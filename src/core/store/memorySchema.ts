/**
 * Memory.Nexus schema v13 (账本五态分账: 预留 createdAt/饥饿生命体征/
 * 消耗速率与累计/超龄回收计数, specs/resource-ledger)。
 * 规则: 只持久化 JSON 兼容数据 (ID + 元数据), 不保存游戏 API 对象引用;
 *       所有持久化结构携带 schemaVersion, 由 migrations 逐版本升级;
 *       新增子系统全部有界: 预留过期清理 / 热点条目上限 / 样本窗口固定。
 */
import { STRATEGY_CONFIG } from "@/config/strategy";
import type { RoomModeName } from "@/config/roomMode";
import type { NexusTask, TaskKind } from "./taskSchema";

export const CURRENT_SCHEMA_VERSION = 14;

export type Posture = "survive" | "develop" | "expand" | "war";

/** 采集工作位与 Source 容器规划 (docs/nexus-design/17 §17.4 / bugs/P0-3): 仅坐标, 环境变化时重算 */
export interface WorksiteRecord {
	/** 采集驻点 (Source 相邻可行走格) */
	x: number;
	y: number;
	/** Source 容器期望位 (= 驻点同格, bugs/P0-3 定案: 矿工站容器上采矿); 无规划时缺省 */
	containerSpot?: { x: number; y: number };
	/** 容器站点创建失败后的冷却截止 tick */
	siteRetryAt?: number;
	/** 工地创建意图已提交的 tick (命令边界异步化: 未成站超时后回退冷却) */
	sitePending?: number;
}

/** 威胁类别 (docs/nexus-design/09 §9.2: NPC 与玩家敌人不可合并) */
export type ThreatCategory = "npc" | "player";

/** 房间威胁摘要 (docs/nexus-design/19 §19.4): 单条有界记录, 失视按 lastSeen 衰减, 过期清除 */
export interface RoomThreatRecord {
	/** 当前威胁分 (可见时由快照评分, 失视按 tick 衰减) */
	score: number;
	/** 本威胁窗口内的峰值 (观测用) */
	peakScore: number;
	/** 主导类别 (存在玩家敌人即为 player) */
	category: ThreatCategory;
	firstSeenAt: number;
	lastSeenAt: number;
	/** 0..1, 随未观测时间衰减; 不代表当前可见 */
	confidence: number;
	hostileCount: number;
	/** 引用量化输入的原因摘要 (可归因) */
	reason: string;
}

/**
 * 源饱和口径实测分解 (specs/harvest-supply-convergence「源饱和口径实测分解」):
 * 采集体在该源上的时间去向 EMA 比例 (specs/workforce 采集收入按在岗 WORK 单一事实的
 *  证据侧记录)。三项占比之和为 1; 定长定数, 不随 tick 增长。
 */
export interface HarvestSplitRecord {
	/** 在源采集 (含正常产出) 占比 */
	atSource: number;
	/** 往返 (前往源/回交付) 占比 */
	transit: number;
	/** 在位等待 (源枯竭或工位未就绪) 占比 */
	waiting: number;
}

