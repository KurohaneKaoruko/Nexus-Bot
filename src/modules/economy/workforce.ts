/**
 * 房间劳动力吞吐定编 (specs/workforce-staffing):
 * 以 WORK/CARRY 能力口径取代固定只数——升级火力按采集收入现算 (水位收缩/盈余加码/
 * 落地堆清理各项取 max), 折只时受 RCL 人口硬上限钳制; 搬运编制按运力下界公式
 * Σ(2×路程×速率)×冗余÷单件运力 现算; 采集收入按在岗 WORK 单一事实口径;
 * 升级饥饿记账负反馈收缩编制 (惰性衰减)。
 * 与参照实现的口径差异 (主线架构适配, 见 openspec workforce-logistics design D1):
 * - 让位闸门只保留保级窗口语义 (主线降级走 DOWNGRADE 紧急通道, 不归零升级);
 * - rush 净收入折旧口径未移植 (miner/hauler 折旧模型属外矿步), 以毛收入×EMA 乘数近似;
 * - 源定编的多采集位窗口不移植 (主线 worksite 单座语义, 饱和由攒能升体型承接)。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { NexusTask } from "@/core/store/taskSchema";
import type { HarvestSplitRecord } from "@/core/store/memorySchema";
import { CARRY_STAFFING_CONFIG, REPLACEMENT_CONFIG, WORKFORCE_CONFIG } from "@/config/economy";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { roomModeProfileFor } from "@/modules/strategy";
import { buildBody } from "@/modules/spawning";
import { destinationQuotas } from "@/modules/economy/quota";
import { activeRemoteSourceCount } from "@/modules/economy/remoteMining";
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";

const HARVEST_POWER = 2;
const ENERGY_REGEN_TIME = 300;

/** 活跃 (非孵化) 采集体的 bodyWork, 其余单位不计 */
function activeHarvesterWork(creep: RoomObservation["creeps"][number]): number {
	if (creep.spawning || creep.unitCode !== UNIT_CODES.harvester) {
		return 0;
	}
	return creep.bodyWork;
}

/**
 * 源 → 绑定采集 WORK 绑定表: harvest 任务租约优先 (assignedTo → 快照 bodyWork),
 * 租约缺失时回退「驻点在位」启发 (采集体站在 worksite 上)。
 */
export function harvesterBindingOf(
	ctx: TickContext,
	room: RoomObservation,
): Map<string, number> {
	const bound = new Map<string, number>();
	const worksites = ctx.memory.rooms[room.roomName]?.worksites;
	for (const source of room.sources) {
		bound.set(source.id, 0);
	}
	for (const task of Object.values(ctx.memory.tasks) as NexusTask[]) {
		if (
			task.kind !== "harvest" ||
			task.roomName !== room.roomName ||
			!task.targetId ||
			(task.status !== "leased" && task.status !== "in_progress") ||
			!task.assignedTo
		) {
			continue;
		}
		const creep = room.creeps.find((c) => c.name === task.assignedTo);
		const work = creep ? activeHarvesterWork(creep) : 0;
		if (work > 0) {
			bound.set(task.targetId, (bound.get(task.targetId) ?? 0) + work);
		}
	}
	// 驻点在位兜底: 无租约 (冷却期/刚换代) 但矿工钉在工位上的真实采集
	if (worksites) {
		for (const creep of room.creeps) {
			if (activeHarvesterWork(creep) <= 0) {
				continue;
			}
			for (const [sourceId, site] of Object.entries(worksites)) {
				if (creep.x === site.x && creep.y === site.y) {
					bound.set(sourceId, (bound.get(sourceId) ?? 0) + activeHarvesterWork(creep));
				}
			}
		}
	}
	return bound;
}

