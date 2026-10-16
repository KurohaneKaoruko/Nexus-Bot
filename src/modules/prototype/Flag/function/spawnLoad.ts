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

    let queued = 0;
    const tasks = getAllMissionFromPool(spawnRoom.name, MISSION_POOLS.spawn) || [];
    for (const task of tasks as any[]) {
        if (matchesFlagSpawnMemory(task?.data?.memory, flagName, unit, legacyMatch)) {
            queued++;
        }
    }

    return {
        live,
        queued,
        total: live + queued,
    };
};

