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
	/** 放量产能联动 (任务 6.5, specs/construction-intents): 每只在岗 worker 的
	 *  工地承载 (个)——放量水位取 min(buildSitesLowWater, worker×本值×倍数),
	 *  worker 不足时暂缓新工地防建造风暴 (P2-20 产能侧) */
	workerSitesCapacity: 3,
	/** 冲级期产业让位 (任务 6.5, specs/construction-intents): rush 档把这些结构
	 *  的放量顺序压到尾部 (order+100)——产业建筑能量锁不挤占升级链 */
	rushIndustrialTypes: ["lab", "factory", "powerSpawn", "nuker", "extractor"] as readonly string[],
	/** 单次放量最多创建的工地数 */
	maxSitesPerPass: 10,
	/** rampart 起建 RCL (冲级姿态接入后可按房间模式推迟到 5) */
	rampartMinRcl: 4,
	/** 路网放量 RCL: 平地早期移动本就全速, RCL3 前产能优先投 extension 扩容 (容量复利) */
	roadMinRcl: 3,
	/** 布局存在前, 允许按驻点规划放 Source 容器 (开局经济兜底) */
	bootstrapContainerEnabled: true,
	/** 工地放量顺序 (bugs/P2-20): 功能建筑靠前, road 紧随扩容梯队之后——
	 *  沼泽房无路时 W1 工人 fetch 往返 300t+ (沼泽 10t/格疲劳), 建造利用率 ~16%,
	 *  ext/container 塞满工地槽后 road 永无预算 → 50k 零道路死锁 (sim seed7 实锤)。
	 *  road 压过 container: 扩容之后先修命脉路网; 源容器/cc 不经此序 (worksites/
	 *  controllerBuffer 独立放量), 布局 container 点位让后。 */
	placementOrder: {
		spawn: 0,
		tower: 1,
		storage: 2,
		terminal: 3,
		extension: 4,
		road: 5,
		container: 6,
		link: 7,
		rampart: 9,
		extractor: 10,
		lab: 11,
		wall: 12,
		observer: 13,
		factory: 14,
		powerSpawn: 15,
		nuker: 16,
	} as Readonly<Record<string, number>>,
	/** 核心库 (storage/terminal) 占位容器的最低 RCL (bugs/P2-20): 占位是
	 *  「真结构转正前保点位」的兜底, 贴着起建门槛才值得占——提前太多等于
	 *  5000 能量的死积压换拆换三轮 (排空→拆→重放, sim 实锤 RCL2 占位卡死
	 *  2 槽位 40k tick)。storage RCL4 / terminal RCL6 起建。 */
	coreDepotPlaceholderMinRcl: 4,
} as const;