/** 采集收入 (能量/tick): Σ 每源 min(源再生口径上限, 绑定 WORK × 采集功率)——定编与诊断的单一事实 */
export function harvestIncomeOf(ctx: TickContext, room: RoomObservation): number {
	const bound = harvesterBindingOf(ctx, room);
	let income = 0;
	for (const source of room.sources) {
		const capPerTick = source.energyCapacity / ENERGY_REGEN_TIME;
		income += Math.min(capPerTick, (bound.get(source.id) ?? 0) * HARVEST_POWER);
	}
	return income;
}

/**
 * 含外矿折算的采集收入 (升级定编口径, bugs (十二)): 本矿实测 + 活跃远程源数 ×
 * 单源再生上限 (SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME)。远程源无本地绑定
 * 数据 (跨房), 按满采上限折算——升级定编用它是保守上界, 不会因外矿断供而超编。
 */
export function harvestIncomeWithRemoteOf(ctx: TickContext, room: RoomObservation): number {
	const remoteSources = activeRemoteSourceCount(ctx, room.roomName);
	if (remoteSources <= 0) return harvestIncomeOf(ctx, room);
	const sourceCap = 3000 / ENERGY_REGEN_TIME; // SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME (远程源满采上限折算)
	return harvestIncomeOf(ctx, room) + remoteSources * sourceCap;
}

// ==================== 源饱和口径实测分解 ====================

/**
 * 按源记录采集工时间去向 (specs harvest-supply-convergence「源饱和口径实测分解」):
 * 在源 / 往返 / 等待 三类占比的 EMA。收入未达饱和时, 该分解是定位「时间花在何处」
 * 的证据口径 (docs/bugs P1-14 结论: 差距在采集工在源时间占比, 不在单体体型旋钮)。
 *
 * 定长存储: 每源三项, 随源增减而非随 tick 增长。
 */
export function harvestTimeSplitOf(
	ctx: TickContext,
	room: RoomObservation,
): Map<string, HarvestSplitRecord> {
	const cfg = WORKFORCE_CONFIG.harvestSplit;
	const intel = ctx.memory.rooms[room.roomName];
	const out = new Map<string, HarvestSplitRecord>();
	if (!intel) {
		return out;
	}

	// 源 → 在编采集体名 (租约优先, 无租约时回退驻点在位启发, 与收入口径同源)
	const bound = harvesterBindingOf(ctx, room);
	const bySource = new Map<string, string[]>();
	for (const task of Object.values(ctx.memory.tasks) as NexusTask[]) {
		if (task.kind !== "harvest" || task.roomName !== room.roomName || !task.targetId || !task.assignedTo) {
			continue;
		}
		if (task.status !== "leased" && task.status !== "in_progress") {
			continue;
		}
		const list = bySource.get(task.targetId);
		if (list) {
			list.push(task.assignedTo);
		} else {
			bySource.set(task.targetId, [task.assignedTo]);
		}
	}
	const sites = intel.worksites;
	if (sites) {
		for (const creep of room.creeps) {
			if (creep.spawning || creep.unitCode !== UNIT_CODES.harvester) {
				continue;
			}
			if (bySource.get(creep.name)) {
				continue;
			}
			for (const [sourceId, site] of Object.entries(sites)) {
				if (creep.x === site.x && creep.y === site.y) {
					const list = bySource.get(sourceId);
					if (list) {
						list.push(creep.name);
					} else {
						bySource.set(sourceId, [creep.name]);
					}
					break;
				}
			}
		}
	}

	const alpha = 1 - 2 ** (-1 / cfg.emaTicks);
	const record = intel.harvestSplit ?? {};
	for (const source of room.sources) {
		// 无在编采集工时不写入 EMA: 缺失即「无人采集」, 避免零占比污染证据口径
		if ((bound.get(source.id) ?? 0) <= 0) {
			continue;
		}
		const names = bySource.get(source.id) ?? [];
		let atSource = 0;
		let waiting = 0;
		for (const name of names) {
			const creep = room.creeps.find((c) => c.name === name);
			if (!creep) {
				continue;
			}
			const near =
				Math.max(Math.abs(creep.x - source.x), Math.abs(creep.y - source.y)) <= cfg.sourceRange;
			if (near) {
				// 源枯竭时在位不产出, 记为等待而非在源采集
				if (source.energy > 0) {
					atSource += 1;
				} else {
					waiting += 1;
				}
			}
			// 其余计入往返 (不在源旁即在路上/在交付)
		}
		const total = Math.max(1, names.length);
		const prev = record[source.id] ?? { atSource: 1, transit: 0, waiting: 0 };
		const next: HarvestSplitRecord = {
			atSource: prev.atSource + (atSource / total - prev.atSource) * alpha,
			transit: prev.transit + ((total - atSource - waiting) / total - prev.transit) * alpha,
			waiting: prev.waiting + (waiting / total - prev.waiting) * alpha,
		};
		record[source.id] = next;
		out.set(source.id, next);
	}

	// 清理消失的源: 记录随源增减, 不随 tick 增长 (specs 存储有界)
	for (const sourceId of Object.keys(record)) {
		if (!room.sources.some((s) => s.id === sourceId)) {
			delete record[sourceId];
		}
	}
	intel.harvestSplit = record;
	return out;
}

