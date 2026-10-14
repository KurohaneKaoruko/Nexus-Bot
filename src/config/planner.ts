/**
 * 布局规划器参数 (docs/nexus-design/17):
 * 生成侧 —— 动态布局重计算受 CPU 桶门控 + 失败退避;
 * 消费侧 —— 工地低水位补足, 单次放量上限, rampart 起建等级。
 */
export const PLANNER_CONFIG = {
	/** 自动为无布局记录的己方房间生成动态布局 */
	autoLayoutEnabled: true,
	/** 动态布局计算允许的最低 CPU 桶 (计算较重, 桶空时跳过) */
	dynamicBucketFloor: 100,
	/** 布局生成失败后的重试间隔 tick */
	layoutRetryBackoffTicks: 500,
	/** 在建工地低水位: 低于该数量时补放量 (升级瞬间由 buildLevel 变化另行触发);
	 *  冲级房建造吞吐高、按优先级收敛, 水位太低会让 ext/路网梯队排队等清仓 */
	buildSitesLowWater: 12,
	/** 单次放量最多创建的工地数 */
	maxSitesPerPass: 10,
	/** rampart 起建 RCL (冲级姿态接入后可按房间模式推迟到 5) */
	rampartMinRcl: 4,
	/** 布局存在前, 允许按驻点规划放 Source 容器 (开局经济兜底) */
	bootstrapContainerEnabled: true,
} as const;
