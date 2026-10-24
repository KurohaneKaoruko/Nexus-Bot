/**
 * AgentSystem (api/06 §6.1): 读取已分配任务, 为每只 Creep 产出本 Tick 的行动提案。
 * 只做决策与范围判断 (基于快照坐标), 不触碰原生 API; 提交统一走 ActionBroker。
 * 取货/送货阶段由 Creep 自身负载推导, 不额外维护状态机。
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
import type { TaskBoard } from "@/modules/tasks";
import { atWorksite } from "@/modules/world";
import { clearBlocked, congestionAction } from "@/modules/movement/trafficMonitor";
import { ccUpgradeReserveOf, hasHungryUpgrader, recordTravelSample, registerUpgraderStarve } from "@/modules/economy";
import { destinationQuotas } from "@/modules/economy";
import { roomModeProfileFor } from "@/modules/strategy";
import { relayHandoffAllowed, type RelayCreepView } from "@/utils/carryRelay";
import { CARRIER_BEHAVIOR_CONFIG, RELAY_CONFIG, REMOTE_CARRY_CONFIG, WORKFORCE_CONFIG } from "@/config/economy";
import { COMBAT_CONFIG, RETREAT_CONFIG } from "@/config/defense";
import { COURIER_CONFIG, CARRY_CONFIG } from "@/config/economy";
import { rankHostiles } from "@/modules/defense";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { acquire } from "@/runtime/actorOwnership";
import { isLegacyExecOn } from "@/config/capabilities";

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
function submitDrop(
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
function submitAdjacentExtensionFill(
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
function hasFetchTarget(
	ctx: TickContext,
	room: RoomObservation,
	creep: CreepSummary,
	fromId?: string,
): boolean {
	if (fromId) {
		if (room.piles.some((p) => p.id === fromId)) return true;
		if (room.stores.some((s) => s.id === fromId && s.energy > 0)) return true;
		return false;
	}
	if (nearestStore(ctx, room, creep.x, creep.y)) return true;
	if (nearestPile(room, creep.x, creep.y)) return true;
	if (nearestEnergyStructureAboveFloor(room, creep.x, creep.y)) return true;
	if (creep.bodyWork > 0 && nearestSource(room, creep.x, creep.y)) return true;
	return false;
}

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
function deliverEnergy(
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

function runCreep(
	ctx: TickContext,
	broker: ActionBroker,
	board: TaskBoard,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): void {
	switch (task.kind) {
		case "scout": {
			// 侦查: 到达目标房即获视野 (下 tick planRemoteHarvest 产出采集任务接替);
			// 到达即 complete 终结任务——此前只删指针不终结, 任务靠 lease 过期回
			// available 又被认领, 且规划器每拍 upsert 续命成永生任务 (实服 4wt
			// 重开残留 6 条 scout 任务 + 视野口径漏计 → 无限补孵 20 只, bugs/实服)
			const target = task.targetPos?.roomName;
			if (!target) return;
			if (creep.roomName === target) {
				board.complete(task.id, creep.name, ctx.tick);
				const live = Game.creeps[creep.name];
				if (live) delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			broker.submit({
				id: `${creep.name}-sc-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "move",
				targetPos: { x: 25, y: 25, roomName: target },
				priority: task.priority,
				pipeline: "move",
				reason: "scout-room",
				dedupeKey: `${creep.name}:move:${task.id}`,
			});
			return;
		}
		case "harvest": {
			// 外矿同名-unit: 目标房 ≠ 当前房间时, 走跨房采集
			if (task.targetPos?.roomName && task.targetPos.roomName !== room.roomName) {
				runRemoteHarvest(ctx, broker, creep, task);
				return;
			}
			const source = room.sources.find((s) => s.id === task.targetId);
			if (!source) {
				return;
			}
			// 钉位: 低容量多只期任务自带采集槽位坐标 (与 Source 相邻且非 Source 本格),
			// 每任务一槽避免多只互挤; 旧口径任务 (targetPos=Source 本格) 与远程任务
			// 回退 intel 主驻点 (单座语义)
			const intel = ctx.memory.rooms[room.roomName];
			const worksite = intel?.worksites?.[source.id];
			const taskSlot =
				task.targetPos &&
				task.targetPos.roomName === room.roomName &&
				!(task.targetPos.x === source.x && task.targetPos.y === source.y)
					? task.targetPos
					: worksite;
			if (taskSlot && !atWorksite(creep, taskSlot)) {
				// 驻点未到: 工作位必然与 Source 相邻, 先钉在固定驻点
				submitMoveTo(ctx, broker, creep, task, taskSlot, "harvest-worksite");
				return;
			}
			// 首次到岗采样: bornAt→firstArrivedAt 即实测路程 (替补窗口用);
			// 同拍写入 per-source 路程表 (specs/workforce-staffing 搬运运力定编的实测输入)
			const unit = ctx.memory.units[creep.name];
			if (worksite && unit && unit.firstArrivedAt === undefined) {
				unit.firstArrivedAt = ctx.tick;
				recordTravelSample(ctx, unit.unitCode, creep.roomName, ctx.tick - unit.bornAt);
				const roomIntel = ctx.memory.rooms[creep.roomName];
				if (roomIntel && task.targetId) {
					const clamp = WORKFORCE_CONFIG.sourceTiming;
					const pathTime = Math.max(
						clamp.clampMin,
						Math.min(clamp.clampMax, ctx.tick - unit.bornAt),
					);
					roomIntel.sourceTiming = { ...roomIntel.sourceTiming, [task.targetId]: pathTime };
				}
			}
			// 驻点稳定生产 (specs/harvest-worksite): 满载先卸货, 矿工绝不离开驻点——
			// 相邻容器有空间则卸入; 相邻有空位的源旁 ext 直填 (零腿补给);
			// 否则原地落地成堆由 carrier 认领;
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
				if (submitAdjacentExtensionFill(ctx, broker, room, creep, task)) {
					return;
				}
				submitDrop(ctx, broker, creep, task);
				return;
			}
			submitMoveOrAction(ctx, broker, creep, task, "harvest", "work", source, RANGE_ADJACENT);
			// 直供泵: 采集态顺手把身上的能量填进相邻 ext——与 harvest 跨管线同 tick 并行,
			// 源旁 ext 空间就是 source → spawn 的零腿通道 (无 carry 部件时恒为空转)
			if (creep.carryEnergy > 0) {
				submitAdjacentExtensionFill(ctx, broker, room, creep, task);
			}
			return;
		}
		case "fill_spawn":
		case "carry": {
			// 跨房 carry (W1-2 远程容器回运): 取料点在外矿房, 本矿分支的
			// room.piles/stores 是错房快照——走独立跨房状态机
			if (task.targetPos?.roomName && task.targetPos.roomName !== room.roomName) {
				runRemoteCarry(ctx, broker, creep, task);
				return;
			}
			// 满载迟滞: 拿满才交付; 源枯竭时带余量交付
			const live = Game.creeps[creep.name];
			const fromId = task.kind === "carry" ? task.targetId : undefined;
			if (live?.memory.mode === "deliver") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, fromId);
					return;
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			if (creep.carryEnergy > 0 && creep.freeCapacity === 0) {
				if (live) {
					live.memory.mode = "deliver";
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			if (creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, fromId)) {
				// 源枯竭: 无货可拿, 带余量交付 (唯一例外出口)
				if (live) {
					live.memory.mode = "deliver";
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task, fromId);
			return;
		}
		case "upgrade": {
			const controller = room.controller;
			if (!controller) {
				return;
			}
			// 控制器缓冲存在 → 就位直供 (specs/controller-upgrade-buffer):
			// 持有者驻所分配工位 (任务 targetPos = 工位), withdraw cc + upgrade 原地完成零往返;
			// cc 空则拾取工位旁落地/墓碑 (快递能量), 都没有原地待命保租约
			const buffer = room.controllerBuffer;
			if (buffer) {
				const slot = task.targetPos;
				if (slot && (creep.x !== slot.x || creep.y !== slot.y)) {
					submitMoveTo(ctx, broker, creep, task, slot, "upgrade-slot");
					return;
				}
				if (creep.carryEnergy > 0) {
					submitMoveOrAction(
						ctx,
						broker,
						creep,
						task,
						"upgradeController",
						"controller",
						controller,
						RANGE_UPGRADE,
					);
					return;
				}
				const ccStore = room.stores.find((store) => store.id === buffer.id);
				if (ccStore && ccStore.energy > 0) {
					submitAction(ctx, broker, creep, task, "withdraw", "carry", buffer.id);
					return;
				}
				const pile = nearestPile(room, creep.x, creep.y, slot);
				if (pile) {
					submitMoveOrAction(ctx, broker, creep, task, "pickup", "carry", pile, RANGE_ADJACENT);
					return;
				}
				// 取能落空且缓冲全空: 饥饿记账 (specs/workforce-staffing 负反馈,
				// 保级窗口由 registerUpgraderStarve 内部豁免), 原地待命保租约。
				// 分档直采 (bugs/P1-14 cc 断粮, (十) 方向2): 无 courier 投喂经济的
				// 档位退化为长腿自取 (fetchEnergy 最近货源), cc 有货自动回归直供;
				// rush/mini 靠墓碑投喂闭环, 保持钉工位。
				// 无 cc 期豁免 (race-speedrun 6.1 第五轮, RCL2 提速): 直供链的
				// 前提物是 cc, cc 未成/未建 (含 RCL1, cc 规划 RCL2 起) 时钉工位
				// 没有任何投喂来源——开局首 200 进度全靠偶发顺路升级, 实测 t851
				// 才有点数; 自采自升是唯一闭环, cc 有货即回归既有直供语义。
				registerUpgraderStarve(ctx, room);
				if (
					roomModeProfileFor(ctx, room.roomName).upgraderForageOnStarve ||
					!room.controllerBuffer
				) {
					fetchEnergy(ctx, broker, room, creep, task, undefined, {
						x: buffer.x,
						y: buffer.y,
					});
				}
				return;
			}
			// 满载迟滞: 拿满才升级; 源枯竭时带余量升级
			const live = Game.creeps[creep.name];
			const ctrlAnchor = { x: controller.x, y: controller.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, ctrlAnchor);
					return;
				}
				submitMoveOrAction(
					ctx,
					broker,
					creep,
					task,
					"upgradeController",
					"controller",
					controller,
					RANGE_UPGRADE,
				);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(
					ctx,
					broker,
					creep,
					task,
					"upgradeController",
					"controller",
					controller,
					RANGE_UPGRADE,
				);
				return;
			}
			// 取离 controller 更近的货源: 缩短载货腿, 降低往返周期 (bugs/P1-4)
			fetchEnergy(ctx, broker, room, creep, task, undefined, ctrlAnchor);
			return;
		}
		case "build": {
			const site = room.sites.find((s) => s.id === task.targetId);
			if (!site) {
				return;
			}
			// 满载迟滞: 拿满才上工; 源枯竭时带余量上工
			const live = Game.creeps[creep.name];
			const siteAnchor = { x: site.x, y: site.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, siteAnchor);
					return;
				}
				submitMoveOrAction(ctx, broker, creep, task, "build", "work", site, RANGE_ADJACENT);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(ctx, broker, creep, task, "build", "work", site, RANGE_ADJACENT);
				return;
			}
			// 取料锚定工地: 空载+载货总路程选点, 工人不为取料横穿房间 (bugs/P1-14)
			fetchEnergy(ctx, broker, room, creep, task, undefined, siteAnchor);
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
					.filter(
						(candidate) =>
							candidate.hitsMax > 0 &&
							candidate.hits < candidate.hitsMax * COMBAT_CONFIG.healThreshold,
					)
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
		case "claim": {
			// 扩张: 走到目标房控制器 → claim (目标房取任务侧, 不随 creep 当前房漂移)
			const targetRoom = task.targetPos?.roomName;
			if (!targetRoom) return;
			const live = Game.creeps[creep.name];
			if (creep.roomName !== targetRoom || !live) {
				broker.submit({
					id: `${creep.name}-go-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: {
						x: task.targetPos?.x ?? 25,
						y: task.targetPos?.y ?? 25,
						roomName: targetRoom,
					},
					priority: task.priority,
					pipeline: "move",
					reason: "claim-room",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			const ctrl = live.room.controller;
			if (!ctrl) return;
			if (ctrl.my) {
				// 已占有: 清任务指针停心跳, 任务由 lease 过期回收
				delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			const d = Math.max(Math.abs(creep.x - ctrl.pos.x), Math.abs(creep.y - ctrl.pos.y));
			if (d <= 1) {
				// claim 经命令边界提交 (api/17 claim 管线)
				broker.submit({
					id: `${creep.name}-claim-act-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "claimController",
					targetId: ctrl.id,
					priority: task.priority,
					pipeline: "claim",
					dedupeKey: `${creep.name}:claim:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-claim-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: { x: ctrl.pos.x, y: ctrl.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "claim-controller",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
			return;
		}
		case "reserve": {
			// 外矿预订 (对齐 Rosmarin race): 走到目标房控制器 → reserveController,
			// 未预订源容量 1500→3000。预订在身即停发任务, 续订由租约过期后重发接替
			const targetRoom = task.targetPos?.roomName;
			if (!targetRoom) return;
			const live = Game.creeps[creep.name];
			if (!live) return;
			const ctrl = live.room.controller;
			if (creep.roomName !== targetRoom || !ctrl) {
				broker.submit({
					id: `${creep.name}-rsv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: {
						x: task.targetPos?.x ?? 25,
						y: task.targetPos?.y ?? 25,
						roomName: targetRoom,
					},
					priority: task.priority,
					pipeline: "move",
					reason: "reserve-room",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			// 他人预订在身: 本件无法续订, 放弃任务 (生产端也不再对他订房发任务)
			if (ctrl.reservation && ctrl.reservation.username !== live.owner?.username) {
				delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			// 驻场终身制 (对齐 Rosmarin reserver): 到位后持续 reserveController
			// 续满, 预订不中断外矿恒满容量; 寿命耗尽由生产端在续订线下重发接替
			const d = Math.max(Math.abs(creep.x - ctrl.pos.x), Math.abs(creep.y - ctrl.pos.y));
			if (d <= 1) {
				// reserve 经命令边界提交 (api/17 claim 管线)
				broker.submit({
					id: `${creep.name}-rsv-act-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "reserveController",
					targetId: ctrl.id,
					priority: task.priority,
					pipeline: "claim",
					dedupeKey: `${creep.name}:reserve:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-rsv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: { x: ctrl.pos.x, y: ctrl.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "reserve-controller",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
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
			// 满载迟滞: 拿满才修; 源枯竭时带余量修
			const live = Game.creeps[creep.name];
			const targetAnchor = { x: target.x, y: target.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, targetAnchor);
					return;
				}
				submitMoveOrAction(ctx, broker, creep, task, "repair", "work", target, RANGE_REPAIR);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(ctx, broker, creep, task, "repair", "work", target, RANGE_REPAIR);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task, undefined, targetAnchor);
			return;
		}
		default:
			return;
	}
}

/** 快递计划无任务租约 (broker 校验 getTask(taskId) 会判 lease-lost),
 *  直接经 broker.submit 提交, 只带执行所需字段 */