/** 储备水位 (storage+terminal 口径): 存量 < 标准线按百分比, 超线后每 surplusStep 折 1 点 */
export function energyLevelOf(room: RoomObservation): number {
	const config = WORKFORCE_CONFIG.upgrade;
	const standard = config.standardReserveByRcl[room.rcl] ?? 10000;
	let total = 0;
	for (const store of room.stores) {
		if (store.structureType === "storage" || store.structureType === "terminal") {
			total += store.energy;
		}
	}
	if (total < standard) {
		return Math.floor((100 * total) / standard);
	}
	return 100 + Math.round((total - standard) / config.surplusStep);
}

/** 地面掉落能量总额 (≥100 才计入): 采集快于搬运消耗的直接信号 */
function droppedPileEnergy(room: RoomObservation): number {
	let total = 0;
	for (const pile of room.piles) {
		if (pile.amount >= 100) {
			total += pile.amount;
		}
	}
	return total;
}

// ==================== 升级饥饿负反馈 ====================

/** 惰性衰减读数: 按流逝 tick 每点 −1, 不依赖固定调用频率 */
export function upgradersStarvedOf(ctx: TickContext, roomName: string): number {
	const record = ctx.memory.rooms[roomName]?.upgradersStarved;
	if (!record || record.amount <= 0) {
		return 0;
	}
	const decayed = Math.max(0, record.amount - Math.max(0, ctx.tick - record.tick));
	const intel = ctx.memory.rooms[roomName];
	if (intel) {
		intel.upgradersStarved = { amount: decayed, tick: ctx.tick };
	}
	return decayed;
}

/**
 * 升级取能落空记账 (行为层在「cc 空 + 工位旁无堆」时调用):
 * 保级窗口与满级房豁免——升级是保命项时不收缩。
 */
export function registerUpgraderStarve(ctx: TickContext, room: RoomObservation): void {
	const config = WORKFORCE_CONFIG.starved;
	const controller = room.controller;
	if (!controller || room.rcl >= config.skipAtRcl) {
		return;
	}
	if ((controller.ticksToDowngrade ?? Infinity) < WORKFORCE_CONFIG.upgrade.neededTtd) {
		return;
	}
	const decayed = upgradersStarvedOf(ctx, room.roomName);
	const intel = ctx.memory.rooms[room.roomName];
	if (!intel) {
		return;
	}
	const increment = Math.max(1, Math.floor(room.rcl / config.levelDivisor));
	intel.upgradersStarved = {
		amount: Math.min(config.max, decayed + increment),
		tick: ctx.tick,
	};
}

