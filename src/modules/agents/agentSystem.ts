/**
 * AgentSystem (api/06 §6.1): 读取已分配任务, 为每只 Creep 产出本 Tick 的行动提案。
 * 只做决策与范围判断 (基于快照坐标), 不触碰原生 API; 提交统一走 ActionBroker。
 * 取货/送货阶段由 Creep 自身负载推导, 不额外维护状态机。
 */
import type { TickContext } from "@/core/tickContext";
import type {
	CreepSummary,
	EnergyStructureSummary,
	PileSummary,
	RoomObservation,
	SourceSummary,
	StoreSummary,
} from "@/core/world";
import type { ActionBroker, ActionKind, ActionPlan, ActionPipeline } from "@/modules/agents/actionBroker";
import type { NexusTask } from "@/store/taskSchema";
import type { TaskBoard } from "@/modules/tasks/board";
import { atWorksite } from "@/modules/world/worksite";
import { clearBlocked, congestionAction } from "@/modules/movement/trafficMonitor";
import { recordTravelSample } from "@/modules/economy/model";
import { COMBAT_CONFIG, RETREAT_CONFIG } from "@/config/defense";
import { rankHostiles } from "@/modules/defense/threatModel";

const RANGE_ADJACENT = 1;
const RANGE_UPGRADE = 3;
const RANGE_RANGED = 3;
const RANGE_REPAIR = 3;

