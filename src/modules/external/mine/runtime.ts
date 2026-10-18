
/**
 * 外矿运行时: 能量外矿与中心房外矿的每 tick 调度主流程（休眠链之一, 由 outMine 挂载）。
 */

import { getWhitelistIds, isWarMode } from '@/core/store/accessor';
import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';
import { isRoomTickAligned } from '@/utils/roomPhase';
import { getActiveRemoteThreshold } from '@/core/bucketGovernor';
import { UNITS } from '@/constant/CreepConstant';
import { RoadBuilder } from '@/modules/external/externalRoad';
import { getRoomTickCacheValue } from '@/utils/roomTickCache';
import { isRoomRemoteUnlocked } from '@/modules/economy';
import { isRaceCompat } from '@/config/capabilities';
import { readRecordedSourceSlotCounts, recordSourceSlotCounts } from '@/core/store/accessor';
import { ExternalMineState, isRoomReachable, type OutMineTargetListKey, type ExternalMineTiming } from '@/modules/external/mine/state';
import { ExternalMineMath } from '@/modules/external/mine/math';
import { ExternalMineSpawner } from '@/modules/external/mine/spawner';
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';
import { EXTERNAL_COMMAND_PRIORITY } from '@/config/external';

// 各外矿房最后已知源数（有视野时刷新）：无视野补采集工时按它补给，防外矿停摆
const lastKnownSourceNum = new Map<string, number>();