function submitCourierAction(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	kind: "withdraw" | "move",
	target?: { id: string; x: number; y: number },
): void {
	broker.submit({
		id: `${creep.name}-${kind}-${ctx.tick}`,
		tick: ctx.tick,
		actorName: creep.name,
		kind,
		...(target?.id !== undefined ? { targetId: target.id } : {}),
		...(target !== undefined
			? { targetPos: { x: target.x, y: target.y, roomName: creep.roomName } }
			: {}),
		resourceType: RESOURCE_ENERGY,
		priority: COURIER_CONFIG.priority,
		pipeline: "carry",
		dedupeKey: `${creep.name}:carry:${kind}`,
	});
}

/** 快递爬逐 tick 驱动 (specs/rush-courier, 无任务租约): 取满向 cc/控制器方向自爆交付;
 *  断供带货就地自爆 (半载也值回票价); 空载限时等待后放弃 */
function runCourierCreep(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
): void {
	const target = room.controllerBuffer ?? room.controller;
	if (!target) {
		return;
	}
	const submitSuicide = (): void => {
		broker.submit({
			id: `${creep.name}-suicide-${ctx.tick}`,
			tick: ctx.tick,
			actorName: creep.name,
			kind: "suicide",
			pipeline: "carry",
			priority: COURIER_CONFIG.priority,
			dedupeKey: `${creep.name}:carry:suicide`,
		});
	};
	if (creep.freeCapacity > 0) {
		// 取能: 只抽底仓之上的 spawn 存量
		const spawn = room.energyStructures.find(
			(structure) =>
				structure.structureType === "spawn" &&
				structure.energy > COURIER_CONFIG.reserveFloor,
		);
		if (spawn) {
			submitCourierAction(ctx, broker, creep, "withdraw", spawn);
			return;
		}
		// spawn 断供: 带货就地交付, 空载限时等待再放弃
		if (creep.carryEnergy > 0) {
			submitSuicide();
			return;
		}
		const record = Game.creeps[creep.name];
		const memory = record?.memory as { waitStart?: number } | undefined;
		if (memory && memory.waitStart !== undefined) {
			if (ctx.tick - memory.waitStart > COURIER_CONFIG.idleGiveUpTicks) {
				submitSuicide();
			}
			return;
		}
		if (memory) {
			memory.waitStart = ctx.tick;
		}
		return;
	}
	// 满载: direct 模式 transfer 入 cc 后复跑 (spawn→cc 短腿专运);
	// tombstone 模式或无 cc 就近自爆, 墓碑能量落升级圈
	const buffer = room.controllerBuffer;
	if (buffer && COURIER_CONFIG.deliveryMode === "direct") {
		if (dist(creep.x, creep.y, buffer.x, buffer.y) <= 1) {
			submitCourierTransfer(ctx, broker, creep, buffer.id);
			return;
		}
		submitCourierAction(ctx, broker, creep, "move", buffer);
		return;
	}
	if (dist(creep.x, creep.y, target.x, target.y) <= (buffer ? 1 : 2)) {
		submitSuicide();
		return;
	}
	submitCourierAction(ctx, broker, creep, "move", target);
}

