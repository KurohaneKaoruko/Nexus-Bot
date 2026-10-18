/**
 * Demand Sources (任务 6.1, docs/Nexus-Bot-架构设计与重构指导 §16 / BUG-011):
 * spawnDirector 的编制/缺口侧职责收编——存活/在途计数、定编目标、四路需求源
 * (常驻编制/任务缺口/替补窗口/courier/bootstrap), 输出统一 SpawnRequest 池。
 * 本文件不做仲裁 (闸门/让位/预算等待归 spawnArbiter), 不触原生孵化 API。
 */
import type { TickContext } from "@/core";
import { roomModeFor } from "@/modules/strategy";
import { STAFFING_CONFIG } from "@/config/defense";
import { UNIT_CODES, unitCode } from "@/constant/UnitConstant";
import type { TaskBoard } from "@/modules/tasks";
import { activeRemoteHarvestCount, activeScoutCount } from "@/modules/economy";
import {
	isSpawnUnit,
	typicalSpawnTime,
	type SpawnUnit,
} from "@/modules/spawning/bodyFactory";
import { travelP95, droppedPileEnergy } from "@/modules/economy";
import {
	CARRY_STAFFING_CONFIG,
	REPLACEMENT_CONFIG,
	SPAWN_CONFIG,
} from "@/config/economy";
import {
	carrierCountTargetOf,
	harvestTimeSplitOf,
	harvesterTargetTotal,
	upgraderCountTargetOf,
} from "@/modules/economy";
import { maxThreatScore, threatTierOf } from "@/modules/defense";

// 引擎常量: 将死体判定 (CREEP_SPAWN_TIME) 用
declare const CREEP_LIFE_TIME: number;
declare const CREEP_SPAWN_TIME: number;

/** 代号 → 角色名 (名称解析出的 unitCode 是代号, 需还原为角色名) */
export function roleFromCode(code: string): SpawnUnit | undefined {
	const entry = Object.entries(UNIT_CODES).find(([, candidate]) => candidate === code);
	if (!entry) {
		return undefined;
	}
	const unitName = entry[0];
	return isSpawnUnit(unitName) ? unitName : undefined;
}

/** 任务类型 → 生产角色 */
export function unitForTaskKind(kind: string): SpawnUnit | undefined {
	switch (kind) {
		case "harvest":
			return "harvester";
		case "upgrade":
			return "upgrader";
		case "build":
		case "repair":
			return "worker";
		case "claim":
			return "claimer"; // 扩张占领件 [CLAIM,MOVE]: universal 无 CLAIM 部件领不了任务
		case "fill_spawn":
		case "haul":
			return "carrier";
		case "defend":
			return "defender";
		case "scout":
			return "scout";
		case "reserve":
			return "reserver"; // 外矿预订件: 未预订源容量减半
		default:
			return undefined;
	}
}

export interface SpawnRequest {
	unit: SpawnUnit;
	priority: number;
	purpose: string;
	/** 快递等按请求给定预算编译的角色 (缺省走容量/存量定档) */
	budget?: number;
}

/** 存活/在途角色计数 (staffed 的分母来源) */
export interface StaffingCount {
	aliveRoles: Map<string, number>;
	aliveTotal: number;
	inflightRoles: Map<string, number>;
	staffed: (unit: string) => number;
}

export function staffingCount(ctx: TickContext, spawns: StructureSpawn[]): StaffingCount {
	// 活体计数走 units 注册表而非视野快照: 侦察体/远程件出视野后仍在岗,
	// 视野口径数不到会无限补孵 (实服 20 只侦察体事故)。注册表由
	// spawnDirector 死亡回收逐 tick 对账, 与 Game.creeps 保持同步。
	// 键口径: 注册表存角色名 (spawnDirector 写入 request.unit), staffed
	// 查询用代号——经 unitCode() 归一, 与视野口径 (CreepSummary.unitCode
	// 为代号) 键空间对齐。
	//
	// 将死体剔除 (race-speedrun 任务2.2, 对齐 race bot manageUpgrade 口径):
	// ticksToLive ≤ 剩余孵化时间 (body.length × CREEP_SPAWN_TIME) 的单位不再
	// 计入在岗——否则其占编使替补请求因「staffed ≥ target」被拒, 替补要等
	// 尸体消失才发出, 加上孵化耗时形成人口空窗 (同龄批死亡潮放大器)。
	// 出视野的远程件拿不到 Game.creeps 条目, 保持计入 (保守口径)。
	const aliveRoles = new Map<string, number>();
	let aliveTotal = 0;
	for (const record of Object.values(ctx.memory.units)) {
		const code = unitCode(record.unitCode);
		const engineCreep = Game.creeps[record.name];
		if (
			engineCreep &&
			!engineCreep.spawning &&
			(engineCreep.ticksToLive ?? CREEP_LIFE_TIME) <=
				engineCreep.body.length * CREEP_SPAWN_TIME
		) {
			continue;
		}
		aliveRoles.set(code, (aliveRoles.get(code) ?? 0) + 1);
		aliveTotal += 1;
	}
	const inflightRoles = new Map<string, number>();
	for (const spawn of spawns) {
		const name = spawn.spawning?.name;
		const unit = name ? ctx.memory.units[name]?.unitCode : undefined;
		if (unit) {
			const code = unitCode(unit);
			inflightRoles.set(code, (inflightRoles.get(code) ?? 0) + 1);
		}
	}
	return {
		aliveRoles,
		aliveTotal,
		inflightRoles,
		staffed: (unit: string): number =>
			(aliveRoles.get(unitCode(unit)) ?? 0) + (inflightRoles.get(unit) ?? 0),
	};
}

