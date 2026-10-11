/**
 * 经济系统规划器 (docs/nexus-design/06 §6.2–6.4 / docs/nexus-design/02 原则 B 局部层): 把房间观测转成任务。
 * 行为兼容保证: dedupe key / 取消语义 / 账本预留语义不变;
 * 指令生效 (设计 D5): 任务基础优先级叠加姿态偏置;
 * survive 且库存低于储备下限时 upgrade/build 暂停新建, 既有任务降权保持存活。
 * 规划器是纯函数: upsert 意图 (dedupeKey 幂等) + cancel 消失的主体;
 * 优先级政策: fill_spawn > harvest > haul > build > upgrade (docs/nexus-design/06 §6.2)。
 * haul 走配额 (§6.4): 货源+目的地+批量明确, 在途承诺入账本, 空缺即终结改派。
 */
import { HAUL_CONFIG } from "@/config/economy";
import { STRATEGY_CONFIG } from "@/config/strategy";
import type { TickContext } from "@/core/tickContext";
import type { RoomObservation } from "@/core/world";
import { priorityFor, type NewTaskInput, type TaskKind } from "@/store/taskSchema";
import type { TaskBoard } from "@/modules/tasks/board";
import { destinationQuotas, pickDestination, roundTripEstimate } from "@/modules/economy/quota";
import { createLedger, reserve } from "@/modules/economy/ledger";
import { worksiteFor } from "@/modules/world/worksite";

const PLANNED_KINDS: TaskKind[] = ["harvest", "haul", "fill_spawn", "upgrade", "build"];

/** 节流期保持既有任务存活: 不新建, 仅以压制优先级合并更新 (防「暂停即取消」抖动) */
function sustainSuppressed(
	board: TaskBoard,
	roomName: string,
	kind: "upgrade" | "build",
	dedupeKey: string,
	input: NewTaskInput,
	expected: Set<string>,
	now: number,
): void {
	const alive = board
		.list({ roomName, kinds: [kind] })
		.some(
			(task) =>
				task.dedupeKey === dedupeKey &&
				task.status !== "completed" &&
				task.status !== "cancelled" &&
				task.status !== "failed",
		);
	if (!alive) {
		return;
	}
	board.upsert(input, now);
	expected.add(dedupeKey);
}

