/**
 * 低频经济模型 (docs/nexus-design/06 §6.7/§6.8):
 * 每 Tick O(小) 累加器 (快照差分 + Broker 结果回填), 每诊断窗口 (P2 门控) 跑瓶颈诊断;
 * 诊断结论 (运力乘数/配额下限偏移/升级加成) 由 SpawnDirector 与配额消费, 调整带迟滞;
 * 实测路程样本 (bornAt→首次到岗) 也在此维护, 供替补窗口使用 (docs/nexus-design/07 §7.5)。
 */
import { ECONOMY_MODEL_CONFIG, REPLACEMENT_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import { busySpawnCount } from "@/modules/spawning/spawningRoster";

import type { WorldView } from "@/core/world";
import { decayHotspots } from "@/modules/movement/trafficMonitor";
import { foldRates, recordDelivery, recordProduction, updateHungerVitals } from "@/modules/economy/ledger";
import type { ActionResult } from "@/modules/agents";

/* ── 实测路程样本 (替补窗口) ── */

function travelKey(unit: string, roomName: string): string {
	return `${unit}:${roomName}`;
}

/** 记录一次 bornAt→首次到岗 的实测路程 (窗口有界, 写入时重算 P95) */
export function recordTravelSample(
	ctx: TickContext,
	unit: string,
	roomName: string,
	ticks: number,
): void {
	if (ticks < 0 || !Number.isFinite(ticks)) {
		return;
	}
	const key = travelKey(unit, roomName);
	const entry = ctx.memory.economy.travel[key] ?? {
		samples: [],
		p95: REPLACEMENT_CONFIG.travelFallback,
	};
	entry.samples.push(ticks);
	if (entry.samples.length > REPLACEMENT_CONFIG.travelSampleWindow) {
		entry.samples.shift();
	}
	const sorted = [...entry.samples].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
	entry.p95 = sorted[index]!;
	ctx.memory.economy.travel[key] = entry;
}

/** unit+room 的路程 P95; 样本不足回退配置估算 */
export function travelP95(ctx: TickContext, unit: string, roomName: string): number {
	return (
		ctx.memory.economy.travel[travelKey(unit, roomName)]?.p95 ?? REPLACEMENT_CONFIG.travelFallback
	);
}

/* ── 每 Tick 累加器 ── */

function totalStock(ctx: TickContext, world: WorldView): number {
	let total = 0;
	for (const room of Object.values(world.rooms)) {
		for (const structure of room.energyStructures) {
			total += structure.energy;
		}
		for (const store of room.stores) {
			total += store.energy;
		}
		for (const pile of room.piles) {
			total += pile.amount;
		}
		for (const creep of room.creeps) {
			total += creep.carryEnergy;
		}
	}
	return total;
}

/** 每 Tick O(小) 累加: spawn 闲置 / 关键结构缺货 / 搬运工占比 / 库存净变化 */
export function accumulateTick(ctx: TickContext, world: WorldView): void {
	const accumulators = ctx.memory.economy.accumulators;
	let idleSpawns = 0;
	if (typeof Game !== "undefined") {
		// spawn 忙闲统计走统一接口 (6.3): 判据单源
		idleSpawns = Math.max(0, Object.keys(Game.spawns).length - busySpawnCount());
	}
	accumulators.spawnIdleTicks += idleSpawns;

	// 饥饿口径只看 spawn: spawn 为空 = 孵化链断供 (真饥饿)。ext 空位是涓流期
	// 常态——按「任一能量结构为 0」计数时, ext 越多越容易误判, 基建改善反而
	// 触发 survive 姿态暂停生产角色 (sim 实锤: ext 建成后 starvation 140>100
	// 误触发, 种群塌方)。
	for (const room of Object.values(world.rooms)) {
		if (room.energyStructures.some((structure) => structure.structureType === "spawn" && structure.energy === 0)) {
			accumulators.starvationTicks += 1;
		}
	}
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			if (creep.unitCode !== "C") {
				continue;
			}
			if (Game.creeps[creep.name]?.memory.taskId !== undefined) {
				accumulators.haulBusyTicks += 1;
			} else {
				accumulators.haulIdleTicks += 1;
			}
		}
	}

	const total = totalStock(ctx, world);
	accumulators.energyStockDelta += total - ctx.memory.economy.lastStockTotal;
	ctx.memory.economy.lastStockTotal = total;
	ctx.memory.economy.lastStockTick = ctx.tick;
	// 饥饿生命体征 (specs/resource-ledger): 与 starvation 累加器同拍维护, 有界
	updateHungerVitals(ctx, world);
}