/** 缩编: starved>0 缩一轮、超二轮阈值再缩一轮 (每轮 ×系数 −1), 下限 1 只升级体产能 */
function shrinkByStarved(ctx: TickContext, roomName: string, demandWork: number, floorWork: number): number {
	const config = WORKFORCE_CONFIG.starved;
	const starved = upgradersStarvedOf(ctx, roomName);
	if (starved <= 0) {
		return demandWork;
	}
	let shrunk = Math.round(demandWork * config.shrinkFactor) - 1;
	if (starved > config.secondStage) {
		shrunk = Math.round(shrunk * config.shrinkFactor) - 1;
	}
	return Math.max(Math.min(floorWork, demandWork), shrunk);
}

// ==================== 升级 WORK 口径目标 ====================

/**
 * 升级侧目标 WORK 总数 (specs/workforce-staffing):
 * 收入跟踪项 (水位收缩/满吃/盈余) + 盈余消耗项 + 落地堆清理项取 max,
 * 受无缓冲收紧上限与模式下限约束; rush 档以供需 EMA 乘数浮动 (饥饿 −1 / 物流闲置 +1)。
 */
export function upgradeWorkTargetOf(ctx: TickContext, room: RoomObservation): number {
	const config = WORKFORCE_CONFIG.upgrade;
	const controller = room.controller;
	if (!controller) {
		return 0;
	}
	// 吞吐上限: RCL8 固定; 无 cc 收紧; 有 cc 全额 (link 几何封顶留待 RCL5+ 链路)
	const capacity = room.rcl >= 8
		? config.rcl8WorkCap
		: room.controllerBuffer
			? config.bufferedWorkCap
			: config.noBufferWorkCap;

	const ttd = controller.ticksToDowngrade ?? Infinity;
	const upgradeNeeded = ttd < config.neededTtd;
	const level = energyLevelOf(room);
	// 升级定编收入口径含外矿折算 (bugs (十二)): 外矿收入是冲级期升级火力的
	// 直接供给, 不计则外矿起量后升级定编反被本地口径锁死
	const income = harvestIncomeWithRemoteOf(ctx, room);

	// RCL1: 固定小队起步 (保级窗口恒保底)
	if (room.rcl < 2) {
		return Math.min(config.rcl1WorkFloor, Math.max(capacity, upgradeNeeded ? config.neededWorkFloor : 0));
	}
	// RCL8: 满级房只在确有富余或保级风险时维持编制
	if (room.rcl >= 8) {
		return upgradeNeeded || level >= config.rcl8ActiveLevel
			? Math.min(capacity, config.rcl8WorkCap)
			: 0;
	}
	const lowerLimit = upgradeNeeded ? config.neededWorkFloor : 0;
	const profile = roomModeProfileFor(ctx, room.roomName);

	// —— 收入跟踪项 (档位倍率统一由模式参数表给出) ——
	const scaledIncome = income * profile.upgradeIncomeMultiplier;
	let incomeWork: number;
	if (!room.stores.some((s) => s.structureType === "storage" || s.structureType === "terminal")) {
		// 无仓期: 周转能量在 container 里水位看不见, 全额跟收入不收缩
		incomeWork = scaledIncome;
	} else if (level < config.throttleLevel) {
		incomeWork = (scaledIncome * Math.max(level, config.throttleLevelFloorPct)) / 100;
	} else if (level > config.surplusLevel) {
		incomeWork = scaledIncome + (level - config.throttleLevel);
	} else {
		incomeWork = scaledIncome;
	}
	incomeWork = Math.ceil(incomeWork);

	// —— 盈余消耗项 + 落地堆清理项 ——
	const surplusWork = Math.max(0, level - config.throttleLevel);
	const pileWork = Math.ceil(droppedPileEnergy(room) / config.pileWorkDivisor);
	const floorWork = Math.max(1, workPerUpgraderBody(ctx, room.roomName));

	// —— rush 档: 供需 EMA 乘数 (饥饿压过富余), 底火 5 WORK, 上限放宽到控制器工位 ——
	if (profile.name === "rush") {
		const intel = ctx.memory.rooms[room.roomName];
		if (intel) {
			const signal = upgradersStarvedOf(ctx, room.roomName) > 0
				? -1
				: logisticsIdleSignal(ctx, room)
					? 1
					: 0;
			const alpha = 1 - 2 ** (-1 / WORKFORCE_CONFIG.rushEma.timeConstant);
			const prev = intel.spawnBalanceEma ?? 0;
			const ema = Math.max(-1, Math.min(1, prev * (1 - alpha) + signal * alpha));
			intel.spawnBalanceEma = ema;
			const multiplier = Math.max(
				WORKFORCE_CONFIG.rushEma.multiplierMin,
				Math.min(WORKFORCE_CONFIG.rushEma.multiplierMax, ema / 2 + WORKFORCE_CONFIG.rushEma.baseline),
			);
			// pile 项不进 rush 升级定编 (主线升级体钉工位不捡堆, 落地能量由
				// carrier 货源管线消化; 50k 校准实锤 pile 项是升级体膨胀的正反馈炸弹)
			const rushWork = Math.ceil(scaledIncome * multiplier);
			const slotCap = room.controllerBuffer ? room.controllerBuffer.slots.length : 0;
			const rushCapacity = Math.max(capacity, slotCap);
			return Math.max(
				Math.max(lowerLimit, config.neededWorkFloor),
				Math.min(rushCapacity, Math.max(rushWork, surplusWork)),
			);
		}
	}

	const demand = Math.max(incomeWork, surplusWork, pileWork);
	return Math.max(lowerLimit, Math.min(capacity, shrinkByStarved(ctx, room.roomName, demand, floorWork)));
}