// 外矿入口类：调度能量外矿与中心房外矿的整体流程。
export const ExternalMine = {
    // 每个 tick 的准备阶段：防守与战争态短路、清理无效任务、修正优先级。
    prepareRoom(room: Room): string | null {
        if (room.memory.defend) return null;
        if (isWarMode()) return null;

        const qosLevel = ExternalMineState.getQosLevel();
        if (qosLevel === 'emergency') return null;
        return qosLevel;
    },

    // 外矿相关可视化。
    runVisuals(): void {
        ExternalMineState.runVisuals();
    },

    // 对外暴露房间模式读取接口（兼容旧调用）。
    getRoomMode(room: Room): string {
        return ExternalMineState.getRoomMode(room);
    },

    // 对外暴露：本源房当前托管的目标房列表（供跨房搬运重平衡复用同一份选择结果）。
    // 背包选择本身不便宜，按 tick 缓存，避免每个搬运工每 tick 重算一次。
    getManagedTargetRooms(room: Room, key: OutMineTargetListKey): string[] {
        return getRoomTickCacheValue(room, `outmine_managed_targets_${key}`, () =>
            ExternalMineState.getManagedTargets(room, key));
    },

    // 常规外矿：能量采集、运输、防守、预定与建造。
    // 采集/搬运不设容量门槛（小体型自带 CARRY 也能有效产出，
    // 废体型与队列淹没已由「不缩水 + 采集优先级 12>13 + 在场产出闸」根治）；
    // 建造侧的门槛由 EXTERNAL_ROAD_CONFIG 的 RCL 限制承担。
    // 不设能量状态硬门：外矿规模由孵化容量准入预算统一约束
    //（本地计划编成含距离因子先扣，外矿占剩余量）——状态门会连搬运工一起拦死，
    // 收入管道断流反而把 CRITICAL 固化成贫困循环（实测 2.9 万能量搁置外房、家里饿死）。
    runEnergy(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;
        // 控制器容器保活不受任何闸门限制：饥荒期恰恰是升级链最依赖容器的时刻
        //（每 tick 无条件放工地，不吃能量状态门）
        RoadBuilder.ensureControllerContainer(room);
        // 解锁闩：本矿产出首次就绪才开外矿管线（参考 TASK_TYPES 序 OWNED_SOURCE 恒先于
        // REMOTE_SOURCE）。未解锁期挂单由 pruneRushRemoteMissions 清理；
        // 解锁后不再设任何闸——本矿波动时外矿替补排队等待，在场爬继续采，链不断
        if (isRaceCompat() && !isRoomRemoteUnlocked(room)) return;

        let targetRooms = ExternalMine.getManagedTargetRooms(room, 'energy');

        // rush 自动扩图：目标不足时自动把一圈相邻房间加入列表（幂等），上限 4 个。
        // RCL8 满级不再自动扩图：满级房的升级需求已结束，自动加房只会白耗孵化预算；
        // 只许采集手动添加的外矿（列表为空 = 不采，不再自动引导）
        if (ExternalMine.getRoomMode(room) === 'rush' && room.level < 8 && targetRooms.length < 4
            && runState.canRunSecondaryAction && isRoomTickAligned(room.name, 100, 7)) {
            targetRooms = ExternalMineState.autoAddNearbyEnergyTargets(room.name, targetRooms);
        }

        if (targetRooms.length <= 0) return;

        // 目标房容量背包：按 value/weight 降序准入，
        // 预算装不下的房本轮挂起——把产能集火到最优房的容器/路/接力链上养熟，
        // 而不是摊薄到一串半成品管线（每房都缺搬运、缺容器、接力密度不足）。
        // 300t 滞回：预算逐 tick 波动会让准入名单横跳，基建（路/容器）需要连续投入
        if (targetRooms.length > 1) {
            const memAny = room.memory as any;
            const cached = memAny.remoteKept as { tick: number; rooms: string[] } | undefined;
            if (!cached || !cached.rooms?.length || Game.time - cached.tick > 300) {
                const scored = targetRooms.map((name) => ({ name, stat: ExternalMineState.estimateTargetSelectionStat(room, name) }))
                    .sort((a, b) => (b.stat.value / b.stat.weight) - (a.stat.value / a.stat.weight));
                let budget = ExternalMineSpawner.getRemoteSpawnLeftover(room);
                const kept: string[] = [];
                for (const entry of scored) {
                    if (kept.length === 0 || entry.stat.weight <= budget) {
                        kept.push(entry.name);
                        budget -= entry.stat.weight;
                    }
                }
                memAny.remoteKept = { tick: Game.time, rooms: kept };
            }
            const keptNames = (cached?.rooms ?? []).filter((n: string) => targetRooms.includes(n));
            if (keptNames.length > 0) targetRooms = keptNames;
        }

        // 不可达扇区清理：绑定到 novice/respawn/closed 房间的外矿 creep 永远到不了岗，
        // 会一直堆在扇区边界（表现为「完全不派出」）——直接回收，孵化侧也不再往这些房间派
        // (任务 8.7: 自杀回收经 broker work 管线提交, 无 ctx 走 sharedBroker 同步通道)
        const broker = sharedBrokerForDirectCommands();
        for (const creep of Object.values(Game.creeps)) {
            if (!creep?.my || !creep.memory?.targetRoom) continue;
            const unit = String(creep.memory.unit || '');
            if (!unit.startsWith('out-') && unit !== UNITS.reserver) continue;
            if (isRoomReachable(creep.memory.targetRoom)) continue;
            broker.executeNow({
                id: `mine-suicide:${creep.name}:${Game.time}`,
                tick: Game.time,
                actorName: creep.name,
                kind: "suicide",
                pipeline: "work",
                priority: EXTERNAL_COMMAND_PRIORITY.suicide,
                dedupeKey: `mine-suicide:${creep.name}`,
            });
        }

        // 补员派单顺序：先近后远 + 挂单少的先派（见 orderTargetsForSpawn）。
        // 配合每房挂单上限，单房无法占满 spawn，队列在多个外矿房之间轮转。
        // 注意：外矿侦查/离线补员也走这个顺序，保证近房先建立视野与工位记录。
        const orderedTargets = ExternalMineSpawner.orderTargetsForSpawn(room, targetRooms);

        // rush 渐进扩图（外矿建设并发受限、先近后远）：活跃外矿数随 RCL 增长
        // （RCL3→4 房、RCL4→5……上限 8）。
        // 一次全开 8 房时，道路工地 + 16 只编制的补员需求（全是 L9）会形成永久任务流，
        // 把主房采集/升级挤死（race 实测：人口崩到 20、控制器容器断粮）。
        // 未激活房间保留在注册表里，RCL 提升后自动扩容。
        const maxActiveTargets = ExternalMine.getRoomMode(room) === 'rush'
            ? Math.min(orderedTargets.length, Math.max(4, room.level + 1))
            : orderedTargets.length;
        const activeTargets = orderedTargets.slice(0, maxActiveTargets);

        // 队列 = 本轮需求：先作废上一轮的外矿经济挂单，再按上面的顺序重新铺。
        // 不做这一步，「先近后远」只会作用于队尾，队头永远是历史遗留顺序（线上即如此）。
        ExternalMineSpawner.clearPlannedEconomyMissions(room);

        for (const roomName of activeTargets) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }

                // 无视野也必须补采集工：否则采集工死光 → 视野丢失 → 永远不再补位，外矿整体停摆。
                // 用 scout 到访时记下的源数/工位数做离线口径（Memory.rooms 持久，重启不丢）；
                // 从未被记录过就退回「进程内最后已知源数，缺省 2」，宁可按估算补也不断档。
                const recordedSlots = readRecordedSourceSlotCounts(roomName);
                if (recordedSlots && recordedSlots.length > 0) {
                    const offlineSlotCap = recordedSlots.reduce((a, b) => a + b, 0);
                    ExternalMineSpawner.harvester(room, null, roomName, recordedSlots.length, undefined, offlineSlotCap);
                } else {
                    ExternalMineSpawner.harvester(room, null, roomName, lastKnownSourceNum.get(roomName) ?? 2);
                }
                continue;
            }

            // 有视野：顺手刷新工位记录（道路/容器落成会改变可站位数），保持离线口径新鲜
            if (!targetRoom.memory.sourcePosCount) recordSourceSlotCounts(targetRoom);

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum === 0) continue;
            lastKnownSourceNum.set(roomName, sourceNum);

            // CPU 桶闭环（Tier 1-3）：桶紧张时按性价比挂起低分外矿
            const activeThreshold = getActiveRemoteThreshold();
            if (activeThreshold > 0 && room.level >= 4) {
                const stat = ExternalMineState.estimateTargetSelectionStat(room, roomName);
                if (stat.score < activeThreshold) continue;
            }

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => (
                    (c.owner.username === 'Invader' ||
                    c.owner.username === 'Source Keeper' ||
                    c.getActiveBodyparts(ATTACK) > 0 ||
                    c.getActiveBodyparts(RANGED_ATTACK) > 0) &&
                    !c.isWhiteList()
                )
            });

            const hasPlayerThreat = hostiles.some(c => {
                if (c.owner.username === 'Invader') return false;
                if (c.owner.username === 'Source Keeper') return false;
                return true;
            });

            if (hasPlayerThreat) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, hostiles);
            } else {
                ExternalMineSpawner.defend(room, targetRoom, hostiles);
            }

            if (hostiles.length > 0) continue;

            const controller = targetRoom.controller;
            const myUserName = room.controller!.owner!.username!;
            if (controller?.owner && controller.owner.username !== myUserName) continue;

            // 预定是外矿经济主链，不应被 secondary-action 节流掉。
            if (room.level >= 3) {
                ExternalMineSpawner.reserver(room, targetRoom);
            }

            if (controller!.reservation! &&
                controller!.reservation.username!== myUserName) continue;

            ExternalMineSpawner.harvester(room, targetRoom, roomName, sourceNum);

            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, targetRoom, sourceNum, false, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum);

            ExternalMineSpawner.builder(room, targetRoom);
        }
    },

    // 中心房外矿：包含 SK/中心房的高强度采集与矿物采集逻辑。
    // 无能量状态硬门（同 runEnergy：外矿规模由孵化容量准入预算统一约束）。
    runCenter(room: Room, timing: ExternalMineTiming): void {
        const runState = ExternalMineState.getRunState(timing);
        if (!runState) return;

        const targetRooms = ExternalMine.getManagedTargetRooms(room, 'centerRoom');
        if (targetRooms.length <= 0) return;

        // 同 runEnergy：先近后远 + 挂单少的先派，避免单房独占总 spawn。
        const orderedTargets = ExternalMineSpawner.orderTargetsForSpawn(room, targetRooms);

        // 同 runEnergy：先作废上一轮外矿经济挂单，队列 = 本轮需求（先近后远）。
        ExternalMineSpawner.clearPlannedEconomyMissions(room);

        for (const roomName of orderedTargets) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) {
                if (runState.canRunSecondaryAction) {
                    ExternalMineSpawner.scout(room, roomName);
                }

                // 无视野：用 scout 记录的源数/工位数做离线 OH 孵化检查（upbody 固定高配）
                const recordedSlots = readRecordedSourceSlotCounts(roomName);
                if (recordedSlots && recordedSlots.length > 0) {
                    const offlineSlotCap = recordedSlots.reduce((a, b) => a + b, 0);
                    ExternalMineSpawner.harvester(room, null, roomName, recordedSlots.length, true, offlineSlotCap);
                }
                continue;
            }

            ExternalMineState.tryBuildRoad(room, targetRoom, EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL, runState.canRunSecondaryAction);

            const hostiles = targetRoom.find(FIND_HOSTILE_CREEPS, {
                filter: (creep) => !getWhitelistIds().includes(creep.owner.username)
            });
            const dangerousHostiles = hostiles.filter((creep) =>
                creep.owner.username !== 'Source Keeper' &&
                (creep.getActiveBodyparts(ATTACK) > 0 || creep.getActiveBodyparts(RANGED_ATTACK) > 0)
            );

            if (dangerousHostiles.length > 0) {
                ExternalMineSpawner.doubleDefend(room, targetRoom, dangerousHostiles);
                continue;
            }

            if (ExternalMineState.isKeeperCenterRoom(roomName)) {
                const hasKeeperCoverage = ExternalMineSpawner.hasKeeperAttackCoverage(targetRoom.name);
                ExternalMineSpawner.requestAttackUnit(room, targetRoom);
                if (!hasKeeperCoverage) continue;
            }

            const sourceNum = targetRoom.source?.length || targetRoom.find(FIND_SOURCES).length || 0;
            if (sourceNum <= 0) continue;

            // CPU 桶闭环（Tier 1-3）：桶紧张时按性价比挂起低分中心房外矿
            const activeThresholdCenter = getActiveRemoteThreshold();
            if (activeThresholdCenter > 0 && room.level >= 4) {
                const stat = ExternalMineState.estimateTargetSelectionStat(room, roomName);
                if (stat.score < activeThresholdCenter) continue;
            }
            ExternalMineSpawner.harvester(room, targetRoom, roomName, sourceNum, true);

            const mineral = (targetRoom as any) [FIND_MINERALS] || targetRoom.find(FIND_MINERALS)[0];
            if (mineral && mineral.mineralAmount > 0) {
                ExternalMineSpawner.mineral(room, targetRoom);
            }

            const carryCapacity = ExternalMineMath.getOutCarryCapacity(room);
            const carryNum = ExternalMineMath.calcEnergyOutCarryTarget(room, targetRoom, sourceNum, false, carryCapacity);
            ExternalMineSpawner.carry(room, targetRoom, carryNum);

            ExternalMineSpawner.builder(room, targetRoom);
        }
    },
};
