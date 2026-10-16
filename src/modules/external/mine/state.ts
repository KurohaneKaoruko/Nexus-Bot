
/**
 * 外矿状态与选房层: QoS/模式/预算口径、目标房背包选择（DP）与托管列表缓存。
 */

import { qos } from '@/core/qos';
import { CARRY_STAFFING_CONFIG } from '@/config/economy';
import { getRoomMode } from '@/modules/strategy';
import { UNITS, UnitData } from '@/constant/CreepConstant';
import { getOutMineData } from '@/core/store/accessor';
import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';
import { RoadBuilder, RoadVisual } from '@/modules/external/externalRoad';
import { HighwayMineVisual } from '@/modules/visuals';
import {
    EXTERNAL_MINE_ANALYSIS,
    EXTERNAL_MINE_ANALYSIS_DEFAULTS,
    getExternalMineNearbyContainer,
    getExternalMineSourceDistance,
    getExternalMineTargetSources,
} from '@/modules/external/mine/shared';

// 目标房间列表的类型：普通外矿（能量）与中心房（SK/中心区）外矿。
export type OutMineTargetListKey = 'energy' | 'centerRoom';

// 单次外矿运行的状态快照，用于控制节奏与副作用（造路/侦查等）。
type OutMineRunState = {
    qosLevel: string;
    canRunSecondaryAction: boolean;
};

type ExternalMineEnergyState = NonNullable<RoomMemory['energyState']> | 'UNKNOWN';
type ExternalMineTargetPolicy = {
    mode: string;
    energyState: ExternalMineEnergyState;
    remoteBudget: number;
    energyTargetLimit: number;
    allowCenterRoom: boolean;
};
type ExternalMineTargetSelectionStat = {
    roomName: string;
    kind: OutMineTargetListKey;
    distance: number;
    sourceCount: number;
    value: number;
    weight: number;
    score: number;
};
type ExternalMineManagedTargetSelection = Record<OutMineTargetListKey, string[]>;

