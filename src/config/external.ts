/**
 * 外域命令优先级配置 (任务 8.7 直连收编配套)。
 *
 * external 域经 broker 提交的命令统一在此取优先级, 模块内不再散落魔法数。
 * 口径沿用 6.6 收编时的工地图优先级基线 (40 = 结构变更常规档),
 * 高于经济任务默认档、低于编队 priorityFloor(80), 与既有 createSite 提交一致。
 */
export const EXTERNAL_COMMAND_PRIORITY = {
	/** 工地移除/结构拆除 (construction 管线常规档) */
	construction: 40,
	/** 外矿容器工地创建 (6.6 口径: 与移除同档) */
	containerSite: 40,
	/** 道路工地创建 (6.6 口径: 低于容器, 道路可延迟) */
	roadSite: 30,
	/** creep 自杀回收 (work 管线最低档: 只在不可达扇区清理时触发) */
	suicide: 10,
} as const;
