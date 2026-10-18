/**
 * 产出就绪闸 (specs/production-readiness-gate):
 * 采集面 (在岗非孵化采集体) 铺满源定编才算「产出就绪」——每 Tick 现算、无锁存,
 * 采集体死亡同拍回落。孵化侧两个消费闸 (spawnDirector):
 * ① 起步序列闸: 未就绪时只放行采集面角色 (harvester/upgrader/universal);
 * ② 搬运开局闸: 未就绪时在岗搬运体 ≥ max(1, 在岗采集体数) 即不再扩编——
 *    杜绝「3 搬运 : 1 矿工」倒挂吃光孵化槽与能量的起步死锁。
 * 与参照实现的口径差异 (主线 worksite 单座语义): 参照实现低等级开多采集位窗口
 * (源旁可站位 × WORK 折算), 主线每源一个固定驻点, 饱和缺口由攒能升体型承接;
 * 外矿解锁闩 (remoteUnlocked) 留待外矿能力, 本模块不实现。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import { harvesterBindingOf } from "@/modules/economy/workforce";
import { WORKFORCE_CONFIG } from "@/config/economy";
import { buildRushHarvesterBody, rushBodyWork } from "@/utils/rushBodies";

/**
 * 单只采集体在给定孵化预算下的 WORK 数 (与 bodyFactory 同生成器, 口径永不漂移):
 * RCL1 (300) → [W2,M1] = 2W; RCL2 (550) → [W5,M1] = 5W 满速体。
 */
function workPerHarvesterOf(capacity: number): number {
	return rushBodyWork(buildRushHarvesterBody(capacity) ?? []);
}

/**
 * 每源采集只数: 容量够单只 5W 满速 (10e/t = 源再生速率) 时单座;
 * 低容量窗口 (RCL1 的 2W) 按容错 WORK 折多只——把 3000e/300t 采完
 * 最少 5W, 容错取 +1W, 即 ceil(容错W / 单只W)。
 */
export function harvestStaffingPerSource(capacity: number | undefined): number {
	if (capacity === undefined) return 1;
	const workPerCreep = workPerHarvesterOf(capacity);
	if (workPerCreep <= 0) return 1;
	if (workPerCreep >= WORKFORCE_CONFIG.harvest.fullSpeedWork) return 1;
	return Math.max(1, Math.ceil(WORKFORCE_CONFIG.harvest.toleranceWork / workPerCreep));
}

/**
 * 采集编制目标 (只数口径) (specs harvest-supply-convergence
 * 「采集定编单一事实来源」的唯一公式)。
 *
 * 形态泛化到「只带源列表」的结构, 使 perception 侧快照与 legacy 侧 Room 共用同一公式;
 * 低容量期每源多只小体, 容量升档后自动回落单座驻点 (饱和缺口由攒能定档升体型承接)。
 */
export function harvestStaffingOf(room: {
	sources: readonly unknown[];
	energyCapacity?: number;
}): number {
	const perSource = harvestStaffingPerSource(room.energyCapacity);
	return room.sources.length * perSource;
}

/** 源采集定编合计 (只数口径): 低容量期每源 ceil(容错W/单只W) 只 */
export function harvesterTargetTotal(room: RoomObservation): number {
	return harvestStaffingOf(room);
}

/** 在岗采集面: 绑定了活跃采集 WORK 的源数 (租约或驻点在位) */
export function onDutySources(ctx: TickContext, room: RoomObservation): number {
	const bound = harvesterBindingOf(ctx, room);
	let seated = 0;
	for (const source of room.sources) {
		if ((bound.get(source.id) ?? 0) > 0) {
			seated += 1;
		}
	}
	return seated;
}

/**
 * 产出就绪判定: 每源都有活跃采集体在岗 (绑定 WORK > 0)。
 * 无源房 (强袭房等) 恒就绪; 采集体死亡/换代窗口自动回落未就绪。
 */
export function isProductionSecured(ctx: TickContext, room: RoomObservation): boolean {
	if (room.sources.length === 0) {
		return true;
	}
	return onDutySources(ctx, room) >= harvesterTargetTotal(room);
}

/**
 * 搬运开局闸 (specs/production-readiness-gate): 未就绪时搬运编制不得超过采集面规模。
 * @param carrierCount 在岗 (含孵化中) 搬运体数
 * @param harvesterCount 在岗 (含孵化中) 采集体数
 */
export function carrierGatePassed(
	secured: boolean,
	carrierCount: number,
	harvesterCount: number,
): boolean {
	if (secured) {
		return true;
	}
	return carrierCount < Math.max(1, harvesterCount);
}
