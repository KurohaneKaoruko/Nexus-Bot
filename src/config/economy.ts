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
	/** 预留最大留存时长 (tick): 超龄强制回收 (泄漏防护)。
	 *  须大于任务最大 deadline (700), 只兜异常滞留, 不碰健康在途承诺 */
	maxReservationAge: 800,
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
	/** 路程样本窗口上限 (每 unit:room 保留的样本数) */
	travelSampleWindow: 8,
	/** 允许短暂在编重叠的关键岗位 */
	keyRoles: ["harvester"] as readonly string[],
	/** 替补提前量抖动幅度 (±比例): 同批单位错峰换代, 避免同拍抖动 (bugs/P2-8) */
	jitterRatio: 0.1,
} as const;

/** 生产缺口 (docs/nexus-design/07 §7.5 / bugs/P1-5) */
export const SPAWN_CONFIG = {
	/** 达到该排队等级的请求按现有能量立即生产 (bootstrap/应急, 不等攒能);
	 *  等级语义小者优先——保级 L2/供能 L1/搬运 L3/升级 L4 均可立即生产,
	 *  采集 L5 走攒能 (capacityWaitRoles, 全灭自举另走 staffed==0 通道) */
	immediatePriority: 4,
	/** 攒能定档实验位 (2026-10-13 校准记录): harvester/carrier 攒能定档在
	 *  强耦合经济里两轮全负 (6588/3919 vs 基线口径 6019)——采集面归零后等待
	 *  断粮死锁, 自举通道补丁又把升级挤垮。维持空表 = 全部按优先级立即定档,
	 *  WORK 密度问题留待与定编/专线同拍的成套校准 (禁止单旋钮, 见 design 校准史)
	 *
	 *  2026-10-16 (十五) 重开实验: urgent 通道按 available 立即定档是小体 churn
	 *  永动机的根因 (speedrun 247 只/31k 全 2-3 部件, 40k 零个 5+ 部件)——
	 *  priority ≥ 70 是排队语义, 绑死「跳过攒能」使 spawn 永不攒大钱。
	 *  断粮死锁已由 harvester staffed==0 自举通道兜底 (本函数 urgent 条件内),
	 *  生产角色回攒能表: desired 按 capacity 定档, 不足等 120t (短窗), 超时降档。 */
	/**
	 * 攒能角色表。harvester 的等待语义特殊: 采集面饱和的唯一杠杆是 WORK 供给——
	 * RCL2 (550) 起 5W1M 即达单源饱和线 (ceil(3000/300/2)=5)。攒能等待不设
	 * 超时降档 (孵化持单等能量, 攒够饱和体型才生产)——超时降档会把体型锁在
	 * 小体档, sim 实证 56% 能量烧在换血 (405 产 376 亡)。无收入自举仍走
	 * staffed==0 通道立即小体。
	 */
	capacityWaitRoles: ["harvester", "upgrader", "carrier", "worker", "rush-courier", "transporter"] as readonly string[],
	/** 采集让位期间的搬运保底数: rush 矿工 0 CARRY (drop 采矿), spawn 能量流入
	 *  全靠 carrier 回收——carrier 低于该数时让位门放行搬运自举, 否则攒能的钱
	 *  永远到不了 spawn, 让位死锁 (sim 实证采集面锁死 2/t 单只换代循环) */
	yieldCarrierFloor: 1,
	/** 攒能角色的短等待窗: 匹配 replacement 提前量, 换代断采 <8% 工作期 (50k 实测) */
	capacityWaitTicksShort: 120,
	/** 替补用途请求的等待上限: 换代提前量 (生产+路程+余量) 量级 ~80t, 原 400t 等待
	 *  远超窗口 → 老单位死亡新人未出 (双重断采 300t+) → 收入跌 → 攒能更慢 → 降档 W1;
	 *  钳到窗口内保证「大的等得起就等, 等不起时老人死前必出新 */
	replacementWaitTicks: 120,
	/** 容量定档等待上限 (tick): 超时退回按存量生产, 防编制空转 */
	capacityWaitTicks: 400,
	/** 采集体收入感知分档 (specs harvest-supply-convergence「采集体型收入感知定档」):
	 *  true 时无在岗采集收入按 max(存量, 起步预算) 定档, 否则按能量容量定档。
	 *  默认 **关闭** —— sim remote-mine 实证: 开启后无收入期采集体型 150→250,
	 *  同能量少孵约 40% 编制 (13→7), 触及外矿防回退断言。按 docs/bugs 校准史
	 *  (单杠杆必被反噬), 该档需与让位闸门成套校准 + A/B 留档, 另立变更推进。 */
	harvestTierEnabled: true,
	/** 采集体无收入期起步预算 (能量): 无在岗采集收入时按 max(存量, 该值) 定档。
	 *  该预算对应 2-WORK 起步体——docs/bugs 2026-10-15 校准实录记载 W2 硬底线一刀切
	 *  为负 (涓流期换代断收入), 故底线必须由「无收入」条件化而非全局生效。
	 *  注意: 此值不是「孵化耗时预算」——引擎孵化耗时为 `CREEP_SPAWN_TIME × 部件数`(极短),
	 *  RCL1 的真实节拍器是 spawn 每 tick 回 1 能量 (上限 300), 体型上限由能量而非时间决定 */
	harvesterStarterBudget: 300,
	/** 采集体无收入期 WORK 底线: 该档位下期望体型不低于此 WORK 数。
	 *  仅作体型目标 (经起步预算达成), **不作为停产闸**——把底线做成硬跳会卡住
	 *  涓流期复产, 采集面归零后无人复产, 属 docs/bugs 已留档的「断粮死锁」负收益路径。 */
	harvesterMinWorkNoIncome: 2,
	/** legacy 采集让位闸门 (specs harvest-supply-convergence): true 时 legacy 服从
	 *  workforce 单一来源定编, 编制已满足即不发单, 仅未满足时兜底发单防收入断档。
	 *  当前 **开启** —— 446d687 引入即 true (提交信息误书「默认关闭」), b8ca2d3
	 *  让位收口后此为生产口径 (legacy 消费端已退役, 让位闸约束生产端挂单),
	 *  六场景基线均在此值下校准; 关闭即恢复 legacy 独立供给, 仅作紧急回退通道。 */
	legacyHarvestStandby: true,
	/** 常驻编制岗位: 缺口判定与任务 available 状态解耦 (任务被租住/冷却期仍请求替补);
	 *  carrier 入列——搬运任务随货源波动, 任务驱动的间歇请求会让编制在关键窗口空转 */
	standingRoles: ["harvester", "upgrader", "carrier", "manager", "transporter", "miner", "scout"] as readonly string[],
	/** 常驻编制缺口的请求排队等级 (race L9; 低于任务驱动, 只兜底) */
	standingPriority: 9,
	/** 按角色的常驻排队等级覆盖 (小者优先, race 语义 + 本矿供能约束):
	 *  carrier L3 / harvester L4——本矿矿工 drop 采矿, 搬运是 spawn 的唯一
	 *  能量入口, 必须先于采集补员 (旧体系 carrier 88 > harvester 55 的同语义);
	 *  两者由采集让位闸 + carrier 上限闸实现 H/C 交替起步; upgrader L6 常态
	 *  升级档 (main 档无 rush 提级时靠此兜底), scout L11 一次性小件。 */
	standingPriorityByRole: { carrier: 3, upgrader: 4, harvester: 9, scout: 11 } as Readonly<Record<string, number>>,
	/** 冲级档缺编 upgrader 的孵化等级下限 (bugs/P1-19): rush 期缺编 upgrader
	 *  与搬运同进 urgent 段 (等级 3), 攒能与立即通道交错建立火力 */
	rushUpgradeSpawnPriority: 3,
	/** 孵化链路遥测 (任务 6.4): 聚合窗口与 EMA 平滑 */
	spawnTelemetry: {
		/** 聚合窗口 (tick): 遥测写 Memory 按窗口节流 */
		aggregateTicks: 100,
		/** 等待时长 EMA 平滑尺度 (tick) */
		waitEmaTicks: 200,
	},
	/** bootstrap 空转治理 (bugs/P1-10): 失明态连续孵化超限后降频, 防能量被 universal churn 耗尽 */
	bootstrap: {
		/** 连续 bootstrap 超过该次数仍未恢复可见房 → 进入节流 */
		maxConsecutive: 8,
		/** 节流期的最小孵化间隔 (tick) */
		throttleInterval: 1000,
	},
	/** 升级定编上限 (每房): 收入对齐定编的防呆上界, 防低容量期小体型放大计数 */
	maxUpgradersPerRoom: 6,
	/** 建造加编: 每 N 个在施工地追加一名工人, 上界防过编 */
	workers: {
		sitesPerWorker: 2,
		max: 4,
	},
} as const;

