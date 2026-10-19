
/**
 * 外矿共享取数与口径层: 容量/功率等运行时兼容取数、源点定位与统计口径常量。
 * 不含调度决策, 供分析、孵化与运行时各层复用。
 */

import { UNITS } from '@/constant/CreepConstant';
import { ensureMemoryCache } from '@/proto';
import { RoadMemory } from '@/modules/external/externalRoad';

export type ExternalMineStoreLike = Partial<Record<string, number>> & {
    getUsedCapacity?: (resourceType?: ResourceConstant) => number | null;
    getFreeCapacity?: (resourceType?: ResourceConstant) => number | null;
    getCapacity?: (resourceType?: ResourceConstant) => number | null;
};

export type ExternalMineIndexedRoom = Room & {
    source?: Source[];
    container?: StructureContainer[];
    __dropped?: Resource[];
};

export type ExternalMineRoadMemoryLike = {
    getPath?: (sourceRoomName: string, targetRoomName: string, targetKey: string) => RoomPosition[] | undefined;
};

export type ExternalMineSourceStat = {
    source: Source;
    sourceId: Id<Source>;
    sourceKey: string;
    sourcePos: RoomPosition;
    targetRoomName: string;
    distance: number;
    energyPerTick: number;
    pendingEnergy: number;
    expectedEnergyDelta: number;
    harvestingPower: number;
    activeHarvesterCount: number;
    assignedCarryCapacity: number;
    availableEnergy: number;
    collectionRange: number;
    container: StructureContainer | null;
};

export type ExternalMineCarryPlan = {
    sources: ExternalMineSourceStat[];
    requiredCarryCapacity: number;
    backlogExtraCount: number;
    throughputTargetNum: number;
    targetCarryNum: number;
};

export const EXTERNAL_MINE_ANALYSIS = {
    OUT_CARRY_ROLE_SET: new Set<string>([UNITS.carrier]),
    OUT_HARVEST_ROLE_SET: new Set<string>([UNITS.harvester]),
    SOURCE_CONTAINER_REPAIR_LOSS:
        (typeof REPAIR_COST === 'number' && typeof CONTAINER_DECAY === 'number' && typeof CONTAINER_DECAY_TIME === 'number')
            ? (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME
            : 0.1,
    ROUTE_BASE_TICKS: 20,
    ROUTE_TICKS_PER_LINEAR_DISTANCE: 25,
    ROUTE_LOCAL_APPROACH_TICKS: 8,
    BACKLOG_THRESHOLD: 2000,
    SEVERE_BACKLOG_THRESHOLD: 3000,
    CARRY_RETURN_TO_COLLECT_RATIO: 0.5,
} as const;

export const EXTERNAL_MINE_ANALYSIS_DEFAULTS = {
    sourceEnergyCapacity: typeof SOURCE_ENERGY_CAPACITY === 'number' ? SOURCE_ENERGY_CAPACITY : 3000,
    energyRegenTime: typeof ENERGY_REGEN_TIME === 'number' ? ENERGY_REGEN_TIME : 300,
    harvestPower: typeof HARVEST_POWER === 'number' ? HARVEST_POWER : 2,
} as const;

export const normalizeExternalMineCapacity = (value: number | null | undefined): number => {
    return typeof value === 'number' ? value : 0;
};

export const getExternalMineStoreUsedCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getUsedCapacity === 'function') return normalizeExternalMineCapacity(store.getUsedCapacity(resourceType));
    if (resourceType) return Number(store[resourceType] || 0);
    let total = 0;
    for (const value of Object.values(store)) {
        if (typeof value === 'number') total += value;
    }
    return total;
};

export const getExternalMineStoreFreeCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getFreeCapacity === 'function') return normalizeExternalMineCapacity(store.getFreeCapacity(resourceType));
    const capacity = getExternalMineStoreCapacity(store, resourceType);
    return Math.max(0, capacity - getExternalMineStoreUsedCapacity(store, resourceType));
};

export const getExternalMineStoreCapacity = (store: ExternalMineStoreLike | undefined, resourceType?: ResourceConstant): number => {
    if (!store) return 0;
    if (typeof store.getCapacity === 'function') return normalizeExternalMineCapacity(store.getCapacity(resourceType));
    return getExternalMineStoreUsedCapacity(store, resourceType);
};

export const getExternalMineCreepWorkParts = (creep: Pick<Creep, 'body' | 'getActiveBodyparts'>): number => {
    if (typeof creep.getActiveBodyparts === 'function') return creep.getActiveBodyparts(WORK);
    if (!Array.isArray(creep.body)) return 0;
    return creep.body.filter((part) => part.type === WORK && (part.hits == null || part.hits > 0)).length;
};

export const getExternalMineVisibleCreeps = (room: Room): Creep[] => {
    const indexed = Object.values(Game.creeps || {}).filter((creep) => creep?.my && creep.room?.name === room.name) as Creep[];
    if (indexed.length > 0) return indexed;
    if (typeof room.find === 'function' && typeof FIND_MY_CREEPS !== 'undefined') {
        try {
            return (room.find(FIND_MY_CREEPS) || []) as Creep[];
        }
        catch {
            return [];
        }
    }
    return [];
};

