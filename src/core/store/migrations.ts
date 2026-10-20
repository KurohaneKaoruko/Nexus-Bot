/**
 * Memory.Nexus 逐版本迁移注册表 (docs/nexus-design/04 §4.4)。
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
			if (
				!isPlainObject(entry) ||
				typeof entry["dedupeKey"] !== "string" ||
				typeof entry["kind"] !== "string"
			) {
				delete tasks[key];
			}
		}
	}
	const units = memory["units"];
	if (isPlainObject(units)) {
		for (const key of Object.keys(units)) {
			const entry = units[key];
			if (
				!isPlainObject(entry) ||
				typeof entry["name"] !== "string" ||
				typeof entry["unitCode"] !== "string"
			) {
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
			if (
				!isPlainObject(entry) ||
				typeof entry["name"] !== "string" ||
				typeof entry["unitCode"] !== "string"
			) {
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
	if (
		typeof globalRecord["transitionCount"] !== "number" ||
		!Number.isFinite(globalRecord["transitionCount"])
	) {
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

/**
 * v6 → v7: 新增 spawn 簿记子系统 (bootstrap 空转计数) 与 rooms[].lostAt (失守记录, 可选字段)。
 * v6 数据形状兼容 (lostAt 缺省即未失守), 只补 spawn 默认结构。
 */
export const migrateV6ToV7: MigrationFn = (memory) => {
	if (!isPlainObject(memory["spawn"])) {
		memory["spawn"] = JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.spawn));
	}
	return {};
};

/**
 * v7 → v8: 新增 layout 子系统 (房间布局记录表)。纯新增, 无旧数据改写。
 */
export const migrateV7ToV8: MigrationFn = (memory) => {
	if (!isPlainObject(memory["layout"]) || !isPlainObject(memory["layout"]["rooms"])) {
		memory["layout"] = { rooms: {} };
	}
	return {};
};

/**
 * v8 → v9: 新增 rooms[].mode (房间运行模式) 与 rooms[].raceVerdict (冲级判废快照, 均可选)。
 * 缺省不回填——解析器按默认规则兜底; 防御性清洗: 值不合法的历史条目删除该字段。
 */
export const migrateV8ToV9: MigrationFn = (memory) => {
	const rooms = memory["rooms"];
	if (isPlainObject(rooms)) {
		const validModes = new Set(["low", "main", "high", "rush"]);
		for (const key of Object.keys(rooms)) {
			const entry = rooms[key];
			if (!isPlainObject(entry)) {
				continue;
			}
			const mode = entry["mode"];
			if (mode !== undefined && (typeof mode !== "string" || !validModes.has(mode))) {
				delete entry["mode"];
			}
			const verdict = entry["raceVerdict"];
			if (
				verdict !== undefined &&
				(!isPlainObject(verdict) ||
					(verdict["failedSegment"] !== undefined && typeof verdict["failedSegment"] !== "number"))
			) {
				delete entry["raceVerdict"];
			}
		}
	}
	return {};
};

/**
 * v9 → v10: 新增 rooms[].sourceTiming / upgradersStarved / spawnBalanceEma
 * (specs/workforce-staffing 吞吐定编的持久输入, 均可选)。
 * 缺省不回填——首采/首记时写入; 防御性清洗: 形状不合法的历史条目删除该字段。
 */
export const migrateV9ToV10: MigrationFn = (memory) => {
	const rooms = memory["rooms"];
	if (isPlainObject(rooms)) {
		for (const key of Object.keys(rooms)) {
			const entry = rooms[key];
			if (!isPlainObject(entry)) {
				continue;
			}
			const timing = entry["sourceTiming"];
			if (timing !== undefined) {
				if (!isPlainObject(timing)) {
					delete entry["sourceTiming"];
				} else {
					for (const sourceId of Object.keys(timing)) {
						const value = timing[sourceId];
						if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
							delete timing[sourceId];
						}
					}
				}
			}
			const starved = entry["upgradersStarved"];
			if (
				starved !== undefined &&
				(!isPlainObject(starved) ||
					typeof starved["amount"] !== "number" ||
					typeof starved["tick"] !== "number")
			) {
				delete entry["upgradersStarved"];
			}
			const ema = entry["spawnBalanceEma"];
			if (ema !== undefined && (typeof ema !== "number" || !Number.isFinite(ema))) {
				delete entry["spawnBalanceEma"];
			}
		}
	}
	return {};
};