export interface RoomIntelRecord {
	/** 最近一次观测 tick */
	lastSeen: number;
	/** 0..1, 随未观测时间衰减; 不代表房间当前可见 */
	confidence: number;
	sourceIds: string[];
	/** sourceId → 固定工作位 (首见计算, 每 Tick 按快照校验) */
	worksites?: Record<string, WorksiteRecord>;
	/** 威胁摘要 (无威胁时缺省) */
	threat?: RoomThreatRecord;
	/** 失守 tick (上一 Tick 己方、本 Tick 可见且非己方; bugs/P1-10): 复得即清除 */
	lostAt?: number;
	/** 房间运行模式 (specs/room-mode-profiles): 显式设置值, 缺省由 resolver 按默认规则解析 */
	mode?: RoomModeName;
	/** 源单程路程实测 (specs/workforce-staffing): sourceId → pathTime, 首次到岗采样并钳制 */
	sourceTiming?: Record<string, number>;
	/** 源饱和口径实测分解 (specs/harvest-supply-convergence): sourceId → 采集工时间去向
	 *  EMA 比例 (在源/往返/等待)。定长记录 (每源三项), 不随 tick 增长。 */
	harvestSplit?: Record<string, HarvestSplitRecord>;
	/** 升级饥饿记账 (specs/workforce-staffing): 取能落空且缓冲全空时累积, 按流逝 tick 惰性衰减 */
	upgradersStarved?: { amount: number; tick: number };
	/**
	 * RCL 达成时间线 (speedrun 取证, bugs (十六)): level → 首次观测到该等级的 tick。
	 * 4wt 重置后 Memory 保留——跨周期留证 + 榜单口径 (score = 累计门槛 + progress)
	 * 的取证入口。定长 (≤8 项), 随等级增长。
	 */
	rclTimeline?: Record<number, number>;
	/** rush 供需 EMA (specs/workforce-staffing): 升级火力乘数浮动状态 [-1,1] */
	spawnBalanceEma?: number;
	/** 冲级分段判废快照 (specs 冲级判废): 仅最新一条, 覆盖写入 */
	raceVerdict?: {
		failed?: boolean;
		failedSegment?: number;
		failSnapshot?: Record<string, unknown>;
	};
}

/** 单位记录 (docs/nexus-design/07 §7.6): 名称可溯源, 不承载全局信息 */
export interface UnitRecord {
	name: string;
	unitCode: string;
	homeRoom: string;
	bornAt: number;
	lastTaskChange: number;
	taskId?: string;
	/** 首次到岗 tick (bornAt→firstArrivedAt 为实测路程样本) */
	firstArrivedAt?: number;
}

/** 资源预留承诺 (docs/nexus-design/06 §6.6): 对未来计划的会计记录, 非库存本体 */
export interface ReservationRecord {
	id: string;
	/** 所有者 (通常为任务 ID), 主体消失时随对账释放 */
	owner: string;
	roomName: string;
	resourceType: string;
	amount: number;
	/** 目的地结构 ID (配额在途承诺用), 无目的地时缺省 */
	destId?: string;
	/** 创建 tick (超龄回收判据); 历史记录缺省时不做超龄判定 */
	createdAt?: number;
	expiresAt: number;
}

/** 按房饥饿生命体征 (specs/resource-ledger「饥饿与瓶颈可观测」):
 *  每房至多一条当前最严重饥饿, 房间脱离饥饿或失联即清除——有界 */
export interface RoomHungerVitals {
	/** 饥饿链路: 孵化线 (spawn 空仓) / 升级线 (cc 低于保障水位) */
	kind: "spawn" | "cc";
	/** 本次连续饥饿起始 tick (持续时长 = now - sinceTick) */
	sinceTick: number;
	/** 缺口量级 (保障线 - 现存量) */
	deficit: number;
	/** 最近一次确认为饥饿的 tick (失联房清理判据) */
	lastTick: number;
}

/** 滚动速率: 每 Tick O(1) 累加, 每窗口折叠 EMA, 恒定 O(房间×资源种) */
export interface RateState {
	/** 当前窗口内累加量 */
	accumulated: number;
	/** 窗口折叠后的平滑均值 (单位量/窗口) */
	ema: number;
	lastFoldTick: number;
}

export interface RoomRates {
	/** 采集产出速率 */
	produced: RateState;
	/** 物流交付速率 */
	delivered: RateState;
	/** 供给消耗速率 (预留 commit 的实际用量) */
	consumed: RateState;
}

