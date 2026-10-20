
/**
 * 外矿定编数学层: 采集/搬运目标数量、体型功率与工位上限的纯估算。
 */

import { getRoomMode, isHighLikeMode } from '@/modules/strategy';
import { buildCarrierBodyConfig, buildRemoteMinerBody } from '@/utils/remoteBody';
import { readRecordedSourceSlotCounts } from '@/core/store/accessor';
import { ExternalMineState } from '@/modules/external/mine/state';
import { ExternalMine } from '@/modules/external/mine/runtime';
import { ExternalMineAnalysis } from '@/modules/external/mine/analysis';

// 外矿搬运数量估算常量
const EXTERNAL_MINE_CARRY_TARGET_CONFIG = {
    harvestPerSourceByLevel: [0, 2, 4, 6, 8, 8, 10, 20, 20] as const,
    fallbackCarryCapacityByLevel: [0, 100, 150, 200, 400, 1000, 1000, 1300, 1600] as const,
    routeBaseTicks: 20,
    routeTicksPerLinearDistance: 25,
    routeOverheadTicks: 8,
    minEffectiveCarryCapacity: 50,
    dynamicTargetBuffer: 1,
    minTargetNum: 6,
    maxTargetNumPerSource: 7,
    noWorkCarryBaseExtraPerSource: 1,
    noWorkCarryBaseMultiplier: 2,
} as const;