/** 迁移期单编队槽位数上限: 防坏数据放大, 与 CLUSTER_CONFIG.maxSlotsPerSquad 同量级 */
const MAX_SLOT_COUNT_PER_SQUAD = 64;

/**
 * v10 → v11: 新增 rooms[].harvestSplit 源饱和实测分解 (可选, 缺省不回填);
 * `SquadRecord.slots` 由数量标量升级为异构槽位定义数组——旧标量 N 展开为与原编队
 * taskKind/capabilities 一致的同质槽位 (specs/squad-heterogeneous-slots
 * 「槽位结构变更向后兼容」)。`expiresAt`/`members` 不动, 保持续期语义与在编成员;
 * 坏条目回退安全空槽位数组而非抛错, 保证迁移不中断。迁移幂等。
 */
export const migrateV10ToV11: MigrationFn = (memory) => {
	const rooms = memory["rooms"];
	if (isPlainObject(rooms)) {
		for (const key of Object.keys(rooms)) {
			const entry = rooms[key];
			if (!isPlainObject(entry)) {
				continue;
			}
			const split = entry["harvestSplit"];
			if (split === undefined) {
				continue;
			}
			if (!isPlainObject(split)) {
				delete entry["harvestSplit"];
				continue;
			}
			for (const sourceId of Object.keys(split)) {
				const rec = split[sourceId];
				if (
					!isPlainObject(rec) ||
					typeof rec["atSource"] !== "number" ||
					typeof rec["transit"] !== "number" ||
					typeof rec["waiting"] !== "number"
				) {
					delete split[sourceId];
				}
			}
		}
	}

	const squads = memory["squads"];
	if (isPlainObject(squads)) {
		for (const id of Object.keys(squads)) {
			const squad = squads[id];
			if (!isPlainObject(squad)) {
				continue;
			}
			const taskKind = typeof squad["taskKind"] === "string" ? squad["taskKind"] : "defend";
			const caps = Array.isArray(squad["capabilities"])
				? squad["capabilities"].filter((c: unknown) => typeof c === "string")
				: [];
			const slots = squad["slots"];
			if (Array.isArray(slots)) {
				// 已是数组: 仅防御性清洗非法项, 保持幂等
				squad["slots"] = slots
					.filter(
						(s: unknown) =>
							isPlainObject(s) &&
							typeof s["taskKind"] === "string" &&
							Array.isArray(s["capabilities"]) &&
							typeof s["count"] === "number" &&
							(s["count"] as number) > 0,
					)
					.map((s: Record<string, unknown>) => ({
						taskKind: s["taskKind"] as string,
						capabilities: (s["capabilities"] as unknown[]).filter(
							(c: unknown) => typeof c === "string",
						) as string[],
						count: Math.min(
							MAX_SLOT_COUNT_PER_SQUAD,
							Math.floor(s["count"] as number),
						),
					}));
				continue;
			}
			// 旧标量: N 展开为单个同质槽位定义 (count=N)
			const count =
				typeof slots === "number" && Number.isFinite(slots) && slots > 0
					? Math.min(MAX_SLOT_COUNT_PER_SQUAD, Math.floor(slots))
					: 0;
			squad["slots"] = count > 0 ? [{ taskKind, capabilities: caps, count }] : [];
		}
	}
	return {};
};