/** 规划单房间: 读快照与当 Tick 战略指令 → 任务 upsert + 账本预留 */
export function planEconomyRoom(ctx: TickContext, board: TaskBoard, room: RoomObservation): void {
	const directive = ctx.directive();
	const bias = (kind: TaskKind): number => directive.kindBias[kind] ?? 0;
	const expected = new Set<string>();
	const intel = ctx.memory.rooms[room.roomName];

	// harvest: 每 Source 一个稳定任务, 工作位可用才生成 (容量语义 = 相邻可行走格数, 持有数由租约约束)
	for (const source of room.sources) {
		const worksite = intel ? worksiteFor(intel, room, source) : undefined;
		if (!worksite) {
			continue;
		}
		const dedupeKey = `harvest:${room.roomName}:${source.id}`;
		expected.add(dedupeKey);
		board.upsert(
			{
				dedupeKey,
				kind: "harvest",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: { x: source.x, y: source.y, roomName: room.roomName },
				priority: priorityFor("harvest") + bias("harvest"),
				requiredCapabilities: ["work", "move"],
			},
			ctx.tick,
		);
	}

	// upgrade: 每房间一个常驻任务; 要求 carry (无 carry 的 harvester 取料必然 ERR_FULL, bugs/P0-2); 节流期不新建、既有降权存活
	if (room.controller) {
		const dedupeKey = `upgrade:${room.roomName}`;
		const input: NewTaskInput = {
			dedupeKey,
			kind: "upgrade",
			roomName: room.roomName,
			targetId: room.controller.id,
			targetPos: { x: room.controller.x, y: room.controller.y, roomName: room.roomName },
			priority: priorityFor("upgrade") + bias("upgrade"),
			requiredCapabilities: ["work", "carry", "move"],
		};
		if (directive.suppressUpgradeBuild) {
			input.priority -= STRATEGY_CONFIG.suppressPenalty;
			sustainSuppressed(board, room.roomName, "upgrade", dedupeKey, input, expected, ctx.tick);
		} else {
			expected.add(dedupeKey);
			board.upsert(input, ctx.tick);
		}
	}

	// build: 工地存在才生成; 节流期同 upgrade
	for (const site of room.sites) {
		const dedupeKey = `build:${room.roomName}:${site.id}`;
		const input: NewTaskInput = {
			dedupeKey,
			kind: "build",
			roomName: room.roomName,
			targetId: site.id,
			targetPos: { x: site.x, y: site.y, roomName: room.roomName },
			priority: priorityFor("build") + bias("build"),
			requiredCapabilities: ["work", "carry", "move"],
		};
		if (directive.suppressUpgradeBuild) {
			input.priority -= STRATEGY_CONFIG.suppressPenalty;
			sustainSuppressed(board, room.roomName, "build", dedupeKey, input, expected, ctx.tick);
		} else {
			expected.add(dedupeKey);
			board.upsert(input, ctx.tick);
		}
	}

	// fill_spawn: 供能结构缺量才生成 (满仓即无任务)
	for (const structure of room.energyStructures) {
		if (structure.energy >= structure.energyCapacity) {
			continue;
		}
		const dedupeKey = `fill_spawn:${room.roomName}:${structure.id}`;
		expected.add(dedupeKey);
		board.upsert(
			{
				dedupeKey,
				kind: "fill_spawn",
				roomName: room.roomName,
				targetId: structure.id,
				targetPos: { x: structure.x, y: structure.y, roomName: room.roomName },
				amount: structure.energyCapacity - structure.energy,
				priority: priorityFor("fill_spawn") + bias("fill_spawn"),
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + 200,
			},
			ctx.tick,
		);
	}

	// haul: 配额驱动的资源流 (货源 → 配额目的地), 低于阈值不值得搬运
	const destinations = destinationQuotas(
		ctx,
		room,
		ctx.memory.economy.diagnosis.quotaFloorBias,
	);
	const haulSources: Array<{ id: string; x: number; y: number; amount: number }> = [];
	for (const pile of room.piles) {
		if (pile.amount >= HAUL_CONFIG.minHaulAmount) {
			haulSources.push({ id: pile.id, x: pile.x, y: pile.y, amount: pile.amount });
		}
	}
	for (const store of room.stores) {
		if (store.energy >= HAUL_CONFIG.minStoreAmount) {
			haulSources.push({ id: store.id, x: store.x, y: store.y, amount: store.energy });
		}
	}
	const ledger = createLedger(ctx);
	for (const source of haulSources) {
		const destination = pickDestination(destinations, source.x, source.y);
		if (!destination) {
			continue;
		}
		const amount = Math.min(source.amount, destination.headroom);
		const dedupeKey = `haul:${room.roomName}:${source.id}:${destination.id}`;
		expected.add(dedupeKey);
		const distance = Math.max(
			Math.abs(source.x - destination.x),
			Math.abs(source.y - destination.y),
		);
		const task = board.upsert(
			{
				dedupeKey,
				kind: "haul",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: { x: source.x, y: source.y, roomName: room.roomName },
				destId: destination.id,
				destPos: { x: destination.x, y: destination.y, roomName: room.roomName },
				resourceType: RESOURCE_ENERGY,
				amount,
				priority: priorityFor("haul") + destination.priority + bias("haul"),
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + Math.min(600, roundTripEstimate(amount, distance) + 100),
			},
			ctx.tick,
		);
		// 在途承诺入账本 (目的地 committedTo 的数据源); 合并任务若预留泄漏则补挂
		if (task.createdAt === ctx.tick || ledger.reservationIdOf(task.id) === undefined) {
			reserve(ctx, {
				owner: task.id,
				roomName: room.roomName,
				amount,
				destId: destination.id,
				...(task.deadline !== undefined ? { expiresAt: task.deadline } : {}),
			});
		}
	}

	// 消失的主体 → 取消其任务 (工地建成/移除、满仓、堆叠消失); 节流期保持存活者除外
	for (const task of board.list({ roomName: room.roomName, kinds: PLANNED_KINDS })) {
		if (!expected.has(task.dedupeKey) && task.status !== "completed" && task.status !== "cancelled") {
			board.cancel(task.id, ctx.tick, "subject-gone");
		}
	}
}

export function runEconomyPlanners(ctx: TickContext, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		planEconomyRoom(ctx, board, room);
	}
}