// 外矿的数学/容量估算集中在此处，避免散落的魔数。
export const ExternalMineMath = {
    // 期望单源总 WORK 数量（用于估算采集人数）。
    SOURCE_TARGET_WORK: 5,
    // 低等级阶段允许的单源外矿采集者上限（用于过渡补能）。
    MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL: 3,
    // 成熟房间（有效等级 >= 4）单源上限：严格 1 个采集者。
    MAX_HARVESTERS_PER_SOURCE_STABLE: 1,
    // 允许占位在采集点旁的可通行结构类型。
    WALKABLE_SOURCE_STRUCTURE_SET: new Set<StructureConstant>([
        STRUCTURE_CONTAINER,
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART,
    ]),

    // 获取 high/rush 模式下的外矿小体型；具体体型配置直接复用 UnitLevelData.minipart。
    getModeLimitedBodyConfig(
        sourceRoom: Room,
        unit: string,
        upbody?: boolean
    ): ((BodyPartConstant | number)[])[] | null {
        if (upbody) return null;
        const mode = ExternalMineState.getRoomMode(sourceRoom);
        if (mode !== 'high' && mode !== 'rush') return null;
        const body = sourceRoom.GetUnitBodys(unit, false, undefined, true);
        return Array.isArray(body) && body.length > 0 ? body : null;
    },

    // 判断外矿资源点旁某个坐标是否可站立（不在边界、非墙、结构阻塞）。
    isStandableOutmineSourcePos(room: Room, x: number, y: number): boolean {
        const terrain = room.getTerrain();
        if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

        const structures = room.lookForAt(LOOK_STRUCTURES, x, y) as Structure[];
        if (structures.some(structure => {
            if (structure.structureType === STRUCTURE_RAMPART) {
                const rampart = structure as StructureRampart;
                return !rampart.my && !rampart.isPublic;
            }
            return !this.WALKABLE_SOURCE_STRUCTURE_SET.has(structure.structureType);
        })) return false;

        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y) as ConstructionSite[];
        if (sites.some(site => !this.WALKABLE_SOURCE_STRUCTURE_SET.has(site.structureType))) return false;

        return true;
    },

    // 计算并缓存某个 Source 周围可站立格数，用于采集者数量上限估计。
    getOutmineSourceStandableCount(room: Room, source: Source): number {
        if (!room.memory.sourcePosCount) room.memory.sourcePosCount = {};
        const cached = room.memory.sourcePosCount[source.id];
        if (typeof cached === 'number') return cached;

        const pos = source.pos;
        const walkable = [
            [pos.x - 1, pos.y],
            [pos.x + 1, pos.y],
            [pos.x, pos.y - 1],
            [pos.x, pos.y + 1],
            [pos.x - 1, pos.y - 1],
            [pos.x + 1, pos.y + 1],
            [pos.x - 1, pos.y + 1],
            [pos.x + 1, pos.y - 1]
        ].filter(([px, py]) => this.isStandableOutmineSourcePos(room!, px!, py!)).length;

        room.memory.sourcePosCount[source.id] = walkable;
        return walkable;
    },

    // 获取目标房间内所有资源点的可站立格总数（作为全局采集上限）。
    getOutHarvesterSlotCap(targetRoom: Room): number {
        const sources = (targetRoom.source || targetRoom.find(FIND_SOURCES) || []) as Source[];
        if (sources.length <= 0) return 0;

        let totalSlots = 0;
        for (const source of sources) {
            totalSlots += this.getOutmineSourceStandableCount(targetRoom, source);
        }
        return totalSlots;
    },

    // 无视野时的离线口径：scout 到访时记录的工位缓存（Memory.rooms[target].sourcePosCount）。
    // 从未记录过返回 null——此时不做工位上限，由调用方决定是否放弃孵化。
    getRecordedOutHarvesterSlotCap(targetRoomName: string): number | null {
        const recorded = readRecordedSourceSlotCounts(targetRoomName);
        if (!recorded) return null;
        return recorded.reduce((a, b) => a + b, 0);
    },

    // 无视野时的离线口径：scout 记录的 source 数量；从未记录过返回 null。
    getRecordedSourceNum(targetRoomName: string): number | null {
        const recorded = readRecordedSourceSlotCounts(targetRoomName);
        return recorded ? recorded.length : null;
    },

    // 计算外矿采集者的 WORK 数量，支持 upbody（固定高配）或读取配置。
    getOutHarvesterWorkParts(sourceRoom: Room, upbody?: boolean): number {
        if (upbody) return 16;
        const body = buildRemoteMinerBody(sourceRoom.energyCapacityAvailable, 5, true);
        if (!Array.isArray(body) || body.length === 0) return 1;

        let workParts = 0;
        for (const part of body as ((BodyPartConstant | number)[])[]) {
            if (!Array.isArray(part) || part.length < 2) continue;
            if (part[0] !== WORK) continue;
            if (typeof part[1] !== 'number') continue;
            workParts += part[1];
        }
        return Math.max(1, workParts);
    },

    // 根据体型配置估算外矿搬运的单体承载能力。
    getOutCarryCapacity(sourceRoom: Room): number {
        // 接力车道（rush）：C4 微型件口径，定编按 200 容量/件折算——
        // 定编必须与实际孵出的体型一致，否则车队目标会被低估 4-6 倍
        if (getRoomMode(sourceRoom) === 'rush') return 200;
        const body = buildCarrierBodyConfig(sourceRoom.energyCapacityAvailable, { forRoad: true, maxCarry: 16 });
        if (Array.isArray(body) && body.length > 0) {
            let carryParts = 0;
            for (const part of body as ((BodyPartConstant | number)[])[]) {
                if (!Array.isArray(part) || part.length < 2) continue;
                if (part[0] !== CARRY) continue;
                if (typeof part[1] !== 'number') continue;
                carryParts += part[1];
            }
            const capacity = carryParts * 50;
            if (capacity > 0) return capacity;
        }
        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        return EXTERNAL_MINE_CARRY_TARGET_CONFIG.fallbackCarryCapacityByLevel[lv] ?? 0;
    },

    // 根据源数、WORK 能力与站位上限，估算采集者目标数量。
    calcOutHarvesterTargetNum(sourceRoom: Room, sourceNum: number, upbody?: boolean, slotCap?: number): number {
        if (sourceNum <= 0) return 0;
        const workParts = this.getOutHarvesterWorkParts(sourceRoom, upbody);
        const perSource = Math.ceil(this.SOURCE_TARGET_WORK / workParts);
        const builtLevel = sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.level;
        const maxPerSource = (builtLevel >= 4 || upbody)
            ? this.MAX_HARVESTERS_PER_SOURCE_STABLE
            : this.MAX_HARVESTERS_PER_SOURCE_LOW_LEVEL;
        const cappedPerSource = Math.min(maxPerSource, Math.max(1, perSource));
        const targetNum = sourceNum * cappedPerSource;
        if (typeof slotCap === 'number') return Math.max(0, Math.min(slotCap, targetNum));
        return targetNum;
    },

    // 根据距离与吞吐估算运输数量，考虑 RCL 运输能力、往返时间与产量。
    calcEnergyOutCarryTarget(
        sourceRoom: Room,
        targetRoom: Room,
        sourceNum: number,
        allowWorkCarry: boolean,
        carryCapacityOverride?: number
    ): number {
        const carryCapacity = (carryCapacityOverride && carryCapacityOverride > 0)
            ? carryCapacityOverride
            : this.getOutCarryCapacity(sourceRoom);
        const carryPlan = ExternalMineAnalysis.buildCarryPlan(sourceRoom, targetRoom, allowWorkCarry, carryCapacity);
        if (carryPlan.sources.length > 0) return carryPlan.targetCarryNum;

        const lv = Math.max(1, Math.min(8, sourceRoom.level));
        const baseNum = allowWorkCarry
            ? sourceNum
            : Math.max(
                sourceNum + EXTERNAL_MINE_CARRY_TARGET_CONFIG.noWorkCarryBaseExtraPerSource,
                Math.ceil(sourceNum * EXTERNAL_MINE_CARRY_TARGET_CONFIG.noWorkCarryBaseMultiplier)
            );

        const linearDistance = Game.map.getRoomLinearDistance(sourceRoom.name, targetRoom.name, true);
        const oneWayTicks =
            EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeBaseTicks +
            linearDistance * EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeTicksPerLinearDistance;
        const roundTripTicks = oneWayTicks * 2 + EXTERNAL_MINE_CARRY_TARGET_CONFIG.routeOverheadTicks;

        const harvestPerSource = EXTERNAL_MINE_CARRY_TARGET_CONFIG.harvestPerSourceByLevel[lv];
        const estimatedIncomePerTick = harvestPerSource! * sourceNum;
        const throughputNeed = Math.ceil((
            estimatedIncomePerTick * roundTripTicks
        ) / Math.max(EXTERNAL_MINE_CARRY_TARGET_CONFIG.minEffectiveCarryCapacity, carryCapacity));
        // 离线估算动态缓冲：高强度模式（rush/high/mini）+1（同参数表冗余思路，离线也不至于运力吃紧）
        const dynamicBuffer = EXTERNAL_MINE_CARRY_TARGET_CONFIG.dynamicTargetBuffer +
            (isHighLikeMode(ExternalMine.getRoomMode(sourceRoom)) ? 1 : 0);
        const dynamicNum = throughputNeed + dynamicBuffer;

        const cappedMax = Math.max(
            EXTERNAL_MINE_CARRY_TARGET_CONFIG.minTargetNum,
            sourceNum * EXTERNAL_MINE_CARRY_TARGET_CONFIG.maxTargetNumPerSource
        );
        return Math.min(cappedMax, Math.max(baseNum, dynamicNum));
    },
};
