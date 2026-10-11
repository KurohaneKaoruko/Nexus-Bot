/**
 * NexusCore 战略层 (docs/nexus-design/02 原则 B / docs/nexus-design/03 §3.1 H 子图 / docs/nexus-design/03 §3.2):
 * 低频周期 + 紧急标志触发重估姿态与政策; 决策只读预聚合摘要, 不扫描游戏对象;
 * 所有转移共用最小驻留迟滞 (阈值线分离 + 驻留双保险防抖动), 原因引用量化输入;
 * 重估受预算门控, 跳过时旧姿态/旧政策继续生效 (保底: 策略停摆不改变行为)。
 */
import { SOURCE_ENERGY_PER_TICK, STRATEGY_CONFIG, stockFloor } from "@/config/strategy";
import { THREAT_CONFIG } from "@/config/defense";
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import type { WorldView } from "@/core/world";
import type { BottleneckKind, NexusGlobalMemory, Posture, PostureTransition } from "@/store/memorySchema";
import { consumeUrgentReeval, nexusRuntime, recordTransitionLog } from "@/store/runtime";
import { directiveOf, postureOf, sourceCountOf } from "@/modules/strategy/directive";
import { maxThreatScore } from "@/modules/defense/threatModel";

/** 重估输入: 全部来自预聚合摘要 (docs/nexus-design/02 §2.4 第 3 层计算) */
export interface StrategyInputs {
	/** 能源总库存 (economy 每 Tick 累计的 lastStockTotal) */
	stock: number;
	/** 诊断窗口饥饿累计 (tick·房间) */
	starvationTicks: number;
	/** 最近瓶颈诊断结论 */
	bottleneck: BottleneckKind;
	/** 是否存在在建工地 */
	sitesOpen: boolean;
	/** 可见 Source 总数 (阈值换算基准) */
	sourceCount: number;
	/** 全局最高威胁分 (Phase 3 war 输入源, 纯 Memory 聚合) */
	maxThreatScore: number;
	tick: number;
}

export interface PostureDecision {
	posture: Posture;
	/** 引用量化输入的原因摘要 (可归因, 进转移记录) */
	reason: string;
}

/**
 * 姿态状态机 (纯函数): 返回 null 表示维持现状。
 * 转移表 (设计 D2): 全部转移须先过最小驻留迟滞;
 * war 输入源 = 威胁分 (docs/nexus-design/19 §19.4): 敌方首见置紧急重估, 超阈值进入, 阈值分离退出。
 */
export function evaluatePosture(
	current: Posture,
	sinceTick: number,
	inputs: StrategyInputs,
): PostureDecision | null {
	if (inputs.tick - sinceTick < STRATEGY_CONFIG.minDwellTicks) {
		return null;
	}
	const critical = stockFloor("critical", inputs.sourceCount);
	const healthy = stockFloor("healthy", inputs.sourceCount);
	const surplus = stockFloor("surplus", inputs.sourceCount);

	if (inputs.stock < critical) {
		return current === "survive"
			? null
			: { posture: "survive", reason: `stock ${inputs.stock} < critical ${critical}` };
	}
	if (inputs.starvationTicks > STRATEGY_CONFIG.starvationTrigger) {
		return current === "survive"
			? null
			: {
					posture: "survive",
					reason: `starvation ${inputs.starvationTicks} > ${STRATEGY_CONFIG.starvationTrigger}`,
				};
	}
	// war: 威胁超进入线 (库存/饥饿触发优先, 战争不能掩盖生存底线)
	if (inputs.maxThreatScore > THREAT_CONFIG.postureWarEnterScore) {
		return current === "war"
			? null
			: {
					posture: "war",
					reason: `threat ${Math.round(inputs.maxThreatScore)} > ${THREAT_CONFIG.postureWarEnterScore}`,
				};
	}
	if (current === "war") {
		// 退出线与进入线分离 (迟滞): 威胁衰减后回 develop, 压制自动解除
		return inputs.maxThreatScore < THREAT_CONFIG.postureWarExitScore
			? {
					posture: "develop",
					reason: `threat ${Math.round(inputs.maxThreatScore)} < ${THREAT_CONFIG.postureWarExitScore}`,
				}
			: null;
	}
	if (current === "survive") {
		return inputs.stock > healthy
			? { posture: "develop", reason: `stock ${inputs.stock} > healthy ${healthy}` }
			: null;
	}
	if (current === "develop") {
		return inputs.stock > surplus && inputs.bottleneck === "none" && !inputs.sitesOpen
			? {
					posture: "expand",
					reason: `stock ${inputs.stock} > surplus ${surplus}, no bottleneck/sites`,
				}
			: null;
	}
	if (current === "expand") {
		return inputs.stock < healthy
			? { posture: "develop", reason: `stock ${inputs.stock} < healthy ${healthy}` }
			: null;
	}
	return null;
}

/** 聚合重估输入: 只读 Memory 摘要 + 世界快照计数, 不触碰 Game 对象 */
export function aggregateStrategyInputs(ctx: TickContext, world: WorldView): StrategyInputs {
	let sourceCount = 0;
	let sitesOpen = false;
	for (const room of Object.values(world.rooms)) {
		sourceCount += room.sources.length;
		if (room.sites.length > 0) {
			sitesOpen = true;
		}
	}
	return {
		stock: ctx.memory.economy.lastStockTotal,
		starvationTicks: ctx.memory.economy.accumulators.starvationTicks,
		bottleneck: ctx.memory.economy.diagnosis.bottleneck,
		sitesOpen,
		sourceCount,
		maxThreatScore: maxThreatScore(ctx.memory),
		tick: ctx.tick,
	};
}

