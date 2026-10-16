
/**
 * 外矿分析层: 源点产出/积压统计、搬运计划与选源、跨房重平衡与真实收入估算。
 */

import { UNITS } from '@/constant/CreepConstant';
import { getRoomModeProfile } from '@/modules/strategy';
import { getRoomTickCacheValue } from '@/utils/roomTickCache';
import { type CarryRoomCandidateStat, OUT_CARRY_DYING_TTL, pickBestCarryRoomName } from '@/modules/external/externalScheduler';
import { getExternalMineCollectionRange } from '@/modules/external/mine/state';
import { ExternalMineMath } from '@/modules/external/mine/math';
import { ExternalMine } from '@/modules/external/mine/runtime';
import {
    EXTERNAL_MINE_ANALYSIS,
    getExternalMineAssignedCarryCapacity,
    getExternalMineAssignedSourceKeyFromCarry,
    getExternalMineEffectiveEnergyPerTick,
    getExternalMineExpectedEnergyDelta,
    getExternalMineNearbyContainer,
    getExternalMineSourceDistance,
    getExternalMineSourceHarvestingStats,
    getExternalMineSourcePendingEnergy,
    getExternalMineStoreCapacity,
    getExternalMineStoreFreeCapacity,
    getExternalMineTargetSources,
    getOutmineSourceKey,
    type ExternalMineSourceStat,
    type ExternalMineCarryPlan,
    type ExternalMineStoreLike,
} from '@/modules/external/mine/shared';

export type { ExternalMineSourceStat, ExternalMineCarryPlan };

export class ExternalMineAnalysis {
    static getSourceStats(
        sourceRoom: Room,
        targetRoom: Room,
        source: Source,
        excludeCreepName?: string,
        unreservedIncomeFactor = 0.5,
    ): ExternalMineSourceStat {
        const sourceKey = getOutmineSourceKey(source);
        const distance = getExternalMineSourceDistance(sourceRoom, targetRoom, source);
        const energyPerTick = getExternalMineEffectiveEnergyPerTick(sourceRoom, targetRoom, source, unreservedIncomeFactor);
        const collectionRange = getExternalMineCollectionRange(targetRoom.name);
        const container = getExternalMineNearbyContainer(targetRoom, source);
        const { power: harvestingPower, count: activeHarvesterCount } = getExternalMineSourceHarvestingStats(targetRoom, source);
        const pendingEnergy = getExternalMineSourcePendingEnergy(targetRoom, source, container, collectionRange);
        const expectedEnergyDelta = getExternalMineExpectedEnergyDelta(source, harvestingPower, distance);
        const assignedCarryCapacity = getExternalMineAssignedCarryCapacity(sourceRoom.name, targetRoom.name, sourceKey, excludeCreepName);
        const availableEnergy = pendingEnergy + expectedEnergyDelta - assignedCarryCapacity;

        return {
            source,
            sourceId: source.id,
            sourceKey,
            sourcePos: source.pos,
            targetRoomName: targetRoom.name,
            distance,
            energyPerTick,
            pendingEnergy,
            expectedEnergyDelta,
            harvestingPower,
            activeHarvesterCount,
            assignedCarryCapacity,
            availableEnergy,
            collectionRange,
            container,
        };
    }

    static getRoomSourceStats(sourceRoom: Room, targetRoom: Room, excludeCreepName?: string, unreservedIncomeFactor = 0.5): ExternalMineSourceStat[] {
        return getExternalMineTargetSources(targetRoom)
            .map((source) => this.getSourceStats(sourceRoom, targetRoom, source, excludeCreepName, unreservedIncomeFactor))
            .filter((stat) => stat.energyPerTick > 0 && stat.distance > 0);
    }

    static buildCarryPlan(
        sourceRoom: Room,
        targetRoom: Room,
        allowWorkCarry: boolean,
        carryCapacity: number,
    ): ExternalMineCarryPlan {
        // 运力口径按房间模式参数表取：
        // - remoteUnreservedIncomeFactor：未预定房间产量口径（rush=1 满产，main=0.75 温和打折）
        // - remoteCarryThroughputFactor：吞吐冗余（死亡率/绕路/沼泽损耗）
        // - remoteCarryBacklogScale：积压加编阈值缩放（越小越早加编）
        const carryProfile = getRoomModeProfile(sourceRoom);
        const sources = this.getRoomSourceStats(sourceRoom, targetRoom, undefined, carryProfile.remoteUnreservedIncomeFactor);
        const sourceCount = sources.length;
        const baseTargetNum = allowWorkCarry
            ? sourceCount
            : Math.max(sourceCount + 1, Math.ceil(sourceCount * 2));

        let requiredCarryCapacity = 0;
        let backlogExtraCount = 0;
        for (const stat of sources) {
            const effectiveEnergyPerTick = Math.max(0, stat.energyPerTick - EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS);
            requiredCarryCapacity += 2 * stat.distance * effectiveEnergyPerTick * carryProfile.remoteCarryThroughputFactor;

            if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.SEVERE_BACKLOG_THRESHOLD * carryProfile.remoteCarryBacklogScale) backlogExtraCount += 2;
            else if (stat.availableEnergy >= EXTERNAL_MINE_ANALYSIS.BACKLOG_THRESHOLD * carryProfile.remoteCarryBacklogScale) backlogExtraCount += 1;
        }