/**
 * 各角色的目标编制基线 (specs/workforce-staffing 吞吐定编):
 * - upgrader: WORK 口径目标 (采集收入×档位倍率, 水位收缩/盈余/pile 取 max, 受饥饿
 *   负反馈与人口硬上限钳制) 按当前孵化体型折只——取代固定只数/produced EMA 口径;
 * - carrier: 运力下界 Σ(2×实测路程×速率)×冗余÷单件运力 (实测缺失回退每源 1 只);
 * - harvester/worker 等维持 count 基线 (采集饱和由攒能升体型承接, 建造定编留步 3 后评估)。
 * defender 编制 = 威胁分级映射, 和平为 0 不养常备军。
 */
export function unitTargets(ctx: TickContext, board: TaskBoard): Record<SpawnUnit, number> {
	const world = ctx.world.current;
	const rooms = world ? Object.values(world.rooms) : [];
	let sites = 0;
	let harvestStaffing = 0;
	let upgraderNeed = 0;
	let carrierNeed = 0;
	let pileBoost = 0;
	let reserverNeed = 0;
	const remoteHarvest = activeRemoteHarvestCount(ctx, board);
	const scoutNeed = activeScoutCount(ctx, board);
	for (const room of rooms) {
		sites += room.sites.length;
		// 源饱和口径实测分解: 逐房随定编同拍刷新 (P1-14 定位口径)
		harvestTimeSplitOf(ctx, room);
		harvestStaffing += harvesterTargetTotal(room);
		upgraderNeed += upgraderCountTargetOf(ctx, room);
		// 路程未实测 (开局) 回退每源 1 只保守基线, 不按猜测路程编队
		carrierNeed += carrierCountTargetOf(ctx, room) ?? room.sources.length;
		// 地面堆积加编 (race 语义): 堆积是搬运缺口最真实的信号——
		// pile > 1000 → +1, > 3000 → +2, 采集面快于搬运消耗时自适应补运力
		const pile = droppedPileEnergy(room);
		pileBoost += (pile > 3000 ? 2 : pile > 1000 ? 1 : 0);
	}
	// 外矿预订件定编: 活跃跨房 reserve 任务数 (预订完成即收编)
	reserverNeed = board
		.list({ kinds: ["reserve"], statuses: ["available", "leased", "in_progress"] })
		.filter((t) => t.targetPos?.roomName && t.targetPos.roomName !== t.roomName).length;
	return {
		harvester: Math.max(1, harvestStaffing + remoteHarvest),
		scout: scoutNeed,
		// universal: 常驻 1 只兜底 (bootstrap 通道另有硬保障)
		universal: 1,
		upgrader: Math.max(1, upgraderNeed),
		worker: Math.max(
			1,
			Math.min(
				SPAWN_CONFIG.workers.max,
				1 + Math.floor(sites / SPAWN_CONFIG.workers.sitesPerWorker),
			),
		),
		carrier: Math.max(1, carrierNeed + pileBoost),
		"rush-courier": 0,
		// 特化单位: 结构到位才激活 (RCL 门控短路, 避免低 RCL 每帧遍历)
		manager: rooms.some((r) => r.rcl >= 4 && r.stores.some((s) => s.structureType === "storage")) ? 1 : 0,
		// transporter 依赖 transport 任务池调度, 生产端无 storage/terminal 不产单
		// (UpdateTransportMission 开头短路)——门控对齐任务生产条件, 否则纯站桩空转
		transporter: rooms.some(
			(r) =>
				r.rcl >= 3 &&
				r.sites.length > 0 &&
				r.stores.some((s) => s.structureType === "storage"),
		) ? 1 : 0,
		miner: rooms.some((r) => r.rcl >= 6 && r.stores.some((s) => s.structureType === "container")) ? 1 : 0,
		defender: STAFFING_CONFIG.tierDefenders[
			threatTierOf(maxThreatScore(ctx.memory)) as "peace" | "low" | "high"
		],
		// 扩张占领件: 活跃 claim 任务时 1 只 (任务消失编制即收)
		claimer: board.list({ kinds: ["claim"] }).some((t) => t.status !== "completed") ? 1 : 0,
		// 外矿预订件: 活跃 reserve 任务数 (预订完成即收编)
		reserver: reserverNeed,
	};
}

/** 在岗 worker 计数 (units 注册表口径, 与 staffingCount 同源) */
function aliveWorkerCount(ctx: TickContext): number {
	let n = 0;
	for (const record of Object.values(ctx.memory.units)) {
		if (unitCode(record.unitCode) === UNIT_CODES.worker) n += 1;
	}
	return n;
}

