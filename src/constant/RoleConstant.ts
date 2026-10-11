/**
 * 角色代号表: 
 * 名称格式 `CODE-HEX`, 如 H-3F2A / UNIV-00FF。
 */
export const ROLE_CODES = {
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

	/* 跨分支共用角色 */
	attacker: "A",
	blinky: "BL",
	healer: "HL",
	defender: "DF",
	quad: "Q",
	colonist: "CO",
	porter: "P",
	courier: "CR",
	picker: "PI",
	puller: "PL",
	digger: "DG",
	tester: "TS",
	"rampart-repairer": "RR",
	"nuke-repairer": "NR",
	"core-attacker": "CA",
	"mineral-hauler": "MH",
	"keeper-killer": "KK",
	"score-hunter": "SH",
	"out-repair": "ORE",
} as const;

export type RoleId = keyof typeof ROLE_CODES;

/** 取角色代号; 未收录的角色回退为自身大写, 保证任意输入都能生成合法名称 */
export function roleCode(role: string): string {
	return (ROLE_CODES as Record<string, string>)[role] ?? role.toUpperCase();
}