/** 物流闲置信号 (+1): 配额表无缺口且有载货搬运体——运力富余可加码升级 */
function logisticsIdleSignal(ctx: TickContext, room: RoomObservation): boolean {
	const bias = ctx.memory.economy.diagnosis.quotaFloorBias;
	const demand = destinationQuotas(ctx, room, bias);
	if (demand.length > 0) {
		return false;
	}
	return room.creeps.some(
		(creep) => !creep.spawning && creep.unitCode === UNIT_CODES.carrier && creep.carryEnergy > 0,
	);
}

/** 当前孵化口径下单只升级体的 WORK 数 (与孵化侧同一体型事实源) */
export function workPerUpgraderBody(ctx: TickContext, roomName: string): number {
	const capacity = roomCapacity(ctx, roomName);
	const body = buildBody("upgrader", capacity);
	let work = 0;
	for (const part of body ?? []) {
		if (part === WORK) {
			work += 1;
		}
	}
	return Math.max(1, work);
}

/** 升级体只数目标: WORK 目标按单只 WORK 折算, 受 RCL 人口硬上限钳制 (上限即吞吐上限) */
export function upgraderCountTargetOf(ctx: TickContext, room: RoomObservation): number {
	const config = WORKFORCE_CONFIG.upgrade;
	const workTarget = upgradeWorkTargetOf(ctx, room);
	if (workTarget <= 0) {
		return 0;
	}
	const perBody = workPerUpgraderBody(ctx, room.roomName);
	const popCap = config.upgraderPopCapByRcl[room.rcl] ?? 6;
	return Math.max(1, Math.min(popCap, Math.ceil(workTarget / perBody)));
}

/**
 * cc 升级保底水位 (能量): 低于该值时 cc 对通用取能排他 (升级底线保护),
 * 高于该值时作为交换枢纽向孵化线开放——两级物流 (源→cc→消费者) 与升级底线兼得。
 */
