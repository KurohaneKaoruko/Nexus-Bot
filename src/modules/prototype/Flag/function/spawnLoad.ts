// @ts-nocheck

import { getAllMissionFromPool } from '@/modules/spawning';
import { MISSION_POOLS } from '@/constant/MissionConstant';
export type SpawnMemoryMatcher = (memory: any) => boolean;
export type SpawnLiveMatcher = (creep: Creep) => boolean;

export const matchesFlagSpawnMemory = (
    memory: any,
    flagName: string,
    unit: string,
    legacyMatch: SpawnMemoryMatcher
) => {
    if (!memory || memory.unit !== unit) return false;
    if (memory.spawnFlag) return memory.spawnFlag === flagName;
    return legacyMatch(memory);
};

export const getFlagSpawnLoad = (
    spawnRoom: Room,
    flagName: string,
    unit: string,
    legacyMatch: SpawnMemoryMatcher,
    liveMatch?: SpawnLiveMatcher
) => {
    let live = 0;
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        if (
            matchesFlagSpawnMemory(creep?.memory, flagName, unit, legacyMatch) &&
            (!liveMatch || liveMatch(creep))
        ) {
            live++;
        }
    }

    // 孵化中的蛋: 不在 Game.creeps, 但 spawnCreep 已写入 Memory.creeps——
    // directSpawn 同步下蛋后, 蛋期是重复派单窗口, 必须计入负载
    let eggs = 0;
    for (const spawn of spawnRoom.find(FIND_MY_SPAWNS)) {
        const eggName = spawn.spawning?.name;
        if (!eggName) continue;
        const eggMemory = Memory.creeps?.[eggName];
        if (matchesFlagSpawnMemory(eggMemory, flagName, unit, legacyMatch)) eggs++;
    }

    let queued = 0;
    const tasks = getAllMissionFromPool(spawnRoom.name, MISSION_POOLS.spawn) || [];
    for (const task of tasks as any[]) {
        if (matchesFlagSpawnMemory(task?.data?.memory, flagName, unit, legacyMatch)) {
            queued++;
        }
    }

    return {
        live: live + eggs,
        queued,
        total: live + eggs + queued,
    };
};