export interface LedgerMemory {
	reservations: Record<string, ReservationRecord>;
	/** roomName → 速率 */
	rates: Record<string, RoomRates>;
	/** roomName → 饥饿生命体征 (每房至多一条当前最严重项, 有界) */
	hunger: Record<string, RoomHungerVitals>;
	/** roomName → 累计已消耗 (五态 Consumed 态, 单调标量有界) */
	consumedTotal: Record<string, number>;
	/** 累计过期清理数 (排障用) */
	expiredCount: number;
	/** 累计超龄强制回收数 (预留泄漏防护, specs/resource-ledger) */
	overdueCount: number;
}

/** 拥堵统计 (docs/nexus-design/08 §8.4): 阻塞计数按保留时长清理, 热点条目有上限 */
export interface TrafficMemory {
	/** creep 名 → 连续阻塞计数 */
	blocked: Record<string, { count: number; lastTick: number }>;
	/** "room:x:y" → 堵塞频率 (每诊断窗口衰减) */
	hotspots: Record<string, { freq: number; lastTick: number }>;
}

/** 孵化簿记 (bugs/P1-10): bootstrap 空转计数, 恒定两个标量有界 */
export interface SpawnMemory {
	/** 失明态 (无己方可见房) 连续 bootstrap 次数, 任一己方房可见即清零 */
	bootstrapCount: number;
	/** 最近一次 bootstrap 请求 tick */
	lastBootstrapTick: number;
	/** spawn 空闲起算 tick (攒能等待超时兜底, specs/workforce-staffing 顺手修):
	 *  跨 Tick 持久化——每 Tick 重建会让 capacityWaitTicks 超时永不触发 */
	idleSince?: Record<string, number>;
	/** 孵化链路遥测 (任务 6.4): 队列深度/等待时长 EMA/请求方拒绝计数。
	 *  键集有界——roles 恒为 SpawnUnit 词表, denyReasons 恒为闸门名枚举 */
	telemetry?: SpawnTelemetry;
}

/** 孵化链路遥测 (任务 6.4, api/13 §13.4 可审计): 只记计数与 EMA, 不记事件流 */
export interface SpawnTelemetry {
	/** 最近聚合 tick (诊断窗口节流写) */
	tick: number;
	/** 聚合窗口内的请求池峰值深度 */
	queueDepthPeak: number;
	/** 请求在池内等待时长 EMA (tick): 创建→被选中/被顶替 */
	waitEma: Record<string, number>;
	/** 请求方被拒计数 (按闸门原因): gate=产出就绪闸, yield=采集让位, pause=survive 暂停 */
	denyReasons: Record<string, number>;
}

/**
 * Actor 所有权跨 Tick 持久索引 (api/16 actor-ownership / 任务 2.2):
 * 只存 owner 名与租约到期 tick (活跃租约的权威态在 global 运行时层);
 * global 重置后由此索引恢复所有权事实, 避免重置窗口期冲突面失察。
 */
export interface OwnershipIndexEntry {
	owner: string;
	/** 租约到期 tick (超过即被 sweep 回收) */
	expiresAt: number;
}

export interface OwnershipMemory {
	/** 本索引 schema 版本 (与 Memory.Nexus.schemaVersion 独立演进) */
	indexVersion: 1;
	/** actor 名 → 持久所有权索引 */
	actors: Record<string, OwnershipIndexEntry>;
}


export type BottleneckKind = "none" | "transport" | "destination" | "surplus";

