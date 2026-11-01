
import { directSpawn } from '@/modules/spawning';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { UNITS } from '@/constant/CreepConstant';
import { parseShardRoomName } from '@/utils/shardRoom';
import { cleanupOutboxAgainstRemoteAcks, getKnownShardNames, publishExpandCreepCounts, publishExpandPlanSummary, publishExpandStatus, pullIncomingCommands, readInterShardLocalRoot, readInterShardRemoteRoot, removePublishedExpandPlan } from '@/modules/intershard';
import { getBotMemory, getMissionPools } from '@/core/store/accessor';
import { getExpandCreepCountsAll } from '@/utils/creepTickIndex';

type LocalExpandPlan = {
    id: string;
    homeShard: string;
    homeRoom: string;
    targetRoom: string;
    desired: { claimer: number; builder: number; carry: number; upgrader: number };
    status: 'running' | 'paused' | 'done';
    created: number;
    updated: number;
    lastSpawnTick?: number;
    /** 孵化否决追踪 (任务 8.5 可观测): 最近原因/首次/连续计数 (内存态, 不发布全量) */
    lastDeny?: { reason: string; first: number; count: number };
};

/** intershard 命令丢弃审计记录 (任务 8.6): 环形缓冲上限有界 */
type ExpandDenyRecord = { time: number; id: string; type: string; fromShard: string; reason: string };

/** denyLog 环形上限 (任务 8.6): 40 条 × ~120B ≈ 5KB, Memory 有界 */
const INTERSHARD_DENY_LOG_MAX = 40;

type LocalExpandMemory = {
    v: number;
    plans: Record<string, LocalExpandPlan>;
};

const getLocalExpandMemory = (): LocalExpandMemory => {
    const mem = getBotMemory() as any;
    if (!mem.Expand || typeof mem.Expand !== 'object') mem.Expand = { v: 1, plans: {} };
    if (!mem.Expand.plans || typeof mem.Expand.plans !== 'object') mem.Expand.plans = {};
    return mem.Expand as LocalExpandMemory;
};

const getExpandCreepCounts = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, number>> = {};
    return () => {
        if (cachedTick === Game.time) return cached;
        cachedTick = Game.time;

        const localCounts = getExpandCreepCountsAll();
        publishExpandCreepCounts(localCounts);

        const merged: Record<string, Record<string, number>> = {};
        for (const planId in localCounts) {
            merged[planId] = { ...localCounts[planId] };
        }

        const maxStale = 100;
        for (const shardName of getKnownShardNames()) {
            if (shardName === Game.shard.name) continue;
            const remote = readInterShardRemoteRoot(shardName);
            const map = remote.expandCreepCounts;
            if (!map || typeof map !== 'object') continue;
            for (const [planId, entry] of Object.entries(map)) {
                if (!entry || typeof entry !== 'object') continue;
                const time = (entry as any).time;
                if (typeof time === 'number' && Game.time - time > maxStale) continue;
                const units = (entry as any).units;
                if (!units || typeof units !== 'object') continue;
                for (const [unit, count] of Object.entries(units)) {
                    if (typeof count !== 'number') continue;
                    merged[planId] ??= {};
                    merged[planId][unit] = (merged[planId][unit] || 0) + count;
                }
            }
        }

        cached = merged;
        return cached;
    };
})();

const getExpandSpawnCounts = (room: Room, expandId: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    const tasks = room.getAllMissionFromPool?.(MISSION_POOLS.spawn) || [];
    for (const task of tasks) {
        if (!task || task.type !== 'spawn') continue;
        const mem = (task.data as any)?.memory;
        if (!mem || mem.expandId !== expandId) continue;
        const unit = mem.unit || 'unknown';
        counts[unit] = (counts[unit] || 0) + 1;
    }
    return counts;
};

const shouldComplete = (plan: LocalExpandPlan): boolean => {
    const { shard, roomName } = parseShardRoomName(plan.targetRoom);
    if (shard && shard !== Game.shard.name) return false;
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) return false;
    if (!room.spawn || room.spawn.length === 0) return false;
    if (room.find(FIND_CONSTRUCTION_SITES).length > 0) return false;
    return true;
};

const isRemoteDone = (plan: LocalExpandPlan): boolean => {
    const { shard } = parseShardRoomName(plan.targetRoom);
    if (!shard || shard === Game.shard.name) return false;
    const remote = readInterShardRemoteRoot(shard);
    const st = remote.status?.[plan.id];
    return !!(st && st.state === 'done');
};