// 外矿逻辑的执行间隔设置（不同 QoS 下采用不同的 tick 间隔）。
export type ExternalMineTiming = {
    normalInterval: number;
    constrainedInterval: number;
};
// 扇区可达性：novice / respawn / closed 扇区的房间物理不可达，
// 混进外矿目标会让 creep 在扇区边界堆死、白占孵化预算
export const isRoomReachable = (roomName: string): boolean => {
    try {
        const status = Game.map.getRoomStatus(roomName);
        return !status || status.status === 'normal';
    } catch {
        return true;
    }
};
// 托管目标选择（背包 DP）的跨 tick 短 TTL 缓存：
// 输入（目标列表、房间模式、能量状态、spawn 预算）都以 tick 级缓慢变化，
// 而 DP 本身不便宜；10 tick 的选择滞后完全可接受，QoS 紧张时也不再反复重算。
const MANAGED_SELECTION_TTL_TICKS = 10;
type ManagedSelectionCacheEntry = {
    tick: number;
    selection: ExternalMineManagedTargetSelection;
};
const managedSelectionCache = new Map<string, ManagedSelectionCacheEntry>();
// 外矿运行的状态工具：QoS、房间模式、节流、以及视觉渲染。
export const ExternalMineState = {
    CENTER_ROOM_REGEX: /^[EW]\d*[456][NS]\d*[456]$/,
    EXACT_CENTER_ROOM_REGEX: /^[EW]\d*[5][NS]\d*[5]$/,
    DEFAULT_LOCAL_SOURCE_COUNT: 2,
    /** 每 spawn 在册爬容量 = 寿命 / 单只孵化耗时; 单只孵化耗时 = CREEP_SPAWN_TIME × 部件数 */
    SPAWN_USAGE_PER_SPAWN:
        (typeof CREEP_LIFE_TIME === 'number' && typeof CREEP_SPAWN_TIME === 'number')
            ? CREEP_LIFE_TIME / (CREEP_SPAWN_TIME * CARRY_STAFFING_CONFIG.nominalCreepParts)
            : 1500 / (3 * 6),
    LOCAL_SOURCE_BASE_WEIGHT: 42,
    LOCAL_PORTER_WEIGHT_PER_SPAWN: 23,
    LOCAL_CONTROLLER_WEIGHT: 18,
    LOCAL_QUEUE_WEIGHT_PER_TASK: 18,
    REMOTE_RESERVER_WEIGHT: 5,
    REMOTE_RESERVER_VALUE_COST: 1.3,
    KEEPER_REMOTE_WEIGHT: typeof MAX_CREEP_SIZE === 'number' ? MAX_CREEP_SIZE : 50,
    KEEPER_REMOTE_VALUE_COST: 4.5,
    DEFAULT_KEEPER_ATTACK_COST: 4270,
    DEFAULT_ENERGY_TARGET_LIMIT: Number.POSITIVE_INFINITY,
    LOW_MODE_ENERGY_TARGET_LIMIT: 1,
    LOW_MODE_MAX_REMOTE_BUDGET: 140,
    SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER: 1.1,
    REMOTE_QUEUE_ROLE_SET: new Set<string>([
        UNITS['scout'],
        UNITS['reserver'],
        UNITS.harvester,
        UNITS.carrier,
        UNITS['out-build'],
        UNITS['out-mineral'],
        UNITS['out-attack'],
        UNITS['out-ranged'],
        UNITS['out-defend'],
        UNITS['out-invader'],
        UNITS['out-2attack'],
        UNITS['out-2heal'],
    ]),

    getTargetList(memory: OutMineMemory, key: OutMineTargetListKey): string[] {
        const list = memory[key];
        if (!Array.isArray(list) || list.length <= 0) return [];
        return list.filter((roomName): roomName is string => typeof roomName === 'string' && !!roomName);
    },

    // 从全局 QoS 中获取当前级别，缺失时默认 normal。
    getQosLevel(): string {
        return qos.getQoS()?.level || 'normal';
    },

    isCenterRoom(roomName: string): boolean {
        return this.CENTER_ROOM_REGEX.test(roomName);
    },

    isExactCenterRoom(roomName: string): boolean {
        return this.EXACT_CENTER_ROOM_REGEX.test(roomName);
    },

    isKeeperCenterRoom(roomName: string): boolean {
        return this.isCenterRoom(roomName) && !this.isExactCenterRoom(roomName);
    },

    getEnergyState(room: Room): ExternalMineEnergyState {
        return room.getEnergyState?.() || room.updateEnergyState?.(false) || room.memory.energyState || 'UNKNOWN';
    },

    // 源房到目标房的线性距离（外矿派单用的「先近后远」主键）。
    getTargetPriorityDistance(sourceRoom: Room, targetRoomName: string): number {
        if (typeof Game.map?.getRoomLinearDistance === 'function') {
            return Math.max(1, Game.map.getRoomLinearDistance(sourceRoom.name, targetRoomName, true));
        }
        return 1;
    },

    getTargetKind(targetRoomName: string): OutMineTargetListKey {
        return this.isCenterRoom(targetRoomName) ? 'centerRoom' : 'energy';
    },

    getSourceRoomLevel(sourceRoom: Room): number {
        return sourceRoom.getEffectiveRoomLevel?.() ?? sourceRoom.level ?? 1;
    },

    getBodyConfigCost(bodyConfig: ((BodyPartConstant | number)[])[] | undefined): number {
        if (!Array.isArray(bodyConfig) || bodyConfig.length <= 0) return 0;
        let total = 0;
        for (const part of bodyConfig) {
            if (!Array.isArray(part) || part.length < 2) continue;
            const type = part[0];
            const count = typeof part[1] === 'number' ? part[1] : 0;
            if (count <= 0) continue;
            switch (type) {
            case WORK:
                total += count * 100;
                break;
            case CARRY:
            case MOVE:
                total += count * 50;
                break;
            case ATTACK:
                total += count * 80;
                break;
            case RANGED_ATTACK:
                total += count * 150;
                break;
            case HEAL:
                total += count * 250;
                break;
            case CLAIM:
                total += count * 600;
                break;
            case TOUGH:
                total += count * 10;
                break;
            default:
                break;
            }
        }
        return total;
    },

    getKeeperRemoteAttackCost(sourceRoom: Room): number {
        const roleBody = sourceRoom.GetUnitBodys?.(UNITS['out-attack']);
        const roleBodyCost = this.getBodyConfigCost(roleBody);
        if (roleBodyCost > 0) return roleBodyCost;
        const fallbackBody = UnitData[UNITS[UNITS['out-attack']]]?.bodypart as ((BodyPartConstant | number)[])[] | undefined;
        const fallbackCost = this.getBodyConfigCost(fallbackBody);
        return fallbackCost > 0 ? fallbackCost : this.DEFAULT_KEEPER_ATTACK_COST;
    },

    canRunKeeperRemote(sourceRoom: Room): boolean {
        const requiredCost = this.getKeeperRemoteAttackCost(sourceRoom);
        return (sourceRoom.energyCapacityAvailable || 0) >= requiredCost;
    },

    getSpawnUsageCapacity(sourceRoom: Room): number {
        const spawnCount = Math.max(1, sourceRoom.spawn?.length || 0);
        return Math.floor(spawnCount * this.SPAWN_USAGE_PER_SPAWN);
    },

    getLocalSourceCount(sourceRoom: Room): number {
        const indexed = Array.isArray(sourceRoom.source) ? sourceRoom.source.length : 0;
        if (indexed > 0) return indexed;
        if (typeof sourceRoom.find === 'function') {
            try {
                const found = sourceRoom.find(FIND_SOURCES).length;
                if (found > 0) return found;
            }
            catch { }
        }
        return this.DEFAULT_LOCAL_SOURCE_COUNT;
    },

    getLocalSpawnQueuePressure(sourceRoom: Room): number {
        const tasks = sourceRoom.getAllMissionFromPool?.('spawn') || [];
        let localQueued = 0;
        for (const task of tasks) {
            const data = task?.data;
            const memory = (data && typeof data === 'object' && 'memory' in data)
                ? (data.memory as Partial<CreepMemory> | undefined)
                : undefined;
            const unit = memory?.unit;
            if (typeof unit !== 'string' || !unit) continue;
            if (this.REMOTE_QUEUE_ROLE_SET.has(unit) && (!memory.sourceRoom || memory.sourceRoom === sourceRoom.name)) {
                continue;
            }
            localQueued++;
        }
        return localQueued * this.LOCAL_QUEUE_WEIGHT_PER_TASK;
    },

    getLocalSpawnReserve(sourceRoom: Room): number {
        const spawnCount = Math.max(1, sourceRoom.spawn?.length || 0);
        const localSourceCount = this.getLocalSourceCount(sourceRoom);
        let reserve =
            localSourceCount * this.LOCAL_SOURCE_BASE_WEIGHT +
            spawnCount * this.LOCAL_PORTER_WEIGHT_PER_SPAWN;
        if (this.getSourceRoomLevel(sourceRoom) <= 4) {
            reserve += this.LOCAL_CONTROLLER_WEIGHT;
        }
        reserve += this.getLocalSpawnQueuePressure(sourceRoom);
        return reserve;
    },

    canReserveRemote(sourceRoom: Room, kind: OutMineTargetListKey): boolean {
        return kind === 'energy' && this.getSourceRoomLevel(sourceRoom) >= 3;
    },

    isRemoteConstructed(sourceRoom: Room, targetRoom: Room | undefined, source: Source | undefined): boolean {
        const builtLevel = this.getSourceRoomLevel(sourceRoom);
        if (builtLevel >= 4) return true;
        if (!targetRoom || !source) return false;
        return !!getExternalMineNearbyContainer(targetRoom, source);
    },

    getSelectionEnergyPerTick(
        sourceRoom: Room,
        targetRoomName: string,
        kind: OutMineTargetListKey,
        targetRoom?: Room,
        source?: Source,
    ): number {
        const baseCapacity = typeof source?.energyCapacity === 'number' && source.energyCapacity > 0
            ? source.energyCapacity
            : EXTERNAL_MINE_ANALYSIS_DEFAULTS.sourceEnergyCapacity;
        let energyPerTick = baseCapacity / EXTERNAL_MINE_ANALYSIS_DEFAULTS.energyRegenTime;

        if (kind === 'centerRoom') return energyPerTick;

        const canReserve = this.canReserveRemote(sourceRoom, kind);
        if (!targetRoom?.controller) {
            return canReserve ? energyPerTick : energyPerTick * 0.5;
        }

        const myUserName = sourceRoom.controller?.owner?.username;
        if (!myUserName) return energyPerTick;
        if (targetRoom.controller.owner && targetRoom.controller.owner.username !== myUserName) return 0;
        if (targetRoom.controller.reservation && targetRoom.controller.reservation.username !== myUserName) {
            return canReserve ? energyPerTick : energyPerTick * 0.5;
        }
        if (targetRoom.controller.owner || (targetRoom.controller.reservation && targetRoom.controller.reservation.username === myUserName)) {
            return energyPerTick;
        }
        return canReserve ? energyPerTick : energyPerTick * 0.5;
    },

    estimateSourceSelectionStat(
        sourceRoom: Room,
        targetRoomName: string,
        kind: OutMineTargetListKey,
        targetRoom?: Room,
        source?: Source,
    ): { distance: number; value: number; weight: number } {
        const distance = targetRoom && source
            ? getExternalMineSourceDistance(sourceRoom, targetRoom, source)
            : (
                EXTERNAL_MINE_ANALYSIS.ROUTE_BASE_TICKS +
                this.getTargetPriorityDistance(sourceRoom, targetRoomName) * EXTERNAL_MINE_ANALYSIS.ROUTE_TICKS_PER_LINEAR_DISTANCE +
                EXTERNAL_MINE_ANALYSIS.ROUTE_LOCAL_APPROACH_TICKS
            );
        const energyPerTick = this.getSelectionEnergyPerTick(sourceRoom, targetRoomName, kind, targetRoom, source);
        if (energyPerTick <= 0) {
            return { distance, value: 0, weight: Number.POSITIVE_INFINITY };
        }

        const constructed = this.isRemoteConstructed(sourceRoom, targetRoom, source);
        const workParts = Math.max(1, Math.ceil(energyPerTick / EXTERNAL_MINE_ANALYSIS_DEFAULTS.harvestPower));
        const carryParts = 1;
        const moveParts = Math.max(1, constructed ? Math.ceil((workParts + carryParts) / 2) : (workParts + carryParts));
        const minerBodyLength = workParts + carryParts + moveParts;
        const minerBodyCost = workParts * 100 + (carryParts + moveParts) * 50;
        const creepLifeTime = typeof CREEP_LIFE_TIME === 'number' ? CREEP_LIFE_TIME : 1500;
        const remainingLife = Math.max(200, creepLifeTime - Math.min(distance, creepLifeTime - 100));
        const minerCost = minerBodyCost / remainingLife;
        const minerSpawnUsage = minerBodyLength * (creepLifeTime / remainingLife);
        const haulerCost = (distance * energyPerTick * 0.04 * (constructed ? 75 : 100)) / creepLifeTime;
        const haulerSpawnUsage = distance * energyPerTick * 0.04 * (constructed ? 1.5 : 2);
        const repairLoss = constructed ? EXTERNAL_MINE_ANALYSIS.SOURCE_CONTAINER_REPAIR_LOSS : 1;

        return {
            distance,
            value: Math.max(0.1, energyPerTick - minerCost - haulerCost - repairLoss),
            weight: Math.max(1, minerSpawnUsage + haulerSpawnUsage),
        };
    },

    estimateTargetSelectionStat(sourceRoom: Room, targetRoomName: string): ExternalMineTargetSelectionStat {
        const targetRoom = Game.rooms[targetRoomName];
        const kind = this.getTargetKind(targetRoomName);
        const fallbackSourceCount = kind === 'centerRoom' ? 3 : 2;
        const sources = targetRoom ? getExternalMineTargetSources(targetRoom) : [];
        const sourceCount = Math.max(fallbackSourceCount, sources.length || 0);

        let value = 0;
        let weight = 0;
        let distanceSum = 0;

        if (sources.length > 0 && targetRoom) {
            for (const source of sources) {
                const sourceStat = this.estimateSourceSelectionStat(sourceRoom, targetRoomName, kind, targetRoom, source);
                distanceSum += sourceStat.distance;
                value += sourceStat.value;
                weight += sourceStat.weight;
            }
        } else {
            for (let index = 0; index < sourceCount; index += 1) {
                const sourceStat = this.estimateSourceSelectionStat(sourceRoom, targetRoomName, kind);
                distanceSum += sourceStat.distance;
                value += sourceStat.value;
                weight += sourceStat.weight;
            }
        }

        if (this.canReserveRemote(sourceRoom, kind)) {
            value -= this.REMOTE_RESERVER_VALUE_COST;
            weight += this.REMOTE_RESERVER_WEIGHT;
        }
        if (this.isKeeperCenterRoom(targetRoomName)) {
            value -= this.KEEPER_REMOTE_VALUE_COST;
            weight += this.KEEPER_REMOTE_WEIGHT;
        }

        const avgDistance = Math.max(1, distanceSum / Math.max(1, sourceCount));
        const safeValue = Math.max(0.1, value);
        const safeWeight = Math.max(1, weight);
        return {
            roomName: targetRoomName,
            kind,
            distance: avgDistance,
            sourceCount,
            value: safeValue,
            weight: safeWeight,
            score: safeValue / safeWeight,
        };
    },

    compareTargetStats(left: ExternalMineTargetSelectionStat, right: ExternalMineTargetSelectionStat): number {
        const scoreDiff = right.score - left.score;
        if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
        const valueDiff = right.value - left.value;
        if (Math.abs(valueDiff) > 0.0001) return valueDiff;
        const distanceDiff = left.distance - right.distance;
        if (Math.abs(distanceDiff) > 0.0001) return distanceDiff;
        return left.roomName.localeCompare(right.roomName);
    },

    selectTargetStats(
        sourceRoom: Room,
        stats: ExternalMineTargetSelectionStat[],
        policy: ExternalMineTargetPolicy,
    ): ExternalMineManagedTargetSelection {
        const allowedStats = stats
            .filter((stat) => {
                if (stat.kind !== 'centerRoom') return true;
                if (!policy.allowCenterRoom) return false;
                if (!this.isKeeperCenterRoom(stat.roomName)) return true;
                return this.canRunKeeperRemote(sourceRoom);
            })
            .sort((left, right) => this.compareTargetStats(left, right));
        if (allowedStats.length <= 0) {
            return { energy: [], centerRoom: [] };
        }

        // 链式记录选中集合：只在「确定替换」时新建一个节点，不再每步拷贝整个 rooms 数组；
        // join 仅在罕见的三重平局（价值/重量/数量全相同）时才物化字符串。
        // 此前 rush 模式 budget 可达 spawn 数 × 500，且每步都拷贝 rooms，
        // 单次 DP 就是「目标数 × 表宽 × 数组长度」的分配风暴，直接把 tick 烧穿。
        type KnapsackEntry = {
            value: number;
            totalWeight: number;
            energyCount: number;
            roomCount: number;
            prev: KnapsackEntry | null;
            roomName: string;
        };

        const budget = Math.max(0, Math.floor(policy.remoteBudget));
        // DP 宽度压到「全部买得起的总重」以内：超出部分永远不可达，结果不变、表长不白算。
        const requiredWeights = allowedStats.map((stat) => Math.max(1, Math.ceil(stat.weight)));
        // 注意：什么都不买得起时也不能在这里提前返回——旧实现的空 DP 会落到
        // 兜底分支补一个目标，语义必须保持一致。
        let affordableTotal = 0;
        for (const requiredWeight of requiredWeights) {
            if (requiredWeight <= budget) affordableTotal += requiredWeight;
        }
        const capacity = Math.min(budget, affordableTotal);

        const table: Array<KnapsackEntry | null> = Array.from({ length: capacity + 1 }, () => null);
        table[0] = { value: 0, totalWeight: 0, energyCount: 0, roomCount: 0, prev: null, roomName: '' };

        const joinRooms = (entry: KnapsackEntry): string => {
            const names: string[] = [];
            for (let node: KnapsackEntry | null = entry; node && node.prev; node = node.prev) {
                names.unshift(node.roomName);
            }
            return names.join(',');
        };

        const betterThan = (candidate: KnapsackEntry, current: KnapsackEntry | null): boolean => {
            if (!current) return true;
            if (candidate.value > current.value + 0.0001) return true;
            if (current.value > candidate.value + 0.0001) return false;
            if (candidate.totalWeight < current.totalWeight) return true;
            if (candidate.totalWeight > current.totalWeight) return false;
            if (candidate.roomCount > current.roomCount) return true;
            if (candidate.roomCount < current.roomCount) return false;
            return joinRooms(candidate) < joinRooms(current);
        };

        const energyLimit = Number.isFinite(policy.energyTargetLimit)
            ? policy.energyTargetLimit
            : Number.POSITIVE_INFINITY;

        for (let index = 0; index < allowedStats.length; index += 1) {
            const stat = allowedStats[index];
            const requiredWeight = requiredWeights[index];
            if (requiredWeight! > capacity) continue;
            const isEnergy = stat?.kind === 'energy';
            for (let currentBudget = capacity; currentBudget >= requiredWeight!; currentBudget -= 1) {
                const previous = table[currentBudget - requiredWeight!];
                if (!previous) continue;
                const nextEnergyCount = previous.energyCount + (isEnergy ? 1 : 0);
                if (nextEnergyCount > energyLimit) continue;
                const candidateValue = previous.value + stat!.value!;
                const candidateWeight = previous.totalWeight + requiredWeight!;
                const candidateRoomCount = previous.roomCount + 1;
                const incumbent = table[currentBudget];
                let replace: boolean;
                if (!incumbent) {
                    replace = true;
                } else if (candidateValue > incumbent.value + 0.0001) {
                    replace = true;
                } else if (incumbent.value > candidateValue + 0.0001) {
                    replace = false;
                } else if (candidateWeight !== incumbent.totalWeight) {
                    replace = candidateWeight < incumbent.totalWeight;
                } else if (candidateRoomCount !== incumbent.roomCount) {
                    replace = candidateRoomCount > incumbent.roomCount;
                } else {
                    replace = joinRooms({
                        value: candidateValue,
                        totalWeight: candidateWeight,
                        energyCount: nextEnergyCount,
                        roomCount: candidateRoomCount,
                        prev: previous,
                        roomName: stat!.roomName!,
                    }) < joinRooms(incumbent);
                }
                if (!replace) continue;
                table[currentBudget] = {
                    value: candidateValue,
                    totalWeight: candidateWeight,
                    energyCount: nextEnergyCount,
                    roomCount: candidateRoomCount,
                    prev: previous,
                    roomName: stat!.roomName!,
                };
            }
        }

        let best: KnapsackEntry | null = null;
        for (const entry of table) {
            if (entry && betterThan(entry, best)) best = entry;
        }

        const selectedSet = new Set<string>();
        for (let node = best; node && node.prev; node = node.prev) {
            selectedSet.add(node.roomName);
        }
        const selection: ExternalMineManagedTargetSelection = { energy: [], centerRoom: [] };
        for (const stat of allowedStats) {
            if (!selectedSet.has(stat.roomName)) continue;
            selection[stat.kind].push(stat.roomName);
        }

        if (selection.energy.length > 0 || selection.centerRoom.length > 0) {
            return selection;
        }

        const fallbackStats = [...allowedStats].sort((left, right) => {
            const valueDiff = right.value - left.value;
            if (Math.abs(valueDiff) > 0.0001) return valueDiff;
            const weightDiff = left.weight - right.weight;
            if (Math.abs(weightDiff) > 0.0001) return weightDiff;
            const distanceDiff = left.distance - right.distance;
            if (Math.abs(distanceDiff) > 0.0001) return distanceDiff;
            return left.roomName.localeCompare(right.roomName);
        });
        for (const stat of fallbackStats) {
            if (stat.kind === 'energy' && Number.isFinite(policy.energyTargetLimit) && selection.energy.length >= policy.energyTargetLimit) {
                continue;
            }
            selection[stat.kind].push(stat.roomName);
            break;
        }
        return selection;
    },

    // 外矿预算折扣已移除：外矿是摆脱能量短缺的收入投资，短缺期砍它只会加剧短缺（贫困陷阱）。
    // 能量平衡由预算公式本身表达——本地编制优先占满 spawn（getLocalSpawnReserve），
    // 能量紧张时本地队列变长、预算自动收窄；孵化端对 out-* 按当前能量缩水体（spawnControl），
    // 收入按比例下降但不断档。
    getTargetPolicy(sourceRoom: Room): ExternalMineTargetPolicy {
        const mode = this.getRoomMode(sourceRoom);
        const energyState = this.getEnergyState(sourceRoom);
        const spawnUsageCapacity = this.getSpawnUsageCapacity(sourceRoom);
        const localSpawnReserve = this.getLocalSpawnReserve(sourceRoom);
        let remoteBudget = Math.max(0, spawnUsageCapacity - localSpawnReserve);

        if (energyState === 'SURPLUS') {
            remoteBudget = Math.floor(remoteBudget * this.SURPLUS_STATE_REMOTE_BUDGET_MULTIPLIER);
        }

        if (mode === 'low') {
            remoteBudget = Math.min(remoteBudget, this.LOW_MODE_MAX_REMOTE_BUDGET);
        }

        // 能量目标房数量不随能量状态收缩（否则其他外矿房的 creep 死一只少一只、骤降断档）；
        // low 模式是用户显式低配，保留单房上限。
        let energyTargetLimit = this.DEFAULT_ENERGY_TARGET_LIMIT;
        if (mode === 'low') {
            energyTargetLimit = this.LOW_MODE_ENERGY_TARGET_LIMIT;
        }

        // rush：外矿就是主要收入源——预算保底、能量目标上限放开、不碰危险中心房
        // 中心房（SK）高耗高危，能量低/紧急时暂停是合理的省能量位置，保留该闸。
        let allowCenterRoom = energyState !== 'LOW' && energyState !== 'CRITICAL';
        if (mode === 'rush') {
            remoteBudget = Math.max(remoteBudget, spawnUsageCapacity);
            energyTargetLimit = Number.POSITIVE_INFINITY;
            allowCenterRoom = false;
        }

        return {
            mode,
            energyState,
            remoteBudget,
            energyTargetLimit,
            allowCenterRoom,
        };
    },

    // 兼容多处存储路径读取房间模式（统一走 roomMode 单一来源）。
    getRoomMode(room: Room): string {
        return getRoomMode(room);
    },

    // 根据 QoS 与间隔判断本 tick 是否运行，返回运行状态快照。
    // emergency 时直接停机，constrained 时拉长间隔且限制副作用操作频率。
    getRunState(timing: ExternalMineTiming): OutMineRunState | null {
        const qosLevel = this.getQosLevel();
        if (qosLevel === 'emergency') return null;

        const canRunSecondaryAction =
            qosLevel === 'normal' || qos.shouldRun({ every: 2, allowLevels: ['constrained'] });
        const interval = qosLevel === 'constrained' ? timing.constrainedInterval : timing.normalInterval;
        if (Game.time % interval !== 0) return null;

        return { qosLevel, canRunSecondaryAction };
    },

    // rush 自动扩图：把**上下左右四个正交相邻**房间自动加入能量外矿列表
    // （跳过 novice/respawn/closed 等不可达扇区；斜对角距离太远，不扩）。
    // 仅当列表**完全为空**时生效（首次引导语义：空 = 没配置，帮我自动来）；
    // 用户一旦手动管理过列表（非空），自动扩图彻底退出——否则手动 remove/add 会被
    // 下一轮扩图写回，表现为「莫名其妙自动乱加外矿」。上限 4 与触发条件对齐。
    autoAddNearbyEnergyTargets(sourceRoomName: string, known: string[]): string[] {
        if (known.length > 0) return known;
        // 满级房双保险：调用侧已闸，这里再挡一层（其他调用方未来接入也不会越界）
        const srcRoom = Game.rooms[sourceRoomName];
        if (srcRoom?.controller?.my && srcRoom.controller.level >= 8) return known;
        const match = sourceRoomName.match(/^([WE])(\d+)([NS])(\d+)$/);
        if (!match) return known;
        const px = match[1] === 'E' ? Number(match[2]) : -Number(match[2]) - 1;
        const py = match[3] === 'N' ? Number(match[4]) : -Number(match[4]) - 1;

        const Mem = getOutMineData(sourceRoomName);
        Mem.energy ??= [];
        // rush：八向候选全量注册——实际取舍交给选房 DP（value/weight 背包，
        // 预算内自动偏好近房），候选列表不做人工截断
        const rush = Game.rooms[sourceRoomName] && getRoomMode(Game.rooms[sourceRoomName]) === 'rush';
        const maxRemote = rush ? 8 : 4;
        const addedRooms: string[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (!rush && dx !== 0 && dy !== 0) continue; // 只允许上下左右四个正交方向，斜角太远不扩
                if (Mem.energy.length >= maxRemote) break;
                const x = px + dx;
                const y = py + dy;
                const roomName = `${x >= 0 ? 'E' + x : 'W' + (-x - 1)}${y >= 0 ? 'N' + y : 'S' + (-y - 1)}`;
                if (!isRoomReachable(roomName)) continue;
                if (Mem.energy.indexOf(roomName) === -1) {
                    Mem.energy.push(roomName);
                    known.push(roomName);
                    addedRooms.push(roomName);
                }
            }
        }
        if (addedRooms.length > 0) {
            console.log(`[自动扩图] ${sourceRoomName} 自动加入相邻外矿: ${addedRooms.join(', ')}`);
        }
        return known;
    },

    // 同一个源房的 energy / centerRoom 旧桶数据可能串味；
    // 这里统一按“房名是否属于 center room”重新分类，避免同一目标被两条分支重复处理。
    // 选择结果按「源房 → energy+centerRoom 一次算齐」做 TTL 缓存（两个 key 共享同一次 DP），
    // 返回副本，避免调用方（如 rush 自动扩图）就地 push 污染缓存。
    getManagedTargets(sourceRoom: Room, key: OutMineTargetListKey): string[] {
        const cached = managedSelectionCache.get(sourceRoom.name);
        if (!cached || Game.time - cached.tick >= MANAGED_SELECTION_TTL_TICKS) {
            const selection = this.computeManagedTargets(sourceRoom);
            managedSelectionCache.set(sourceRoom.name, { tick: Game.time, selection });
            return selection[key].slice();
        }
        return cached.selection[key].slice();
    },

    computeManagedTargets(sourceRoom: Room): ExternalMineManagedTargetSelection {
        const data = getOutMineData(sourceRoom.name);
        const mergedTargets = [
            ...this.getTargetList(data, 'energy'),
            ...this.getTargetList(data, 'centerRoom'),
        ];
        if (mergedTargets.length <= 0) return { energy: [], centerRoom: [] };

        // 过滤不可达扇区：novice/respawn/closed 房间物理进不去，混进轮换会让 creep 在扇区边界堆死、白占孵化预算
        const uniqueTargets = [...new Set(mergedTargets)].filter(isRoomReachable);
        const policy = this.getTargetPolicy(sourceRoom);
        const stats = uniqueTargets.map((roomName) => this.estimateTargetSelectionStat(sourceRoom, roomName));
        return this.selectTargetStats(sourceRoom, stats, policy);
    },

    createMemory(sourceRoomName: string, targetRoomName: string): CreepMemory {
        return { sourceRoom: sourceRoomName, targetRoom: targetRoomName } as CreepMemory;
    },

    // 外矿基础设施建造入口。
    // container 只要目标房有视野就优先尝试落地，不再受 secondary action 节流影响；
    // road 仍按 secondary action、等级与 BUILD_INTERVAL 节流，避免把高成本寻路/铺路放大到每 tick。
    // rush 例外：道路是采集/搬运的 2 倍速引擎（平地 1 tick/格 → 路面 0.5），落地即铺、
    // 100 tick 一轮——等 RCL4 才铺路，整个前期远程运力都在平地上爬（race 实测 4 万 tick 零路网）。
    tryBuildRoad(
        sourceRoom: Room,
        targetRoom: Room,
        minLevel: number,
        canRunSecondaryAction: boolean
    ): void {
        RoadBuilder.ensureControllerContainer(sourceRoom);
        RoadBuilder.ensureContainerSites(sourceRoom, targetRoom);
        if (!canRunSecondaryAction) return;
        const rush = getRoomMode(sourceRoom) === 'rush';
        // rush 也从 RCL3 起铺：RCL2 阶段收入未起量，8 房路网（~9k 能量/房）会把
        // 升级/孵化抽干；源容器与控制器容器在上方两行先建，不受此门限制
        if (sourceRoom.level < (rush ? 3 : minLevel)) return;
        // cc 是升级链唯一补给点：缺位/在建/残血期间路面一律让位（worker 建造力集中保 cc）
        const ctrl = sourceRoom.controller;
        if (ctrl) {
            const cc = (sourceRoom.container || []).find(c => c.pos.inRangeTo(ctrl.pos, 3));
            const ccSite = sourceRoom.find(FIND_MY_CONSTRUCTION_SITES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(ctrl.pos, 3),
            }).length > 0;
            if (!cc || ccSite || cc.hits < cc.hitsMax * 0.4) return;
        }
        if (Game.time % (rush ? 100 : EXTERNAL_ROAD_CONFIG.BUILD_INTERVAL) !== 0) return;
        RoadBuilder.createRoadSites(sourceRoom, targetRoom);
    },

    // 外矿相关的可视化输出。
    runVisuals(): void {
        RoadVisual.run();
        HighwayMineVisual.run();
    },
};

export const getExternalMineCollectionRange = (roomName: string): number => ExternalMineState.isCenterRoom(roomName) ? 5 : 1;