/** Broker 提交结果回填账本速率: harvest 产出 (work×2/tick), transfer 交付 (按携带量) */
export function recordActionRates(ctx: TickContext, results: readonly ActionResult[]): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const result of results) {
		if (result.kind !== "harvest" && result.kind !== "transfer") {
			continue;
		}
		let creep;
		for (const room of Object.values(world.rooms)) {
			const found = room.creeps.find((candidate) => candidate.name === result.actorName);
			if (found) {
				creep = found;
				break;
			}
		}
		if (!creep || !result.accepted) {
			continue;
		}
		if (result.kind === "harvest") {
			recordProduction(ctx, creep.roomName, creep.bodyWork * 2);
		} else {
			recordDelivery(ctx, creep.roomName, creep.carryEnergy);
		}
	}
}

/* ── 低频诊断 ── */

/** 诊断是否到点 (预算门控由调用方的 canRun 决定) */
function dueForDiagnosis(ctx: TickContext): boolean {
	return ctx.tick - ctx.memory.economy.diagnosis.updatedAt >= ECONOMY_MODEL_CONFIG.diagnosisPeriod;
}

/**
 * 瓶颈诊断 (docs/nexus-design/06 §6.7): 比较生产/交付/库存 → 分类 → 调整目标;
 * 同窗口最多调整一次 (迟滞天然成立); 累加器读取后清零。
 */
export function diagnose(ctx: TickContext, world: WorldView): void {
	if (!dueForDiagnosis(ctx)) {
		return;
	}
	const config = ECONOMY_MODEL_CONFIG;
	const economy = ctx.memory.economy;
	const accumulators = economy.accumulators;

	let production = 0;
	let delivery = 0;
	let sourceCount = 0;
	for (const room of Object.values(world.rooms)) {
		const rates = ctx.memory.ledger.rates[room.roomName];
		production += rates?.produced.ema ?? 0;
		delivery += rates?.delivered.ema ?? 0;
		sourceCount += room.sources.length;
		foldRates(ctx, room.roomName);
	}

	const starved = accumulators.starvationTicks;
	const stock = economy.lastStockTotal;
	const sitesOpen = Object.values(world.rooms).some((room) => room.sites.length > 0);

	if (production > 0 && delivery < production * config.transportDeficitRatio && starved === 0) {
		// 采集多交付少 → 优先补运力, 而非增加矿工
		economy.diagnosis.bottleneck = "transport";
		economy.diagnosis.carrierMultiplier = Math.min(
			config.carrierMultiplierMax,
			economy.diagnosis.carrierMultiplier * config.carrierMultiplierStep,
		);
	} else if (starved > config.starvationTicksThreshold && stock > config.surplusStockAmount) {
		// 库存高但关键结构缺货 → 目的地错配, 抬高配额保障线
		economy.diagnosis.bottleneck = "destination";
		economy.diagnosis.quotaFloorBias = Math.min(0.3, economy.diagnosis.quotaFloorBias + 0.1);
	} else if (stock > config.surplusStockAmount && starved === 0 && !sitesOpen) {
		// 生产过剩且无收益目标 → 劳动力转向升级
		economy.diagnosis.bottleneck = "surplus";
		economy.diagnosis.upgraderBonus = 1;
	} else {
		economy.diagnosis.bottleneck = "none";
		// 无瓶颈时缓步回落, 避免一次性撤销全部调整
		economy.diagnosis.upgraderBonus = 0;
		economy.diagnosis.quotaFloorBias = Math.max(0, economy.diagnosis.quotaFloorBias - 0.1);
		economy.diagnosis.carrierMultiplier = Math.max(
			config.carrierMultiplierMin,
			economy.diagnosis.carrierMultiplier / config.carrierMultiplierStep,
		);
	}
	economy.diagnosis.updatedAt = ctx.tick;

	// 累加器清零 (指标窗口即诊断窗口) + 热点衰减
	accumulators.spawnIdleTicks = 0;
	accumulators.starvationTicks = 0;
	accumulators.haulBusyTicks = 0;
	accumulators.haulIdleTicks = 0;
	accumulators.energyStockDelta = 0;
	decayHotspots(ctx);
}