        const throughputTargetNum = carryCapacity > 0
            ? Math.ceil(requiredCarryCapacity / Math.max(50, carryCapacity))
            : 0;
        const targetCarryNum = Math.max(baseTargetNum, throughputTargetNum + backlogExtraCount);

        return {
            sources,
            requiredCarryCapacity,
            backlogExtraCount,
            throughputTargetNum,
            targetCarryNum,
        };
    }

    static pickBestCarrySource(creep: Creep): ExternalMineSourceStat | null {
        const sourceRoomName = creep.memory.sourceRoom;
        const targetRoomName = creep.memory.targetRoom;
        if (!sourceRoomName || !targetRoomName) return null;

        const sourceRoom = Game.rooms[sourceRoomName];
        const targetRoom = Game.rooms[targetRoomName];
        if (!sourceRoom || !targetRoom) return null;

        const stats = this.getRoomSourceStats(sourceRoom, targetRoom, creep.name);
        if (stats.length <= 0) return null;

        const currentSourceKey = getExternalMineAssignedSourceKeyFromCarry(creep);
        const carryNeed = Math.max(1, getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY));
        let best: ExternalMineSourceStat | null = null;
        let bestScore = -Infinity;

        for (const stat of stats) {
            const availableEnergy = stat.availableEnergy;
            if (availableEnergy <= 0) continue;

            let score = Math.min(availableEnergy, carryNeed);
            score += Math.min(carryNeed, Math.max(0, availableEnergy - carryNeed)) * 0.1;

            if (creep.room?.name === stat.targetRoomName) {
                const localRange = creep.pos.getRangeTo(stat.sourcePos);
                score -= localRange * localRange * 0.5;
            }

            if (stat.sourceKey === currentSourceKey) {
                score += Math.max(20, carryNeed * 0.2);
            }

            if (score > bestScore) {
                bestScore = score;
                best = stat;
            }
        }

        if (best) return best;

        if (!currentSourceKey) return null;
        return stats.find((stat) => stat.sourceKey === currentSourceKey) || null;
    }

    // 每 tick 每源房缓存一次：各托管目标房的「可用积压」（已扣除在场搬运工预定量）。
    // 单次调度覆盖全部托管房，多个搬运工复用同一份结果，避免逐 creep 重算。
    static getManagedRoomBacklogMap(sourceRoom: Room): Record<string, number> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_room_backlog', () => {
            const backlog: Record<string, number> = {};
            const roomNames = [
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'energy'),
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'centerRoom'),
            ];
            for (const roomName of roomNames) {
                const targetRoom = Game.rooms[roomName];
                if (!targetRoom) continue;
                let total = 0;
                for (const stat of this.getRoomSourceStats(sourceRoom, targetRoom)) {
                    total += Math.max(0, stat.availableEnergy);
                }
                backlog[roomName] = total;
            }
            return backlog;
        });
    }

    // 每 tick 每源房缓存一次：各目标房在册的搬运工数量（含在途与孵化中，不含濒死返程的）。
    // 这是搬运重平衡的主键（人数最少者优先），单次统计全房搬运工复用。
    private static getCarryCountByTargetRoom(sourceRoom: Room): Record<string, number> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_carry_count', () => {
            const counts: Record<string, number> = {};
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                const memory = creep?.memory as any;
                if (!memory) continue;
                if (memory.unit !== UNITS.carrier || !memory.targetRoom) continue;
                if (memory.sourceRoom !== sourceRoom.name) continue;
                const targetRoom = memory.targetRoom;
                if (!targetRoom) continue;
                // 濒死返程的搬运工这趟交完就退休，不再计入在册
                if (typeof creep!.ticksToLive! === 'number' && creep!.ticksToLive! <= OUT_CARRY_DYING_TTL) continue;
                counts[targetRoom] = (counts[targetRoom] || 0) + 1;
            }
            return counts;
        });
    }

    // 每 tick 每源房缓存一次：有「在场产出采集工」的目标房集合。
    // 在场产出 = 本源房孵的外矿采集爬物理位于其目标房 + 有 WORK（能采）
    // + 有 CARRY（能装；零 CARRY 的废体型 harvest 永远 ERR_FULL，不算产出）。
    // 在途/孵化中的采集工不算——到场前没有产出。
    // 供搬运派送的「在场产出闸」与重平衡的候选过滤共用。
    static getOnSiteHarvesterRoomSet(sourceRoom: Room): Set<string> {
        return getRoomTickCacheValue(sourceRoom, 'outmine_onsite_harvester_rooms', () => {
            const rooms = new Set<string>();
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                const memory = creep?.memory as any;
                if (!memory || memory.unit !== UNITS.harvester || !memory.targetRoom) continue;
                if (memory.sourceRoom !== sourceRoom.name) continue;
                if (creep!.spawning!) continue;
                const targetRoomName = memory.targetRoom;
                if (!targetRoomName || !creep!.pos || creep!.pos.roomName!== targetRoomName) continue;
                const hasWork = typeof creep!.getActiveBodyparts! === 'function' && creep!.getActiveBodyparts! (WORK) > 0;
                if (!hasWork) continue;
                // 不要求 store 容量：rush 定点矿工 [W5,M1] 无 CARRY（掉落由搬运收取），
                // 在场产出的判定只看「在目标房 + 有采集力」
                rooms.add(targetRoomName);
            }
            return rooms;
        });
    }

    /**
     * 为一个外矿搬运工挑「更值得跑」的目标房（搬运工动态选房）。
     *
     * @remarks
     * 负载均衡以「在册搬运数」为主键：优先派往人最少的托管房，让各外矿房的搬运工数量趋平；
     * 同人数时才比积压（这一趟能不能装满）与距离。选择时机由调用方约束在
     * 「一趟起点」（刚交付完、空仓在母房），上路后目标锁定，避免途中反复横跳。
     *
     * @param creep 当前外矿搬运 creep。
     * @param candidatesOverride 候选目标房（测试/外部注入用；不传则按当前目标房的类别取托管列表）。
     * @param backlogOverride 候选房可用积压（测试/外部注入用；不传则按 tick 缓存现算）。
     * @returns 建议的目标房名；维持现状或数据不足时返回 `null`。
     */
    static pickBestCarryTargetRoom(
        creep: Creep,
        candidatesOverride?: string[],
        backlogOverride?: Record<string, number>,
    ): string | null {
        const sourceRoomName = creep.memory.sourceRoom;
        const currentTarget = creep.memory.targetRoom;
        if (!sourceRoomName || !currentTarget) return null;

        const injected = !!(candidatesOverride && backlogOverride);
        const sourceRoom = Game.rooms[sourceRoomName];
        if (!sourceRoom && !injected) return null;

        // 只在同类目标房之间重平衡：能量外矿 ↔ 能量外矿、中心房 ↔ 中心房。
        // 混着换会把搬运工送进 SK 中心房（工位与威胁口径完全不同）。
        let candidates = candidatesOverride;
        if (!candidates) {
            const energyTargets = ExternalMine.getManagedTargetRooms(sourceRoom!, 'energy');
            const centerTargets = ExternalMine.getManagedTargetRooms(sourceRoom!, 'centerRoom');
            candidates = energyTargets.indexOf(currentTarget) !== -1
                ? energyTargets
                : (centerTargets.indexOf(currentTarget) !== -1 ? centerTargets : []);
        }
        // 注意：这里不再因「候选只有 1 个」提前返回——当前房若是死房（被产出闸过滤），
        // 唯一的有效候选就是逃逸目标。

        const backlog = backlogOverride || this.getManagedRoomBacklogMap(sourceRoom!);
        const carryCount = sourceRoom ? this.getCarryCountByTargetRoom(sourceRoom) : {};
        const onSiteRooms = sourceRoom ? this.getOnSiteHarvesterRoomSet(sourceRoom) : new Set<string>();
        const carryNeed = Math.max(1, getExternalMineStoreFreeCapacity(creep.store as ExternalMineStoreLike, RESOURCE_ENERGY));

        const stats: CarryRoomCandidateStat[] = [];
        for (const roomName of candidates) {
            const hasBacklogEntry = roomName in backlog;
            const available = hasBacklogEntry ? Math.max(0, backlog[roomName] ?? 0) : 0;
            // 有产出闸：有积压（能量在等着搬）或有在场采集工（正在产出），二者居一才进候选。
            // 无视野又无在场采集工、或有视野但零积压且无采集工的死房一律排除——
            // 负载均衡主项是人数趋平，死房 0 人反而最「吸引」，不排除会把搬运工均衡进空房空跑。
            if (available <= 0 && !onSiteRooms.has(roomName)) continue;
            stats.push({
                roomName,
                available,
                distance: Math.max(1, Game.map.getRoomLinearDistance(sourceRoomName, roomName, true)),
                creepInRoom: creep.room?.name === roomName,
                assigned: carryCount[roomName] || 0,
            });
        }

        return pickBestCarryRoomName(currentTarget, carryNeed, stats);
    }

    // 每 tick 每源房缓存：发往某目标房的在册搬运总载量（含孵化中，不含濒死返程）。
    // 供收入瓶颈口径计算「搬运比」使用。
    private static getAssignedCarryCapacityByTarget(sourceRoomName: string, targetRoomName: string): number {
        let capacity = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const memory = creep?.memory as any;
            if (!memory) continue;
            if (memory.unit !== UNITS.carrier || !memory.targetRoom) continue;
            if (memory.sourceRoom !== sourceRoomName) continue;
            if (memory.targetRoom !== targetRoomName) continue;
            // 濒死返程的搬运工这趟交完就退休，不再计入运力
            if (typeof creep!.ticksToLive! === 'number' && creep!.ticksToLive! <= OUT_CARRY_DYING_TTL) continue;
            capacity += getExternalMineStoreCapacity(creep!.store! as ExternalMineStoreLike);
        }
        return capacity;
    }

    /**
     * 本源房外矿的真实有效收入（每 tick 能量口径）。
     *
     * @remarks
     * 有效收入 = Σ 净收入 × min(采集比, 搬运比)——**瓶颈侧决定真实到账**：
     * 采集断档（minerRatio 低）或运力不足（carryRatio 低）时收入按短板折算，
     * 升级定编（income 驱动）随之收缩，不再孵出「喂不饱的升级工」去抢外矿能量。
     *
     * - 采集比 = 在场采集功率 ÷ 净收入功率（到场 WORK × 2 / Σept，clamp 0-1）；
     * - 搬运比 = 在册搬运总载量 ÷ 需求运力（2 × 距离 × 净收入 × 模式冗余系数）；
     * - 无视野的目标房退化为「在册采集工 × 5」估算（宁估不缺，不断档口径）。
     */
    static getRoomRemoteIncome(sourceRoom: Room): number {
        return getRoomTickCacheValue(sourceRoom, 'outmine_remote_income', () => {
            const profile = getRoomModeProfile(sourceRoom);
            let income = 0;
            const roomNames = [
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'energy'),
                ...ExternalMine.getManagedTargetRooms(sourceRoom, 'centerRoom'),
            ];
            for (const roomName of roomNames) {
                const targetRoom = Game.rooms[roomName];
                if (!targetRoom) {
                    // 无视野：按在册采集工估算（每工 5/tick），封顶按 scout 记录的源数
                    const recorded = ExternalMineMath.getRecordedSourceNum(roomName) ?? 2;
                    let harvesters = 0;
                    for (const creep of Object.values(Game.creeps || {})) {
                        if (!creep?.my) continue;
                        if (creep.memory?.unit !== UNITS.harvester || !creep.memory.targetRoom) continue;
                        if (creep.memory.sourceRoom !== sourceRoom.name) continue;
                        if (creep.memory.targetRoom !== roomName) continue;
                        harvesters++;
                    }
                    income += Math.min(10 * recorded, harvesters * 5);
                    continue;
                }

                const stats = this.getRoomSourceStats(sourceRoom, targetRoom, undefined, profile.remoteUnreservedIncomeFactor);
                if (stats.length <= 0) continue;

                let netPerTickTotal = 0;
                let harvestPowerTotal = 0;
                let requiredCarryCapacity = 0;
                for (const stat of stats) {
                    const netPerTick = Math.max(0, stat.energyPerTick - EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS);
                    netPerTickTotal += netPerTick;
                    harvestPowerTotal += stat.harvestingPower;
                    requiredCarryCapacity += 2 * stat.distance * netPerTick * profile.remoteCarryThroughputFactor;
                }
                if (netPerTickTotal <= 0) continue;

                const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
                const minerRatio = clamp01(harvestPowerTotal / netPerTickTotal);
                const carryRatio = requiredCarryCapacity > 0
                    ? clamp01(this.getAssignedCarryCapacityByTarget(sourceRoom.name, roomName) / requiredCarryCapacity)
                    : 1;
                income += netPerTickTotal * Math.min(minerRatio, carryRatio);
            }
            return income;
        });
    }
}
