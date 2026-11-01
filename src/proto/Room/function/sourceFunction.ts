import { UNITS } from '@/constant/CreepConstant';

const getMyCreepsByRoleByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, Creep[]>> = {};
    return (room: Room, unit: string) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        const roomCache = cached[room.name] ?? (cached[room.name] = {});
        const hit = roomCache[unit];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c && (c.ticksToLive || 0) > 0 && c.memory.unit === unit
        }) as Creep[];
        roomCache[unit] = creeps;
        return creeps;
    };
})();

const LEGACY_SHARED_SOURCE_ROLE_SET = new Set<string>([UNITS.worker, UNITS.upgrader, UNITS.universal]);
const STRICT_SOURCE_ROLE_SET = new Set<string>([UNITS.harvester]);
const SOURCE_PRIORITY_MAP = {
    harvester: 0,
    universal: 1,
    worker: 2,
    upgrader: 3,
} as const;

type SourcePriorityRole = keyof typeof SOURCE_PRIORITY_MAP;
type SourceCompetitor = {
    creep: Creep;
    priority: number;
    isAdjacent: boolean;
    isBound: boolean;
    distance: number;
};

const getSourcePriority = (unit?: string): number | null => {
    if (!unit) return null;
    const priority = SOURCE_PRIORITY_MAP[unit as SourcePriorityRole];
    return priority == null ? null : priority;
};

const isPrioritySourceUnit = (unit?: string): unit is SourcePriorityRole => getSourcePriority(unit) != null;

const getSourceReservationsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Record<string, Set<string>>> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        if (!cached[room.name]) cached[room.name] = {};
        return cached[room.name];
    };
})();

const reserveSourceForCreep = (room: Room, sourceId: Id<Source>, creepName: string) => {
    const roomCache = getSourceReservationsByRoom(room);
    const set = roomCache! [sourceId]! || (roomCache! [sourceId] = new Set());
    set.add(creepName);
};

const getReservedSourceCountForCreep = (room: Room, sourceId: Id<Source>, creepName: string) => {
    const roomCache = getSourceReservationsByRoom(room);
    const set = roomCache! [sourceId]!;
    if (!set) return 0;
    if (set.has(creepName)) return Math.max(0, set.size - 1);
    return set.size;
};

const getPrioritySourceCreepsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Creep[]> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        const hit = cached[room.name];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) =>
                c &&
                (c.ticksToLive || 0) > 1 &&
                isPrioritySourceUnit(c.memory.unit)
        }) as Creep[];
        cached[room.name] = creeps;
        return creeps;
    };
})();

const WALKABLE_SOURCE_STRUCTURE_SET = new Set<StructureConstant>([
    STRUCTURE_CONTAINER,
    STRUCTURE_ROAD,
    STRUCTURE_RAMPART,
]);

const isStandableSourcePos = (room: Room, x: number, y: number) => {
    const terrain = room.getTerrain();
    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

    const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
    if (structures.some(structure => {
        if (structure.structureType === STRUCTURE_RAMPART) {
            const rampart = structure as StructureRampart;
            return !rampart.my && !rampart.isPublic;
        }
        return !WALKABLE_SOURCE_STRUCTURE_SET.has(structure.structureType);
    })) return false;

    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
    if (sites.some(site => !WALKABLE_SOURCE_STRUCTURE_SET.has(site.structureType))) return false;

    return true;
};

const getMyLegacySourceBoundCreepsByRoom = (() => {
    let cachedTick = -1;
    let cached: Record<string, Creep[]> = {};
    return (room: Room) => {
        if (cachedTick !== Game.time) {
            cachedTick = Game.time;
            cached = {};
        }
        const hit = cached[room.name];
        if (hit) return hit;
        const creeps = room.find(FIND_MY_CREEPS, {
            filter: (c: Creep) => c && (c.ticksToLive || 0) > 0 && !!c.memory.targetSourceId
        }) as Creep[];
        cached[room.name] = creeps;
        return creeps;
    };
})();

const getSourceWalkableCount = (room: Room, source: Source) => {
    if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
    const pos = source.pos;
    const walkable = ([
        [pos.x - 1, pos.y],
        [pos.x + 1, pos.y],
        [pos.x, pos.y - 1],
        [pos.x, pos.y + 1],
        [pos.x - 1, pos.y - 1],
        [pos.x + 1, pos.y + 1],
        [pos.x - 1, pos.y + 1],
        [pos.x + 1, pos.y - 1]
    ] as [number, number][]).filter(([x, y]) => isStandableSourcePos(room, x, y)).length;

    room.memory.sourcePosCount[source.id] = walkable;
    return walkable;
};