const applyCmds = (mem: LocalExpandMemory) => {
    const cmds = pullIncomingCommands();
    for (const cmd of cmds) {
        if (!cmd) continue;
        // 命令审计 (任务 8.6): 任何被丢弃的命令必留痕——原因码 + tick 记入
        // denyLog 环形缓冲 (上限 INTERSHARD_DENY_LOG_MAX, 可经 expand.diag 查询);
        // 无静默丢弃 = 调度意图全链路可审计
        const deny = (reason: string): void => {
            const log = ((mem as LocalExpandMemory & { denyLog?: ExpandDenyRecord[] }).denyLog ??= []);
            log.push({ time: Game.time, id: cmd.id, type: cmd.type, fromShard: cmd.fromShard, reason });
            if (log.length > INTERSHARD_DENY_LOG_MAX) log.splice(0, log.length - INTERSHARD_DENY_LOG_MAX);
            console.log(`[isshard.deny] ${cmd.type} ${cmd.id} from=${cmd.fromShard}: ${reason}`);
        };
        if (cmd.type === 'expand.set') {
            const p = cmd.payload as any;
            if (!p || !p.id) {
                deny('payload 缺 id');
                continue;
            }
            if (p.homeShard && p.homeShard !== Game.shard.name) {
                deny(`homeShard=${p.homeShard} 非本 shard`);
                continue;
            }
            mem.plans[p.id] = {
                id: p.id,
                homeShard: p.homeShard,
                homeRoom: p.homeRoom,
                targetRoom: p.targetRoom,
                desired: p.desired,
                status: p.status || 'running',
                created: p.created || Game.time,
                updated: Game.time
            };
            publishExpandPlanSummary({ ...mem.plans[p.id] } as Parameters<typeof publishExpandPlanSummary>[0]);
        } else if (cmd.type === 'expand.pause' || cmd.type === 'expand.resume') {
            const p = cmd.payload as any;
            const plan = mem.plans[p?.id];
            if (!plan) {
                deny(`plan ${p?.id} 不存在`);
                continue;
            }
            plan.status = cmd.type === 'expand.pause' ? 'paused' : 'running';
            plan.updated = Game.time;
            publishExpandPlanSummary({ ...plan });
            publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: plan.status });
        } else if (cmd.type === 'expand.remove') {
            const p = cmd.payload as any;
            const id = p?.id;
            if (!id) {
                deny('payload 缺 id');
                continue;
            }
            const plan = mem.plans[id];
            if (!plan) {
                deny(`plan ${id} 不存在 (已移除或从未落本 shard)`);
            } else if (plan.homeRoom) {
                cleanupExpandSpawnMissions(plan.homeRoom, id);
            } else {
                for (const roomName of Object.keys(getMissionPools() || {})) {
                    cleanupExpandSpawnMissions(roomName, id);
                }
            }
            publishExpandStatus(id, { shard: Game.shard.name, time: Game.time, state: 'removed' });
            delete mem.plans[id];
            removePublishedExpandPlan(id, true);
        } else {
            deny('未知命令类型');
        }
    }
};

const cleanupExpandSpawnMissions = (roomName: string, expandId: string): number => {
    const pools = getMissionPools()?.[roomName];
    const tasks = pools?.spawn;
    if (!Array.isArray(tasks) || tasks.length === 0) return 0;

    let removed = 0;
    const remaining: Task[] = [];

    for (const task of tasks) {
        const mem = (task as any)?.data?.memory;
        if (mem?.expandId === expandId) {
            removed++;
            continue;
        }
        remaining.push(task as any);
    }

    pools!.spawn = remaining as any;
    // 若房间可见则清理 Room 实例上的 spawn 任务计数缓存
    const room = Game.rooms[roomName];
    if (room) {
        delete (room as any)._spawnMissionNumCache;
        delete (room as any)._spawnMissionNumCacheTick;
    }

    return removed;
};

const closePlan = (mem: LocalExpandMemory, plan: LocalExpandPlan) => {
    plan.status = 'done';
    plan.updated = Game.time;
    if (plan.homeRoom) {
        cleanupExpandSpawnMissions(plan.homeRoom, plan.id);
    } else {
        for (const roomName of Object.keys(getMissionPools() || {})) {
            cleanupExpandSpawnMissions(roomName, plan.id);
        }
    }
    publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: 'done' });
    delete mem.plans[plan.id];
    removePublishedExpandPlan(plan.id, true);
};

