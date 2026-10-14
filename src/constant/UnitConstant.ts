/**
 * 角色代号表: 全量角色代号 (跨分支共用族除外), 按需增删。
 * 名称格式 `中文体名 CODE-HEX`, 如 采集体 H-3F2A。
 */
export const UNIT_CODES = {
	/* 基本房间运营 */
	harvester: "H",
	carrier: "C",
	transporter: "T",
	manager: "M",
	upgrader: "U",
	worker: "W",
	miner: "MR",
	universal: "UNIV",
	"rush-courier": "RC",

	/* 特殊用途 */
	scout: "S",
	logistic: "L",
	cleaner: "CLE",
	dismantle: "DIS",
	"up-upgrade": "UUP",
	"up-repair": "URE",

	/* 占领房间 */
	claimer: "CL",
	"attack-claimer": "ACL",

	/* 援建 */
	"aid-build": "AIDB",
	"aid-carry": "AIDC",
	"aid-upgrade": "AIDU",

	/* 战斗 */
	"one-ranged": "1R",
	aio: "AIO",
	saio: "SAIO",
	"double-attack": "2A",
	"double-dismantle": "2D",
	"double-heal": "2H",
	"team-attack": "xA",
	"team-dismantle": "xD",
	"team-heal": "xH",
	"team-ranged": "xR",
	"defend-attack": "DFA",
	"defend-ranged": "DFR",
	"defend-2attack": "D2A",
	"defend-2heal": "D2H",

	/* 外矿 */
	reserver: "RSV",
	"out-build": "OB",
	"out-defend": "OD",
	"out-2attack": "O2A",
	"out-2heal": "O2H",
	"out-invader": "OI",
	"out-attack": "OA",
	"out-ranged": "OR",
	"out-mineral": "OMR",

	/* 沉积物 */
	"deposit-harvest": "DH",
	"deposit-transfer": "DT",
	"deposit-attack": "DPA",
	"deposit-heal": "DPH",
	"deposit-ranged": "DPR",

	/* Power */
	"power-attack": "PA",
	"power-heal": "PH",
	"pc-heal": "PCH",
	"power-carry": "PC",
	"power-ranged": "PR",

	/* 主线在用 (原跨分支族, 主线防御消费) */
	defender: "DF",
} as const;

export type UnitId = keyof typeof UNIT_CODES;

/** 取角色代号; 未收录的角色回退为自身大写 */
export function unitCode(role: string): string {
	return (UNIT_CODES as Record<string, string>)[role] ?? role.toUpperCase();
}

/** 已确立的中文体名; 其余展示回退为角色代号 */
export const UNIT_BODY_NAMES: Partial<Record<UnitId, string>> = {
	harvester: "采集体",
	carrier: "搬运体",
	transporter: "建筑搬运体",
	manager: "中央搬运体",
	miner: "元素矿工",
	upgrader: "升级体",
	worker: "工作体",
	universal: "全能体",
	defender: "防御体",
	"rush-courier": "快递体",
};

/** 取角色中文体名; 未收录角色回退为角色代号 */
export function unitBodyName(role: string): string {
	return UNIT_BODY_NAMES[role as UnitId] ?? unitCode(role);
}