function dist(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function submitAction(
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
function submitMoveOrAction(
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

function submitMoveTo(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	target: { x: number; y: number },
): void {
	broker.submit({
		id: `${creep.name}-move-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "move",
		targetPos: { x: target.x, y: target.y, roomName: creep.roomName },
		priority: task.priority,
		pipeline: "move",
		dedupeKey: `${creep.name}:move:${task.id}`,
	});
}

/** 原地卸货落地 (驻点矿工兜底): 能量成堆留在脚下, 由 carrier 认领 */
function submitDrop(ctx: TickContext, broker: ActionBroker, creep: CreepSummary, task: NexusTask): void {
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

function nearestFreeEnergyStructure(
	room: RoomObservation,
	x: number,
	y: number,
): EnergyStructureSummary | undefined {
	let best: EnergyStructureSummary | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const structure of room.energyStructures) {
		if (structure.energy >= structure.energyCapacity) {
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

function nearestPile(
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
	return dist(x, y, target.x, target.y) + (anchor ? dist(target.x, target.y, anchor.x, anchor.y) : 0);
}

function nearestStore(
	room: RoomObservation,
	x: number,
	y: number,
	anchor?: { x: number; y: number },
): StoreSummary | undefined {
	let best: StoreSummary | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const store of room.stores) {
		if (store.energy <= 0) {
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

/** 空载取货: 容器/落地优先, 否则就近采源; anchor 给定时按「空载+载货」总路程选点 (bugs/P1-4) */
function fetchEnergy(
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
		return;
	}
	const store = nearestStore(room, creep.x, creep.y, anchor);
	if (store) {
		submitMoveOrAction(ctx, broker, creep, task, "withdraw", "carry", store, RANGE_ADJACENT);
		return;
	}
	const pile = nearestPile(room, creep.x, creep.y, anchor);
	if (pile) {
		submitMoveOrAction(ctx, broker, creep, task, "pickup", "carry", pile, RANGE_ADJACENT);
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
function deliverEnergy(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): void {
	if (task.destId) {
		const dest =
			room.energyStructures.find((structure) => structure.id === task.destId) ??
			room.towers.find((tower) => tower.id === task.destId) ??
			room.stores.find((store) => store.id === task.destId);
		if (dest && dest.energy < dest.energyCapacity) {
			submitMoveOrAction(ctx, broker, creep, task, "transfer", "carry", dest, RANGE_ADJACENT);
			return;
		}
	}
	const target = nearestFreeEnergyStructure(room, creep.x, creep.y);
	if (target) {
		submitMoveOrAction(ctx, broker, creep, task, "transfer", "carry", target, RANGE_ADJACENT);
	}
}

function runCreep(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): void {
	switch (task.kind) {
		case "harvest": {
			const source = room.sources.find((s) => s.id === task.targetId);
			if (!source) {
				return;
			}
			const worksite = ctx.memory.rooms[room.roomName]?.worksites?.[source.id];
			if (worksite && !atWorksite(creep, worksite)) {
				// 驻点未到: 工作位必然与 Source 相邻, 先钉在固定驻点
				submitMoveTo(ctx, broker, creep, task, worksite);
				return;
			}
			// 首次到岗采样: bornAt→firstArrivedAt 即实测路程 (替补窗口用)
			const unit = ctx.memory.units[creep.name];
			if (worksite && unit && unit.firstArrivedAt === undefined) {
				unit.firstArrivedAt = ctx.tick;
				recordTravelSample(ctx, unit.roleCode, creep.roomName, ctx.tick - unit.bornAt);
			}
			// 驻点稳定生产 (specs/harvest-worksite): 满载先卸货, 矿工绝不离开驻点——
			// 相邻容器有空间则卸入; 否则原地落地成堆由 carrier 认领;
			// 无 carry 部件的矿工 (落地采集) 恒不满足卸货条件, 持续采集即自动落地
			if (creep.freeCapacity === 0 && creep.carryEnergy > 0) {
				const spot = worksite?.containerSpot;
				const container = spot
					? room.stores.find(
							(store) =>
								store.structureType === "container" &&
								store.x === spot.x &&
								store.y === spot.y &&
								store.energy < store.energyCapacity,
						)
					: undefined;
				if (container && dist(creep.x, creep.y, container.x, container.y) <= RANGE_ADJACENT) {
					submitAction(ctx, broker, creep, task, "transfer", "carry", container.id);
					return;
				}
				submitDrop(ctx, broker, creep, task);
				return;
			}
			submitMoveOrAction(ctx, broker, creep, task, "harvest", "work", source, RANGE_ADJACENT);
			return;
		}
		case "fill_spawn":
		case "haul": {
			if (creep.carryEnergy > 0) {
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task, task.kind === "haul" ? task.targetId : undefined);
			return;
		}
		case "upgrade": {
			const controller = room.controller;
			if (!controller) {
				return;
			}
			if (creep.carryEnergy > 0) {
				submitMoveOrAction(ctx, broker, creep, task, "upgradeController", "controller", controller, RANGE_UPGRADE);
				return;
			}
			// 取离 controller 更近的货源: 缩短载货腿, 降低往返周期 (bugs/P1-4)
			fetchEnergy(ctx, broker, room, creep, task, undefined, { x: controller.x, y: controller.y });
			return;
		}
		case "build": {
			const site = room.sites.find((s) => s.id === task.targetId);
			if (!site) {
				return;
			}
			if (creep.carryEnergy > 0) {
				submitMoveOrAction(ctx, broker, creep, task, "build", "work", site, RANGE_ADJACENT);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task);
			return;
		}
		case "defend": {
			// 目标每 Tick 从快照重选 (威胁动态变化, 任务 targetId 仅为创建期快照)
			const target = rankHostiles(room)[0];
			if (!target) {
				return;
			}
			// 治疗切换: 持治疗部件且友方 (含自己) 损血超阈且相邻 (docs/nexus-design/09 §9.3)
			if (creep.bodyHeal > 0) {
				const ally = room.creeps
					.filter((candidate) => candidate.hitsMax > 0 && candidate.hits < candidate.hitsMax * COMBAT_CONFIG.healThreshold)
					.sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)[0];
				if (ally && dist(creep.x, creep.y, ally.x, ally.y) <= RANGE_ADJACENT) {
					submitAction(ctx, broker, creep, task, "heal", "combat", ally.id);
					return;
				}
			}
			const ranged = creep.bodyRanged > 0;
			submitMoveOrAction(
				ctx,
				broker,
				creep,
				task,
				ranged ? "rangedAttack" : "attack",
				"combat",
				target,
				ranged ? RANGE_RANGED : RANGE_ADJACENT,
			);
			return;
		}
		case "retreat": {
			// 撤退锚点保持: 距锚点超出半径持续移动, 到达后原地不动 (威胁解除由规划器 cancel)
			const anchor = task.targetPos;
			if (anchor && dist(creep.x, creep.y, anchor.x, anchor.y) > RETREAT_CONFIG.anchorRadius) {
				submitMoveTo(ctx, broker, creep, task, anchor);
			}
			return;
		}
		case "repair": {
			const target = room.damageables.find((structure) => structure.id === task.targetId);
			if (!target) {
				return; // 结构消失: 任务由规划器终结
			}
			if (creep.carryEnergy > 0) {
				submitMoveOrAction(ctx, broker, creep, task, "repair", "work", target, RANGE_REPAIR);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task);
			return;
		}
		default:
			// 高级任务 (attack/heal 进攻族、工业族) 后续阶段实现
			return;
	}
}

export function runAgents(ctx: TickContext, broker: ActionBroker, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			const taskId = Game.creeps[creep.name]?.memory.taskId;
			if (!taskId) {
				continue;
			}
			const task = board.get(taskId);
			// 指针生命周期: 任务不存在/终态/已改派他人 → 清除指针, 本 Tick 不产出计划
			const record = Game.creeps[creep.name];
			if (!task || task.assignedTo !== creep.name || task.status === "completed" || task.status === "cancelled" || task.status === "failed") {
				if (record) {
					delete record.memory.taskId;
				}
				continue;
			}
			// 拥堵分级响应 (docs/nexus-design/08 §8.6): 让路已由 endTickResolve 推开承担,
			// 这里处理 repath (本 Tick 让位) 与 release (释放任务重分配)
			const action = congestionAction(ctx, creep.name);
			if (action === "repath") {
				clearBlocked(ctx, creep.name);
				continue;
			}
			if (action === "release") {
				board.release(taskId, creep.name, ctx.tick, "traffic-stuck");
				if (record) {
					delete record.memory.taskId;
				}
				clearBlocked(ctx, creep.name);
				continue;
			}
			board.heartbeat(taskId, creep.name, ctx.tick);
			runCreep(ctx, broker, room, creep, task);
		}
	}
}