const runOnePlanInRoom = (mem: LocalExpandMemory, room: Room, plan: LocalExpandPlan, creepCounts: any) => {
    if (plan.status !== 'running') return;
    if (plan.homeRoom !== room.name) return;

    if (isRemoteDone(plan)) {
        closePlan(mem, plan);
        return;
    }

    if (shouldComplete(plan)) {
        closePlan(mem, plan);
        return;
    }

    const spawnCounts = getExpandSpawnCounts(room, plan.id);
    const unitCount = (unit: string) => (creepCounts[plan.id]?.[unit] || 0) + (spawnCounts[unit] || 0);

    // aid-* 死角色裁撤 (bugs/role-registry-executor-gap): 跨 shard 援建改用主线活体
    // (worker/carrier/upgrader 任务板执行器齐全), 显式体型走 buildBody 能量预算。
    const needClaimer = Math.max(0, plan.desired.claimer - unitCount(UNITS.claimer));
    const needBuilder = Math.max(0, plan.desired.builder - unitCount(UNITS.worker));
    const needCarry = Math.max(0, plan.desired.carry - unitCount(UNITS.carrier));
    const needUpgrader = Math.max(0, plan.desired.upgrader - unitCount(UNITS.upgrader));

    // 扩张链路可观测 (任务 8.5, specs/external-expansion 否决必有原因输出):
    // directSpawn 非零返回码 = 本 tick 孵化否决, 原因码限频上屏 + 状态发布。
    // 全员 ERR_NOT_ENOUGH_RESOURCES 连续超窗 = 计划能量锁死, 升级为 warn。
    const noteSpawnResult = (role: string, rc: number): void => {
        if (rc === OK) {
            delete (plan as Partial<LocalExpandPlan> & { lastDeny?: string }).lastDeny;
            return;
        }
        const reason = `spawn.${role}:${rc}`;
        const denyState = ((plan as { lastDeny?: { reason: string; first: number; count: number } }).lastDeny ??= {
            reason,
            first: Game.time,
            count: 0,
        });
        denyState.count += 1;
        if (denyState.reason !== reason) {
            denyState.reason = reason;
            denyState.first = Game.time;
            denyState.count = 1;
        }
        // 同因持续 5 分钟 = 能量锁死/孵化槽饿死, 提级告警并发布 (跨 shard 可见)
        if (denyState.count === 1 || denyState.count % 60 === 0) {
            const level = denyState.count >= 60 ? "warn" : "info";
            console.log(
                `[expand.deny] ${level === "warn" ? "WARN " : ""}${plan.id} ${room.name}->${plan.targetRoom} ${reason} 连续 ${denyState.count} 次 (自 t${denyState.first})`,
            );
            publishExpandStatus(plan.id, {
                shard: Game.shard.name,
                time: Game.time,
                state: plan.status === "running" ? "running" : plan.status,
                note: reason,
            });
        }
    };
    if (needClaimer > 0) {
        const rc = directSpawn(room, { mode: "direct", unit: UNITS.claimer, memory: { homeRoom: room.name, targetRoom: plan.targetRoom, expandId: plan.id } });
        noteSpawnResult("claimer", rc);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needBuilder > 0) {
        const rc = directSpawn(room, { mode: "direct", unit: UNITS.worker, memory: { homeRoom: room.name, sourceRoom: plan.targetRoom, targetRoom: plan.targetRoom, expandId: plan.id } });
        noteSpawnResult("worker", rc);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needCarry > 0) {
        const rc = directSpawn(room, { mode: "direct", unit: UNITS.carrier, memory: { homeRoom: room.name, sourceRoom: room.name, targetRoom: plan.targetRoom, resource: RESOURCE_ENERGY, expandId: plan.id } });
        noteSpawnResult("carrier", rc);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
    if (needUpgrader > 0) {
        const rc = directSpawn(room, { mode: "direct", unit: UNITS.upgrader, memory: { homeRoom: room.name, targetRoom: plan.targetRoom, expandId: plan.id } });
        noteSpawnResult("upgrader", rc);
        if (rc === OK) plan.lastSpawnTick = Game.time;
        return;
    }
};

const publishRemoteCompletions = () => {
    const myShard = Game.shard.name;
    const seen = new Set<string>();
    for (const shardName of getKnownShardNames()) {
        const root = shardName === myShard ? readInterShardLocalRoot() : readInterShardRemoteRoot(shardName);
        const plans = Object.values(root.plans || {});
        for (const p of plans) {
            if (!p || seen.has(p.id)) continue;
            seen.add(p.id);
            const { shard } = parseShardRoomName(p.targetRoom);
            if (shard !== myShard) continue;
            if (shouldComplete(p as any)) {
                publishExpandStatus(p.id, { shard: myShard, time: Game.time, state: 'done' });
            }
        }
    }
};

export const ExpandController = {
    run() {
        if (Game.time % 5 !== 0) return;
        if (Game.time % 50 === 0) cleanupOutboxAgainstRemoteAcks();
        const mem = getLocalExpandMemory();
        applyCmds(mem);

        publishRemoteCompletions();

        const creepCounts = getExpandCreepCounts();
        const plans = Object.values(mem.plans || {});
        if (!plans.length) return;
        for (const plan of plans) {
            if (!plan) continue;
            const room = Game.rooms[plan.homeRoom];
            if (room && room.controller?.my) {
                runOnePlanInRoom(mem, room, plan, creepCounts);
            }
            if (mem.plans[plan.id]) {
                publishExpandPlanSummary({ ...plan });
                publishExpandStatus(plan.id, { shard: Game.shard.name, time: Game.time, state: plan.status });
            }
        }
    }
};