export const getExternalMineTargetSources = (room: Room): Source[] => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    const indexed = Array.isArray(indexedRoom.source) ? indexedRoom.source : [];
    if (indexed.length > 0) return indexed;
    if (typeof room.find === 'function') {
        try {
            return (room.find(FIND_SOURCES) || []) as Source[];
        }
        catch {
            return [];
        }
    }
    return [];
};

export const getOutmineSourceKey = (source: Pick<Source, 'pos'> | RoomPosition): string => {
    const pos = 'pos' in source ? source.pos : source;
    return `${pos.x}:${pos.y}`;
};
export const getExternalMineNearbyContainer = (room: Room, source: Source): StructureContainer | null => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    const indexed = Array.isArray(indexedRoom.container) ? indexedRoom.container : [];
    const fromIndex = indexed.find((container) => source.pos.inRangeTo(container.pos, 1));
    if (fromIndex) return fromIndex;

    if (typeof source.pos.findInRange === 'function' && typeof FIND_STRUCTURES !== 'undefined') {
        try {
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure: Structure) => structure.structureType === STRUCTURE_CONTAINER,
            }) as StructureContainer[];
            return containers[0] || null;
        }
        catch {
            return null;
        }
    }
    return null;
};

export const getExternalMineDroppedEnergyAroundSource = (room: Room, source: Source, range: number): number => {
    const indexedRoom = room as ExternalMineIndexedRoom;
    let dropped: Resource[] = [];
    if (typeof source.pos.findInRange === 'function' && typeof FIND_DROPPED_RESOURCES !== 'undefined') {
        try {
            dropped = source.pos.findInRange(FIND_DROPPED_RESOURCES, range) as Resource[];
        }
        catch {
            dropped = [];
        }
    } else if (Array.isArray(indexedRoom.__dropped)) {
        dropped = indexedRoom.__dropped.filter((resource) => source.pos.inRangeTo(resource.pos, range));
    }

    let total = 0;
    for (const resource of dropped) {
        if (resource.resourceType !== RESOURCE_ENERGY) continue;
        total += resource.amount || 0;
    }
    return total;
};

export const getExternalMineTombstoneEnergyAroundSource = (source: Source, range: number): number => {
    let tombstones: Tombstone[] = [];
    if (typeof source.pos.findInRange === 'function' && typeof FIND_TOMBSTONES !== 'undefined') {
        try {
            tombstones = source.pos.findInRange(FIND_TOMBSTONES, range) as Tombstone[];
        }
        catch {
            tombstones = [];
        }
    }

    let total = 0;
    for (const tombstone of tombstones) {
        total += getExternalMineStoreUsedCapacity(tombstone.store as ExternalMineStoreLike, RESOURCE_ENERGY);
    }
    return total;
};

export const getExternalMineSourceDistance = (sourceRoom: Room, targetRoom: Room, source: Source): number => {
    const targetKey = getOutmineSourceKey(source);
    const plannedPath = (RoadMemory as ExternalMineRoadMemoryLike).getPath?.(sourceRoom.name, targetRoom.name, targetKey);
    if (Array.isArray(plannedPath) && plannedPath.length > 0) return plannedPath.length;

    const linearDistance = typeof Game.map?.getRoomLinearDistance === 'function'
        ? Math.max(1, Game.map.getRoomLinearDistance(sourceRoom.name, targetRoom.name, true))
        : 1;
    const targetCenter = new RoomPosition(25, 25, targetRoom.name);
    const localApproach = source.pos && typeof source.pos.getRangeTo === 'function'
        ? Math.max(0, source.pos.getRangeTo(targetCenter) - 1)
        : EXTERNAL_MINE_ANALYSIS.ROUTE_LOCAL_APPROACH_TICKS;

    return EXTERNAL_MINE_ANALYSIS.ROUTE_BASE_TICKS +
        linearDistance * EXTERNAL_MINE_ANALYSIS.ROUTE_TICKS_PER_LINEAR_DISTANCE +
        localApproach;
};

export const getExternalMineEffectiveEnergyPerTick = (sourceRoom: Room, targetRoom: Room, source: Source, unreservedIncomeFactor = 0.5): number => {
    const baseCapacity = typeof source.energyCapacity === 'number' && source.energyCapacity > 0
        ? source.energyCapacity
        : EXTERNAL_MINE_ANALYSIS_DEFAULTS.sourceEnergyCapacity;
    let energyPerTick = baseCapacity / EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;

    const targetController = targetRoom.controller;
    const myUserName = sourceRoom.controller?.owner?.username;
    if (!targetController || !myUserName) return energyPerTick;
    if (targetController.owner && targetController.owner.username !== myUserName) return 0;
    if (!targetController.owner) {
        const reservation = targetController.reservation;
        if (!reservation || reservation.username !== myUserName) {
            // 未预定产量口径由模式参数表给出：rush=1 满产规划，main=0.75 温和打折，low=0.5 保守
            energyPerTick *= unreservedIncomeFactor;
        }
    }
    return energyPerTick;
};

