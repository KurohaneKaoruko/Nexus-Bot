/**
 * Memory.Nexus 引导 (docs/nexus-design/04 §4.4 迁移流程):
 *   缺失 → 初始化最小结构; 版本不可识别/迁移抛错 → 整体重建;
 *   单级迁移声明损坏子系统 → 仅重置该子系统; 版本超前 (代码回滚) → 保留新数据降级运行。
 * 幂等: 当前版本且子系统完好时零写入、直接返回。
 */
import type { Logger } from "@/core/logger";
import {
	CURRENT_SCHEMA_VERSION,
	SUBSYSTEM_DEFAULTS,
	SUBSYSTEM_KEYS,
	type NexusMemory,
} from "@/core/store/memorySchema";
import { MIGRATIONS, type MigrationFn, type RawNexus } from "@/core/store/migrations";

export interface BootstrapDeps {
	/** 原生 Memory 根对象 (游戏内) 或等价 stand-in (测试) */
	memory: Record<string, unknown>;
	tick: number;
	logger: Logger;
	/** 缺省 MIGRATIONS; 测试可注入 */
	migrations?: readonly MigrationFn[];
	/** 缺省 CURRENT_SCHEMA_VERSION; 测试可注入 */
	currentVersion?: number;
}

function createMinimal(currentVersion: number, tick: number): NexusMemory {
	return {
		schemaVersion: currentVersion,
		global: { ...SUBSYSTEM_DEFAULTS.global, lastStrategicTick: tick },
		rooms: {},
		tasks: {},
		units: {},
		ledger: JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.ledger)),
		traffic: JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.traffic)),
		economy: JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.economy)),
		defense: JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS.defense)),
		squads: {},
		spawn: { ...SUBSYSTEM_DEFAULTS.spawn },
		layout: { rooms: {} },
		metrics: { ...SUBSYSTEM_DEFAULTS.metrics },
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVersion(raw: RawNexus): number | null {
	const version = raw["schemaVersion"];
	return typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : null;
}

/** 轻校验各子系统, 损坏的隔离重置为安全空状态; 返回被重置的子系统名 */
function repairSubsystems(raw: RawNexus, tick: number, logger: Logger): string[] {
	const repaired: string[] = [];
	for (const key of SUBSYSTEM_KEYS) {
		if (!isPlainObject(raw[key])) {
			// 默认值均为纯 JSON, 用 JSON 克隆避免依赖运行时 structuredClone
			raw[key] = JSON.parse(JSON.stringify(SUBSYSTEM_DEFAULTS[key]));
			if (key === "global") {
				(raw["global"] as { lastStrategicTick: number }).lastStrategicTick = tick;
			}
			repaired.push(key);
		}
	}
	if (repaired.length > 0) {
		logger.warn("memory.repair", `tick ${tick}: 重置损坏子系统 ${repaired.join(", ")}`);
	}
	return repaired;
}

function bumpMigrationCount(memory: RawNexus): void {
	const metrics = memory["metrics"];
	if (isPlainObject(metrics) && typeof metrics["migrationCount"] === "number") {
		metrics["migrationCount"] += 1;
	}
}

export function calibrateNexus(deps: BootstrapDeps): NexusMemory {
	const { memory, tick, logger } = deps;
	const migrations = deps.migrations ?? MIGRATIONS;
	const currentVersion = deps.currentVersion ?? CURRENT_SCHEMA_VERSION;

	const raw = memory["Nexus"];

	// 1. 缺失 → 初始化当前 schema 的最小有效结构
	if (!isPlainObject(raw)) {
		const fresh = createMinimal(currentVersion, tick);
		memory["Nexus"] = fresh;
		return fresh;
	}

	// 2. 版本不可识别 → 整体重建 (安全空状态), 限频告警
	const version = readVersion(raw);
	if (version === null) {
		logger.warn(
			"memory.bootstrap",
			`tick ${tick}: Memory.Nexus 无法识别 schemaVersion, 重建为 v${currentVersion}`,
		);
		const fresh = createMinimal(currentVersion, tick);
		memory["Nexus"] = fresh;
		return fresh;
	}

	// 3. 版本超前: 代码被回滚但 Memory 是新格式 —— 保留新数据, 轻校验后降级运行, 不销毁
	if (version > currentVersion) {
		logger.warn(
			"memory.bootstrap",
			`tick ${tick}: Memory.Nexus v${version} 超前于代码 v${currentVersion}, 降级运行`,
		);
		repairSubsystems(raw, tick, logger);
		return raw as unknown as NexusMemory;
	}

	// 4. 当前版本 → 幂等短路, 仅做子系统轻校验
	if (version === currentVersion) {
		repairSubsystems(raw, tick, logger);
		return raw as unknown as NexusMemory;
	}

	// 5. 逐版本迁移; 完成后写入当前版本, 后续 Tick 不再迁移
	let work = raw;
	try {
		for (let v = version; v < currentVersion; v += 1) {
			const migration = migrations[v - 1];
			if (!migration) {
				throw new Error(`缺少 v${v} -> v${v + 1} 迁移函数`);
			}
			const outcome = migration(work);
			if (outcome.resetSubsystems) {
				for (const key of outcome.resetSubsystems) {
					if ((SUBSYSTEM_KEYS as readonly string[]).includes(key)) {
						work[key] = JSON.parse(
							JSON.stringify(SUBSYSTEM_DEFAULTS[key as keyof typeof SUBSYSTEM_DEFAULTS]),
						);
						logger.warn("memory.migrate", `tick ${tick}: v${v} 迁移重置子系统 ${key}`);
					}
				}
			}
			work["schemaVersion"] = v + 1;
		}
	} catch (err) {
		logger.warn(
			"memory.bootstrap",
			`tick ${tick}: 迁移失败 (${String(err)}), 重建为 v${currentVersion}`,
		);
		const fresh = createMinimal(currentVersion, tick);
		memory["Nexus"] = fresh;
		return fresh;
	}
	bumpMigrationCount(work);
	repairSubsystems(work, tick, logger);
	memory["Nexus"] = work;
	return work as unknown as NexusMemory;
}