/* ── 指标观察 (docs/nexus-design/06 §6.8) ── */

export interface EconomyIndicators {
	/** 窗口内能源净变化 */
	energyNetDelta: number;
	/** Spawn 闲置 tick */
	spawnIdleTicks: number;
	/** 关键结构缺货 tick */
	criticalStructureStarvation: number;
	/** 搬运工忙碌占比 (0..1), 无样本时 -1 */
	haulUtilization: number;
	/** 采集实际产出对理论产能比例 (0..∞), 无源时 -1 */
	sourceHarvestEfficiency: number;
	/** 预留与可用库存比值 */
	reservedVsAvailable: number;
	/** 超龄强制回收累计 (预留泄漏告警, >0 即有泄漏发生过) */
	overdueReclaimed: number;
	/** 当前饥饿房间: 房名 → { 链路, 持续 tick, 缺口 } (有界, 每房一条) */
	hunger: Record<string, { kind: string; duration: number; deficit: number }>;
	updatedAt: number;
}

/** §6.8 指标快照 (HUD/控制台查询用) */
export function economyIndicators(ctx: TickContext): EconomyIndicators {
	const accumulators = ctx.memory.economy.accumulators;
	const world = ctx.world.current;
	let production = 0;
	let sourceCount = 0;
	let reserved = 0;
	let stock = 0;
	if (world) {
		for (const room of Object.values(world.rooms)) {
			production += ctx.memory.ledger.rates[room.roomName]?.produced.ema ?? 0;
			sourceCount += room.sources.length;
			stock += room.energyStructures.reduce((sum, structure) => sum + structure.energy, 0);
		}
	}
	for (const reservation of Object.values(ctx.memory.ledger.reservations)) {
		reserved += reservation.amount;
	}
	const haulSamples = accumulators.haulBusyTicks + accumulators.haulIdleTicks;
	const hunger: EconomyIndicators["hunger"] = {};
	for (const [roomName, vitals] of Object.entries(ctx.memory.ledger.hunger)) {
		hunger[roomName] = {
			kind: vitals.kind,
			duration: ctx.tick - vitals.sinceTick,
			deficit: vitals.deficit,
		};
	}
	return {
		energyNetDelta: accumulators.energyStockDelta,
		spawnIdleTicks: accumulators.spawnIdleTicks,
		criticalStructureStarvation: accumulators.starvationTicks,
		haulUtilization: haulSamples > 0 ? accumulators.haulBusyTicks / haulSamples : -1,
		sourceHarvestEfficiency: sourceCount > 0 ? production / (sourceCount * 10) : -1,
		reservedVsAvailable: stock > 0 ? reserved / stock : 0,
		overdueReclaimed: ctx.memory.ledger.overdueCount,
		hunger,
		updatedAt: ctx.memory.economy.lastStockTick,
	};
}

/** 经济模型运行体: 逐 tick 累加 (随模块 P1) + 到期诊断 (内部 P2 子门控, 预算紧张时降级跳过) */
export function runEconomyModel(ctx: TickContext): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	accumulateTick(ctx, world);
	if (dueForDiagnosis(ctx)) {
		if (ctx.cpu.canRun("economy-model-diagnosis", "P2")) {
			diagnose(ctx, world);
		} else {
			ctx.cpu.recordSkip("economy-model-diagnosis", "budget");
		}
	}
}