/** 快递直投: transfer 入 cc (满载交付后回 spawn 复跑) */
function submitCourierTransfer(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	ccId: string,
): void {
	broker.submit({
		id: `${creep.name}-transfer-${ctx.tick}`,
		tick: ctx.tick,
		actorName: creep.name,
		kind: "transfer",
		targetId: ccId,
		resourceType: RESOURCE_ENERGY,
		priority: COURIER_CONFIG.priority,
		pipeline: "carry",
		dedupeKey: `${creep.name}:carry:transfer`,
	});
}

/** agent 系统直接驱动的角色代号集 (有对应任务 kind 分支); 其余走原型执行 */
/**
 * 外矿同名-unit 采集: 目标在远程房 → 走到目标房 source → harvest → 满载走回本矿 spawn 卸货。
 * 跨房能量流: 远程 harvester 满载回本矿, 交付到 spawn/ext (carrier 接力可选)。
 */
function runRemoteHarvest(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
): void {
	const targetRoom = task.targetPos?.roomName;
	if (!targetRoom) return;

	// 满载且在目标房: 优先卸源旁容器 (W1-2 carrier 链, 驻点化零往返);
	// 无容器再走自回运兜底 (远程容器由本矿 carrier 跨房 carry 接力)
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0 && creep.roomName === targetRoom) {
		const remoteRoom = Game.rooms[targetRoom];
		const source = remoteRoom
			? (Game.getObjectById(task.targetId ?? "") as Source | null)
			: null;
		const container =
			source && remoteRoom
				? remoteRoom
						.find(FIND_STRUCTURES, {
							filter: (s): s is StructureContainer =>
								s.structureType === STRUCTURE_CONTAINER &&
								s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange) &&
								s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
						})
						.find((c) => dist(creep.x, creep.y, c.pos.x, c.pos.y) <= 1)
				: undefined;
		if (container) {
			broker.submit({
				id: `${creep.name}-rcd-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "transfer",
				targetId: container.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
			return;
		}
		// 无成品容器但有自家工地 (W2 建设期): 满载去工地浇筑, 不走自回运——
		// 回运一趟 2×路程 tick, 容器不落地 carry 链永远不开
		const liveRoomFull = Game.rooms[targetRoom];
		const ownSiteFull = liveRoomFull
			? liveRoomFull.find(FIND_CONSTRUCTION_SITES, {
					filter: (s) =>
						s.structureType === STRUCTURE_CONTAINER &&
						Math.max(Math.abs(s.pos.x - (task.targetPos?.x ?? 0)), Math.abs(s.pos.y - (task.targetPos?.y ?? 0))) <= REMOTE_CARRY_CONFIG.containerRange + 1,
				})[0]
			: undefined;
		if (ownSiteFull && creep.bodyWork > 0) {
			broker.submit({
				id: `${creep.name}-rhb2-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "build",
				targetId: ownSiteFull.id,
				priority: task.priority,
				pipeline: "work",
				dedupeKey: `${creep.name}:work:${task.id}`,
			});
			return;
		}
	}

	// 满载且不在本矿 → 走回本矿
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0 && creep.roomName !== task.roomName) {
		broker.submit({
			id: `${creep.name}-ret-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "move",
			targetPos: { x: 25, y: 25, roomName: task.roomName },
			priority: task.priority,
			pipeline: "move",
			reason: "return-home",
			dedupeKey: `${creep.name}:move:${task.id}`,
		});
		return;
	}

	// 满载且在本矿 → 卸到 cc (升级线优先) / spawn-ext
	if (creep.carryEnergy > 0 && creep.roomName === task.roomName) {
		const dest = remoteDropoffFor(ctx, task.roomName);
		if (dest) {
			const live = Game.getObjectById(dest.id as Id<AnyStoreStructure>);
			// 距离预判 (bugs/P1-18 断点⑥): 卸货点不在脚边时先走过去——
			// 直接 transfer 只会每 tick ERR_NOT_IN_RANGE, 爬原地罚站到租约耗尽
			if (live && dist(creep.x, creep.y, live.pos.x, live.pos.y) > 1) {
				broker.submit({
					id: `${creep.name}-del-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: { x: live.pos.x, y: live.pos.y, roomName: task.roomName },
					priority: task.priority,
					pipeline: "move",
					reason: "remote-dropoff",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			broker.submit({
				id: `${creep.name}-del-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "transfer",
				targetId: dest.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
		}
		return;
	}

	// 未满载且在目标房 → 采集
	if (creep.roomName === targetRoom) {
		const remoteRoom = Game.rooms[targetRoom];
		const source = remoteRoom ? (Game.getObjectById(task.targetId ?? "") as Source | null) : null;
		if (source) {
			// 远程基建 (W2): 源旁无容器且无在建 → 就地放站; 兼职建造——
			// 容器是 carrier 回运链的开关 (W1-2), 无容器期采集掉落堆满地腐烂。
			// 门控: 非己方房且 (无 controller 或无主) 才动工——有主之地禁建
			const liveRoom = Game.rooms[targetRoom];
			const remoteCtrl = liveRoom?.controller;
			const buildableRemote =
				liveRoom !== undefined && !remoteCtrl?.my && (remoteCtrl === undefined || !remoteCtrl.owner);
			if (buildableRemote) {
				const existing = liveRoom.find(FIND_STRUCTURES, {
					filter: (s): s is StructureContainer =>
						s.structureType === STRUCTURE_CONTAINER &&
						s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange),
				});
				const site = liveRoom.find(FIND_CONSTRUCTION_SITES, {
					filter: (s) => s.structureType === STRUCTURE_CONTAINER,
				});
				if (existing.length === 0 && site.length === 0 && creep.bodyWork > 0) {
					// 站点位置: 采集工位即容器位 (驻点采集本就贴源), 找源旁一格空地
					const spot = pickRemoteContainerSpot(liveRoom, source);
					if (spot) {
						broker.submit({
							id: `${creep.name}-rcs-${ctx.tick}`,
							tick: ctx.tick,
							taskId: task.id,
							actorName: liveRoom.name,
							kind: "createSite",
							targetPos: { x: spot.x, y: spot.y, roomName: targetRoom },
							payload: { structureType: STRUCTURE_CONTAINER },
							priority: 40,
							pipeline: "construction",
							dedupeKey: `remote-container:${targetRoom}:${spot.x}:${spot.y}`,
						});
					}
				}
			}
			const d = Math.max(Math.abs(creep.x - source.pos.x), Math.abs(creep.y - source.pos.y));
			if (d <= 1) {
				// 兼职建造 (W2): 工地贴源且身上有货 → 先 build (采集间隙推进容器)。
				// 射程用原生 build 上限 3: 容器位与矿工工位可能分居源两侧 (切比雪夫 2),
				// 收紧到 1 会让站点永远无人建造直到衰亡重放
				const buildTarget = liveRoom
					? liveRoom.find(FIND_CONSTRUCTION_SITES, {
							filter: (s) =>
								s.structureType === STRUCTURE_CONTAINER &&
								Math.max(Math.abs(s.pos.x - source.pos.x), Math.abs(s.pos.y - source.pos.y)) <= REMOTE_CARRY_CONFIG.containerRange,
						})[0]
					: undefined;
				if (buildTarget && creep.carryEnergy > 0 && dist(creep.x, creep.y, buildTarget.pos.x, buildTarget.pos.y) <= 3) {
					broker.submit({
						id: `${creep.name}-rhb-${ctx.tick}`,
						tick: ctx.tick,
						taskId: task.id,
						actorName: creep.name,
						kind: "build",
						targetId: buildTarget.id,
						priority: task.priority,
						pipeline: "work",
						dedupeKey: `${creep.name}:work:${task.id}`,
					});
					return;
				}
				// 容器维修 (W2): 成品容器耐久低于阈值即修——不修则 decay 拆链,
				// carry 回运的取料点周期性消失 (sim 实证 cont 周期性归零重放)
				const wornContainer = liveRoom
					? liveRoom.find(FIND_STRUCTURES, {
							filter: (s): s is StructureContainer =>
								s.structureType === STRUCTURE_CONTAINER &&
								s.hits < s.hitsMax * REMOTE_CARRY_CONFIG.repairRatio &&
								s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange + 1),
						})[0]
					: undefined;
				if (wornContainer && creep.carryEnergy > 0) {
					broker.submit({
						id: `${creep.name}-rhr-${ctx.tick}`,
						tick: ctx.tick,
						taskId: task.id,
						actorName: creep.name,
						kind: "repair",
						targetId: wornContainer.id,
						priority: task.priority,
						pipeline: "work",
						dedupeKey: `${creep.name}:work:${task.id}`,
					});
					return;
				}
				broker.submit({
					id: `${creep.name}-hv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "harvest",
					targetId: source.id,
					priority: task.priority,
					pipeline: "work",
					dedupeKey: `${creep.name}:work:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-m-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: { x: source.pos.x, y: source.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "remote-source",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
		}
		return;
	}

	// 未满载且不在目标房 → 走到目标房
	broker.submit({
		id: `${creep.name}-go-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "move",
		targetPos: { x: task.targetPos?.x ?? 25, y: task.targetPos?.y ?? 25, roomName: targetRoom },
		priority: task.priority,
		pipeline: "move",
		reason: "remote-room",
		dedupeKey: `${creep.name}:move:${task.id}`,
	});
}

function room_energyStructures_findSpawn(ctx: TickContext) {
	const world = ctx.world.current;
	if (!world) return undefined;
	for (const room of Object.values(world.rooms)) {
		const spawn = room.energyStructures.find((s) => s.structureType === "spawn" && s.energy < s.energyCapacity);
		if (spawn) return spawn;
	}
	return undefined;
}

/**
 * 远程采集件在本矿的卸货地: 优先 cc (升级线是外矿冲级收入的最终去处,
 * 直灌孵化线会把 cc 抽干——bugs (十二) 实证 control −82%), spawn/ext 次之。
 */
/** 远程容器选址: 源旁一格非墙空地 (无结构/工地), 确定性序 (dx/dy 升序) */
function pickRemoteContainerSpot(
	room: Room,
	source: Source,
): { x: number; y: number } | undefined {
	const terrain = room.getTerrain();
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			if (dx === 0 && dy === 0) continue;
			const x = source.pos.x + dx;
			const y = source.pos.y + dy;
			if (x < 1 || x > 48 || y < 1 || y > 48) continue;
			if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;
			if (room.lookForAt(LOOK_STRUCTURES, x, y).length > 0) continue;
			if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
			return { x, y };
		}
	}
	return undefined;
}

