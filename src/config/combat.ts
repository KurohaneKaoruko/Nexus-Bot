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

/** 编队齐射策略 (teams 域目标选择/火力下发) */
export const TEAM_VOLLEY_CONFIG = {
	/** rangedMassAttack 触发: 该距离内敌对 rampart 数量达到阈值即换溅射 */
	massAttackRange: 2,
	/** rangedMassAttack 触发: rampart 数量阈值 (3x3 溅射同时削多目标) */
	massAttackRampartCount: 2,
} as const;

/** 扩展队形 (cross/square3) 推进参数: 动态组合防卡死 */
export const TEAM_MOVE_CONFIG = {
	/** 成阵窗口 (tick): 孵化房集结等待上限, 超时后不论队形整队开拔 */
	gatherWindowTicks: 40,
	/** 卡死累计阈值 (tick): 阵型推进无方向/未成阵计数达到该值切散装 */
	stuckTriggerTicks: 8,
	/** 散装窗口 (tick): 成员各自寻路 (单爬可穿窄门), 到期自动重试成阵 */
	looseDurationTicks: 60,
	/** quad 穿边保形驻留上限 (tick): 超时强制下发移动, 防对岸格被占时门口永久站桩 */
	quadHoldLimitTicks: 5,
} as const;
