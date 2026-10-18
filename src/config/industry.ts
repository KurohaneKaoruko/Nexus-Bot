/**
 * 工业适配层参数集中配置 (openspec nexus-architecture-refactor 8.4 轨道 F):
 * industry 域的直连动作 (lab/factory/powerSpawn/市场订单) 经 industryAdapter
 * 汇入 ActionBroker 统一提交, 本文件承载该适配层的所有可调参数。
 */

/** 工业适配层 (lab/factory/powerSpawn 结构命令 + 市场订单命令的提交通道) */
export const INDUSTRY_ADAPTER_CONFIG = {
	/** 结构命令优先级 (lab 反应/工厂生产/PowerSpawn 烧电) */
	structureActionPriority: 50,
	/** 市场订单命令优先级 (createOrder/changeOrderPrice/extendOrder) */
	marketActionPriority: 50,
	/** 所有权 owner 名: 工业结构 actor 的统一持有者 (actorOwnership 候选) */
	ownerName: "industry-adapter",
	/** owner 候选优先级 (结构 actor 无租约语义, 仅登记供冲突聚合观测) */
	ownerPriority: 40,
} as const;