/** worker 缺位建造紧急 (race 换班制语义): 工地积压且 worker 全灭——
 * cc/ext 不成则升级体长腿/容量锁死。开局豁免: 无 worker 出生史时不提级
 * (sim 实证开局 worker 插队打断 carrier 供能泵建立, 孵化节律 94t→268t),
 * 建造由 harvester 兼差 (allocator affinity) 承接 */
export function workerBuildCriticalOf(ctx: TickContext): boolean {
	let sites = 0;
	let workerEverBorn = false;
	for (const room of Object.values(ctx.world.current?.rooms ?? {})) {
		sites += room.sites.length;
	}
	for (const record of Object.values(ctx.memory.units)) {
		if (unitCode(record.unitCode) === UNIT_CODES.worker) {
			workerEverBorn = true;
			break;
		}
	}
	return sites > 0 && workerEverBorn && aliveWorkerCount(ctx) === 0;
}

/** 己方房最高 RCL */
function topRcl(ctx: TickContext): number {	let rcl = 0;
	for (const room of Object.values(ctx.world.current?.rooms ?? {})) {
		rcl = Math.max(rcl, room.rcl);
	}
	return rcl;
}

/** 诊断调整后的有效编制: carrier 乘运力乘数 (吞吐目标已由 workforce 现算, 不再有第二公式) */
export function effectiveTarget(ctx: TickContext, unit: SpawnUnit, targets: Record<SpawnUnit, number>): number {
	const base = targets[unit];
	const diagnosis = ctx.memory.economy.diagnosis;
	if (unit === "carrier") {
		const multiplierTarget = Math.round(base * diagnosis.carrierMultiplier);
		const rclCap = Math.min(
			CARRY_STAFFING_CONFIG.maxCarriers,
			CARRY_STAFFING_CONFIG.carriersPerRcl * Math.max(1, topRcl(ctx)),
		);
		return Math.max(CARRY_STAFFING_CONFIG.minCarriers, Math.min(rclCap, multiplierTarget));
	}
	if (unit === "upgrader") {
		return base + diagnosis.upgraderBonus;
	}
	return base;
}

/**
 * 替补提前量 (docs/nexus-design/07 §7.5): 生产时间 + 实测路程 P95 + 安全余量, 按单位名确定性抖动 ±jitterRatio
 * (bugs/P2-8: 同龄单位同拍进入替补窗口会成对孵化, 抖动使其错峰)。
 */
export function replacementLead(
	ctx: TickContext,
	unit: SpawnUnit,
	roomName: string,
	creepName: string,
): number {
	const spawnTime = typicalSpawnTime(unit);
	const base =
		spawnTime + travelP95(ctx, unit, roomName) + REPLACEMENT_CONFIG.setupMargin;
	// 错峰双通道 (race-speedrun D2): 乘性 jitter (±比例) + 加性离散窗口。
	// 窗口 = 批规模 × 生产周期 (单 spawn 串行吞吐), 同批 N 只的替补点按名哈希
	// 均匀落在 [base, base+窗口] 内; 窗口上限钳制在寿命的一半内——
	// lead 是「TTL 低于此值即触发」的阈值, 若 lead 可超过寿命, 单位从出生起
	// 永远处于替补窗口, 孵化队列被常驻替补请求淹没 (sim 实锤人口 23→8 平台下移)。
	// 同名恒定 (无随机源), sim 可复现。
	const windowCap = Math.floor(
		(CREEP_LIFE_TIME - base) * REPLACEMENT_CONFIG.disperseLifeShare,
	);
	const disperseWindow = Math.min(
		REPLACEMENT_CONFIG.disperseWindowFactor *
			REPLACEMENT_CONFIG.disperseCohortSize *
			spawnTime,
		windowCap,
	);
	const jittered = base * (1 + nameJitter(creepName));
	return Math.round(jittered + nameUnit01(creepName) * disperseWindow);
}

/** 名称哈希 → [-jitterRatio, +jitterRatio] 的确定性偏移 (同名恒定, 不引入随机源) */
function nameJitter(creepName: string): number {
	return (nameUnit01(creepName) * 2 - 1) * REPLACEMENT_CONFIG.jitterRatio;
}

/** 名称哈希 → [0,1) 确定性均匀值 (错峰取点共用, 同名恒定) */
function nameUnit01(creepName: string): number {
	let hash = 0;
	for (let i = 0; i < creepName.length; i += 1) {
		hash = (hash * 31 + creepName.charCodeAt(i)) | 0;
	}
	return (Math.abs(hash) % 1000) / 1000; // 0..1
}

/** roomModeFor 的 rush 判定 rush 档豁免用 */
export function anyRoomRush(ctx: TickContext): boolean {
	for (const room of Object.values(ctx.world.current?.rooms ?? {})) {
		if (roomModeFor(ctx, room.roomName) === "rush") {
			return true;
		}
	}
	return false;
}
