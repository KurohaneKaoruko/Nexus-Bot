/**
 * AgentSystem 取料/送货公共辅助 (api/06 §6.1): 任务提交封装、目标选择 (nearest* 族)
 * 与能量搬运决策。纯决策层, 全部提交走 ActionBroker, 不触碰原生 API。
 */
import type { TickContext } from "@/core";
import type {
	CreepSummary,
	EnergyStructureSummary,
	PileSummary,
	RoomObservation,
	SourceSummary,
	StoreSummary,
} from "@/core/world";
import type { ActionBroker, ActionKind, ActionPipeline } from "@/modules/agents/actionBroker";
import type { NexusTask } from "@/core/store/taskSchema";
import { ccUpgradeReserveOf, hasHungryUpgrader } from "@/modules/economy";
import { destinationQuotas } from "@/modules/economy";
import { CARRIER_BEHAVIOR_CONFIG } from "@/config/economy";
import { CARRY_CONFIG } from "@/config/economy";

export const RANGE_ADJACENT = 1;
export const RANGE_UPGRADE = 3;
export const RANGE_RANGED = 3;
export const RANGE_REPAIR = 3;

export function dist(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function submitAction(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	kind: Exclude<ActionKind, "move">,
	pipeline: Exclude<ActionPipeline, "move">,
	targetId: string,
): void {
	broker.submit({
		id: `${creep.name}-${kind}-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind,
		targetId,
		resourceType: RESOURCE_ENERGY,
		priority: task.priority,
		pipeline,
		dedupeKey: `${creep.name}:${pipeline}:${kind}:${task.id}`,
	});
}

/** 距离不足时只出移动计划, 不提交注定失败的作业调用 */
export function submitMoveOrAction(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	kind: Exclude<ActionKind, "move">,
	pipeline: Exclude<ActionPipeline, "move">,
	target: { id: string; x: number; y: number },
	range: number,
): void {
	if (dist(creep.x, creep.y, target.x, target.y) <= range) {
		submitAction(ctx, broker, creep, task, kind, pipeline, target.id);
		return;
	}
	submitMoveTo(ctx, broker, creep, task, target);
}

export function submitMoveTo(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	target: { x: number; y: number },
	reason = `${task.kind}-target`,
): void {
	broker.submit({
		id: `${creep.name}-move-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "move",
		targetPos: { x: target.x, y: target.y, roomName: task.roomName },
		priority: task.priority,
		pipeline: "move",
		reason,
		dedupeKey: `${creep.name}:move:${task.id}`,
	});
}

/** 原地卸货落地 (驻点矿工兜底): 能量成堆留在脚下, 由 carrier 认领 */
export function submitDrop(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
): void {
	broker.submit({
		id: `${creep.name}-drop-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "drop",
		resourceType: RESOURCE_ENERGY,
		priority: task.priority,
		pipeline: "carry",
		dedupeKey: `${creep.name}:carry:drop:${task.id}`,
	});
}

/**
 * 源旁直供链 (SOURCE_EXTENSION_CONFIG): 相邻有空位的 extension 顺手直填。
 * 模式无关的通用行为——有相邻空位就填; 配合布局的源旁 ring-2 ext,
 * 驻点矿工成为泵: harvest (work 管线) 与 transfer (carry 管线) 同 tick 并行。
 * 返回是否提交了直填意图。
 */
export function submitAdjacentExtensionFill(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): boolean {
	let best: EnergyStructureSummary | undefined;
	let bestFree = -1;
	for (const structure of room.energyStructures) {
		if (structure.structureType !== "extension") {
			continue;
		}
		const free = structure.energyCapacity - structure.energy;
		if (free <= 0) {
			continue;
		}
		if (dist(creep.x, creep.y, structure.x, structure.y) > RANGE_ADJACENT) {
			continue;
		}
		if (free > bestFree) {
			best = structure;
			bestFree = free;
		}
	}
	if (!best) {
		return false;
	}
	submitAction(ctx, broker, creep, task, "transfer", "carry", best.id);
	return true;
}

function nearestFreeEnergyStructure(
	room: RoomObservation,
	x: number,
	y: number,
	/** 兜底白名单 (specs/controller-supply-line): 只投配额目的地; 缺省为全量 */
	allowedIds?: Set<string>,
): EnergyStructureSummary | undefined {
	let best: EnergyStructureSummary | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const structure of room.energyStructures) {
		if (structure.energy >= structure.energyCapacity) {
			continue;
		}
		if (allowedIds && !allowedIds.has(structure.id)) {
			continue;
		}
		const d = dist(x, y, structure.x, structure.y);
		if (d < bestDist) {
			best = structure;
			bestDist = d;
		}
	}
	return best;
}

export function nearestPile(
	room: RoomObservation,
	x: number,
	y: number,
	anchor?: { x: number; y: number },
): PileSummary | undefined {
	let best: PileSummary | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const pile of room.piles) {
		const score = fetchScore(x, y, pile, anchor);
		if (score < bestScore) {
			best = pile;
			bestScore = score;
		}
	}
	return best;
}

/** 取货点锚定评分: 空载路程 + (可选) 载货路程 —— 升级工取离 controller 更近的货源 (bugs/P1-4) */
function fetchScore(
	x: number,
	y: number,
	target: { x: number; y: number },
	anchor: { x: number; y: number } | undefined,
): number {
	return (
		dist(x, y, target.x, target.y) + (anchor ? dist(target.x, target.y, anchor.x, anchor.y) : 0)
	);
}

function nearestStore(
	ctx: TickContext,
	room: RoomObservation,
	x: number,
	y: number,
	anchor?: { x: number; y: number },
): StoreSummary | undefined {
	// cc 水位排他 (specs/controller-supply-line): cc 是两级物流的交换枢纽, 高于
	// 升级保底水位时向孵化线开放; 低于保底时排他——否则升级工断粮
	// (同 universal 防御: 防"取出又补回"假死循环)
	const ccId = room.controllerBuffer?.id;
	const ccOpen =
		ccId === undefined ||
		(room.stores.find((store) => store.id === ccId)?.energy ?? 0) >=
			ccUpgradeReserveOf(ctx, room);
	let best: StoreSummary | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const store of room.stores) {
		if (store.energy <= 0 || (store.id === ccId && !ccOpen)) {
			continue;
		}
		const score = fetchScore(x, y, store, anchor);
		if (score < bestScore) {
			best = store;
			bestScore = score;
		}
	}
	return best;
}

function nearestSource(room: RoomObservation, x: number, y: number): SourceSummary | undefined {
	let best: SourceSummary | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const source of room.sources) {
		const d = dist(x, y, source.x, source.y);
		if (d < bestDist) {
			best = source;
			bestDist = d;
		}
	}
	return best;
}

/** 供能结构兜底取料点: 库存高于保障线的最近 spawn/extension——工地/升级圈常贴着供能区,
 *  远 piles 的取料腿是沼泽房建造吞吐的黑洞 (bugs/P1-14) */
function nearestEnergyStructureAboveFloor(
	room: RoomObservation,
	x: number,
	y: number,
	floorRatioOverride?: number,
): EnergyStructureSummary | undefined {
	let best: EnergyStructureSummary | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	const ratio = floorRatioOverride ?? CARRY_CONFIG.structureFloorRatio;
	for (const structure of room.energyStructures) {
		if (structure.energy < structure.energyCapacity * ratio) {
			continue;
		}
		const score = dist(x, y, structure.x, structure.y);
		if (score < bestScore) {
			best = structure;
			bestScore = score;
		}
	}
	return best;
}

/** 空载取货: 容器/落地优先, 否则就近采源; anchor 给定时按「空载+载货」总路程选点 (bugs/P1-4) */
/** 取料目标存在性判定 (满载迟滞的源枯竭出口): 与 fetchEnergy 的级联同源 */
export function hasFetchTarget(
	ctx: TickContext,
	room: RoomObservation,
	creep: CreepSummary,
	fromId?: string,
): boolean {
	if (fromId) {
		if (room.piles.some((p) => p.id === fromId)) return true;
		if (room.stores.some((s) => s.id === fromId && s.energy > 0)) return true;
		// 原生结构兜底: link/terminal 取货点 (fetchEnergy 同口径), 部分装载不误判枯竭
		const native = Game.getObjectById(fromId as Id<AnyStoreStructure>);
		if (native && "store" in native && (native.store[RESOURCE_ENERGY] ?? 0) > 0) return true;
		return false;
	}
	if (nearestStore(ctx, room, creep.x, creep.y)) return true;
	if (nearestPile(room, creep.x, creep.y)) return true;
	if (nearestEnergyStructureAboveFloor(room, creep.x, creep.y)) return true;
	if (creep.bodyWork > 0 && nearestSource(room, creep.x, creep.y)) return true;
	return false;
}

export function fetchEnergy(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
	fromId?: string,
	anchor?: { x: number; y: number },
): void {
	if (fromId) {
		const pile = room.piles.find((p) => p.id === fromId);
		if (pile) {
			submitMoveOrAction(ctx, broker, creep, task, "pickup", "carry", pile, RANGE_ADJACENT);
			return;
		}
		const store = room.stores.find((s) => s.id === fromId);
		if (store) {
			submitMoveOrAction(ctx, broker, creep, task, "withdraw", "carry", store, RANGE_ADJACENT);
			return;
		}
		// 原生结构兜底 (specs/mission-pool-retirement manage 行): link/terminal 不在
		// 感知快照 stores 内, 但 link 调拨/terminal 平衡任务的取货点就是它们——
		// 提交阶段按 id 直读原生房 (与 planner 消费 Game.rooms 同先例)
		const native = Game.getObjectById(fromId as Id<AnyStoreStructure>);
		if (native && "store" in native) {
			const energy = native.store[RESOURCE_ENERGY] ?? 0;
			if (energy > 0) {
				submitMoveOrAction(
					ctx,
					broker,
					creep,
					task,
					"withdraw",
					"carry",
					{ id: native.id, x: native.pos.x, y: native.pos.y },
					RANGE_ADJACENT,
				);
			}
		}
		return;
	}
	const store = nearestStore(ctx, room, creep.x, creep.y, anchor);
	if (store) {
		submitMoveOrAction(ctx, broker, creep, task, "withdraw", "carry", store, RANGE_ADJACENT);
		return;
	}
	const pile = nearestPile(room, creep.x, creep.y, anchor);
	if (pile) {
		submitMoveOrAction(ctx, broker, creep, task, "pickup", "carry", pile, RANGE_ADJACENT);
		return;
	}
	// 供能结构兜底: 库存高于保障线的 spawn/extension 可作取料点 (短腿建造/升级)。
	// 孵化需求在线时收紧 (E24): fill_spawn 与兜底取能构成「取出又补回」循环
	// (carrier 喂 spawn → 就近单位抽走 → 孵化能量恒低水位, sim 实证开局 384 次
	// withdraw spawn 同量 transfer 回填, race 对照取能只认容器/落地/源)。
	// 有孵化缺口时只有满仓结构才可抽 (高线), 无缺口时维持原保障线。
	const spawnDemand = room.energyStructures.some(
		(structure) => structure.energy < structure.energyCapacity,
	);
	const energyStructure =
		spawnDemand ?
			nearestEnergyStructureAboveFloor(room, creep.x, creep.y, 1)
		:	nearestEnergyStructureAboveFloor(room, creep.x, creep.y);
	if (energyStructure) {
		submitMoveOrAction(
			ctx,
			broker,
			creep,
			task,
			"withdraw",
			"carry",
			energyStructure,
			RANGE_ADJACENT,
		);
		return;
	}
	// 就地采集兜底仅对有 WORK 部件的单位开放 (carrier 采源必然失败)
	if (creep.bodyWork > 0) {
		const source = nearestSource(room, creep.x, creep.y);
		if (source) {
			submitMoveOrAction(ctx, broker, creep, task, "harvest", "work", source, RANGE_ADJACENT);
		}
	}
}

/** 满载送货 (carrier 专用): 配额目的地优先; 无目的地或已满时就近缺能供能结构 */
export function deliverEnergy(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): void {
	// 手填闭环勘误 (2026-10-15): 匹配结果 (energyLogistics.getAssignedEnergyTarget)
	// 此前仅被退役的旧角色路径消费, 活路径投递只认结构。直接接活会让专线阶段
	// 吸干孵化线运力 (arena 40k 不进 L3, docs/bugs sim-audit-10-12 (七))——
	// 升级工供能修复需与匹配器两阶段结构同套设计, 单点接活已证伪, 保持关闭。
	if (task.destId) {
		const dest =
			room.energyStructures.find((structure) => structure.id === task.destId) ??
			room.towers.find((tower) => tower.id === task.destId) ??
			room.stores.find((store) => store.id === task.destId);
		if (dest && dest.energy < dest.energyCapacity) {
			submitMoveOrAction(ctx, broker, creep, task, "transfer", "carry", dest, RANGE_ADJACENT);
			return;
		}
		// 原生结构兜底 (specs/mission-pool-retirement manage 行): link (中心调拨
		// 补货方向的目的地) 不在快照交付面内, 按 id 直读原生房
		if (task.resourceType === RESOURCE_ENERGY || task.resourceType === undefined) {
			const native = Game.getObjectById(task.destId as Id<AnyStoreStructure>);
			if (native && "store" in native) {
				const free = native.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
				if (free > 0) {
					submitMoveOrAction(
						ctx,
						broker,
						creep,
						task,
						"transfer",
						"carry",
						{ id: native.id, x: native.pos.x, y: native.pos.y },
						RANGE_ADJACENT,
					);
					return;
				}
			}
		}
	}
	// 兜底收窄 (specs/controller-supply-line): 就近缺能结构 → 只在当 Tick 配额目的地
	// 集合内挑选; 无配额可投则原地等待 (持能零损耗), 不投非配额结构与账本承诺错位
	const bias = ctx.memory.economy.diagnosis.quotaFloorBias;
	const quotas = destinationQuotas(ctx, room, bias);
	const quotaIds = new Set(quotas.map((d) => d.id));
	// C1 顺路灌注 (specs/controller-supply-line): 满载途经相邻配额目的地 (非任务
	// 目的地) 就地交付——移动腿转化为交付腿; 配额集合是唯一交付事实源
	if (CARRIER_BEHAVIOR_CONFIG.enrouteTopup) {
		const topup = quotas.find(
			(d) =>
				d.id !== task.destId && dist(creep.x, creep.y, d.x, d.y) <= RANGE_ADJACENT,
		);
		if (topup) {
			submitAction(ctx, broker, creep, task, "transfer", "carry", topup.id);
			return;
		}
	}
	const target = nearestFreeEnergyStructure(room, creep.x, creep.y, quotaIds);
	if (target) {
		submitMoveOrAction(ctx, broker, creep, task, "transfer", "carry", target, RANGE_ADJACENT);
		return;
	}
	// C2 溢流落堆闸 (specs/controller-supply-line): 无可投目的地 + cc 在位 + 升级圈
	// 饥饿 → 走到 cc 位落堆 (升级工拾取路径承接); 无饥饿消费者持能待命 (零损耗)
	const buffer = room.controllerBuffer;
	if (
		CARRIER_BEHAVIOR_CONFIG.overflowDrop &&
		buffer &&
		hasHungryUpgrader(room) &&
		pileEnergyAt(room, buffer.x, buffer.y) < CARRIER_BEHAVIOR_CONFIG.overflowDropMaxPile
	) {
		if (dist(creep.x, creep.y, buffer.x, buffer.y) <= RANGE_ADJACENT) {
			submitDrop(ctx, broker, creep, task);
		} else {
			submitMoveTo(ctx, broker, creep, task, buffer, "cc-overflow-buffer");
		}
	}
}

/** cc 位置邻近落地堆的能量总额 (溢流落堆闸的堆规模口径) */
function pileEnergyAt(room: RoomObservation, x: number, y: number): number {
	let total = 0;
	for (const pile of room.piles) {
		if (Math.max(Math.abs(pile.x - x), Math.abs(pile.y - y)) <= 1) {
			total += pile.amount;
		}
	}
	return total;
}
