/**
 * 多房 Intel 与外矿配置 (docs/nexus-design/13 §24.14)。
 *
 * INTEL_CONFIG 管「房间情报」的新鲜度与有界性; REMOTE_CONFIG 管外矿
 * 选点与闭环 (选点/评估/暂停恢复的量化阈值, 第 4-5 节消费)。
 * 默认值按 sim 校准, 校准结论回写注释。
 */

export const INTEL_CONFIG = {
	/** Intel 过期阈值 (tick): lastSeen 距今超过此值视为过期, 需重新侦查 */
	staleTicks: 5000,
	/** 置信度半衰期 (tick): confidence = 0.5 ^ (未见 tick / 此值), 与威胁模型同形 */
	confidenceHalfLife: 5000,
	/** 遗忘阈值 (tick): 非己方、非外矿房 lastSeen 距今超过此值即删除条目 */
	forgetTicks: 100000,
	/** Intel 条目总数上限: 超限淘汰最旧者 (己方房与外矿房不参与淘汰) */
	maxRooms: 100,
	/** 房类覆盖表 (房名 → kind): 房名推导按标准世界生成规则;
	 *  仅当地图布局与命名规则不符时在此覆盖, 标准生成世界用不到。优先于推导 */
	kindOverride: {} as Record<string, "normal" | "highway" | "keeper" | "center">,
} as const;

export const REMOTE_CONFIG = {
	/** 候选房路线长度上限 (格): 超过不入选 */
	maxRouteLength: 3,
	/** 外矿 spawn 占用份额上限 (0..1): 候选按 net/s 降序准入至此份额 */
	spawnShareCap: 0.5,
	/** 状态机最小驻留 (tick): 转移后至少停留此时长才允许再转移 (威胁暂停不受此限) */
	minDwellTicks: 500,
	/** 规划间隔 (tick): remote-planner 主循环周期 */
	planInterval: 50,
	/** 每次评估的 PathFinder 上限 (次): 评估 P3 每轮最多算几条路程 */
	evalPerRun: 2,
	/** scout 任务期限 (tick): 到期未认领即取消 */
	scoutDeadline: 3000,
	/** 外矿容器维修阈值 (0..1): hits 低于此比例出 repair 任务 */
	containerRepairBelow: 0.5,
	/** 预定刷新阈值 (tick): ticksToEnd 低于此值补预定 */
	reserveRefreshBelow: 1000,
	/** 暂停威胁门槛 (0..1): 房间威胁置信度超过此值暂停外矿 */
	pauseThreat: 0.5,
	/** 恢复威胁门槛 (0..1): 暂停后威胁置信度降至此值以下恢复 */
	resumeThreat: 0.2,
	/** 死亡暂停计数 (个): 窗口内外矿单位死亡达此数即暂停 */
	pauseDeaths: 2,
	/** 死亡计数窗口 (tick) */
	deathWindow: 1000,
	/** 暂停时长 (tick): 期满自动回评估态 */
	pauseTicks: 2000,
	/** 拒绝重试间隔 (tick): 净收益不足被拒后此时长内不再评估 */
	rejectedRetryTicks: 5000,
	/** 实测净收入折叠间隔 (tick): 账本采样折叠为 netEma 的周期 */
	foldInterval: 100,
	/** 净收入评估窗口 (tick): 窗口内净收入为负即触发亏损剔除 */
	lossWindow: 10000,
	/** 外矿装卸余量 (格): 装载/卸载驻留折算的等效路途长度, 与 2d 同量纲
	 *  (搬运容量 C = r_eff × (2d + 此值) / CARRY_CAPACITY, docs/24 §24.7.2) */
	loadMargin: 2,
} as const;