/** 低频经济模型 (docs/nexus-design/06 §6.7): 每 Tick 累加 + 周期诊断, 全部有界 */
export interface EconomyMemory {
	/** 每 Tick O(1) 累加器 (诊断时读取并清零) */
	accumulators: {
		spawnIdleTicks: number;
		starvationTicks: number;
		carryBusyTicks: number;
		carryIdleTicks: number;
		energyStockDelta: number;
	};
	/** worker 出生史累计标记 (workerBuildCriticalOf 豁免口径; 死亡不清除) */
	workerEverBorn?: boolean;
	/** 上一诊断窗口的总库存 (算净变化用) */
	lastStockTotal: number;
	/** 观测窗口基准 tick */
	lastStockTick: number;
	/** 最近一次诊断结论 */
	diagnosis: {
		bottleneck: BottleneckKind;
		carrierMultiplier: number;
		upgraderBonus: number;
		quotaFloorBias: number;
		updatedAt: number;
	};
	/** unit:room → 实测路程样本 (bornAt→首次到岗), 固定窗口 */
	travel: Record<string, { samples: number[]; p95: number }>;
	/**
	 * 手动外矿目标列表 (remoteMining: "manual" 档的消费源, 用户口径 2026-10-15):
	 * 显式登记的外矿房名; 空表 = 不挖。真实服写入口 = 控制台
	 * `Memory.Nexus.economy.remoteTargets = ["W5N9", ...]`;
	 * sim 预置见 remote-mine 场景 (memory 字段, 须带合法 schemaVersion 与完整 economy 结构)。
	 * auto 档 (rush) 不读此表。
	 */
	remoteTargets?: string[];
}

/** 全局战略政策 (docs/nexus-design/04 §4.2): 随姿态转移更新, 值域见 config/strategy */
export interface StrategyPolicy {
	/** 储备下限系数: × sourceCount × 10 = 储备下限绝对值 */
	reserveFloorFactor: number;
	/** 风险容忍度 0..1 (Phase 3 威胁输入启用前为占位) */
	riskTolerance: number;
}

export interface StrategyGoals {
	/** 目标库存系数: × sourceCount × 10 = 目标库存绝对值 */
	targetStockFactor: number;
}

/** 姿态转移记录 (有界: 仅最近一条 + 计数) */
export interface PostureTransition {
	from: Posture;
	to: Posture;
	at: number;
	/** 引用量化输入的原因摘要 */
	reason: string;
}

export interface NexusGlobalMemory {
	posture: Posture;
	lastStrategicTick: number;
	policy: StrategyPolicy;
	goals: StrategyGoals;
	lastTransition?: PostureTransition;
	/** 累计转移次数 (有界计数, 观测用) */
	transitionCount: number;
}

/**
 * 编队收益对比 (specs/squad-coordination-metrics「编队收益指标入遥测」):
 * 编队建立时的基线快照 (同房等长窗口) 与当前协同窗口的累计, 供「协同是否带来收益」
 * 取证。定长定数 (每房一条), 不随 tick 或编队次数增长。
 */
export interface SquadBenefitRecord {
	/** 滚动窗口长度 (tick): 累计超过该长度即按窗口衰减回退 */
	window: number;
	/** 当前协同窗口累计 */
	kills: number;
	losses: number;
	/** 成员在编累计 tick (存活时长口径) */
	memberTicks: number;
	/** 编队建立时的基线快照 (等长窗口对照) */
	baseKills: number;
	baseLosses: number;
	baseMemberTicks: number;
	/** 最近一次结算 tick */
	evaluatedAt: number;
}

export interface NexusMetricsMemory {
	/** 累计迁移次数 (排障用) */
	migrationCount: number;
	/** 房名 → 编队收益对比 (specs/squad-coordination-metrics); 有界: 每房一条 */
	squadBenefit?: Record<string, SquadBenefitRecord>;
}

/** SafeMode 簿记 (docs/nexus-design/09 §9.3: 重要限时防御资源, 重试有冷却) */
export interface SafeModeBookkeeping {
	/** 最近一次激活尝试 tick (防每 Tick 重试) */
	lastAttemptTick: number;
	/** 成功激活累计次数 (观测用) */
	activationCount: number;
}

/** 塔能耗滚动统计 (窗口折叠 EMA + 累计, 恒定大小) */
export interface TowerSpendState {
	/** 当前窗口内累加量 */
	accumulated: number;
	/** 窗口折叠后的平滑均值 (能量/窗口) */
	ema: number;
	lastFoldTick: number;
	/** 累计总耗能 */
	total: number;
}