/** Controller 降级守护 (bugs/P1-10 / docs/nexus-design/17 §17.9): 保升级不断供, 防降级螺旋 */
export const DOWNGRADE_CONFIG = {
	/** 紧急阈值: 降级剩余 tick 低于该值判定紧急 (初值取 RCL2 计时 10000t 的 1/4, 覆盖替补生产+路程; sim 校准点) */
	emergencyTicks: 2500,
	/** 紧急态 upgrade 任务等级: 保级档, 压过常规升级 L4 与搬运 L3 */
	upgradePriority: 2,
} as const;

/** 控制器缓冲 cc (bugs/P1-14 根因① / specs/controller-upgrade-buffer): 升级工就位直供的货源容器 */
export const CONTROLLER_BUFFER_CONFIG = {
	/** cc 规划的最低 RCL (容器 RCL1 即可建, 冲级房开局直供) */
	minRcl: 1,
	/** 水位门缓冲 tick 数: cc 存量 < 在座升级 WORK×2×该值 时暂停升级体孵化 (让位物流) */
	spawnGateBufferTicks: 10,
	/** 采纳半径: 控制器该范围内的既有容器/容器工地直接采纳为 cc, 不另建 */
	adoptRange: 3,
	/** 新建选点半径: cc 距控制器切比雪夫距离落在 [min, max] (墓碑/卸货贴近升级圈) */
	placeRangeMin: 1,
	placeRangeMax: 2,
	/** 保障水位 (占容量比例, 含诊断偏移): 低于该线进入补货配额 */
	floorRatio: 0.6,
	/** 配额优先级: 常规档 (specs/controller-supply-line 序: 孵化线 > 受威胁塔 > cc > 常态塔) */
	priorityNormal: 3,
	/** 配额优先级: 冲级档 (升过常态塔, 仍低于受威胁塔与孵化线) */
	priorityRush: 2.5,
	/** 专线 carve-out: 运力吃紧时 cc 货运任务提到该优先级 (压过孵化线任务),
	 *  兑现「专线只数优先满足」——近距孵化/常态请求不得吸干升级供能份额 */
	dedicatedLinePriority: 0,
	/**
	 * 专线收紧总闸 (2026-10-13 校准负收益留档): 50k 实测 −3835 升级量——
	 * 「空闲搬运力」在任务板架构下是瞬时口径 (fill_spawn 租约占满时恒 0),
	 * 收紧误触发会切断 pile→孵化线的货流, 升级体反而断粮。默认关停,
	 * 专线语义由优先级序 (孵化线>受威胁塔>cc>常态塔) 承载; 重启需先修
	 * 空闲口径为「稳态可用运力」(EMA) 再实测。
	 */
	supplyLineGateEnabled: false,
	/** 站点创建失败冷却 (tick), 与 worksite 同口径 */
	siteRetryInterval: 300,
	/** cc 工地建造任务的等级提前量: 升级直供链路的地基——恒压过扩容与路网
	 *  (cc 不成升级体长腿取能, sim 实证 5k tick 零进度全在修 ext) */
	buildPriorityBonus: -4,
} as const;

