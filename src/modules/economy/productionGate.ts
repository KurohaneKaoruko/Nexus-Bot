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
import { UNIT_CODES } from "@/constant/UnitConstant";
import { buildRushHarvesterBody, rushBodyWork } from "@/utils/rushBodies";

/**
 * 单只采集体在给定孵化预算下的 WORK 数 (与 bodyFactory 同生成器, 口径永不漂移):
 * RCL1 (300) → [W2,M1] = 2W; RCL2 (550) → [W5,M1] = 5W 满速体。
 */
function workPerHarvesterOf(capacity: number): number {
	return rushBodyWork(buildRushHarvesterBody(capacity) ?? []);
}

/**
 * 在岗采集体平均 WORK (实际孵化结果): 涓流期攒能超时降档会让实际体型低于容量档
 * 理论值——定编若仍按理论 5W 折 1 只/源, 采集面永远铺不满源速。取实际口径反馈
 * 修正定编, 体型回升后定编自动回落单座 (设计「低容量多只、升档回落」的本意)。
 */
export function avgHarvesterWorkOf(room: {
	creeps?: readonly unknown[];
}): number | undefined {
	const works = (room.creeps ?? [])
		.filter(
			(creep): creep is { unitCode: string; bodyWork: number } =>
				typeof creep === "object" &&
				creep !== null &&
				"unitCode" in creep &&
				"bodyWork" in creep &&
				(creep as { unitCode: string }).unitCode === UNIT_CODES.harvester,
		)
		.map((creep) => creep.bodyWork)
		.filter((work) => work > 0);
	if (works.length === 0) {
		return undefined;
	}
	return works.reduce((sum, work) => sum + work, 0) / works.length;
}

/**
 * 每源采集只数: 单只 WORK 达满速 (10e/t = 源再生速率) 时单座; 否则按容错 WORK
 * 折多只——把 3000e/300t 采完最少 5W, 容错取 +1W, 即 ceil(容错W / 单只W)。
 * 单只 WORK 取实际在岗均值 (无在岗时退容量档理论值), 上限 maxPerSource 防退化
 * 小体无界扩编。
 */
export function harvestStaffingPerSource(
	capacity: number | undefined,
	fleetWork?: number,
): number {
	if (capacity === undefined) return 1;
	const workPerCreep = Math.max(1, fleetWork ?? workPerHarvesterOf(capacity));
	if (workPerCreep >= WORKFORCE_CONFIG.harvest.fullSpeedWork) return 1;
	const staffing = Math.max(1, Math.ceil(WORKFORCE_CONFIG.harvest.toleranceWork / workPerCreep));
	return Math.min(staffing, WORKFORCE_CONFIG.harvest.maxPerSource);
}

/**
 * 采集编制目标 (只数口径) (specs harvest-supply-convergence
 * 「采集定编单一事实来源」的唯一公式)。
 *
 * 形态泛化到「只带源列表」的结构, 使 perception 侧快照与 legacy 侧 Room 共用同一公式;
 * 低容量期每源多只小体, 容量升档后自动回落单座驻点 (饱和缺口由攒能定档升体型承接)。
 */
/**
 * 采集编制目标 (只数口径) (specs harvest-supply-convergence
 * 「采集定编单一事实来源」的唯一公式)。
 *
 * 形态泛化到「只带源列表」的结构, 使 perception 侧快照与 legacy 侧 Room 共用同一公式;
 * 低容量期每源多只小体, 容量升档后自动回落单座驻点 (饱和缺口由攒能定档升体型承接)。
 * RoomObservation 入参时用实际在岗体型反馈修正 (涓流降档期铺多只, 体型回升自动回落)。
 */
export function harvestStaffingOf(room: {
	sources: readonly unknown[];
	energyCapacity?: number;
	creeps?: readonly unknown[];
}): number {
	const fleetWork = room.creeps ? avgHarvesterWorkOf(room) : undefined;
	const perSource = harvestStaffingPerSource(room.energyCapacity, fleetWork);
	return room.sources.length * perSource;
}
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
	// 多只期口径: 逐源看绑定 WORK 是否铺满该源折算定编 (perSource 只数 × 单只
	// 实际 WORK 的容量), 而非「有绑定的源数 vs 总定编」——后者在定编 > 源数时
	// 恒 false, 会锁死搬运开局闸与外矿闸
	const perSource = harvestStaffingPerSource(room.energyCapacity, avgHarvesterWorkOf(room));
	const bound = harvesterBindingOf(ctx, room);
	const workQuotaPerSource = perSource * Math.max(1, avgHarvesterWorkOf(room) ?? 0);
	for (const source of room.sources) {
		if ((bound.get(source.id) ?? 0) < Math.min(workQuotaPerSource, WORKFORCE_CONFIG.harvest.fullSpeedWork)) {
			return false;
		}
	}
	return true;
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
