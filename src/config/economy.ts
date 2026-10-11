/**
 * Phase 2 经济/物流参数集中配置 (docs/nexus-design/06/07/08)。
 * 全部可调参数只在此处定义, 模块禁止散落魔法数;
 * 数值为 RCL1–3 单房间基线, 后续按实测指标校准。
 */

/** 运输与搬运 (docs/nexus-design/06 §6.4) */
export const HAUL_CONFIG = {
	/** 落地能量低于该值不专门派搬运 (不值得) */
	minHaulAmount: 30,
	/** 容器/Storage 库存低于该值不派搬运 */
	minStoreAmount: 100,
	/** 单批搬运量估算 (按典型 carrier 段容量, 上限为实际身体容量) */
	batchSize: 200,
	/** 关键供能结构最低库存线 (占容量比例): 低于该线进入配额搬运流 */
	structureFloorRatio: 0.6,
	/** Storage 兜底水位: 低于该线时富余能量转入 Storage */
	storageFloorAmount: 2000,
} as const;

/** 资源账本 (docs/nexus-design/06 §6.1/§6.6) */
export const LEDGER_CONFIG = {
	/** 速率窗口长度 (tick): 累加器每窗口折叠一次 EMA */
	rateWindowTicks: 100,
	/** EMA 折叠系数: 新窗口均值权重 (0..1), 越小越平滑 */
	rateSmoothing: 0.3,
	/** 预留默认有效期 (tick), 超期由对账清理 */
	reservationTtl: 150,
} as const;

/** 固定采集工作位与 Source 容器 (docs/nexus-design/06 §6.3 / docs/nexus-design/17 / bugs/P0-3) */
export const WORKSITE_CONFIG = {
	/** Source 容器建造的最低 RCL (先保证 Spawn/Extension 扩展) */
	containerMinRcl: 2,
	/** 容器站点创建失败后的重试间隔 (tick) */
	siteRetryInterval: 300,
	/** 驻点选址的容器亲和加成: 已有容器 (结构/工地) 的相邻格优先 (替补无缝继承) */
	containerAffinityBonus: 50,
} as const;

/** 基础设施建造 (bugs/P0-1 / docs/nexus-design/17): extension 扩容 + 主干道 */
export const CONSTRUCTION_CONFIG = {
	/** 各 RCL 允许的 extension 数上限 (引擎 CONTROLLER_STRUCTURES 镜像, 供离线可测) */
	extensionMaxByRcl: [0, 0, 5, 10, 20, 30, 40, 50, 60] as readonly number[],
	/** extension 选点: spawn 周围该切比雪夫距离环带内 */
	extensionRingMin: 2,
	extensionRingMax: 4,
	/** 距 controller 该范围内的格子留给升级位, 不放 extension */
	controllerClearRange: 2,
	/** 每 tick 最多创建的 extension 站点数 (逐步落位, 不一次性铺满) */
	extensionSitesPerTick: 2,
	/** 主干道重规划间隔 (tick): 路已铺满时 findPath 走路网零新增, 低频重查即可 */
	roadReplanInterval: 150,
} as const;

/** 拥堵检测与分级响应 (docs/nexus-design/08 §8.4/§8.6) */
export const TRAFFIC_CONFIG = {
	/** 连续阻塞达到该 tick 数开始升级 (让路) */
	escalateTicks: 4,
	/** 连续阻塞达到该 tick 数重置路径缓存 */
	repathTicks: 8,
	/** 连续阻塞达到该 tick 数释放任务重分配 */
	releaseTicks: 15,
	/** 热点频率衰减系数 (每诊断窗口) */
	hotspotDecay: 0.7,
	/** 热点条目上限 (超出按最久未更新淘汰) */
	hotspotMaxEntries: 64,
	/** 阻塞记录保留时长: 超过该 tick 未更新的条目清除 */
	blockedRetentionTicks: 500,
} as const;

/** 替补窗口 (docs/nexus-design/07 §5/§7.5) */
export const REPLACEMENT_CONFIG = {
	/** 安全余量 (tick), 叠加在生产时间与实测路程之上 */
	setupMargin: 60,
	/** 实测路程样本不足时的回退估算 (tick) */
	travelFallback: 120,
	/** 路程样本窗口上限 (每 role:room 保留的样本数) */
	travelSampleWindow: 8,
	/** 允许短暂在编重叠的关键岗位 */
	keyRoles: ["harvester"] as readonly string[],
	/** 替补提前量抖动幅度 (±比例): 同批单位错峰换代, 避免同拍抖动 (bugs/P2-8) */
	jitterRatio: 0.1,
} as const;

/** 生产缺口 (docs/nexus-design/07 §7.5 / bugs/P1-5) */
export const SPAWN_CONFIG = {
	/** 常驻编制岗位: 缺口判定与任务 available 状态解耦 (任务被租住/冷却期仍请求替补) */
	standingRoles: ["harvester", "upgrader"] as readonly string[],
	/** 常驻编制缺口的请求优先级 (低于任务驱动, 只兜底) */
	standingPriority: 55,
} as const;

/** 低频经济模型 (docs/nexus-design/06 §6.7/§6.8) */
export const ECONOMY_MODEL_CONFIG = {
	/** 诊断周期 (tick); 每 Tick 仅做 O(小) 累加 */
	diagnosisPeriod: 150,
	/** 运输瓶颈判定: 交付速率低于生产的该比例视为运力不足 */
	transportDeficitRatio: 0.6,
	/** 缺货判定: 关键结构空仓累计 tick 超过该值视为目的地错配 */
	starvationTicksThreshold: 100,
	/** 运力目标乘数上下限 */
	carrierMultiplierMax: 3,
	carrierMultiplierStep: 1.25,
	/** 产能过剩判定: 搬运目的地全部满足且库存高于该值 */
	surplusStockAmount: 3000,
} as const;