/** 搬运编制钳制: 吞吐目标由 workforce 运力公式现算 (specs/workforce-staffing),
 *  此处只留冗余系数与只数钳制 (防诊断乘数在极端窗口失控);
 *  地形耗时/运力基准字段供 modules/units (内聚化在途工作) 消费 */
export const CARRY_STAFFING_CONFIG = {
	/** 运力冗余系数 (死亡率/绕路/装卸波动余量) */
	throughputFactor: 1.3,
	/** 慢地形 (无路网沼泽) 单格耗时 */
	slowTileTicks: 5,
	/** 快地形单格耗时 */
	fastTileTicks: 1,
	/** 单 carrier 运力基准 (能量) */
	carrierCapacity: 200,
	/**
	 * 外矿孵化容量折算用的标称体型部件数。
	 *
	 * 引擎的孵化耗时是 `CREEP_SPAWN_TIME × 部件数` (tick), 不是常数——六部件体约 18 tick
	 * 一只, 而非 3 tick。故每 spawn 的在册爬容量 = `CREEP_LIFE_TIME / (CREEP_SPAWN_TIME × 该值)`。
	 * 早期实现漏乘部件数, 把容量高估约 6 倍 (1500/3 = 500 vs 1500/18 ≈ 83), 导致外矿
	 * 误判「孵化容量充裕」而超发外务、挤占本地孵化队列。
	 */
	nominalCreepParts: 6,
	/** 定编下限 */
	minCarriers: 2,
	/** 定编上限 */
	maxCarriers: 8,
	/** 实测单程路程的钳制上限: 换班实测含出生排队/拥堵等待, 病理值 (实测 345/407)
	 *  会把运力定编吹成几十只小搬运形成拥堵正反馈; 按 50×50 平地最远单程兜底 */
	pathTimeClamp: 50,
	/** 上限随 RCL 分档的基准: 实际上限 = min(maxCarriers, carriersPerRcl × RCL);
	 *  早期采集面小 (1W 小矿工) 时 2/rcl 足够; 采集面解锁 (5W 饱和矿工) 后
	 *  搬运成为瓶颈——rcl2 双源 20/t 需 ~8 只 (250/只·170t 往返), 4 只封顶
	 *  时 sim 实证落地腐烂 12.5%→49.8% (141k 能量烂在源边) */
	carriersPerRcl: 4,
} as const;