/** 应用转移: 写 Memory.global (决策状态) + runtime 环形日志 (观测) */
function applyPosture(ctx: TickContext, from: Posture, decision: PostureDecision): void {
	const global = ctx.memory.global;
	const policy = STRATEGY_CONFIG.posturePolicy[decision.posture];
	global.posture = decision.posture;
	global.policy = { reserveFloorFactor: policy.reserveFloorFactor, riskTolerance: policy.riskTolerance };
	global.goals = { targetStockFactor: policy.targetStockFactor };
	global.lastTransition = { from, to: decision.posture, at: ctx.tick, reason: decision.reason };
	global.transitionCount += 1;
	recordTransitionLog({ from, to: decision.posture, at: ctx.tick, reason: decision.reason });
	ctx.logger.info(`战略姿态 ${from} → ${decision.posture}: ${decision.reason}`);
}

export const strategyCoreModule: TickModule = {
	name: "nexus-core",
	phase: "strategy",
	band: "P2",
	run(ctx: TickContext): void {
		const urgent = consumeUrgentReeval(ctx.tick);
		const due = ctx.tick - ctx.memory.global.lastStrategicTick >= STRATEGY_CONFIG.reevaluatePeriod;
		if (!due && !urgent) {
			return;
		}
		// 重估是 P2 级分析: 预算紧张时跳过并计入降级统计, 旧姿态/政策继续生效
		if (!ctx.cpu.canRun("nexus-core-eval", "P2")) {
			ctx.cpu.recordSkip("nexus-core-eval", "budget");
			return;
		}
		const world = ctx.world.current;
		if (!world) {
			// 无快照 (感知缺失): 记周期不决策, 行为保持现状
			ctx.memory.global.lastStrategicTick = ctx.tick;
			return;
		}
		const inputs = aggregateStrategyInputs(ctx, world);
		nexusRuntime().strategy.lastInputs = {
			stock: inputs.stock,
			sourceCount: inputs.sourceCount,
			starvationTicks: inputs.starvationTicks,
			maxThreatScore: inputs.maxThreatScore,
		};
		const current = postureOf(ctx.memory.global);
		const since = ctx.memory.global.lastTransition?.at ?? 0;
		const decision = evaluatePosture(current, since, inputs);
		if (decision) {
			applyPosture(ctx, current, decision);
		}
		ctx.memory.global.lastStrategicTick = ctx.tick;
	},
};

/* ── 观测快照 (HUD/控制台, docs/nexus-design/02 原则 F) ── */

export interface StrategySnapshot {
	posture: Posture;
	/** 当前姿态驻留 tick 数 */
	dwellTicks: number;
	/** 储备下限绝对值 (按当前可见 Source 数) */
	reserveFloor: number;
	/** 目标库存绝对值 */
	targetStock: number;
	/** upgrade/build 节流是否生效 */
	suppressActive: boolean;
	/** 累计转移次数 (有界计数) */
	transitionCount: number;
	lastTransition?: PostureTransition;
}

/** 目标库存系数容错读取: 非法值回退配置默认 */
function targetFactorOf(global: NexusGlobalMemory, posture: Posture): number {
	const factor = global.goals?.targetStockFactor;
	return typeof factor === "number" && Number.isFinite(factor) && factor > 0
		? factor
		: STRATEGY_CONFIG.posturePolicy[posture].targetStockFactor;
}

/** 战略状态快照: 转移次数/驻留时长等指标经此有界查询 (Nexus.strategy()) */
export function strategySnapshot(ctx: TickContext): StrategySnapshot {
	const global = ctx.memory.global;
	const posture = postureOf(global);
	const sourceCount = sourceCountOf(ctx.world.current);
	const directive = directiveOf(global, sourceCount, ctx.memory.economy.lastStockTotal);
	return {
		posture,
		dwellTicks: ctx.tick - (global.lastTransition?.at ?? 0),
		reserveFloor: directive.reserveFloor,
		targetStock: targetFactorOf(global, posture) * sourceCount * SOURCE_ENERGY_PER_TICK,
		suppressActive: directive.suppressUpgradeBuild,
		transitionCount: typeof global.transitionCount === "number" ? global.transitionCount : 0,
		...(global.lastTransition !== undefined ? { lastTransition: global.lastTransition } : {}),
	};
}

/** HUD 单行文案 (boot 消费; 颜色按姿态分级) */
export function strategyHudLine(snapshot: StrategySnapshot): { text: string; color: string } {
	const icon: Record<Posture, string> = { survive: "🛟", develop: "⚙", expand: "🚩", war: "⚔" };
	const color: Record<Posture, string> = {
		survive: "#ff6b6b",
		develop: "#98d8c8",
		expand: "#7fdbca",
		war: "#ff6b6b",
	};
	const throttle = snapshot.suppressActive ? " 节流" : "";
	return {
		text: `${icon[snapshot.posture]} ${snapshot.posture} ⌂${snapshot.reserveFloor}${throttle} ⇄${snapshot.transitionCount}`,
		color: color[snapshot.posture],
	};
}