/**
 * 跨房 carry (W1-2 远程容器回运): fetch 腿在容器房 (withdraw 装满),
 * deliver 腿回本矿卸货点 (remoteDropoffFor)——与 runRemoteHarvest 的
 * 自回运兜底同构, 但由专职 carrier 承担, 5W 矿工驻源不出场。
 */
function runRemoteCarry(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
): void {
	const live = Game.creeps[creep.name];
	// deliver 态: 有货即回本矿卸 (空载才回 fetch)
	if (live?.memory.mode === "deliver") {
		if (creep.carryEnergy === 0) {
			live.memory.mode = "fetch";
		} else {
			const dest = remoteDropoffFor(ctx, task.roomName);
			const destLive = dest
				? (Game.getObjectById(dest.id as Id<AnyStoreStructure>)?.pos ?? null)
				: null;
			if (dest && destLive && dist(creep.x, creep.y, destLive.x, destLive.y) <= 1 && creep.roomName === task.roomName) {
				broker.submit({
					id: `${creep.name}-rhd-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "transfer",
					targetId: dest.id,
					resourceType: "energy",
					priority: task.priority,
					pipeline: "carry",
					dedupeKey: `${creep.name}:carry:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-rhg-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: destLive
						? { x: destLive.x, y: destLive.y, roomName: task.roomName }
						: { x: 25, y: 25, roomName: task.roomName },
					priority: task.priority,
					pipeline: "move",
					reason: "carry-deliver",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
			return;
		}
	}
	// fetch 态: 满载切 deliver; 未满去容器取
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0) {
		if (live) live.memory.mode = "deliver";
		return;
	}
	// 取料点可能是容器 (稳态) 或掉落堆 (矿工 drop 期): 掉落堆按 amount, 容器按 store
	const target = Game.getObjectById(task.targetId ?? "") as StructureContainer | Resource | null;
	const targetEnergy =
		target === null ? 0 : "store" in target ? target.store.energy : target.amount;
	if (target !== null && targetEnergy > 0) {
		const isDrop = !("store" in target);
		if (creep.roomName === target.pos.roomName && dist(creep.x, creep.y, target.pos.x, target.pos.y) <= 1) {
			broker.submit({
				id: `${creep.name}-rhf-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: isDrop ? "pickup" : "withdraw",
				targetId: target.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
		} else {
			broker.submit({
				id: `${creep.name}-rhm-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "move",
				targetPos: { x: target.pos.x, y: target.pos.y, roomName: target.pos.roomName },
				priority: task.priority,
				pipeline: "move",
				reason: "carry-fetch",
				dedupeKey: `${creep.name}:move:${task.id}`,
			});
		}
		return;
	}
	// 容器空/消失: 任务由 planner 存量门自然回收, 空载待命避免空跑
}

function remoteDropoffFor(ctx: TickContext, roomName: string): { id: string } | undefined {
	const room = ctx.world.current?.rooms[roomName];
	if (!room) return room_energyStructures_findSpawn(ctx);
	const buffer = room.controllerBuffer;
	const bufferStore = buffer
		? room.stores.find(
				(s) => s.id === buffer.id && s.structureType === "container" && s.energy < s.energyCapacity,
			)
		: undefined;
	if (bufferStore) return bufferStore;
	const spawnish = room.energyStructures.find((s) => s.energy < s.energyCapacity);
	return spawnish ?? room_energyStructures_findSpawn(ctx);
}

/**
 * 接力搬运交接 (specs/接力搬运): 满载供方与空载受方在通道上相向对穿时
 * 同 Tick 整仓移交——判据纯函数在 utils/carryRelay, 意图格为朝任务锚点的几何步进。
 * 任务随货走: 受方承接供方的交付任务租约、供方转回受方的取货任务;
 * 交接 transfer 不带 taskId (broker 免租约校验, 快递 lease-lost 教训不重演)。
 * 返回交接后的两个 (creep, task) 对, 调用方同 Tick 重跑双方行为; 未命中返回 null。
 */
function tryRelayHandoff(
	ctx: TickContext,
	broker: ActionBroker,
	board: TaskBoard,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
	processed: Set<string>,
): { supplierName: string; receiverName: string } | null {
	if ((room.rcl ?? 0) >= RELAY_CONFIG.maxRcl) {
		return null;
	}
	if (creep.unitCode !== UNIT_CODES.carrier || creep.spawning) {
		return null;
	}
	const liveSelf = Game.creeps[creep.name];
	if (!liveSelf) {
		return null;
	}
	const selfMode = liveSelf.memory.mode;
	// 供方相位: 满载交付中; 锚点 = 交付目的地
	const selfSupplying =
		selfMode === "deliver" && creep.carryEnergy > 0 && creep.freeCapacity === 0;
	const selfAnchor = selfSupplying ? (task.destPos ?? task.targetPos) : task.targetPos;
	// 受方相位要求 carry 取货 (fill_spawn 取货无确定锚点, 不参与)
	if (!selfSupplying && task.kind !== "carry") {
		return null;
	}
	const relayedSelf = liveSelf.memory.relayedTick === ctx.tick;
	const selfView: RelayCreepView = {
		x: creep.x,
		y: creep.y,
		supplying: selfSupplying,
		bodyCarry: creep.bodyCarry,
		ticksToLive: creep.ticksToLive,
		relayedThisTick: relayedSelf,
		anchor: selfAnchor ? { x: selfAnchor.x, y: selfAnchor.y } : undefined,
	};
	for (const other of room.creeps) {
		if (other.name === creep.name || processed.has(other.name)) {
			continue;
		}
		if (other.unitCode !== UNIT_CODES.carrier || other.spawning) {
			continue;
		}
		const otherLive = Game.creeps[other.name];
		const otherTaskId = otherLive?.memory.taskId;
		if (!otherLive || !otherTaskId) {
			continue;
		}
		const otherTask = board.get(otherTaskId);
		if (
			!otherTask ||
			otherTask.assignedTo !== other.name ||
			(otherTask.kind !== "carry" && otherTask.kind !== "fill_spawn")
		) {
			continue;
		}
		const otherMode = otherLive.memory.mode;
		const otherSupplying =
			otherMode === "deliver" && other.carryEnergy > 0 && other.freeCapacity === 0;
		// 相位必须相反: 供方=满载交付, 受方=空载取货 (carry)
		if (selfSupplying === otherSupplying) {
			continue;
		}
		if (!otherSupplying && otherTask.kind !== "carry") {
			continue;
		}
		const otherAnchor = otherSupplying
			? (otherTask.destPos ?? otherTask.targetPos)
			: otherTask.targetPos;
		const otherView: RelayCreepView = {
			x: other.x,
			y: other.y,
			supplying: otherSupplying,
			bodyCarry: other.bodyCarry,
			ticksToLive: other.ticksToLive,
			relayedThisTick: otherLive.memory.relayedTick === ctx.tick,
			anchor: otherAnchor ? { x: otherAnchor.x, y: otherAnchor.y } : undefined,
		};
		const supplier = selfSupplying ? selfView : otherView;
		const receiver = selfSupplying ? otherView : selfView;
		if (!relayHandoffAllowed(supplier, receiver, RELAY_CONFIG.minSupplierTtl)) {
			continue;
		}
		const supplierName = supplier === selfView ? creep.name : other.name;
		const receiverName = supplier === selfView ? other.name : creep.name;
		const supplierTask = supplier === selfView ? task : otherTask;
		const receiverTask = supplier === selfView ? otherTask : task;
		// 整仓移交 (不带 taskId, broker 免租约校验)
		broker.submit({
			id: `${supplierName}-relay-${ctx.tick}`,
			tick: ctx.tick,
			actorName: supplierName,
			kind: "transfer",
			targetId: receiverName,
			resourceType: RESOURCE_ENERGY,
			priority: supplierTask.priority,
			pipeline: "carry",
			dedupeKey: `${supplierName}:relay:${ctx.tick}`,
		});
		// 任务随货走: 受方承接交付任务, 供方转回取货任务; 同 Tick 防重入标记
		const supplierLive = Game.creeps[supplierName];
		const receiverLive = Game.creeps[receiverName];
		if (!supplierLive || !receiverLive) {
			return null;
		}
		supplierTask.assignedTo = receiverName;
		receiverTask.assignedTo = supplierName;
		supplierTask.updatedAt = ctx.tick;
		receiverTask.updatedAt = ctx.tick;
		receiverLive.memory.taskId = supplierTask.id;
		supplierLive.memory.taskId = receiverTask.id;
		receiverLive.memory.mode = "deliver";
		supplierLive.memory.mode = "fetch";
		supplierLive.memory.relayedTick = ctx.tick;
		receiverLive.memory.relayedTick = ctx.tick;
		return { supplierName, receiverName };
	}
	return null;
}

/** 任务驱动角色代号集; 集合外角色走原型 exec() 自驱 */
const NEXUS_TASK_DRIVEN_CODES: ReadonlySet<string> = new Set([
	UNIT_CODES.harvester,
	UNIT_CODES.carrier,
	UNIT_CODES.upgrader,
	UNIT_CODES.worker,
	UNIT_CODES.universal,
	UNIT_CODES["rush-courier"],
	UNIT_CODES.defender,
	UNIT_CODES.scout,
	UNIT_CODES.claimer,
	UNIT_CODES.reserver,
	UNIT_CODES.miner,
]);

export function runAgents(ctx: TickContext, broker: ActionBroker, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		/** 本 Tick 已驱动过的单位 (接力对的双方不重复进入默认驱动) */
		const processed = new Set<string>();
		for (const creep of room.creeps) {
			if (processed.has(creep.name)) {
				continue;
			}
			// 孵化中单位不驱动 (bugs/P0-16c 同源防护): 出生前任何计划都是
			// actor-missing-or-spawning 无效提交; 角色记录由孵化簿记保证
			if (creep.spawning) {
				continue;
			}
			// 原型角色执行体 (manager/transporter/miner): 无任务指针时走原型 exec()
			// 注意: NEXUS_TASK_DRIVEN_CODES 是 Set, 成员判定必须用 has——
			// `in` 是对象属性键检查, 对 Set 成员恒 false, 会让任务驱动角色
			// 全部漏进 exec() (scout/claimer 无 registry 处理器, 刷屏空转)
			// legacyExecMode 全局关 (任务 5.5 三级开关末段): 类别级收编
			// (加 NEXUS_TASK_DRIVEN_CODES) 完成后的全量切换点
			const liveVendor = Game.creeps[creep.name];
			if (
				isLegacyExecOn() &&
				!NEXUS_TASK_DRIVEN_CODES.has(creep.unitCode) &&
				liveVendor &&
				!liveVendor.memory.taskId &&
				typeof liveVendor.exec === "function"
			) {
				acquire(creep.name, "legacy-exec", ctx.tick);
				liveVendor.exec();
				continue;
			}
			// 快递爬: 无任务租约的角色驱动 (specs/rush-courier)
			if (creep.unitCode === UNIT_CODES["rush-courier"]) {
				// 孵化中不产出计划 (bugs/P0-16c): 出生前提交的计划全部
				// actor-missing-or-spawning 无效, 白耗仲裁与告警
				if (creep.spawning) {
					continue;
				}
				acquire(creep.name, "nexus-agent", ctx.tick);
				runCourierCreep(ctx, broker, room, creep);
				continue;
			}
			const taskId = Game.creeps[creep.name]?.memory.taskId;
			if (!taskId) {
				continue;
			}
			const task = board.get(taskId);
			// 指针生命周期: 任务不存在/终态/已改派他人 → 清除指针, 本 Tick 不产出计划
			const record = Game.creeps[creep.name];
			if (
				!task ||
				task.assignedTo !== creep.name ||
				task.status === "completed" ||
				task.status === "cancelled" ||
				task.status === "failed"
			) {
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
			acquire(creep.name, "nexus-agent", ctx.tick);
			// 接力搬运 (specs/接力搬运): 相向对穿整仓交接, 任务随货走后双方同 Tick 重跑
			const relay = tryRelayHandoff(ctx, broker, board, room, creep, task, processed);
			if (relay) {
				for (const name of [relay.supplierName, relay.receiverName]) {
					const member = room.creeps.find((c) => c.name === name);
					const memberTaskId = Game.creeps[name]?.memory.taskId;
					const swapped = memberTaskId ? board.get(memberTaskId) : undefined;
					processed.add(name);
					if (member && swapped && swapped.assignedTo === name) {
						runCreep(ctx, broker, board, room, member, swapped);
					}
				}
				continue;
			}
			runCreep(ctx, broker, board, room, creep, task);
			processed.add(creep.name);
		}
	}

	// 外矿单位驱动 (bugs/P1-18 断点④): 可见非己方房的己方爬不进 world.rooms,
	// 上面循环驱动不到——按其任务归属房取 observation 后走同一 runCreep。
	// 只驱动带有效租约的任务件 (无租约外矿件不产出计划, 等待分配器续派)。
	for (const creep of world.remoteUnits) {
		if (creep.spawning) {
			continue;
		}
		const live = Game.creeps[creep.name];
		if (!live) {
			continue;
		}
		const taskId = live.memory.taskId;
		if (!taskId) {
			continue;
		}
		const task = board.get(taskId);
		if (
			!task ||
			task.assignedTo !== creep.name ||
			task.status === "completed" ||
			task.status === "cancelled" ||
			task.status === "failed"
		) {
			delete live.memory.taskId;
			continue;
		}
		// 任务归属房 (本矿) 的 observation: runCreep 的 remote 分支按 task 定位目标
		const homeRoom = world.rooms[task.roomName];
		if (!homeRoom) {
			continue;
		}
		board.heartbeat(taskId, creep.name, ctx.tick);
		acquire(creep.name, "nexus-agent", ctx.tick);
		runCreep(ctx, broker, board, homeRoom, creep, task);
	}
}