/**
 * 源旁 extension 直供链: 冲级档在 source ring-2 放 ext, 驻点矿工工位直填。
 */
export const SOURCE_EXTENSION_CONFIG = {
	/** 触发的最高 RCL (冲级期专用; 高 RCL 走常规物流布局) */
	maxRcl: 4,
	/** 触发的最低 RCL (对齐 1-CARRY 下限的免费窗口) */
	minRcl: 3,
	/** ext 环半径: 切比雪夫距离恰为该值的格 (ring-1 是采集工位, ring-2 与工位相邻不相占) */
	ring: 2,
	/** 源旁 ext 并发工地上限 (只数源旁 ring ext 工地, 建完再补) */
	maxConcurrentSites: 2,
	/** 站点创建失败冷却 (tick) */
	siteRetryInterval: 100,
} as const;

/** 拉能快递 (specs/rush-courier): spawn 盈余自爆转运 */
export const COURIER_CONFIG = {
	/** spawn 底仓: 快递预算不得动用的存量 */
	reserveFloor: 150,
	/** 运作线: 房间总能量低于 capacity × 该比例时不发车 (基础孵化永不断档) */
	opFloorRatio: 0.6,
	/** 升级工饥饿线: 存量按 WORK 吞吐折算低于该 tick 数判快断能 (墓碑要有紧急消费者) */
	hungryTicks: 150,
	/** 升级圈范围: 距控制器该范围内有饥饿升级工才发车 */
	controllerRange: 4,
	/** 空载断供的放弃等待 (tick) */
	idleGiveUpTicks: 60,
	/** 孵化请求排队等级 (L11 一次性小件档, 永不挤占基础孵化/攒能) */
	priority: 11,
	/** 特化子模式判据: 仅 RCL ≤ maxRcl 且 spawn 距控制器 ≤ spawnRange 且房内无 link 时激活 */
	maxRcl: 3,
	spawnRange: 3,
	/**
	 * 交付模式: "direct" 满载后 transfer 入 cc (能量直达, 快递可复跑多趟);
	 * "tombstone" 就近自爆靠墓碑中转——sim 实证墓碑衰减漏损大 (升级 19437→9324),
	 * 按 design 风险预案默认直投。无 cc 时退化为墓碑模式 (没有直投目标)。
	 */
	deliveryMode: "direct" as "direct" | "tombstone",
} as const;

