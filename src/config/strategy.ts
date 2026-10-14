/**
 * 智械连结战略层参数 (docs/nexus-design/02 §2.4 分层计算 / docs/nexus-design/03 §3.2 全局层)。
 * 库存阈值以「Source 理论产能 × 系数」表达, 随房间规模自适应, 不用绝对值;
 * 偏置与政策为初值, 待 docs/nexus-design/02 原则 F 的指标闭环校准。
 */
import type { Posture } from "@/core/store/memorySchema";
import type { TaskKind } from "@/core/store/taskSchema";

/** Source 理论产能 (能量/tick), 阈值换算基准 */
export const SOURCE_ENERGY_PER_TICK = 10;

export interface PosturePolicy {
	/** 储备下限系数: × sourceCount × 产能 = 储备下限绝对值 */
	reserveFloorFactor: number;
	/** 风险容忍度 0..1 (Phase 3 威胁输入启用前为占位) */
	riskTolerance: number;
	/** 目标库存系数: × sourceCount × 产能 = 目标库存绝对值 */
	targetStockFactor: number;
}

export interface StrategyConfig {
	/** 战略重估周期 (tick); 紧急标志可提前触发 */
	reevaluatePeriod: number;
	/** 姿态最小驻留 (tick): 所有转移共用的迟滞, 防阈值附近抖动 */
	minDwellTicks: number;
	/** 转移环形日志上限 (global 运行时层, 控制台排障用) */
	transitionLogMax: number;
	/** 库存阈值系数 (× sourceCount × SOURCE_ENERGY_PER_TICK) */
	stockFloors: {
		/** 临界线: 跌破触发降级 survive */
		criticalFactor: number;
		/** 健康线: 恢复判定基准 */
		healthyFactor: number;
		/** 过剩线: 超过进入扩张准备 */
		surplusFactor: number;
	};
	/** 诊断窗口饥饿累计触发线 (tick·房间) */
	starvationTrigger: number;
	/** 姿态 → 全局政策 (转移时写入 Memory.global) */
	posturePolicy: Record<Posture, PosturePolicy>;
	/** 姿态 → 任务种类优先级偏置 (叠加到基础优先级上) */
	postureBias: Record<Posture, Partial<Record<TaskKind, number>>>;
	/** 节流期 upgrade/build 既有任务的降权幅度 */
	suppressPenalty: number;
	/** survive 姿态暂停新排的非关键岗位 (缺口与替补均停) */
	surviveSpawnPauseRoles: readonly string[];
}

export const STRATEGY_CONFIG: StrategyConfig = {
	reevaluatePeriod: 300,
	minDwellTicks: 600,
	transitionLogMax: 10,
	stockFloors: {
		criticalFactor: 2,
		healthyFactor: 5,
		surplusFactor: 12,
	},
	starvationTrigger: 100,
	posturePolicy: {
		survive: { reserveFloorFactor: 3, riskTolerance: 0.2, targetStockFactor: 3 },
		develop: { reserveFloorFactor: 2, riskTolerance: 0.5, targetStockFactor: 5 },
		expand: { reserveFloorFactor: 5, riskTolerance: 0.5, targetStockFactor: 12 },
		war: { reserveFloorFactor: 3, riskTolerance: 0.1, targetStockFactor: 3 },
	},
	postureBias: {
		survive: { fill_spawn: 20, harvest: 10, haul: 5, build: -20, upgrade: -25 },
		develop: {},
		expand: {},
		war: { fill_spawn: 10, defend: 10, repair: 5, build: -20, upgrade: -25 },
	},
	suppressPenalty: 40,
	surviveSpawnPauseRoles: ["upgrader", "worker"],
};

/** 库存阈值绝对值: 系数 × sourceCount × Source 理论产能 */
export function stockFloor(kind: "critical" | "healthy" | "surplus", sourceCount: number): number {
	const factors = {
		critical: STRATEGY_CONFIG.stockFloors.criticalFactor,
		healthy: STRATEGY_CONFIG.stockFloors.healthyFactor,
		surplus: STRATEGY_CONFIG.stockFloors.surplusFactor,
	};
	return factors[kind] * sourceCount * SOURCE_ENERGY_PER_TICK;
}
