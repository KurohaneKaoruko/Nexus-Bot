/**
 * 可观测性配置 (任务 9.4 五项不变量监控配套)。
 * 阈值集中在此, 模块内不落魔法数。
 */
export const INVARIANT_CONFIG = {
	/** 不变量检查频率 (tick): 每 N tick 跑一轮五项检查 */
	checkEveryTicks: 5,
	/** 同 key 告警限频 (tick): 每 N tick 至多一条 */
	warnEveryTicks: 100,
	/** Memory 有界预算 (字节): 序列化量超此值告警 (引擎硬限 2MB, 预算留缓冲) */
	memoryBudgetBytes: 1_500_000,
	/** Memory 体量采样频率 (tick): 全量序列化有 CPU 成本, 限频采样 */
	sampleEveryTicks: 100,
	/** tick CPU 告警线 (ms): 超此值计数告警 (不是硬顶, 硬顶由 cpuBudget 管) */
	cpuWarnMs: 80,
	/** 任务滞留容忍倍数: available/assigned 超过 maxLease×本值视为泄漏 (maxLease 从 LEASE_POLICY 单源推导) */
	staleToleranceFactor: 3,
} as const;