/** 房间劳动力吞吐定编 (specs/workforce-staffing): WORK/CARRY 能力口径取代固定只数 */
export const WORKFORCE_CONFIG = {
	/** 采集定编折算 (RosmarinBot 同源口径): 源速 3000e/300t=10e/t, 满速体 = 5W;
	 *  低容量期单只 W 不足时按 ceil(容错W/单只W) 多只铺满, 容量升档自动回落单座 */
	harvest: {
		/** 满速单只 WORK 数 (= 源再生速率 10e/t ÷ HARVEST_POWER 2) */
		fullSpeedWork: 5,
		/** 容错 WORK 数 (满速 5W + 1W 换班/移动损耗容错) */
		toleranceWork: 6,
	},
	/** 源饱和口径实测分解 (specs harvest-supply-convergence「源饱和口径实测分解」):
	 *  按源 EMA 记录采集工时间去向 (在源/往返/等待), 作为定编与体型决策的证据口径。
	 *  存储定长 (每源三个比例), 不随 tick 增长。 */
	harvestSplit: {
		/** EMA 时间常数 (tick): 越大越平滑, 越小越贴当前时序 */
		emaTicks: 300,
		/** 源旁判定范围 (切比雪夫): 与工作位口径一致 */
		sourceRange: 1,
	},
	/** 升级侧 (WORK 口径目标) */
	upgrade: {
		/** 无控制器缓冲时的收紧上限 (WORK): 长腿取能期不放大编制 */
		noBufferWorkCap: 30,
		/** 缓冲在位的上限 (WORK); link 供能几何封顶留待 RCL5+ 正规链路 */
		bufferedWorkCap: 90,
		/** RCL8 满级房固定编制 (WORK) */
		rcl8WorkCap: 15,
		/** RCL8 维持升级的水位线 (energyLevel ≥ 该值时保编制) */
		rcl8ActiveLevel: 110,
		/** 保级窗口判定: ttd 低于该值时定编下限与饥饿豁免生效 */
		neededTtd: 10000,
		/** RCL1 起步固定小队 (WORK) */
		rcl1WorkFloor: 5,
		/** 保级窗口的定编下限 (WORK) */
		neededWorkFloor: 5,
		/** 水位收缩阈值: energyLevel 低于该值按水位等比收缩 */
		throttleLevel: 90,
		/** 水位收缩的百分比下限 (等比收缩不归零) */
		throttleLevelFloorPct: 20,
		/** 盈余加码阈值: energyLevel 高于该值时收入项叠加盈余差 */
		surplusLevel: 120,
		/** 每份该数值的地面掉落能量折 1 WORK 清理编 */
		pileWorkDivisor: 2000,
		/** 储备水位基准: RCL → 标准储量 (storage+terminal 口径) */
		standardReserveByRcl: {
			1: 10000,
			2: 10000,
			3: 10000,
			4: 20000,
			5: 40000,
			6: 80000,
			7: 160000,
			8: 320000,
		} as Readonly<Record<number, number>>,
		/** 超线盈余折算步长 (每该值能量折 1 水位点/盈余 WORK) */
		surplusStep: 1500,
		/** 升级体只数人口硬上限 (RCL 表): 兜底护栏, 非吞吐主控。
		 *  原表为防「小体型折算膨胀」(RCL3: 40 WORK ÷ 1 WORK/只 = 38 只独占孵化队列) 而设,
		 *  但 WORK 密度优先的体型生成器落地后单体可载 4~40 WORK, 该表反而成为吞吐天花板
		 *  (RCL2: 目标 30 WORK ÷ 4 WORK/只 = 8 只 > 原上限 6)。现按该 RCL 所需只数留
		 *  余量, 既不炸孵化队列也不卡火力。 */
		upgraderPopCapByRcl: {
			1: 3,
			2: 8,
			3: 10,
			4: 12,
			5: 14,
			6: 16,
			7: 18,
			8: 6,
		} as Readonly<Record<number, number>>,
	},
	/** 升级饥饿负反馈 */
	starved: {
		/** 记账上限 */
		max: 200,
		/** 二轮缩编阈值 (记账超过该值追加一轮收缩) */
		secondStage: 100,
		/** 单次记账量 = floor(RCL / 该值), 至少 1 */
		levelDivisor: 2,
		/** 每轮缩编系数 (×0.75 后 −1) */
		shrinkFactor: 0.75,
		/** RCL ≥ 该值不记账 (满级房固定编制 + link 常供) */
		skipAtRcl: 8,
	},
	/** rush 供需 EMA: 升级火力乘数在 [min,max] 浮动, 信号 −1(饥饿)/0/+1(物流闲置) */
	rushEma: {
		/** 时间常数 (tick): alpha = 1 − 2^(−1/T) */
		timeConstant: 50,
		multiplierMin: 1,
		multiplierMax: 1.2,
		/** 乘数基线偏移: multiplier = clamp(ema/2 + baseline) */
		baseline: 0.8,
	},
	/** 源单程路程实测的记录钳制 (tick) */
	sourceTiming: { clampMin: 10, clampMax: 500 },
} as const;

