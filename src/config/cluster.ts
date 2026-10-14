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
} as const;