export const getExternalMineSourceHarvestingStats = (targetRoom: Room, source: Source): { power: number; count: number } => {
    let power = 0;
    let count = 0;
    for (const creep of getExternalMineVisibleCreeps(targetRoom)) {
        if (!creep?.memory?.unit || !EXTERNAL_MINE_ANALYSIS.OUT_HARVEST_ROLE_SET.has(creep.memory.unit)) continue;
        const boundSourceId = creep.memory.targetSourceId as Id<Source> | undefined;
        const isBound = boundSourceId === source.id;
        const isStandingOnSource = creep.pos?.roomName === source.pos.roomName && creep.pos.inRangeTo(source.pos, 1);
        if (!isBound && !isStandingOnSource) continue;
        // 零 CARRY 的采集工 harvest 永远 ERR_FULL，不产生任何吞吐——
        // 不计入采集功率（否则收入估算出现「幻影收入」，升级定编被虚高）
        if (getExternalMineStoreCapacity(creep.store as ExternalMineStoreLike) <= 0) continue;
        power += getExternalMineCreepWorkParts(creep);
        count++;
    }
    return { power: power * EXTERNAL_MINE_ANALYSIS_DEFAULTS.harvestPower, count };
};

export const getExternalMineSourcePendingEnergy = (room: Room, source: Source, container: StructureContainer | null, collectionRange: number): number => {
    let total = getExternalMineDroppedEnergyAroundSource(room, source, collectionRange);
    total += getExternalMineStoreUsedCapacity(container?.store as ExternalMineStoreLike | undefined, RESOURCE_ENERGY);
    if (collectionRange > 1) {
        total += getExternalMineTombstoneEnergyAroundSource(source, collectionRange);
    }
    return total;
};

export const getExternalMineExpectedEnergyDelta = (source: Source, harvestingPower: number, distance: number): number => {
    if (harvestingPower <= 0) return 0;
    const energy = typeof source.energy === 'number' ? source.energy : 0;
    const regeneration = typeof source.ticksToRegeneration === 'number' && source.ticksToRegeneration > 0
        ? source.ticksToRegeneration
        : EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;
    if (distance < regeneration) {
        return Math.min(energy, harvestingPower * distance);
    }
    return Math.min(energy, harvestingPower * regeneration) + harvestingPower * (distance - regeneration);
};

export const getExternalMineOutCarryMode = (creep: Creep): 'collect' | 'deliver' | 'unknown' => {
    const cachedMode = creep.memory.cache?.outCarryMode;
    if (cachedMode === 'collect' || cachedMode === 'deliver') return cachedMode;
    return 'unknown';
};

export const isExternalMineLikelyCollecting = (creep: Creep): boolean => {
    if (!creep || creep.spawning) return false;
    const used = getExternalMineStoreUsedCapacity(creep.store as ExternalMineStoreLike);
    const free = getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike);
    if (free <= 0) return false;

    const mode = getExternalMineOutCarryMode(creep);
    if (mode === 'deliver') {
        const cap = Math.max(1, getExternalMineStoreCapacity(creep.store as ExternalMineStoreLike));
        return used < Math.ceil(cap * EXTERNAL_MINE_ANALYSIS.CARRY_RETURN_TO_COLLECT_RATIO);
    }
    if (mode === 'collect') return true;
    if (creep.memory.targetRoom && creep.room?.name === creep.memory.targetRoom) return true;
    return used === 0;
};

export const getExternalMineAssignedSourceKeyFromCarry = (creep: Creep): string | null => {
    const sourceCache = ensureMemoryCache(creep.memory).source as Record<string, any> | undefined;
    const assignedSourceKey = sourceCache?.assignedSourceKey;
    if (typeof assignedSourceKey === 'string' && assignedSourceKey) return assignedSourceKey;

    const assignedSourceId = sourceCache?.assignedSourceId as Id<Source> | undefined;
    if (!assignedSourceId) return null;
    const source = Game.getObjectById(assignedSourceId);
    if (!source) return null;
    return getOutmineSourceKey(source);
};

export const getExternalMineAssignedCarryCapacity = (
    sourceRoomName: string,
    targetRoomName: string,
    sourceKey: string,
    excludeCreepName?: string,
): number => {
    let assigned = 0;
    for (const creep of Object.values(Game.creeps || {})) {
        if (!creep?.my || creep.spawning) continue;
        if (!creep.memory?.unit || !EXTERNAL_MINE_ANALYSIS.OUT_CARRY_ROLE_SET.has(creep.memory.unit)) continue;
        if (creep.name === excludeCreepName) continue;
        if (creep.memory.sourceRoom !== sourceRoomName) continue;
        if (creep.memory.targetRoom !== targetRoomName) continue;
        if (!isExternalMineLikelyCollecting(creep)) continue;
        if (getExternalMineAssignedSourceKeyFromCarry(creep) !== sourceKey) continue;
        assigned += getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY);
    }
    return assigned;
};