/** carrier 交付侧行为 (specs/controller-supply-line 顺路灌注/溢流落堆)。
	 *  2026-10-13 校准负收益留档: 两闸同拍开启 sprint control 12387→11259 (−9%),
	 *  且 RCL3 时间线劣于基线 (顺路灌注把边际能量灌进孵化线, cc 断粮升级停)——
	 *  默认关停, 重启需先解决「灌注目标与 cc 专线抢同一批边际能量」的配额再平衡 */
export const CARRIER_BEHAVIOR_CONFIG = {
	/** 顺路灌注总闸: 满载途经相邻配额目的地就地交付 */
	enrouteTopup: false,
	/** 溢流落堆总闸: 无可投目的地 + cc 在位 + 升级圈饥饿 → 落堆 cc 位 */
	overflowDrop: false,
	/** 落堆规模上限 (能量): cc 位堆超过该值转持能待命 (防巨堆衰减浪费) */
	overflowDropMaxPile: 400,
	/**
	 * 孵化线保底搬运工: 控制器专线 (cc 补货/升级工手填) 认领搬运工时,
	 * 只要孵化线 (spawn/ext/受威胁塔, priority 1) 还有缺口, 就为通用线保留
	 * 这么多只搬运工不被专线吸走。专线阶段先于通用阶段执行且认领者不参与
	 * 通用阶段竞争——无保底时「每只升级工空仓请求」叠加可把全部搬运工划走,
	 * 孵化线断供 → ext 翻不满 → RCL3 解锁死锁 (arena 40k 不进 L3 的实测根因)。
	 */
	spawnLineCarrierReserve: 1,
} as const;

/** Pixel 生成 (bucket 满额溢出 → GPL; 冲级/模拟环境恒关) */
export const PIXEL_CONFIG = {
	/** 总闸: 桶满 10000 后消耗桶搓 pixel (GPL 进程) */
	enabled: false,
} as const;

/** 产出就绪闸 (specs/production-readiness-gate): 未就绪房间的孵化面约束 */
export const PRODUCTION_GATE_CONFIG = {
	/**
	 * 未就绪时仍放行的角色: 采集面 (采集体/升级体/万金油) + 生存防御 + 侦查件
	 * (scout 是 1 MOVE 廉价件, 是外矿链路第一环——被此闸卡死则 auto 档
	 * remoteMining 永远无法点亮邻房, sim 实证 scout 任务恒 available 无人孵化)
	 */
	unsecuredAllowedRoles: ["harvester", "upgrader", "universal", "defender", "scout", "reserver"] as readonly string[],
} as const;

/** 外矿预订线 (specs/race-remote「预订线」): 未预订源容量减半 */
export const RESERVE_CONFIG = {
	/** 预订续订线: 预订剩余刻数低于该值即重发 reserve 任务 (防裸奔减半期) */
	refreshTicks: 2000,
} as const;

/** 外矿收入统一折算 (资源账本 7.3): 定编与孵化门同源引用的唯一口径 */
export const REMOTE_INCOME_CONFIG = {
	/** 未预订源折算系数: 容量减半 (1500/3000) 计收入, 防按虚高收入超编 */
	unreservedFactor: 0.5,
} as const;

/** 远程搬运链 (bugs/race-strategy-port W1-2: 自查式改独立 carrier 链):
 *  远程矿工驻源满载卸源旁容器, 本矿 carrier 跨房 haul 回家——
 *  5W 矿工走长途是运力浪费 (往返 2×路程 tick 全程 0 采集)。 */
export const REMOTE_HAUL_CONFIG = {
	/** 源旁容器搜索半径 (切比雪夫): 容器与源的距离上限 */
	containerRange: 2,
	/** 容器维修线: 耐久低于 hitsMax × 该值即修 (不修则 decay 拆 haul 链取料点) */
	repairRatio: 0.5,
	/** haul 任务发起阈值: 容器存量占容量比例达到即产任务 (拉空触发, 防空跑) */
	haulTriggerRatio: 0.3,
	/** haul 任务等级: 与本矿 haul 同档 L4 (收入实现线, 远程采集同源) */
	haulPriority: 4,
} as const;

/** 升级体体型参数 (specs/workforce-staffing「升级定编 WORK 口径目标」):
 * 升级火力对齐采集收入, 体型按能量容量取**装得下的最大 WORK**。
 * 升级体常驻控制器工位就近取能, 移动占比极低, 故 MOVE 配给远低于移动型角色,
 * 使同预算下 WORK 密度最大化 (每 WORK 摊到的 MOVE/CARRY 越少, 能量越集中在 WORK)。
 */
