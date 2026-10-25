
/**
 * 任务池被存储在 Memory 的 MissionPools 中，每个 room 独立存储。
 * 六池 (transport/build/repair/terminal/mine/boost) 已随域 3.4 退役,
 * 仅剩 spawn 池作为孵化队列基建驻留 (warSpawn/external 去重计数消费)。
 */

import { getMissionPools, sanitizeMissionPoolMemory } from "@/core/store/accessor";
import { MISSION_POOL_NAMES } from "@/constant/MissionConstant";

export { sanitizeMissionPoolMemory };

const MISSION_POOL_NAME_SET = new Set<string>(MISSION_POOL_NAMES);

type ResolvedMissionPoolState = {
    poolName: MissionPoolName;
    pool: Task[];
};

const createEmptyMissionPoolMemory = (): MissionPoolMemory => ({
    spawn: [],
});

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


    // (私有方法) 生成一个16进制id
    function generateId() {
        const Gametime = Game.time.toString(16);
        const Random = Math.random().toString(16).slice(2, -1);
        return (Gametime + Random).toUpperCase();
    }


    // 添加任务到任务池
    export function addMissionToPool(roomName: string, PoolName: MissionPoolName, type: Task["type"], level: Task["level"], data: Task["data"]) {
        const id = `${type.toUpperCase()}-${generateId()}`;
        const pool = getRoomMissionPools(roomName)![PoolName]!;
        const task: Task = { id, type, level, data };
        pool.push(task);
        return OK;
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



    // 获取任务池中的任务数量
    export function getMissionNumInPool(roomName: string, PoolName: MissionPoolName) {
        return resolvePoolState(roomName, PoolName).pool.length;
    }




    // 用id删除任务池中的任务
    export function deleteMissionFromPool(roomName: string, PoolName: MissionPoolName, id: Task["id"]) {
        const state = resolvePoolState(roomName, PoolName);
        if (state.pool.length === 0) return;

        const index = findTaskIndex(state, id);
        if (index === -1) return;

        state.pool.splice(index, 1);

        return OK;
    }



// spawn 任务角色计数缓存 (原 room 实例缓存改模块级)
