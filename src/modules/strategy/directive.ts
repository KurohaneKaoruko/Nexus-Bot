/**
 * 战略指令 (docs/nexus-design/02 原则 B / docs/nexus-design/03 §3.3 第 5→6 步连结):
 * 把持久化战略状态纯派生为单 Tick 有效的指令视图 —— 姿态/储备下限/任务偏置/节流。
 * 消费边界: Cluster 与 SpawnDirector 读指令; Agent 层不读 (执行自治, 战略不逐单位微操)。
 * 战略模块被跳过/禁用/数据损坏时退化为中性指令 (develop 零偏置不节流), 不抛异常。
 */
import { SOURCE_ENERGY_PER_TICK, STRATEGY_CONFIG, stockFloor } from "@/config/strategy";
import type { DirectiveSource } from "@/core/tickContext";
import type { Posture } from "@/store/memorySchema";
import type { TaskKind } from "@/store/taskSchema";
import type { WorldView } from "@/core/world";
import { markUrgentReeval } from "@/store/runtime";

export interface StrategyDirective {
	readonly posture: Posture;
	/** 储备下限绝对值 (policy.reserveFloorFactor × sourceCount × 产能) */
	readonly reserveFloor: number;
	/** 任务种类优先级偏置 (叠加到基础优先级上) */
	readonly kindBias: Readonly<Partial<Record<TaskKind, number>>>;
	/** survive 且库存低于储备下限时暂停 upgrade/build 新任务生成 */
	readonly suppressUpgradeBuild: boolean;
}

const POSTURES: readonly Posture[] = ["survive", "develop", "expand", "war"];

/** 可见房间 Source 总数 (阈值换算基准; 无快照时 0 → 阈值全为 0 线, 指令保持中性) */
export function sourceCountOf(world: WorldView | null): number {
	if (!world) {
		return 0;
	}
	let count = 0;
	for (const room of Object.values(world.rooms)) {
		count += room.sources.length;
	}
	return count;
}

/** 姿态容错读取: 非法值回退 develop */
export function postureOf(globalRecord: unknown): Posture {
	const posture = (globalRecord as { posture?: unknown } | undefined)?.posture;
	return typeof posture === "string" && (POSTURES as readonly string[]).includes(posture)
		? (posture as Posture)
		: "develop";
}

/** 政策系数容错读取: 非法值回退该姿态的配置默认 */
function reserveFactorOf(globalRecord: unknown, posture: Posture): number {
	const factor = (globalRecord as { policy?: { reserveFloorFactor?: unknown } } | undefined)?.policy
		?.reserveFloorFactor;
	return typeof factor === "number" && Number.isFinite(factor) && factor > 0
		? factor
		: STRATEGY_CONFIG.posturePolicy[posture].reserveFloorFactor;
}

/**
 * 纯派生: 任意损坏输入 → 中性指令, 不抛异常。
 * stock 仅影响 suppress 判定 (survive 下的节流开关)。
 */
export function directiveOf(globalRecord: unknown, sourceCount: number, stock: number): StrategyDirective {
	const posture = postureOf(globalRecord);
	const reserveFloor = reserveFactorOf(globalRecord, posture) * sourceCount * SOURCE_ENERGY_PER_TICK;
	return {
		posture,
		reserveFloor,
		kindBias: STRATEGY_CONFIG.postureBias[posture],
		suppressUpgradeBuild: posture === "survive" && stock < reserveFloor,
	};
}

/**
 * boot 装配的派生入口 (TickContext.directive 惰性调用):
 * 派生 + 库存穿越检测 —— 非 survive 且库存已破临界线时置紧急重估标志,
 * 供下一 Tick 的战略阶段消费 (消费后清除; runtime 丢失则退回周期重估)。
 */
export function deriveStrategyDirective(source: DirectiveSource): StrategyDirective {
	const sourceCount = sourceCountOf(source.world);
	const stock = source.memory.economy.lastStockTotal;
	const directive = directiveOf(source.memory.global, sourceCount, stock);
	if (directive.posture !== "survive" && sourceCount > 0 && stock < stockFloor("critical", sourceCount)) {
		markUrgentReeval(source.tick);
	}
	return directive;
}
