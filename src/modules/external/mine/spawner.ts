
/**
 * 外矿孵化层: 各角色（采集/搬运/防御/预定/建造）的派单决策与孵化容量准入。
 */

import { deleteMissionFromPool } from '@/modules/spawning';
import { CARRY_STAFFING_CONFIG } from '@/config/economy';
import { getRoomMode, getRoomModeProfile } from '@/modules/strategy';
import { UNITS, UnitData, type UnitId } from '@/constant/CreepConstant';
import { decompressBodyConfig } from '@/utils/compress';
import { buildHaulerBodyConfig, buildOutBuildBody, buildRemoteMinerBody } from '@/utils/remoteBody';
import { getCreepByTargetRoom } from '@/utils/creepTickIndex';
import { getRoomTickCacheValue } from '@/utils/roomTickCache';
import { countPendingEconomyMissions, countPendingMissions, OUTMINE_CARRY_ROLE_SET, OUTMINE_HARVEST_ROLE_SET, shouldDropPlannedMission, sortOutMineSpawnTargets } from '@/modules/external/externalScheduler';
import { ExternalMineState } from '@/modules/external/mine/state';
import { ExternalMineMath } from '@/modules/external/mine/math';
import { ExternalMineAnalysis } from '@/modules/external/mine/analysis';
import { EXTERNAL_MINE_ANALYSIS } from '@/modules/external/mine/shared';