/** 战损与防御开销统计 (docs/nexus-design/14 Phase 3: 战损有预算与统计; 全部有界计数) */
export interface DefenseStats {
	/** 威胁窗口内己方单位损失 */
	unitsLost: number;
	/** 可见敌方数下降的击杀近似计数 */
	hostilesKilled: number;
	/** 威胁窗口开启次数 */
	threatWindows: number;
	/** 塔能耗 (窗口 EMA + 累计) */
	towerEnergy: TowerSpendState;
}

/** 防御子系统持久化状态 */
export interface DefenseMemory {
	safeMode: SafeModeBookkeeping;
	stats: DefenseStats;
}

/** 编队类型 (docs/nexus-design/19 §19.4 集群): 防御编队为当前唯一消费方, 后续可扩 remote/industry */
export type SquadKind = "defense" | "remote";

/**
 * 异构槽位定义 (specs/squad-heterogeneous-slots): 一个槽位条目可携带独立的
 * 任务种类与所需能力, 使同一编队内可混编采集位/搬运位/护卫位 (矿工+搬运+护卫)。
 * `count` 表示同质槽位的数量 (便于迁移与裁剪)。
 */
export interface SquadSlotDef {
	/** 槽位成员任务种类 (与成员任务 kind 一致) */
	taskKind: TaskKind;
	/** 该槽位所需能力 (写入成员任务 requiredCapabilities) */
	capabilities: string[];
	/** 同质槽位数量 */
	count: number;
}

/**
 * 编队记录 (docs/nexus-design/19 §19.4 / docs/nexus-design/20): 多 Creep 协作编队的持久化形态。
 * 编队只持有「槽位」——每个槽位对应一条成员任务 (dedupeKey = squad:<id>:slot:<n>),
 * 成员由任务的 assignedTo 反填; 编队不直接指挥单位, 成员行动仍经 AgentSystem → ActionBroker。
 * 槽位以定义数组表达 (异构); `taskKind`/`capabilities` 为编队级默认槽位定义, 供迁移与回退。
 * 有界: 编队数上限 + 槽位上限 + TTL (请求方不续期即解散并回收槽位任务)。
 */
export interface SquadRecord {
	id: string;
	kind: SquadKind;
	roomName: string;
	/** 编队级默认槽位任务种类 (与成员任务 kind 一致); 异构槽位以其自身 taskKind 为准 */
	taskKind: TaskKind;
	/** 编队级默认每槽位所需能力; 异构槽位以其自身 capabilities 为准 */
	capabilities: string[];
	/** 异构槽位定义数组; 总槽位数 = Σ count */
	slots: SquadSlotDef[];
	/** 当前成员 creep 名 (由槽位任务 assignedTo 反填, 对账维护) */
	members: string[];
	priority: number;
	/** 需求方给出的原因摘要 (可归因, 防抖动排障) */
	reason: string;
	createdAt: number;
	updatedAt: number;
	/** 无需求方续期时在此 tick 解散 (TTL 迟滞) */
	expiresAt: number;
}

/** 布局类型: 动态规划或静态模板名 (docs/nexus-design/17 §17.4) */
export type LayoutType = "auto" | "63auto" | "mini" | "rosemary" | "clover" | "hoho" | "tea";

/** 单房布局记录: 结构点位以压缩整数 ((x<<6)|y) 持久化, 仅 JSON 数据 */
export interface LayoutRoomRecord {
	type: LayoutType;
	/** 布局中心 (= storage 期望位) */
	center?: { x: number; y: number };
	/** structType → 压缩坐标数组 */
	data: Record<string, number[]>;
	/** 自动建造开关 (放量工地由布局驱动) */
	autobuild: boolean;
	/** 上次放量时的 RCL, 变化即触发补量 */
	buildLevel: number;
	/** 下次允许尝试生成布局的 tick (失败退避) */
	retryAt?: number;
	/** 最近一次布局生成 tick */
	updatedAt?: number;
	/** 冲级期产业让位调制 (任务 6.5): rush 档产业类结构放量顺序压后 (运行时推导, 不落盘语义) */
	rushMode?: boolean;
	/** coreDepot 占位容器排空计时 (storage/terminal 真建筑可建时先拆占位再落真身) */
	coreDepotSwapSince?: Partial<Record<"storage" | "terminal", number>>;
}