export function ccUpgradeReserveOf(ctx: TickContext, room: RoomObservation): number {
	if (!room.controllerBuffer) {
		return 0;
	}
	const reserveTicks = CONTROLLER_BUFFER_CONFIG.spawnGateBufferTicks;
	return workPerUpgraderBody(ctx, room.roomName) * HARVEST_POWER * reserveTicks;
}

// ==================== 搬运运力定编 ====================

/** 当前孵化口径下单只搬运体的 CARRY 容量 (能量) */
export function carryCapacityPerBody(ctx: TickContext, roomName: string): number {
	return carryPartsPerBody(ctx, roomName) * CARRY_CAPACITY;
}

/** 当前孵化口径下单只搬运体的 CARRY 部件数 (运力公式分母是部件口径, 勿与容量混用) */
export function carryPartsPerBody(ctx: TickContext, roomName: string): number {
	const capacity = roomCapacity(ctx, roomName);
	const body = buildBody("carrier", capacity);
	let parts = 0;
	for (const part of body ?? []) {
		if (part === CARRY) {
			parts += 1;
		}
	}
	return Math.max(1, parts);
}

/**
 * 搬运体只数目标 (specs/workforce-staffing 运力下界):
 * Σ(源采集速率 × 2 × 实测单程路程) × 冗余 ÷ 单件运力, 向上取整;
 * 任一源路程未实测 → 返回 null (调用方回退保守基线, 不按猜测路程编队)。
 */
export function carrierCountTargetOf(ctx: TickContext, room: RoomObservation): number | null {
	const timing = ctx.memory.rooms[room.roomName]?.sourceTiming;
	if (!timing) {
		return null;
	}
	const partsPerBody = carryPartsPerBody(ctx, room.roomName);
	const bound = harvesterBindingOf(ctx, room);
	let carryNeed = 0;
	for (const source of room.sources) {
		const pathTime = timing[source.id];
		if (typeof pathTime !== "number" || pathTime <= 0) {
			return null;
		}
		const capPerTick = source.energyCapacity / ENERGY_REGEN_TIME;
		const rate = Math.min(capPerTick, (bound.get(source.id) ?? 0) * HARVEST_POWER);
		if (rate <= 0) {
			continue;
		}
		carryNeed += (rate * 2 * pathTime) / CARRY_CAPACITY;
	}
	if (carryNeed <= 0) {
		return null;
	}
	return Math.ceil((carryNeed * CARRY_STAFFING_CONFIG.throughputFactor) / partsPerBody);
}

/**
 * 控制器专线服务只数 (specs/controller-supply-line):
 * 升级 WORK × 往返路程折算所需运力 ÷ 单件运力, 向上取整;
 * cc 缺位归零 (由断供升级工的快递/手填口径承接)。
 */
export function controllerCarryQuotaOf(ctx: TickContext, room: RoomObservation): number {
	const buffer = room.controllerBuffer;
	if (!buffer) {
		return 0;
	}
	const upgradeWork = upgraderCountTargetOf(ctx, room) * workPerUpgraderBody(ctx, room.roomName);
	if (upgradeWork <= 0) {
		return 0;
	}
	const timing = ctx.memory.rooms[room.roomName]?.sourceTiming;
	let pathTime = 0;
	if (timing) {
		for (const value of Object.values(timing)) {
			pathTime = Math.max(pathTime, value);
		}
	}
	if (pathTime <= 0) {
		pathTime = REPLACEMENT_CONFIG.travelFallback;
	}
	const perBody = carryCapacityPerBody(ctx, room.roomName);
	if (perBody <= 0) {
		return 0;
	}
	const carryNeedEnergy = 2 * upgradeWork * pathTime;
	return Math.ceil(carryNeedEnergy / perBody);
}

/** 房间孵化容量: 优先本房 spawn 口径, 无 spawn 房回退 300 (最小容量档) */
function roomCapacity(_ctx: TickContext, roomName: string): number {
	return Game.rooms[roomName]?.energyCapacityAvailable ?? 300;
}