const sortSourceCompetitors = (a: SourceCompetitor, b: SourceCompetitor) =>
    a.priority - b.priority ||
    Number(b.isAdjacent) - Number(a.isAdjacent) ||
    Number(b.isBound) - Number(a.isBound) ||
    a.distance - b.distance ||
    a.creep.name.localeCompare(b.creep.name);

const getSourceCompetitors = (room: Room, source: Source, candidate?: Creep) => {
    const competitors: SourceCompetitor[] = [];
    let hasCandidate = false;

    for (const creep of getPrioritySourceCreepsByRoom(room)) {
        const priority = getSourcePriority(creep.memory.unit);
        if (priority == null) continue;

        const isBound = creep.memory.targetSourceId === source.id;
        const isAdjacent = creep.pos.inRangeTo(source.pos, 1);
        if (!isBound && !isAdjacent && (!candidate || creep.id !== candidate.id)) continue;

        if (candidate && creep.id === candidate.id) hasCandidate = true;
        competitors.push({
            creep,
            priority,
            isAdjacent,
            isBound,
            distance: creep.pos.getRangeTo(source.pos),
        });
    }

    if (candidate && isPrioritySourceUnit(candidate.memory.unit) && !hasCandidate) {
        competitors.push({
            creep: candidate,
            priority: getSourcePriority(candidate.memory.unit)!,
            isAdjacent: candidate.pos.inRangeTo(source.pos, 1),
            isBound: candidate.memory.targetSourceId === source.id,
            distance: candidate.pos.getRangeTo(source.pos),
        });
    }

    competitors.sort(sortSourceCompetitors);
    return competitors;
};

const getAllowedSourceCandidate = (room: Room, creep: Creep, source: Source) => {
    const slots = getSourceWalkableCount(room, source);
    const competitors = getSourceCompetitors(room, source, creep);
    return {
        competitors,
        allowed: slots > 0 && competitors.slice(0, slots).some(item => item.creep.id === creep.id)
    };
};

/**
 * 能量源分配域：按角色优先级、站位容量与绑定数分配 source。
 */