/**
 * v11 → v12: 新增 `ownership` 子系统 (api/16 actor-ownership 任务 2.2):
 * 跨 Tick 持久所有权索引, 旧 Memory 无此键 → 引导为安全空状态
 * (spec: 内存兼容——旧 Memory 不产生未迁移字段错误, 机制从空状态引导)。
 * 坏条目 (owner 非串/expiresAt 非数) 逐条剔除; 子系统级损坏重置。
 * 迁移幂等。
 */
export const migrateV11ToV12: MigrationFn = (memory) => {
	const ownership = memory["ownership"];
	if (ownership === undefined) {
		return {};
	}
	if (
		!isPlainObject(ownership) ||
		!isPlainObject(ownership["actors"])
	) {
		memory["ownership"] = { indexVersion: 1, actors: {} };
		return { resetSubsystems: ["ownership"] };
	}
	const actors = ownership["actors"] as Record<string, unknown>;
	for (const [name, entry] of Object.entries(actors)) {
		if (
			!isPlainObject(entry) ||
			typeof entry["owner"] !== "string" ||
			typeof entry["expiresAt"] !== "number"
		) {
			delete actors[name];
		}
	}
	return {};
};

/**
 * v12 → v13: 账本五态分账 (specs/resource-ledger 任务 7.1/7.2/7.4):
 * ledger 新增 hunger / consumedTotal / overdueCount 子键,
 * rates 各房补 consumed 速率位; 预留 createdAt 为可选字段, 不回填
 * (缺省记录不做超龄判定, 首次 reserve 起带年龄)。迁移幂等。
 */
export const migrateV12ToV13: MigrationFn = (memory) => {
	const ledger = memory["ledger"];
	if (ledger === undefined) {
		return {};
	}
	if (!isPlainObject(ledger)) {
		return { resetSubsystems: ["ledger"] };
	}
	ledger["hunger"] ??= {};
	ledger["consumedTotal"] ??= {};
	ledger["overdueCount"] ??= 0;
	const rates = ledger["rates"];
	if (isPlainObject(rates)) {
		for (const entry of Object.values(rates)) {
			if (isPlainObject(entry) && !isPlainObject(entry["consumed"])) {
				entry["consumed"] = { accumulated: 0, ema: 0, lastFoldTick: 0 };
			}
		}
	}
	return {};
};

/**
 * v13 → v14: 搬运任务词表统一为 carry (与 carrier 单位/搬运语义对齐)。
 * 旧 haul 任务不迁移: planner 下一 Tick 即按新键重建, 直接剔除避免新旧双份;
 * 经济诊断累加器 haulBusyTicks/haulIdleTicks 改名并保留窗口计数。迁移幂等。
 */
export const migrateV13ToV14: MigrationFn = (memory) => {
	const tasks = memory["tasks"];
	if (isPlainObject(tasks)) {
		for (const [id, entry] of Object.entries(tasks)) {
			if (!isPlainObject(entry) || entry["kind"] === "haul") {
				delete tasks[id];
			}
		}
	}
	const economy = memory["economy"];
	if (isPlainObject(economy)) {
		const accumulators = economy["accumulators"];
		if (isPlainObject(accumulators)) {
			if (
				accumulators["carryBusyTicks"] === undefined &&
				typeof accumulators["haulBusyTicks"] === "number"
			) {
				accumulators["carryBusyTicks"] = accumulators["haulBusyTicks"];
			}
			if (
				accumulators["carryIdleTicks"] === undefined &&
				typeof accumulators["haulIdleTicks"] === "number"
			) {
				accumulators["carryIdleTicks"] = accumulators["haulIdleTicks"];
			}
			delete accumulators["haulBusyTicks"];
			delete accumulators["haulIdleTicks"];
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
	migrateV6ToV7,
	migrateV7ToV8,
	migrateV8ToV9,
	migrateV9ToV10,
	migrateV10ToV11,
	migrateV11ToV12,
	migrateV12ToV13,
	migrateV13ToV14,
];
