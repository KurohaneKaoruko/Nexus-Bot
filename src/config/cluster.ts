/**
 * 智能连结集群参数集中配置 (docs/nexus-design/19 §19.4 集群 / docs/nexus-design/20)。
 * 全部可调参数只在此处定义, 模块禁止散落魔法数;
 * 数值为单房间 Phase 3 基线, 按战损/协同收益指标校准。
 */

export const CLUSTER_CONFIG = {
	/** 同时存活的编队数上限 (有界: 超出不再新建, 需求方下 Tick 会再报) */
	maxSquads: 4,
	/** 单编队槽位上限 (成员数上限) */
	maxSlotsPerSquad: 4,
	/** 单 Tick 待处理需求队列上限 (防同 Tick 需求放大) */
	maxPendingRequests: 8,
	/** 需求方不续期时编队的存活 tick 数 (TTL 迟滞: 需求抖动不会立刻拆队) */
	requestTtlTicks: 60,
	/** 槽位任务优先级下限 (低于此值抬到该值, 保证编队任务不被经济任务抢占) */
	priorityFloor: 80,
	/** 异构槽位 (specs/squad-heterogeneous-slots): 单编队允许的槽位定义条目数上限 */
	maxSlotDefsPerSquad: 4,
	/**
	 * 编队收益指标 (specs/squad-coordination-metrics「协同行为默认关闭并以指标为开启门」):
	 * 基线取编队建立前的等长窗口, 协同窗口与基线的归一化收益 (每千 tick) 超过该阈值
	 * 才允许开启领队/外矿协同。默认关闭: 无指标证据不上线 (docs/nexus-design/02 原则 F)。
	 */
	benefit: {
		/** 协同行为总闸: false = 只维持槽位协同, 不启用领队/外矿协作 */
		enabled: false,
		/** 滚动窗口长度 (tick): 累计超过该长度按窗口衰减回退 */
		windowTicks: 600,
		/** 开启门: 归一化净收益 (每千 tick) 下限, 低于则保持关闭 */
		enableThreshold: 0,
	},
} as const;