export default class SourceFunction extends Room {
    // 获取绑定最少的能量源
    override closestSource(creep: Creep): Source | null {
        const unit = creep.memory.unit;
        const isStrictRole = !!unit && STRICT_SOURCE_ROLE_SET.has(unit);
        const availableSources = (this.source || []).filter(
            source => source && (isStrictRole ? true : source.energy > 0)
        );
        if (availableSources.length <= 0) return null;

        if (isStrictRole) {
            const currentSource = creep.getBoundSource?.() || null;
            if (currentSource) return currentSource;

            const creeps = unit ? getMyCreepsByRoleByRoom(this, unit) : [];
            const boundCounts: Record<string, number> = {};
            const minTtlBySource: Record<string, number> = {};
            for (const c of creeps) {
                if (c.id === creep.id) continue;
                const sid = c.memory.targetSourceId;
                if (!sid) continue;
                boundCounts[sid] = (boundCounts[sid] || 0) + 1;
                const ttl = c.ticksToLive || 0;
                minTtlBySource[sid] = minTtlBySource[sid] == null
                    ? ttl
                    : Math.min(minTtlBySource[sid], ttl);
            }

            let best: Source | null = null;
            let bestCount = Infinity;
            let bestMinTtl = Infinity;
            let bestDistance = Infinity;

            for (const source of availableSources) {
                const slots = getSourceWalkableCount(this, source);
                if (slots <= 0) continue;
                const count = (boundCounts[source.id] || 0) +
                    getReservedSourceCountForCreep(this, source.id, creep.name);
                if (count >= slots) continue;
                const minTtl = minTtlBySource[source.id] ?? Infinity;
                const distance = creep.pos.getRangeTo(source.pos);
                if (
                    count < bestCount ||
                    (count === bestCount && minTtl < bestMinTtl) ||
                    (count === bestCount && minTtl === bestMinTtl && distance < bestDistance)
                ) {
                    best = source;
                    bestCount = count;
                    bestMinTtl = minTtl;
                    bestDistance = distance;
                }
            }

            if (best) reserveSourceForCreep(this, best.id, creep.name);
            return best;
        }

        if (isPrioritySourceUnit(unit)) {
            const currentSource = creep.getBoundSource?.() || null;
            if (currentSource && currentSource.energy > 0 && getAllowedSourceCandidate(this, creep, currentSource).allowed) {
                return currentSource;
            }

            let best: Source | null = null;
            let bestCrowd = Infinity;
            let bestDistance = Infinity;
            for (const source of availableSources) {
                const { competitors, allowed } = getAllowedSourceCandidate(this, creep, source);
                if (!allowed) continue;
                const crowd = competitors.length;
                const distance = creep.pos.getRangeTo(source.pos);
                if (crowd < bestCrowd || (crowd === bestCrowd && distance < bestDistance)) {
                    best = source;
                    bestCrowd = crowd;
                    bestDistance = distance;
                }
            }
            return best;
        }
        // 初始化最少Creep绑定计数
        let minCreepCount = Infinity;
        let leastCrowdedSources: Source[] = [];

        if(!this.memory.sourcePosCount) this.memory.sourcePosCount = {}
        const useSharedCrowd = !!unit && LEGACY_SHARED_SOURCE_ROLE_SET.has(unit);
        const creeps = unit
            ? (useSharedCrowd ? getMyLegacySourceBoundCreepsByRoom(this) : getMyCreepsByRoleByRoom(this, unit)).filter(c => {
                if (c.id === creep.id) return false;
                const otherUnit = c.memory.unit;
                if (!otherUnit) return false;
                if (!useSharedCrowd) return otherUnit === unit;
                if (!LEGACY_SHARED_SOURCE_ROLE_SET.has(otherUnit)) return false;
                if (otherUnit !== UNITS.universal && c.memory.working) return false;
                return true;
            })
            : [];
        const boundCounts: Record<string, number> = {};
        const minTtlBySource: Record<string, number> = {};
        for (const c of creeps) {
            const sid = c.memory.targetSourceId;
            if (!sid) continue;
            boundCounts[sid] = (boundCounts[sid] || 0) + 1;
            const ttl = c.ticksToLive || 0;
            minTtlBySource[sid] = minTtlBySource[sid] == null ? ttl : Math.min(minTtlBySource[sid], ttl);
        }
        // 找到绑定最少的，有位置的采集点
        availableSources.forEach((source: Source) => {
            let creepCount = boundCounts[source.id] || 0;
            const maxPosCount = getSourceWalkableCount(this, source);
            // 绑定满的忽略
            if (creepCount >= maxPosCount) return;
            // 记录绑定数最小的采集点
            if (creepCount < minCreepCount) {
                minCreepCount = creepCount;
                leastCrowdedSources = [source];
            } else if (creepCount === minCreepCount) {
                leastCrowdedSources.push(source);
            }
        });

        let targetSource: Source | null = null;
        if (leastCrowdedSources.length == 1) {
            targetSource = leastCrowdedSources[0] ?? null;
        } else if (minCreepCount === 0) {
            targetSource = creep.pos.findClosestByRange(leastCrowdedSources);
        } else if (leastCrowdedSources.length > 1) {
            targetSource = leastCrowdedSources.reduce<{ source: Source; minTickToLive: number } | null>((obj, source) => {
                const minTickToLive = minTtlBySource[source.id] ?? Infinity;
                if (!obj) return { source, minTickToLive };
                if (obj.minTickToLive > minTickToLive) {
                    return { source, minTickToLive }
                }
                return obj;
            }, null)?.source ?? null;
        }

        return targetSource;
    }

    /* 动态生成角色体型 */
    override canUseSourceByPriority(creep: Creep, source: Source): boolean {
        if (!source || source.room.name !== this.name) return false;
        if (!isPrioritySourceUnit(creep.memory.unit)) return true;
        return getAllowedSourceCandidate(this, creep, source).allowed;
    }

    override shouldYieldSourceByPriority(creep: Creep, source: Source): boolean {
        if (!source || source.room.name !== this.name) return false;
        if (!isPrioritySourceUnit(creep.memory.unit)) return false;
        return !this.canUseSourceByPriority(creep, source);
    }
}
