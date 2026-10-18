/**
 * 孵化/任务排队等级 (RosmarinBot race 同源写法, 2026-10-18 race 复盘):
 *
 * 档位定义的单一事实源是 taskSchema.TASK_PRIORITY (任务种类 → level);
 * 本文件只承载排队器 (spawnArbiter / allocator) 的通用常量与角色映射。
 *
 * 排队规则 (race pickSpawnMission 同源):
 * 严格分层——最高层有单 → 孵最高层付得起的首单; 全付不起 → 为最高层
 * 最便宜者攒能等待; 小件层 (≥ QUEUE_JUMP_ALLOW_BELOW_LEVEL) 付得起即可
 * 插队, 不阻塞高层攒能。
 */

/** 角色 → 常驻排队等级 (race RoleData.level 同源: harvester L3 / carrier L4 /
 *  upgrader L5-7 / worker L8 / scout L11 一次性小件) */
export const ROLE_LEVELS = {
	universal: 0,
	defender: 2,
	carrier: 3,
	harvester: 5,
	reserver: 5,
	upgrader: 4,
	manager: 6,
	transporter: 6,
	miner: 6,
	worker: 8,
	scout: 11,
	"rush-courier": 11,
	claimer: 10,
} as const;

export type RoleLevelName = keyof typeof ROLE_LEVELS;

/** 角色的常驻排队等级; 未知角色落替补档 (不阻塞攒能) */
export function roleLevelOf(role: string): number {
	return (ROLE_LEVELS as Record<string, number | undefined>)[role] ?? 11;
}

/**
 * 跨层插队豁免线 (race WAIT_ENERGY_QUEUE_JUMP_ALLOW_BELOW_LEVEL 同源):
 * level ≥ 该值的单付得起即可插队孵化, 不阻塞高层攒能等待。
 * 11 = 替补/快递/scout 一次性小件层。
 */
export const QUEUE_JUMP_ALLOW_BELOW_LEVEL = 11;
