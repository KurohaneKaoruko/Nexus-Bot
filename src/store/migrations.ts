/**
 * Memory.nexus 逐版本迁移注册表 (docs/nexus-design/04 §4.4)。
 * 每级迁移是一个纯函数: 就地修改传入的工作副本, 输出只含处置说明, 无外部副作用;
 * 版本号管理 (写 schemaVersion) 统一由 bootstrap 负责, 迁移函数不碰版本字段。
 */
import { SUBSYSTEM_DEFAULTS } from "./memorySchema";

/** 迁移在纯 JSON 视图上工作, 不触碰游戏 API */
export type RawNexus = Record<string, unknown>;

export interface MigrationOutcome {
	/** 无法迁移、需重置为安全空状态的子系统 key (如 "rooms"); 其余子系统照常保留 */
	readonly resetSubsystems?: readonly string[];
}

/** MIGRATIONS[v - 1] 把 schemaVersion v 的内容升级到 v + 1 */
export type MigrationFn = (memory: RawNexus) => MigrationOutcome;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * v1 → v2: tasks/units 从占位空表实装为正式 DTO 表。
 * v1 从未写入过条目 (占位阶段), 仍做防御性清洗: 形状不合规的条目丢弃,
 * 形状接近的条目补齐默认字段。rooms/global/metrics 形状未变, 原样保留。
 */
export const migrateV1ToV2: MigrationFn = (memory) => {
	const tasks = memory["tasks"];
	if (isPlainObject(tasks)) {
		for (const key of Object.keys(tasks)) {
			const entry = tasks[key];
			if (!isPlainObject(entry) || typeof entry["dedupeKey"] !== "string" || typeof entry["kind"] !== "string") {
				delete tasks[key];
			}
		}
	}
	const units = memory["units"];
	if (isPlainObject(units)) {
		for (const key of Object.keys(units)) {
			const entry = units[key];
			if (!isPlainObject(entry) || typeof entry["name"] !== "string" || typeof entry["roleCode"] !== "string") {
				delete units[key];
			}
		}
	}
	return {};
};

/**
 * v2 → v3: 新增 ledger/traffic/economy 子系统与 rooms[].worksites/units[].firstArrivedAt。
 * v2 数据 (tasks/units) 形状兼容 (新增字段全为可选), 原样保留;
 * 新子系统补默认空结构 (与 memorySchema 的安全空状态一致)。
 */
export const migrateV2ToV3: MigrationFn = (memory) => {
	const units = memory["units"];
	if (isPlainObject(units)) {
		for (const key of Object.keys(units)) {
			const entry = units[key];
			if (!isPlainObject(entry) || typeof entry["name"] !== "string" || typeof entry["roleCode"] !== "string") {
				delete units[key];
			}
		}
	}
	for (const key of ["ledger", "traffic", "economy"] as const) {
		if (!isPlainObject(memory[key])) {
			memory[key] = JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS[key]));
		}
	}
	return {};
};

/**
 * v3 → v4: global 扩展战略政策/目标/转移记录 (智械连结)。
 * v3 的 posture/lastStrategicTick 原样保留, 新字段补安全默认;
 * 形状损坏的 lastTransition 丢弃 (观测数据, 可弃)。
 */
export const migrateV3ToV4: MigrationFn = (memory) => {
	const globalRecord = memory["global"];
	if (!isPlainObject(globalRecord)) {
		// global 缺失/损坏由 bootstrap 子系统修复兜底
		return {};
	}
	if (!isPlainObject(globalRecord["policy"])) {
		globalRecord["policy"] = { ...SUBSYSTEM_DEFAULTS.global.policy };
	}
	if (!isPlainObject(globalRecord["goals"])) {
		globalRecord["goals"] = { ...SUBSYSTEM_DEFAULTS.global.goals };
	}
	if (typeof globalRecord["transitionCount"] !== "number" || !Number.isFinite(globalRecord["transitionCount"])) {
		globalRecord["transitionCount"] = 0;
	}
	const lastTransition = globalRecord["lastTransition"];
	if (
		lastTransition !== undefined &&
		(!isPlainObject(lastTransition) ||
			typeof lastTransition["from"] !== "string" ||
			typeof lastTransition["to"] !== "string" ||
			typeof lastTransition["at"] !== "number" ||
			typeof lastTransition["reason"] !== "string")
	) {
		delete globalRecord["lastTransition"];
	}
	return {};
};

/**
 * v4 → v5: 新增 defense 子系统 (SafeMode 簿记 + 战损统计) 与 rooms[].threat (可选字段)。
 * v4 数据形状兼容 (threat 缺省即无威胁), 只补 defense 默认空结构。
 */
export const migrateV4ToV5: MigrationFn = (memory) => {
	if (!isPlainObject(memory["defense"])) {
		memory["defense"] = JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.defense));
	}
	return {};
};

/**
 * v5 → v6: 新增 squads 编队子系统 (智能连结集群)。
 * v5 数据形状兼容 (编队为纯新增), 只补 squads 默认空结构;
 * 历史遗留的编队记录 (若存在) 逐条清洗: 缺 id/roomName 等必填字段的条目丢弃。
 */
export const migrateV5ToV6: MigrationFn = (memory) => {
	const squads = memory["squads"];
	if (!isPlainObject(squads)) {
		memory["squads"] = JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.squads));
		return {};
	}
	for (const key of Object.keys(squads)) {
		const entry = squads[key];
		if (
			!isPlainObject(entry) ||
			typeof entry["id"] !== "string" ||
			typeof entry["roomName"] !== "string" ||
			typeof entry["taskKind"] !== "string" ||
			!Array.isArray(entry["capabilities"])
		) {
			delete squads[key];
		}
	}
	return {};
};

/** 当前注册表: 索引 v-1 把 schemaVersion v 升到 v+1 */
export const MIGRATIONS: readonly MigrationFn[] = [
	migrateV1ToV2,
	migrateV2ToV3,
	migrateV3ToV4,
	migrateV4ToV5,
	migrateV5ToV6,
];
