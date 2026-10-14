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
	/** 达到该优先级的请求按现有能量立即生产 (bootstrap/应急, 不等攒能) */
	immediatePriority: 70,
	/** 攒能定档实验位 (2026-10-13 校准记录): harvester/carrier 攒能定档在
	 *  强耦合经济里两轮全负 (6588/3919 vs 基线口径 6019)——采集面归零后等待
	 *  断粮死锁, 自举通道补丁又把升级挤垮。维持空表 = 全部按优先级立即定档,
	 *  WORK 密度问题留待与定编/专线同拍的成套校准 (禁止单旋钮, 见 design 校准史) */
	capacityWaitRoles: [] as readonly string[],
	/** 攒能角色的短等待窗: 匹配 replacement 提前量, 换代断采 <8% 工作期 (50k 实测) */
	capacityWaitTicksShort: 120,
	/** 容量定档等待上限 (tick): 超时退回按存量生产, 防编制空转 */
	capacityWaitTicks: 400,
	/** 常驻编制岗位: 缺口判定与任务 available 状态解耦 (任务被租住/冷却期仍请求替补);
	 *  carrier 入列——搬运任务随货源波动, 任务驱动的间歇请求会让编制在关键窗口空转 */
	standingRoles: ["harvester", "upgrader", "carrier", "manager", "transporter", "miner", "scout"] as readonly string[],
	/** 常驻编制缺口的请求优先级 (低于任务驱动, 只兜底) */
	standingPriority: 55,
	/** 按角色的常驻优先级覆盖: carrier 物流是骨干——涓流孵化队列里 55 会被
	 *  任务驱动请求 (70) 永久压队, 没有搬运一切不流 (bugs/P1-14 根因③) */
	standingPriorityByRole: { carrier: 72 } as Readonly<Record<string, number>>,
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
	/** 紧急态 upgrade 任务优先级: 高于抢占线 90 (含 retreat), 低于 defend 92 / fill_spawn 95 */
	upgradePriority: 91,
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
	priorityNormal: 4.2,
	/** 配额优先级: 冲级档 (升过常态塔, 仍低于受威胁塔与孵化线) */
	priorityRush: 4.4,
	/** 专线 carve-out: 运力吃紧时 cc 货运任务提到该优先级 (压过孵化线任务),
	 *  兑现「专线只数优先满足」——近距孵化/常态请求不得吸干升级供能份额 */
	dedicatedLinePriority: 96,
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
	/** cc 工地建造任务的优先级加成: 升级直供链路的地基, 与扩容同档压过路网 */
	buildPriorityBonus: 25,
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
	/** 定编下限 */
	minCarriers: 2,
	/** 定编上限 */
	maxCarriers: 8,
	/** 上限随 RCL 分档的基准: 实际上限 = min(maxCarriers, carriersPerRcl × RCL);
	 *  早期孵化槽紧张, 全量吞吐编制会挤死采集/升级 (sim 实证 RCL2 +1000t) */
	carriersPerRcl: 2,
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
	/** 孵化请求优先级 (低于常驻编制兜底 55 与替补 60, 绝不挤占基础孵化) */
	priority: 40,
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
		/** 升级体只数人口硬上限 (RCL 表): 低容量期小体型折算防膨胀
		 * (实测教训: RCL3 冲级房 40 WORK ÷ 1 WORK/只 = 38 只独占孵化队列) */
		upgraderPopCapByRcl: {
			1: 3,
			2: 6,
			3: 8,
			4: 8,
			5: 8,
			6: 8,
			7: 8,
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
} as const;

/** Pixel 生成 (bucket 满额溢出 → GPL; 冲级/模拟环境恒关) */
export const PIXEL_CONFIG = {
	/** 总闸: 桶满 10000 后消耗桶搓 pixel (GPL 进程) */
	enabled: false,
} as const;

/** 产出就绪闸 (specs/production-readiness-gate): 未就绪房间的孵化面约束 */
export const PRODUCTION_GATE_CONFIG = {
	/** 未就绪时仍放行的角色: 采集面 (采集体/升级体/万金油) + 生存防御 */
	unsecuredAllowedRoles: ["harvester", "upgrader", "universal", "defender"] as readonly string[],
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
	/** extension: 容量增长复利——750 能量换 550 容量与更大体型, 最高回报 */
	extension: 25,
	/** road: 沼泽房的物流命脉 (1 疲劳全速), 仅次于扩容与 cc */
	road: 40,
};

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