export const ExternalMineSpawner = {
    // 各角色任务优先级，统一从角色配置读取。
    // 注意：采集工/搬运工入队走专属流水线层级（采集 12 严格优先于搬运 13，见下），
    // 这里的 harvest/carry 只用于角色对齐与阅读参考，不再直接作为入队等级。
    PRIORITY: {
        reserver: UnitData[UNITS.reserver].level,
        harvest: 12,
        carry: 13,
        scout: UnitData[UNITS.scout].level,
        build: UnitData[UNITS[UNITS['out-build']]].level,
        mineral: UnitData[UNITS[UNITS['out-mineral']]].level,
    } as const,

    // 采集与搬运的孵化层级：采集(12) 严格优先于搬运(13)，两者都直接读角色配置
    // （词表删键后固化为字面量：采集 12 / 搬运 13，仅作挂单排序口径）。
    // 曾经同层排队（先采后运、谁缺谁先补），但搬运定编（3-4/房）远大于采集定编（1-2/房），
    // 同层先到先孵会让存量搬运任务排在采集补位前面——采集工全灭的房补不上人，
    // 而搬运闸又因为「有排队中的采集工」继续派搬运，形成循环饥饿
    // （线上实例：外矿房长期零采集工在岗、容器空转）。
    // 分层语义：任何缺采集的房先把采集补上（12 压过所有搬运）；
    // 有采集在岗的房不存在竞争中的采集任务，其搬运不会被别房的采集饿死。
    // 搬运的「在场产出闸」（carry）与之配套：没有在场采集工的房根本不派搬运。
    OUTMINE_HARVEST_PIPELINE_LEVEL: 12,
    OUTMINE_CARRY_PIPELINE_LEVEL: 13,
    // rush 管线等级（孵化层序：分发/采集搬运 > 升级 > 建造）：
    // 收入链（矿工 OH + 搬运 OC）整体压在升级前面，升级压在建造前面。
    // 升级不饿死的保障不是层级，而是升级定编有界（=实测收入 + 底火）——
    // 收入链先满、升级池封顶，谁也饿不死谁（自洽闭环）。
    // 旧口径（升级 7 > 搬运 8）的震荡根源：升级单常态缺编 → 永远插队搬运 →
    // 搬运饿死 → 收入掉 → 升级定编跟着掉 → 同步崩（attempt 19/20 实测 RCL4@25k）。
    OUTMINE_RUSH_HARVEST_LEVEL: 4,
    OUTMINE_RUSH_CARRY_LEVEL: 5,
    // 积压饥荒层：常态 L5 已在升级(7)/建造(9) 之上，饥荒不再额外升层（留位未来调）
    OUTMINE_RUSH_CARRY_FAMINE_LEVEL: 5,

    // 换班接力优先级：目标房仍有在岗采集工、但 TTL 覆盖不足时的接替孵化等级。
    // 高于本地 worker(8)（换班爬绝不被建造/升级无限插队），低于内部保命线
    // （universal=0 / manager=1 / transporter=2 / harvester=3）——生命线优先，其次无缝接力。
    OUTMINE_REPLACEMENT_LEVEL: 5,

    // 单个目标房在 spawn 池中允许挂的外矿任务上限（按角色分列）。
    // 外矿体型很大（RCL8 搬运工 48 格 ≈ 144 tick 孵化），单房一次把定编全塞进队列，
    // 就会独占总 spawn 数百 tick，其它外矿房一个 creep 都排不上；
    // 等终于轮到它们时又是一次性批量产出。上限 + 每 tick 补员 ⇒ 队列自然轮转。
    // - 采集工额度 = 单源定编（RCL≥4 每源 1 个，两源房正好 2），刚好排满不浪费；
    // - 搬运工额度是大头，压到 3 条，把它对 spawn 的占用摊到多个外矿房上。
    OUTMINE_HARVEST_PENDING_CAP: 2,
    // rush 接力口径：OH 是收入源头，挂单额度大于搬运（先矿后车）
    OUTMINE_HARVEST_PENDING_CAP_RUSH: 2,
    OUTMINE_CARRY_PENDING_CAP: 3,
    // rush 接力车道（C4 微型件）的搬运挂单额度
    OUTMINE_CARRY_PENDING_CAP_RELAY: 3,

    // 触发“双人防御”模式的最低 RCL。
    DOUBLE_DEFEND_MIN_LEVEL: 7,

    getSpawnTaskData(task: Task | null | undefined): SpawnTask | null {
        const data = task?.data;
        if (!data || typeof data !== 'object' || !('memory' in data)) return null;
        return data as SpawnTask;
    },

    getSpawnTaskMemory(task: Task | null | undefined): CreepMemory | null {
        return this.getSpawnTaskData(task)?.memory || null;
    },

    // 统计本源房 spawn 池里、发往某目标房、且角色落在给定集合内的任务数。
    countPendingMissions(sourceRoom: Room, targetRoomName: string, unitSet: ReadonlySet<string>): number {
        const memories = (sourceRoom.getAllMissionFromPool?.('spawn') || [])
            .map((task) => this.getSpawnTaskMemory(task));
        return countPendingMissions(memories, sourceRoom.name, targetRoomName, unitSet);
    },

    // 统计本源房 spawn 池里、发往某目标房的外矿经济任务数（采集 + 搬运）。
    // 这是派单排序用的「挂单量」：挂单少的房先补员，避免单房独占总 spawn。
    countPendingEconomyTasks(sourceRoom: Room, targetRoomName: string): number {
        const memories = (sourceRoom.getAllMissionFromPool?.('spawn') || [])
            .map((task) => this.getSpawnTaskMemory(task));
        return countPendingEconomyMissions(memories, sourceRoom.name, targetRoomName);
    },

    // 外矿补员派单顺序：先近后远 + 负载均衡（排序规则见 externalScheduler）。
    // 主键线性距离升序，次键该目标房已挂单数升序，末键房名。
    orderTargetsForSpawn(sourceRoom: Room, targetRoomNames: string[]): string[] {
        return sortOutMineSpawnTargets(targetRoomNames.map((roomName) => ({
            roomName,
            distance: ExternalMineState.getTargetPriorityDistance(sourceRoom, roomName),
            pending: this.countPendingEconomyTasks(sourceRoom, roomName),
        })));
    },

    // 清空本源房 spawn 池里「上一轮」的外矿经济任务。
    // 每轮派单都会按当前需求 + 先近后远重新铺一遍队列，残留旧任务必须先作废，
    // 否则：① 旧任务永远占着队头，「先近后远」只作用于追加位置、实际顺序仍是旧顺序；
    // ② 旧任务把单房挂单额度占满，新任务永远排不进去，外矿补员被整体冻结。
    // （线上实测：165 条挂单里 77 条是早期 level=15 的遗留搬运任务，
    //   结果所有外矿房 0 个采集工、补员一条都排不进来。）
    clearPlannedEconomyMissions(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let removed = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!shouldDropPlannedMission(memory, sourceRoom.name)) continue;
            deleteMissionFromPool(sourceRoom.name, 'spawn', task.id);
            removed++;
        }
        return removed;
    },

    // 采集工挂单是否已达上限。采集工定编小、又是搬运的前置，
    // 所以额度独立：搬运队列排满也不能挡住采集工补员（否则断档后要等一整个搬运周期）。
    isHarvestAtPendingCap(sourceRoom: Room, targetRoomName: string): boolean {
        const cap = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_HARVEST_PENDING_CAP_RUSH
            : this.OUTMINE_HARVEST_PENDING_CAP;
        return this.countPendingMissions(sourceRoom, targetRoomName, OUTMINE_HARVEST_ROLE_SET)
            >= cap;
    },

    // 搬运工挂单是否已达上限。搬运工体型最大（RCL8 48 格 ≈144 tick），是最需要限流的一方。
    isCarryAtPendingCap(sourceRoom: Room, targetRoomName: string): boolean {
        // rush 接力车道用 C4 微型件（300 能量 15-20t 孵化），单房占 spawn 风险低，
        // 挂单额度放大让车道密度快速到位
        const cap = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_CARRY_PENDING_CAP_RELAY
            : this.OUTMINE_CARRY_PENDING_CAP;
        return this.countPendingMissions(sourceRoom, targetRoomName, OUTMINE_CARRY_ROLE_SET)
            >= cap;
    },

    // 统计某房间针对某目标房间的排队刷怪数量（仅本房间任务池）。
    getQueuedSpawnUnitNumByTarget(sourceRoom: Room, unit: string, targetRoomName: string): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!memory?.unit) continue;
            if (memory.unit !== unit) continue;
            if ((memory.targetRoom || '') !== targetRoomName) continue;
            const taskSourceRoom = memory.sourceRoom;
            if (taskSourceRoom && taskSourceRoom !== sourceRoom.name) continue;
            count++;
        }
        return count;
    },

    // 统计全局所有房间针对某目标房间的排队刷怪数量（可选按 sourceRoom 过滤）。
    getQueuedSpawnUnitNumByTargetGlobal(unit: string, targetRoomName: string, sourceRoomName?: string): number {
        let count = 0;
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            const tasks = room.getAllMissionFromPool?.('spawn') || [];
            for (const task of tasks) {
                const memory = this.getSpawnTaskMemory(task);
                if (!memory?.unit) continue;
                if (memory.unit !== unit) continue;
                if ((memory.targetRoom || '') !== targetRoomName) continue;
                if (sourceRoomName) {
                    const taskSourceRoom = memory.sourceRoom;
                    if (taskSourceRoom && taskSourceRoom !== sourceRoomName) continue;
                }
                count++;
            }
        }
        return count;
    },

    // 统计全局某角色在目标房间的存活数量。
    getActiveRoleNumByTarget(unit: string, targetRoomName: string): number {
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.unit !== unit) continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            count++;
        }
        return count;
    },

    // 统计“本 tick 已经开始孵化，但尚未进入 Game.creeps 活体索引”的数量。
    // Screeps 的状态结算按 tick 延后，spawn 成功后任务会先从队列移除；
    // 若此时不补上 spawning 中的单位，就会出现 1 tick 的统计空窗，从而重复补单。
    getSpawningRoleNumByTargetGlobal(unit: string, targetRoomName: string, sourceRoomName?: string): number {
        let count = 0;
        for (const spawnName in Game.spawns) {
            const spawn = Game.spawns[spawnName];
            const spawning = spawn?.spawning;
            if (!spawning?.name) continue;
            // 下一 tick creep 已经进入 Game.creeps 时，由 active 统计接管，避免重复计数。
            if (Game.creeps[spawning.name]) continue;

            const memory = Memory.creeps?.[spawning.name] as CreepMemory | undefined;
            if (!memory?.unit) continue;
            if (memory.unit !== unit) continue;
            if ((memory.targetRoom || '') !== targetRoomName) continue;
            if (sourceRoomName) {
                const taskSourceRoom = memory.sourceRoom;
                if (taskSourceRoom && taskSourceRoom !== sourceRoomName) continue;
            }
            count++;
        }
        return count;
    },

    // 统计某房间自身任务池里某角色排队数量（不关心 targetRoom）。
    getQueuedSpawnRoleNumBySource(sourceRoom: Room, unit: string): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let count = 0;
        for (const task of tasks) {
            const memory = this.getSpawnTaskMemory(task);
            if (!memory?.unit) continue;
            if (memory.unit !== unit) continue;
            if (memory.sourceRoom !== sourceRoom.name) continue;
            count++;
        }
        return count;
    },

    // spawnInAdvance：TTL 不足以再跑一趟（路程 + 缓冲）的
    // 采集者不计入覆盖数——接替者在其死亡前就提前孵化，新爬到场时老爬刚好耗尽，外矿不断档。
    getEffectiveOutHarvesterNum(sourceRoom: Room, targetRoomName: string): number {
        const travelTicks = getRoomTickCacheValue(sourceRoom, `out_harvest_travel_${targetRoomName}`, () =>
            ExternalMineState.estimateTargetSelectionStat(sourceRoom, targetRoomName).distance
        );
        const minUsefulTtl = travelTicks + 15; // 路程 + 缓冲：跑不完一趟的爬不再计入覆盖
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.unit !== UNITS.harvester || !creep.memory.targetRoom) continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            if (!this.isSameSourceRoom(creep.memory?.sourceRoom, sourceRoom.name)) continue;
            if ((creep.ticksToLive ?? 0) <= minUsefulTtl) continue;
            count++;
        }
        return count;
    },

    // 目标房内「所有存活」采集工数（不限 TTL / 不限源房）。
    // 工位硬上限必须按在场身体数算：换班期快死的爬仍占着工位，
    // 若沿用 getEffectiveOutHarvesterNum 的换班排除口径，会把超额新爬顶进满员房间（No source 根源）。
    getAllLiveOutHarvesterNum(targetRoomName: string): number {
        let count = 0;
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (!creep || creep.memory?.unit !== UNITS.harvester || !creep.memory.targetRoom) continue;
            if (creep.memory?.targetRoom !== targetRoomName) continue;
            count++;
        }
        return count;
    },

    isSameSourceRoom(creepSourceRoom: string | undefined, sourceRoomName: string): boolean {
        if (!creepSourceRoom) return false;
        return creepSourceRoom === sourceRoomName;
    },

    // 侦查：全局与本房均只允许 1 个 scout，以避免重复探路。
    scout(sourceRoom: Room, targetRoomName: string): boolean {
        const globalActive = this.getActiveRoleNumByTarget(UNITS['scout'], targetRoomName);
        const globalQueued = this.getQueuedSpawnUnitNumByTargetGlobal(UNITS['scout'], targetRoomName);
        if (globalActive + globalQueued > 0) return false;

        const activeSourceScouts = Object.values(Game.creeps).filter((creep) =>
            creep &&
            creep.memory?.unit === UNITS.scout &&
            creep.memory.sourceRoom === sourceRoom.name
        ).length;
        const queuedSourceScouts = this.getQueuedSpawnRoleNumBySource(sourceRoom, UNITS['scout']);
        if (activeSourceScouts + queuedSourceScouts > 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoomName);
        const scouts = (creepByTargetRoom[UNITS.scout] || [])
            .filter((c: any) => this.isSameSourceRoom(c?.sourceRoom, sourceRoom.name)).length;
        const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['scout'], targetRoomName);
        if (scouts + spawnNum > 0) return false;

        sourceRoom.SpawnMissionAdd('OS', [], this.PRIORITY.scout, UNITS['scout'], ExternalMineState.createMemory(sourceRoom.name, targetRoomName));
        return true;
    },

    // 常规外矿攻击者（单目标房最多 1 个）。
    requestAttackUnit(sourceRoom: Room, targetRoom: Room): boolean {
        const globalActive = this.getActiveRoleNumByTarget(UNITS['out-attack'], targetRoom.name);
        const globalQueued = this.getQueuedSpawnUnitNumByTargetGlobal(UNITS['out-attack'], targetRoom.name);
        const globalSpawning = this.getSpawningRoleNumByTargetGlobal(UNITS['out-attack'], targetRoom.name);
        if (globalActive + globalQueued + globalSpawning >= 1) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name);
        sourceRoom.SpawnMissionAdd('OA', [], -1, UNITS['out-attack'], memory);
        return true;
    },

    hasKeeperAttackCoverage(targetRoomName: string): boolean {
        const active = this.getActiveRoleNumByTarget(UNITS['out-attack'], targetRoomName);
        const queued = this.getQueuedSpawnUnitNumByTargetGlobal(UNITS['out-attack'], targetRoomName);
        const spawning = this.getSpawningRoleNumByTargetGlobal(UNITS['out-attack'], targetRoomName);
        return active + queued + spawning > 0;
    },

    // 远程攻击者（单目标房最多 1 个）。
    ranged(sourceRoom: Room, targetRoom: Room): boolean {
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerRanged = (creepByTargetRoom[UNITS[UNITS['out-ranged']]] || [])
            .filter((c: any) => c.ticksToLive > 300 || c.spawning);
        const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-ranged'], targetRoom.name);
        if (outerRanged.length + spawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('OR', [], -1, UNITS['out-ranged'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    },

    // ── 外矿孵化容量准入──
    // 单位 = 身体部件数：B 件爬孵化耗 3B tick，每 spawn 每 1500t 窗口产 500×N 部件，
    // 即维持一只 B 件爬恰好消耗 B 单位/窗口。本地在编 + 本地排队单先扣预算，
    // 外矿（在编+排队+新单）占用不得超过剩余量：本地缺编时准入自动收缩为零，
    // 主房成长后外矿规模自动放大——早期照常开张，但不再抽干主房孵化产能。

    /** 任务体型折算部件数（空体型 = 角色默认配置；压缩串 = 解码后求和） */
    resolveMissionBodyParts(sourceRoom: Room, unit: string, body: ((BodyPartConstant | number)[])[] | string): number {
        const sumPairs = (pairs: any): number => {
            if (!Array.isArray(pairs)) return 0;
            let sum = 0;
            for (const item of pairs) {
                sum += Array.isArray(item) ? (Number(item[1]) || 0) : 1;
            }
            return sum;
        };
        if (typeof body === 'string') {
            if (!body) {
                const flat = sourceRoom.GenerateBodys(sourceRoom.GetUnitBodys(unit as UnitId), unit as UnitId);
                return flat?.length ?? 0;
            }
            return sumPairs(decompressBodyConfig(body));
        }
        return sumPairs(body);
    },

    /** 外矿准入判定：剩余孵化容量 ≥ 新单部件数 */
    hasRemoteSpawnBudget(sourceRoom: Room, newParts: number): boolean {
        return this.getRemoteSpawnLeftover(sourceRoom) >= newParts;
    },

    /** 剩余外矿孵化容量（已扣本地计划编成与在编外务；负数 = 本地缺口，外矿全停） */
    getRemoteSpawnLeftover(sourceRoom: Room): number {
        const LIFE = typeof CREEP_LIFE_TIME === 'number' ? CREEP_LIFE_TIME : 1500;
        // 引擎按 `CREEP_SPAWN_TIME × 部件数` 计孵化耗时, 须乘标称部件数, 否则容量高估数倍
        const SPAWN_TIME = (typeof CREEP_SPAWN_TIME === 'number' ? CREEP_SPAWN_TIME : 3)
            * CARRY_STAFFING_CONFIG.nominalCreepParts;
        const capacity = Math.max(1, (sourceRoom.spawn || []).length) * Math.floor(LIFE / SPAWN_TIME);
        let localDemand = 0;
        let remoteUsed = 0;
        for (const creep of Object.values(Game.creeps)) {
            const unit = creep?.memory?.unit || '';
            if (!unit) continue;
            if (unit.startsWith('out-') || unit === UNITS.reserver) remoteUsed += creep.body.length;
            else if (unit !== UNITS.harvester) localDemand += creep.body.length;
        }
        const tasks = (sourceRoom.getAllMissionFromPool?.('spawn') || []) as any[];
        for (const task of tasks) {
            const unit = task?.data?.memory?.unit as string | undefined;
            if (!unit) continue;
            const parts = this.resolveMissionBodyParts(sourceRoom, unit, task?.data?.body);
            if (unit.startsWith('out-') || unit === UNITS.reserver) remoteUsed += parts;
            else localDemand += parts;
        }
        // 本地源计划编成带距离因子：
        // 矿工补员率×路途折损 + 搬运吞吐×距离——源越远本地占预算越高，
        // harvester 在编部分由计划编成代表，不重复计入。
        // pathTime 钳制 60：同房源不可能超出（早期堵路/寻路抖动的坏采样会
        // 把权重虚增到百位级，直接饿死整个外矿准入）
        const timing = (sourceRoom.memory as any).sourceTiming ?? {};
        const sources = (sourceRoom.source || []) as Source[];
        for (const source of sources) {
            const rawPathTime = timing[source.id]?.pathTime ?? 20;
            const pathTime = Math.min(60, Math.max(10, Number(rawPathTime) || 20));
            localDemand += 7 * (LIFE / Math.max(200, LIFE - pathTime)) + pathTime * 0.04 * 10 * 2;
        }
        return capacity - localDemand - remoteUsed;
    },

    /** 外矿经济单统一入口：过容量准入闸再落单（战争/防御/侦察单不走此闸） */
    addEconomyMission(sourceRoom: Room, name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, unit: string, memory: any): boolean {
        if (!this.hasRemoteSpawnBudget(sourceRoom, this.resolveMissionBodyParts(sourceRoom, unit, body))) return false;
        return sourceRoom.SpawnMissionAdd(name, body, level, unit, memory) === OK;
    },

    // 外矿矿物采集（需要 RCL6+ 且单房仅 1 个）。
    mineral(sourceRoom: Room, targetRoom: Room): boolean {
        if (sourceRoom.level < 6) return false;
        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerMiners = (creepByTargetRoom[UNITS[UNITS['out-mineral']]] || []).length;
        const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-mineral'], targetRoom.name);
        if (outerMiners + spawnNum >= 1) return false;

        return this.addEconomyMission(sourceRoom, 'OMR', [], this.PRIORITY.mineral, UNITS['out-mineral'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
    },

    // 常规防守：根据敌人种类/数量派遣 out-defend 或 out-invader。
    defend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        const invaderCore = targetRoom.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_INVADER_CORE
        });

        if (invaderCore.length === 0 && hostiles.length === 0) return false;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerDefenders = (creepByTargetRoom[UNITS[UNITS['out-defend']]] || []).length;
        const outerInvaders = (creepByTargetRoom[UNITS[UNITS['out-invader']]] || []).length;

        if (hostiles.length > 0) {
            const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-defend'], targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 3;
            else if (sourceRoom.level < 6) maxNum = 2;
            if (outerDefenders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OD', [], -1, UNITS['out-defend'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        if (invaderCore.length > 0) {
            const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-invader'], targetRoom.name);
            let maxNum = 1;
            if (sourceRoom.level < 4) maxNum = 4;
            else if (sourceRoom.level < 6) maxNum = 3;
            else if (sourceRoom.level === 6) maxNum = 2;
            if (outerInvaders + spawnNum >= maxNum) return false;
            sourceRoom.SpawnMissionAdd('OI', [], -1, UNITS['out-invader'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return true;
        }

        return false;
    },

    // 高等级的“双人防守”编队（out-2attack + out-2heal）。
    doubleDefend(sourceRoom: Room, targetRoom: Room, hostiles: Creep[]): boolean {
        if (hostiles.length === 0) return false;

        if (sourceRoom.level < this.DOUBLE_DEFEND_MIN_LEVEL) {
            sourceRoom.deleteSpawnMissionsByRole([UNITS['out-2attack'], UNITS['out-2heal']]);
            return this.defend(sourceRoom, targetRoom, hostiles);
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const out2Attack = (creepByTargetRoom[UNITS[UNITS['out-2attack']]] || []).length || 0;
        const out2AttackSpawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-2attack'], targetRoom.name);
        if (out2Attack + out2AttackSpawnNum >= 1) return false;
        const out2Heal = (creepByTargetRoom[UNITS[UNITS['out-2heal']]] || []).length;
        const out2HealSpawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-2heal'], targetRoom.name);
        if (out2Heal + out2HealSpawnNum >= 1) return false;

        sourceRoom.SpawnMissionAdd('', [], -1, UNITS['out-2attack'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        sourceRoom.SpawnMissionAdd('', [], -1, UNITS['out-2heal'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
        return true;
    },

    // 外矿采集者：根据源数、站位上限与 body 配置决定目标数量。
    // targetRoom 可为 null（无视野）：此时优先用 scout 记录的工位数做离线口径；
    // 拿不到记录就退回「源数 × 每源编制」补给——绝不因视野丢失而停发采集工，
    // 否则外矿一次视野间隙（采集工死光 → 没视野 → 不再补位）就会整体停摆。
    harvester(sourceRoom: Room, targetRoom: Room | null, targetRoomName: string, sourceNum: number, upbody?: boolean, slotCapOverride?: number): boolean {
        let slotCap: number | null;
        if (targetRoom) {
            slotCap = ExternalMineMath.getOutHarvesterSlotCap(targetRoom);
        } else if (typeof slotCapOverride === 'number') {
            slotCap = slotCapOverride;
        } else {
            slotCap = ExternalMineMath.getRecordedOutHarvesterSlotCap(targetRoomName);
        }
        const targetNum = ExternalMineMath.calcOutHarvesterTargetNum(sourceRoom, sourceNum, upbody, slotCap ?? undefined);
        if (targetNum <= 0) return false;

        // 采集工挂单上限：本房已排够采集任务就本轮不补，把 spawn 让给其它外矿房，
        // 否则一房会把定编一次性塞满队列、独占总 spawn。
        if (this.isHarvestAtPendingCap(sourceRoom, targetRoomName)) return false;

        // 多母房共享同一个 targetRoom 时，OH 数量只按 targetRoom 全局控制，
        // 不再按 sourceRoom 各自算一遍，避免多个源房叠加超孵化。
        // spawnInAdvance：快死的采集者不计入覆盖——接替者提前孵化，外矿不断档
        const globalEffective = this.getEffectiveOutHarvesterNum(sourceRoom, targetRoomName);
        const globalQueued = this.getQueuedSpawnUnitNumByTargetGlobal(UNITS.harvester, targetRoomName);
        const globalSpawning = this.getSpawningRoleNumByTargetGlobal(UNITS.harvester, targetRoomName);
        if (globalEffective + globalQueued + globalSpawning >= targetNum) return false;
        // 工位闸用「所有存活 + 排队 + 孵化中」：换班排除只服务于定编覆盖，不作用于工位上限
        if (slotCap !== null && slotCap > 0) {
            const globalAllLive = this.getAllLiveOutHarvesterNum(targetRoomName);
            if (globalAllLive + globalQueued + globalSpawning >= slotCap) return false;
        }

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoomName);
        // 换班接力：目标房还有本源房的采集工在岗、但 TTL 覆盖已不足——
        // 接替孵化必须抢在本地 worker 之前，否则排队时间让老爬先死，采集断档、
        // 搬运工集体闲置（无缝接力的核心）。
        const isReplacement = this.getAllLiveOutHarvesterNum(targetRoomName) > 0;
        const rushPipelineLevel = getRoomMode(sourceRoom) === 'rush'
            ? this.OUTMINE_RUSH_HARVEST_LEVEL
            : this.OUTMINE_HARVEST_PIPELINE_LEVEL;
        // rush 换班也让位升级（L9）：换班单 E700 比升级体型 E750 便宜，若留在 L5
        // 会把 extension 永远压在 700 以下，升级工饿死（单 spawn 优先级霸权）。
        // 代价：换班延迟到升级池清空的窗口，采集短暂断档后恢复。
        const replaceLevel = isReplacement
            ? (getRoomMode(sourceRoom) === 'rush' ? this.OUTMINE_RUSH_CARRY_LEVEL : this.OUTMINE_REPLACEMENT_LEVEL)
            : rushPipelineLevel;
        if (upbody) {
            return this.addEconomyMission(sourceRoom, 'OH', [[WORK, 16], [CARRY, 6], [MOVE, 8]], replaceLevel, UNITS.harvester, memory);
        } else {
            // 体型按当前预算最大化（WORK 优先补到 5、move 保持 0.5 机动比、
            // 自带 1 CARRY 自补）——LOW/CRITICAL 时预算取当前可用能量（
            // 饥荒期也要出得起小体型，[W2,M1,C1] 仍有 4/tick 产出），否则全款体型
            // 在贫困房永远攒不齐，外矿会集体老死断供（死亡螺旋）；
            // 每轮派单都按当时预算重新生成，能量回升自动出满配 5W。
            // rush 同口径（参考 getMinerBody 的 income 语义）：RCL2-3 容量 300-500 时
            // 满水体 450-550 而房间常驻 150-450，不缩水 = 外矿永远进不了场、
            // 升级线整段断粮；「缩水体低效」的代价远小于「零外矿」
            const energyState = ExternalMineState.getEnergyState(sourceRoom);
            const rushMode = getRoomMode(sourceRoom) === 'rush';
            const energyBudget = (energyState === 'LOW' || energyState === 'CRITICAL')
                ? Math.max(300, sourceRoom.energyAvailable)
                : sourceRoom.energyCapacityAvailable;
            // rush 不带自携 CARRY（[W5,M1,C1]=600 > 550，装箱成 [W4,C1,M2] →
            // perSource=ceil(5/4)=2 超编挖）：掉落由外矿车队收取，
            // 550 恰好 [W5,M1] 满效 10e/t，每源 1 只定编
            const body = buildRemoteMinerBody(energyBudget, 5, !rushMode);
            return this.addEconomyMission(sourceRoom, 'OH', body, replaceLevel, UNITS.harvester, memory);
        }
    },

    // 外矿运输者：以 carrier 角色孵化，走外矿工作位分支。
    carry(sourceRoom: Room, targetRoom: Room, num: number): boolean {
        // 决策轨迹：拒绝原因进环形缓冲，诊断采样读取（定位搬运断供）
        const trace = (reason: string): false => {
            const g = globalThis as any;
            const buf = g.__carryTrace ?? (g.__carryTrace = []);
            buf.push({ t: Game.time, room: targetRoom.name, why: reason });
            if (buf.length > 12) buf.shift();
            return false;
        };
        // 在场产出闸：目标房必须有「正在产出」的采集工（在场且有采集能力）才派搬运。
        // 在途/排队的采集工不算——到场前没有产出，先派搬运只会空跑一趟。
        // 采集工断档期：排队中的搬运任务由每轮重铺自然清空（clearPlannedEconomyMissions），
        // 在场存量搬运工照常把容器余量搬完，采集工到场后下一轮即恢复派送。
        if (!ExternalMineAnalysis.getOnSiteHarvesterRoomSet(sourceRoom).has(targetRoom.name)) {
            return trace('no-on-site-harvester');
        }

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerCarry = (creepByTargetRoom[UNITS.carrier] || [])
            .filter((c: any) => c.sourceRoom === sourceRoom.name).length;

        const spawnCarryNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS.carrier, targetRoom.name);
        // 体型按当前预算最大化 CARRY（走路段 [C,C,M] 整组扩展）——LOW/CRITICAL 时
        // 预算取当前可用能量（同采集工口径：贫困房也要出得起小搬运，能量回升
        // 每轮派单自动升回满配）。rush 例外：抽水造成的 LOW 不降级收入引擎，
        // 否则小体型搬运 → 同吞吐要更多只 → 队列更堵 → 更穷的螺旋。
        // 接力定尺（接力体型 CARRY 定尺 4）：rush（lv<7 恒接力）
        // 用微型件 [C4,M2]=200 容量——接力链靠相向交接让货物单 tick 前进两格，
        // 单位密度 > 单件容量；lv≥7 直运大件（maxCarry 16，来回整坑）。
        // 体型按当前可用能量出（以 room.energyAvailable 为预算），
        // LOW/CRITICAL 时小件保底、能量回升自动升回满配（rush 抽水造成的 LOW 不降级）。
        const energyState = ExternalMineState.getEnergyState(sourceRoom);
        const carryRush = getRoomMode(sourceRoom) === 'rush';
        const energyBudget = carryRush
            ? Math.max(150, sourceRoom.energyAvailable)
            : (energyState === 'LOW' || energyState === 'CRITICAL')
                ? Math.max(150, sourceRoom.energyAvailable)
                : sourceRoom.energyCapacityAvailable;
        const carryBody = buildHaulerBodyConfig(energyBudget, { forRoad: true, maxCarry: carryRush ? 4 : 16 });

        const totalCarry = outerCarry + spawnCarryNum;
        // 车队上限：接力链按吞吐定编（num 自适应），绝对上限只防病态堆积
        const fleetCap = 24;
        if (totalCarry < Math.min(num, fleetCap)) {
            // 搬运工挂单上限：体型最大（RCL8 48 格 ≈144 tick），不设限就会一房独占 spawn。
            if (this.isCarryAtPendingCap(sourceRoom, targetRoom.name)) return trace('pending-cap');
            const carryLevel = getRoomMode(sourceRoom) === 'rush'
            ? (this.isCarryFamine(sourceRoom, targetRoom.name)
                ? this.OUTMINE_RUSH_CARRY_FAMINE_LEVEL
                : this.OUTMINE_RUSH_CARRY_LEVEL)
            : this.OUTMINE_CARRY_PIPELINE_LEVEL;
            const admitted = this.addEconomyMission(sourceRoom, 'OC', carryBody, carryLevel, UNITS.carrier, ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
            return admitted ? true : trace('budget');
        }

        return trace(`satisfied(${totalCarry}>=${Math.min(num, fleetCap)})`);
    },

    // 外矿积压是否处于严重饥荒：可用积压（扣除在场搬运预定）过严重线。
    // 饥荒期 OC 升层重建、建造派单让位——能量优先回流收入管线。
    isCarryFamine(sourceRoom: Room, targetRoomName: string): boolean {
        const backlog = ExternalMineAnalysis.getManagedRoomBacklogMap(sourceRoom)[targetRoomName] ?? 0;
        return backlog >= EXTERNAL_MINE_ANALYSIS.SEVERE_BACKLOG_THRESHOLD
            * getRoomModeProfile(sourceRoom).remoteCarryBacklogScale;
    },

    // 外矿预定：仅在目标未被占领、且自家预定不足时派遣。
    reserver(sourceRoom: Room, targetRoom: Room): boolean {
        if (!targetRoom.controller || targetRoom.controller.my) return false;
        if (sourceRoom.controller!.level! < 3) return false;

        if (targetRoom.controller.reservation &&
            targetRoom.controller.reservation.username === sourceRoom.controller!.owner!.username! &&
            targetRoom.controller.reservation.ticksToEnd > 1000) return false;

        const outerReservers = this.getActiveRoleNumByTarget(UNITS['reserver'], targetRoom.name);
        const spawnNum = this.getQueuedSpawnUnitNumByTargetGlobal(UNITS['reserver'], targetRoom.name);
        if (outerReservers + spawnNum >= 1) return false;

        // rush 预定提级（L6，升级之前）：reservation 决定 source 容量（有预定 3000/无 1500，
        // 砍半），是外矿收入的倍增器——垫底 L11 会在孵化繁忙期永久饿死
        const reserveLevel = getRoomMode(sourceRoom) === 'rush' ? 6 : this.PRIORITY.reserver;
        return this.addEconomyMission(sourceRoom, '', '', reserveLevel, UNITS['reserver'], ExternalMineState.createMemory(sourceRoom.name, targetRoom.name));
    },

    getBuilderConstructionTargets(targetRoom: Room): ConstructionSite[] {
        return targetRoom.find(FIND_CONSTRUCTION_SITES, {
            filter: (site) => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER
        }) as ConstructionSite[];
    },

    getBuilderRepairTargets(targetRoom: Room): Structure[] {
        return targetRoom.find(FIND_STRUCTURES, {
            filter: (structure) =>
                (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) &&
                structure.hits < structure.hitsMax * 0.8
        }) as Structure[];
    },

    getBuilderWorkCount(targetRoom: Room): number {
        return this.getBuilderConstructionTargets(targetRoom).length + this.getBuilderRepairTargets(targetRoom).length;
    },

    // 外矿建造者：道路/容器存在施工或维修需求时派遣。
    // 不分配 targetSourceId——运行时按「离当前工作目标最近的源」动态取能
    // （见 out-build.ts 的 getAssignedSource），采建同侧、不跨源绑定。
    builder(sourceRoom: Room, targetRoom: Room): boolean {
        // 运力饥荒让位：外矿积压过严重线时暂停建造派单，spawn 周期让给 OC 重建
        //（路网/容器再投资在积压消化后自然恢复——builder 按工地存在性自限）
        if (this.isCarryFamine(sourceRoom, targetRoom.name)) return false;
        const constructionTargets = this.getBuilderConstructionTargets(targetRoom);
        const repairTargets = this.getBuilderRepairTargets(targetRoom);
        const workCount = constructionTargets.length + repairTargets.length;
        if (workCount === 0) return false;
        const repairOnly = constructionTargets.length === 0 && repairTargets.length > 0;

        const creepByTargetRoom = getCreepByTargetRoom(targetRoom.name);
        const outerBuilder = (creepByTargetRoom[UNITS[UNITS['out-build']]] || []).length;
        const spawnNum = this.getQueuedSpawnUnitNumByTarget(sourceRoom, UNITS['out-build'], targetRoom.name);

        let num = 1;
        if (!repairOnly && workCount > 10) num = 2;
        if (outerBuilder + spawnNum >= num) return false;

        const memory = ExternalMineState.createMemory(sourceRoom.name, targetRoom.name) as CreepMemory & {
            outBuildMode?: 'repair';
        };
        if (repairOnly) memory.outBuildMode = 'repair';

        // rush 下 out-build 提到 9（与搬运同层、插队层内）：远程道路/容器是运力引擎，
        // L12 在「等待高优先级能量」语义下永远轮不到（升级池常驻有任务）。
        // 任务本身按工地存在性自限（没工地不下单），提级不会造成空转孵化。
        const buildLevel = getRoomMode(sourceRoom) === 'rush' ? 9 : this.PRIORITY.build;
        // 显式体型：out-build 无 UnitLevelData 分级表，空 body 会被孵化端按 Infinity
        // 成本跳过（结构性无法孵化）。rush 不缩水——建造力就是运力引擎本身。
        const energyState = ExternalMineState.getEnergyState(sourceRoom);
        const buildRush = getRoomMode(sourceRoom) === 'rush';
        const buildBudget = (!buildRush && (energyState === 'LOW' || energyState === 'CRITICAL'))
            ? Math.max(300, sourceRoom.energyAvailable)
            : sourceRoom.energyCapacityAvailable;
        return this.addEconomyMission(sourceRoom, 'OB', buildOutBuildBody(buildBudget), buildLevel, UNITS['out-build'], memory);
    },
};