/** 布局子系统: 房间布局的唯一真相源, 生成重 CPU 受桶门控 */
export interface LayoutMemory {
	rooms: Record<string, LayoutRoomRecord>;
}

export interface NexusMemory {
	schemaVersion: number;
	global: NexusGlobalMemory;
	rooms: Record<string, RoomIntelRecord>;
	tasks: Record<string, NexusTask>;
	units: Record<string, UnitRecord>;
	ledger: LedgerMemory;
	traffic: TrafficMemory;
	economy: EconomyMemory;
	defense: DefenseMemory;
	squads: Record<string, SquadRecord>;
	spawn: SpawnMemory;
	layout: LayoutMemory;
	metrics: NexusMetricsMemory;
	ownership: OwnershipMemory;
}

/** 各子系统损坏时的安全空状态 (bootstrap 隔离重置用); 全部为纯 JSON */
export const SUBSYSTEM_DEFAULTS: {
	global: NexusGlobalMemory;
	rooms: Record<string, RoomIntelRecord>;
	tasks: Record<string, NexusTask>;
	units: Record<string, UnitRecord>;
	ledger: LedgerMemory;
	traffic: TrafficMemory;
	economy: EconomyMemory;
	defense: DefenseMemory;
	squads: Record<string, SquadRecord>;
	spawn: SpawnMemory;
	layout: LayoutMemory;
	metrics: NexusMetricsMemory;
	ownership: OwnershipMemory;
} = {
	global: {
		posture: "develop",
		lastStrategicTick: 0,
		policy: {
			reserveFloorFactor: STRATEGY_CONFIG.posturePolicy.develop.reserveFloorFactor,
			riskTolerance: STRATEGY_CONFIG.posturePolicy.develop.riskTolerance,
		},
		goals: { targetStockFactor: STRATEGY_CONFIG.posturePolicy.develop.targetStockFactor },
		transitionCount: 0,
	},
	rooms: {},
	tasks: {},
	units: {},
	ledger: {
		reservations: {},
		rates: {},
		expiredCount: 0,
		overdueCount: 0,
		consumedTotal: {},
		hunger: {},
	},
	traffic: { blocked: {}, hotspots: {} },
	defense: {
		safeMode: { lastAttemptTick: 0, activationCount: 0 },
		stats: {
			unitsLost: 0,
			hostilesKilled: 0,
			threatWindows: 0,
			towerEnergy: { accumulated: 0, ema: 0, lastFoldTick: 0, total: 0 },
		},
	},
	economy: {
		accumulators: {
			spawnIdleTicks: 0,
			starvationTicks: 0,
			carryBusyTicks: 0,
			carryIdleTicks: 0,
			energyStockDelta: 0,
		},
		lastStockTotal: 0,
		lastStockTick: 0,
		diagnosis: {
			bottleneck: "none",
			carrierMultiplier: 1,
			upgraderBonus: 0,
			quotaFloorBias: 0,
			updatedAt: 0,
		},
		travel: {},
	},
	squads: {},
	spawn: { bootstrapCount: 0, lastBootstrapTick: 0 },
	layout: { rooms: {} },
	metrics: { migrationCount: 0 },
	ownership: { indexVersion: 1, actors: {} },
};

export const SUBSYSTEM_KEYS = [
	"global",
	"rooms",
	"tasks",
	"units",
	"ledger",
	"traffic",
	"economy",
	"defense",
	"squads",
	"spawn",
	"layout",
	"metrics",
	"ownership",
] as const;

export type SubsystemKey = (typeof SUBSYSTEM_KEYS)[number];
