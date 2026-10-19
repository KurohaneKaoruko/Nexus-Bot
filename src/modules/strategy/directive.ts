/**
 * 战略指令 (docs/nexus-design/02 原则 B / docs/nexus-design/03 §3.3 第 5→6 步连结):
 * 把持久化战略状态纯派生为单 Tick 有效的指令视图 —— 姿态/储备下限/任务偏置/节流。
 * 消费边界: Cluster 与 SpawnDirector 读指令; Agent 层不读 (执行自治, 战略不逐单位微操)。
 * 战略模块被跳过/禁用/数据损坏时退化为中性指令 (develop 零偏置不节流), 不抛异常。
 */
import { SOURCE_ENERGY_PER_TICK, STRATEGY_CONFIG, stockFloor } from "@/config/strategy";
import type { TickContext } from "@/core";
import type { Posture } from "@/core/store/memorySchema";
import type { TaskKind } from "@/core/store/taskSchema";
import type { WorldView } from "@/core/world";
import { markUrgentReeval } from "@/core/store/runtime";

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
 * 无 storage 的涓流期豁免: 低 RCL 库存天然贴地 (孵化即时消费), 瞬时存量击穿
 * reserveFloor 是常态而非危机; 压 upgrade 任务只会让开局升级链停摆
 * (sim 实证 upgrade 任务被压 5300t, L2 拖到 5900+, race 参照 676)。
 */
export function directiveOf(
	globalRecord: unknown,
	sourceCount: number,
	stock: number,
	storagePresent = false,
): StrategyDirective {
	const posture = postureOf(globalRecord);
	const reserveFloor =
		reserveFactorOf(globalRecord, posture) * sourceCount * SOURCE_ENERGY_PER_TICK;
	return {
		posture,
		reserveFloor,
		kindBias: STRATEGY_CONFIG.postureBias[posture],
		suppressUpgradeBuild: storagePresent && posture === "survive" && stock < reserveFloor,
	};
}

/**
 * 单 Tick 指令读取入口 (消费边界: Cluster/Spawn/Economy/Defense):
 * 首 Tick 的 emergency 消费者先于战略阶段执行 → 惰性派生 + Tick 级缓存 (同 Tick 同引用);
 * 缓存为模块级可重建数据, global 重置后自动重算, 不落 Memory。
 * 派生 + 库存穿越检测 —— 非 survive 且库存已破临界线时置紧急重估标志,
 * 供下一 Tick 的战略阶段消费 (消费后清除; runtime 丢失则退回周期重估)。
 */
let directiveCache: { tick: number; value: StrategyDirective } | undefined;

export function directiveFor(ctx: TickContext): StrategyDirective {
	if (directiveCache && directiveCache.tick === ctx.tick) {
		return directiveCache.value;
	}
	const world = ctx.world.current;
	const sourceCount = sourceCountOf(world);
	const stock = ctx.memory.economy.lastStockTotal;
	// storage 在场判定: 涓流期 (无 storage) suppress 豁免的输入
	const storagePresent = Object.values(world?.rooms ?? {}).some(
		(room) => room.stores.some((store) => store.structureType === "storage"),
	);
	const directive = directiveOf(ctx.memory.global, sourceCount, stock, storagePresent);
	if (
		directive.posture !== "survive" &&
		sourceCount > 0 &&
		stock < stockFloor("critical", sourceCount)
	) {
		markUrgentReeval(ctx.tick);
	}
	directiveCache = { tick: ctx.tick, value: directive };
	return directive;
}
