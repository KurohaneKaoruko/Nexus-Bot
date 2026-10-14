
/**
 * 任务池被存储在 Memory 的 MissionPools 中，每个 room 独立存储。
 * 其中 transport/mine/terminal 为共享池，通过 task.type 区分具体子任务。
 */

import { decompress } from "@/utils/compress";
import { getMissionPools, sanitizeMissionPoolMemory } from "@/core/store/accessor";
import { MISSION_POOLS } from "@/constant/MissionConstant";

export { sanitizeMissionPoolMemory };

export const MISSION_POOL_NAMES = [
    'transport',
    'build',
    'repair',
    'terminal',
    'spawn',
    'mine',
    'boost',
] as const satisfies readonly MissionPoolName[];

const TASK_TYPE_TO_POOL: Record<MissionTaskType, MissionPoolName> = {
    transport: 'transport',
    manage: 'transport',
    build: 'build',
    repair: 'repair',
    send: 'terminal',
    spawn: 'spawn',
    power: 'mine',
    deposit: 'mine',
    boost: 'boost',
};

const MISSION_POOL_NAME_SET = new Set<string>(MISSION_POOL_NAMES);

type ResolvedMissionPoolState = {
    poolName: MissionPoolName;
    pool: Task[];
};

const createEmptyMissionPoolMemory = (): MissionPoolMemory => ({
    transport: [],
    build: [],
    repair: [],
    terminal: [],
    spawn: [],
    mine: [],
    boost: [],
});

    // 清理本房间 spawn 任务角色计数缓存
    function clearSpawnMissionNumCache(roomName: string): void {
        spawnMissionNumCache.delete(roomName); spawnMissionNumTick.delete(roomName);
    }

    function getRoomMissionPools(roomName: string) {
        const root = getMissionPools();
        if (!root[roomName]) {
            root[roomName] = createEmptyMissionPoolMemory();
            return root[roomName];
        }

        const memory = root[roomName]!;
        const hasInvalidShape = Object.keys(memory).some(key => !MISSION_POOL_NAME_SET.has(key));
        const hasMissingPools = MISSION_POOL_NAMES.some(poolName => !Array.isArray(memory[poolName]!));
        if (hasInvalidShape || hasMissingPools) {
            return sanitizeMissionPoolMemory(memory);
        }
        return memory;
    }

    function resolvePoolState(roomName: string, poolName: MissionPoolName): ResolvedMissionPoolState {
        let memory = getRoomMissionPools(roomName);
        if (!memory) memory = {} as NonNullable<typeof memory>;
        if (!Array.isArray(memory[poolName])) memory[poolName] = [];

        return {
            poolName,
            pool: memory[poolName]!,
        };
    }

    function findTaskIndex(state: ResolvedMissionPoolState, id: Task["id"]) {
        return state.pool.findIndex(task => task.id === id);
    }

    function pushTaskToPool(roomName: string, poolName: MissionPoolName, task: Task) {
        if (!task) return ERR_NOT_FOUND;
        const pool = getRoomMissionPools(roomName)![poolName]!;
        pool.push(task);
        return OK;
    }

    // (私有方法) 生成一个16进制id
    function generateId() {
        const Gametime = Game.time.toString(16);
        const Random = Math.random().toString(16).slice(2, -1);
        return (Gametime + Random).toUpperCase();
    }

    // 任务池初始化
    export function initMissionPool(roomName: string) {
        getRoomMissionPools(roomName);
        return OK;
    }

    // 添加任务到任务池
    export function addMissionToPool(roomName: string, PoolName: MissionPoolName, type: Task["type"], level: Task["level"], data: Task["data"]) {
        const poolName = TASK_TYPE_TO_POOL[type] || PoolName;

        const id = `${type.toUpperCase()}-${generateId()}`;
        const task: Task = { id, type, level, data };
        pushTaskToPool(roomName, poolName, task);
        if (poolName === MISSION_POOLS.spawn) clearSpawnMissionNumCache(roomName);
        return OK;
    }

    // 计算切比雪夫距离
    function getDistance(pos1: number, pos2: number): number {
        const [x1, y1] = decompress(pos1);
        const [x2, y2] = decompress(pos2);
        return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
    }

    // 获取任务池中的任务
    export function getMissionFromPool(roomName: string, PoolName: MissionPoolName, pos?: number, filter?: (task: Task) => boolean) {
        const state = resolvePoolState(roomName, PoolName);

        const check = filter || (() => true);
        let bestTask: Task | null = null;
        let minLevel = Infinity;
        let minDistance = Infinity;

        for (const task of state.pool) {
            if (!task || task.lock) continue;
            if (!check(task)) continue;

            if (task.level < minLevel) {
                minLevel = task.level;
                bestTask = task;
                if (pos != null && 'pos' in task.data && task.data.pos != null) {
                    minDistance = getDistance(task.data.pos, pos);
                } else {
                    minDistance = Infinity;
                }
                continue;
            }

            if (task.level === minLevel && pos != null && 'pos' in task.data && task.data.pos != null) {
                const dist = getDistance(task.data.pos, pos);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestTask = task;
                }
            }
        }

        return bestTask;
    }

    // 不考虑优先级，直接获取第一个任务
    export function getMissionFromPoolFirst(roomName: string, PoolName: MissionPoolName, filter?: (task: Task) => boolean) {
        const state = resolvePoolState(roomName, PoolName);

        const check = filter || (() => true);
        const tasks = state.pool.filter(task =>
            task &&
            !task.lock &&
            check(task)
        );
        if (tasks.length === 0) return null;
        return tasks[0];
    }

    // 获取随机一个任务
    export function getMissionFromPoolRandom(roomName: string, PoolName: MissionPoolName) {
        const state = resolvePoolState(roomName, PoolName);
        const tasks = state.pool;
        if (!tasks.length) return null;
        return tasks[Math.floor(Math.random() * tasks.length)];
    }

    // 获取全部任务
    export function getAllMissionFromPool(roomName: string, PoolName: MissionPoolName) {
        return resolvePoolState(roomName, PoolName).pool;
    }

    // 用id获取任务池中的任务
    export function getMissionFromPoolById(roomName: string, PoolName: MissionPoolName, id: Task["id"]) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return null;
        const index = findTaskIndex(state, id);
        if (index === -1) return null;
        return state.pool[index];
    }

    // 检查是否有相同任务
    export function checkSameMissionInPool(roomName: string, PoolName: MissionPoolName, type: Task["type"], data: Task["data"]) {
        const poolName = TASK_TYPE_TO_POOL[type] || PoolName;
        const tasks = getRoomMissionPools(roomName)![poolName]!;
        if (!tasks.length) return null;

        for (const task of tasks!) {
            if (task.type !== type) continue;
            const sameInPool = Object.keys(data).every(key => (data as any) [key] === (task.data as any) [key]);
            if (!sameInPool) continue;
            return task.id;
        }
        return null;
    }

    // 检查任务池中是否存在任务
    export function checkMissionInPool(roomName: string, PoolName: MissionPoolName) {
        return resolvePoolState(roomName, PoolName).pool.length > 0;
    }

    // 获取任务池中的任务数量
    export function getMissionNumInPool(roomName: string, PoolName: MissionPoolName) {
        return resolvePoolState(roomName, PoolName).pool.length;
    }

    // 锁定任务池中的任务
    export function lockMissionInPool(roomName: string, PoolName: MissionPoolName, id: Task["id"], creepId: Id<Creep>) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const index = findTaskIndex(state, id);
        if (index === -1) {
            console.log(`任务${id}不存在`);
            return;
        }

        const task = state.pool[index]!;
        task.lock = true;
        task.bindCreep = creepId;
        return OK;
    }

    // 解锁任务池中的任务
    export function unlockMissionInPool(roomName: string, PoolName: MissionPoolName, id: Task["id"]) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const index = findTaskIndex(state, id);
        if (index === -1) {
            console.log(`任务${id}不存在`);
            return;
        }

        const task = state.pool[index]!;
        task.lock = false;
        task.bindCreep = null;
        return OK;
    }

    // 更新任务池中的任务
    export function updateMissionPool(roomName: string, PoolName: MissionPoolName, id: Task["id"], { level, data, lock }: { level?: Task["level"], data?: Task["data"], lock?: Task["lock"] }) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const taskIndex = findTaskIndex(state, id);
        if (taskIndex === -1) {
            console.log(`任务 ${id} 不存在`);
            return;
        }

        const task = state.pool[taskIndex]!;
        if (level !== undefined) {
            task.level = level;
        }
        if (data) {
            for (const key in data) {
                (task.data! as any) [key] = (data as any) [key];
            }
        }
        if (lock !== undefined) {
            task.lock = lock;
            if (!lock) task.bindCreep = null;
        }

        return OK;
    }

    // 用id删除任务池中的任务
    export function deleteMissionFromPool(roomName: string, PoolName: MissionPoolName, id: Task["id"]) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const index = findTaskIndex(state, id);
        if (index === -1) return;

        state.pool.splice(index, 1);
        if (state.poolName === MISSION_POOLS.spawn) clearSpawnMissionNumCache(roomName);

        return OK;
    }

    // 检查任务池中的任务是否已完成、过期、失效
    export function checkMissionPool(roomName: string, PoolName: MissionPoolName, checkFunc: (t: Task) => boolean) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        for (let i = state.pool.length - 1; i >= 0; i--) {
            const task = state.pool[i]!;
            if (!checkFunc(task)) state.pool.splice(i, 1);
        }
        return OK;
    }

    // 提交任务完成信息
    export function submitMission(roomName: string, PoolName: MissionPoolName, id: Task["id"], data: Task["data"], deleteFunc: (t: any) => boolean) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const index = findTaskIndex(state, id);
        if (index === -1) {
            console.log(`任务${id}不存在`);
            return;
        }

        const task = state.pool[index]!;
        for (const key in data) {
            (task.data! as any) [key] = (data as any) [key];
        }
        task.lock = false;
        task.bindCreep = null;

        if (deleteFunc(task.data!)) {
            deleteMissionFromPool(roomName, PoolName, id);
        }
        return OK;
    }

// spawn 任务角色计数缓存 (原 room 实例缓存改模块级)
const spawnMissionNumCache = new Map<string, Record<string, number>>();
const spawnMissionNumTick = new Map<string, number>();