export const UPGRADER_BODY_CONFIG = {
	/** 每个 WORK 预留的携行能量 (决定 CARRY 部件数: ceil(work × 该值 / CARRY_CAPACITY)) */
	carryEnergyPerWork: 6,
	/** 每个 MOVE 承担的 WORK 数 (决定 MOVE 部件数: ceil(work / 该值)); 升级体移动少, 取值偏大 */
	workPerMove: 10,
	/** 起步 CARRY 下限 (保证有取能缓冲) */
	minCarry: 1,
	/** 起步 MOVE 下限 (保证可移动) */
	minMove: 1,
} as const;

/** 接力搬运 (specs/relay-hauling): 低等级期微型件相向整仓交接 */
export const RELAY_CONFIG = {
	/** 接力启用等级门: RCL < 该值恒接力; 达门转大件直运 */
	maxRcl: 7,
	/** 供方 TTL 下限: 快死的能量不做半程交接 */
	minSupplierTtl: 50,
	/** 直运期 (RCL≥门) 段数上限放大 (大件摊薄往返) */
	directMaxSegments: 8,
} as const;

/** 地形感知体型 (bugs/P1-14 根因② / specs/adaptive-body-factory) */
export const BODY_TERRAIN_CONFIG = {
	/** 沼泽密度阈值: 房间可行走格中沼泽占比高于该值按地形档配比 (sim seed7 沼泽房实测 0.28) */
	swampRatioThreshold: 0.2,
	/** 通道路网覆盖率阈值: 关键通道 (spawn↔source↔controller) 路网覆盖低于该值保持地形档 */
	roadCoverThreshold: 0.7,
	/** 地形分析缓存刷新间隔 (tick): 地形静态、路网随建造变化, 低频重扫 */
	refreshIntervalTicks: 500,
} as const;

/** 建造任务的按结构加成 (docs/nexus-design/17 §17.9 建设协同: 扩容与路网优先) */
export const BUILD_PRIORITY_BONUS: Readonly<Record<string, number>> = {
	/** extension: 容量增长复利——750 能量换 550 容量与更大体型, 冲级窗口最高回报, 提前 3 档压过路网 */
	extension: -3,
	/** road: 平地全速移动, 早期收益低于扩容/直供链——殿后 (正数=推后), 沼泽房由
	 *  路网 RCL 门槛 (roadMinRcl) 之后的阶段承接; 抢先修路会把 worker 从 cc/ext
	 *  引走 (sim 实证 cc 工地 5k tick 零进度, worker 全在修路) */
	road: 1,
} as const;

/** 建造近完提权 (bugs/P2-20): 工地进度占比 ≥ 阈值时加分——收尾一个 ext 立即
 *  解锁 cap+50 (更大体型/更强火力), 摊开施工把「5 个各 20%」拖成「首个建成
 *  无限推迟」(sim 实锤 5 ext 摊开 24k tick 才收首个, cap 300 锁 W1 体型整程)。 */
export const BUILD_COMPLETION_CONFIG = {
	/** 进度占比阈值 (0..1): 达到才提权 */
	progressRatio: 0.6,
	/** 提级幅度 (负数=提前): 压过其他在建 ext/road, 不越升级常规档 */
	bonus: -2,
} as const;

/** 低频经济模型 (docs/nexus-design/06 §6.7/§6.8) */
export const ECONOMY_MODEL_CONFIG = {
	/** 诊断周期 (tick); 每 Tick 仅做 O(小) 累加 */
	diagnosisPeriod: 150,
	/** 运输瓶颈判定: 交付速率低于生产的该比例视为运力不足 */
	transportDeficitRatio: 0.6,
	/** 缺货判定: 关键结构空仓累计 tick 超过该值视为目的地错配 */
	starvationTicksThreshold: 100,
	/** 运力目标乘数上下限; 下限>1 = 交付自举保底 (carrier 是出生吞吐的上游,
	 *  衰减到 1 会让交付-出生互相锁死在低水位, sim 实证 2 carrier/1.7t 封顶) */
	carrierMultiplierMax: 3,
	carrierMultiplierMin: 2,
	carrierMultiplierStep: 1.25,
	/** 产能过剩判定: 搬运目的地全部满足且库存高于该值 */
	surplusStockAmount: 3000,
} as const;
