/**
 * 战斗适配层参数集中配置 (openspec nexus-architecture-refactor 轨道 E):
 * defense/teams 域的直连动作经 combatAdapter 汇入 ActionBroker 统一提交,
 * 本文件承载该适配层的所有可调参数。
 */

/** 战斗适配层 (defense/units + teams 编队的命令提交通道) */
export const COMBAT_ADAPTER_CONFIG = {
	/** 战斗命令优先级 (同管线仲裁用; executeNow 同步窗口不参与跨计划仲裁) */
	actionPriority: 80,
	/** 旗标命令优先级 (flag 管线) */
	flagPriority: 70,
	/** 所有权 owner 名: 战斗域 actor 的统一持有者 (actorOwnership 候选) */
	ownerName: "combat-adapter",
	/** owner 候选优先级 (拦截档下与 teams-direct 同档) */
	ownerPriority: 60,
} as const;
