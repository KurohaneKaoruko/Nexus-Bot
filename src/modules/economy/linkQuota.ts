/**
 * 中心 link 调拨供给 (specs/mission-pool-retirement manage 行):
 * manager 的 link 调拨语义迁任务板——中心 link (布局中心 1 格内且 storage 2 格内)
 * 与 storage 间的能量搬运按水位产 carry 任务:
 * - 兄弟 link (控制器/普通) 饥饿 (<linkStarveAmount) 且中心 link 有空间 → storage 补中心 link;
 * - 无饥饿兄弟且中心 link 有能量 → 中心 link 回 storage。
 * link 分区口径与 planLinkTransfer 一致 (源 link 2 格内排除、控制器 link 2 格内);
 * 纯函数核心 + 原生房读取包装, planners 在 carry 规划段接入。
 */
import { LINK_TRANSFER_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import { getRoomData } from "@/core/store/accessor";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { reserve } from "@/modules/economy/ledger";

/** link 结构视图 (纯数据, 单测直喂) */
export interface LinkStructureView {
	id: string;
	x: number;
	y: number;
	energy: number;
	energyCapacity: number;
}

/** link 调拨规划输入 (纯数据) */
export interface LinkTransferView {
	roomName: string;
	/** 布局中心 (RoomData.center, 缺省 25,25 — getCenter 同源口径) */
	center: { x: number; y: number };
	storage: { id: string; x: number; y: number; energy: number; energyCapacity: number } | null;
	controller: { x: number; y: number } | null;
	sources: Array<{ x: number; y: number }>;
	links: LinkStructureView[];
}

/** 调拨计划: 一个中心 link 至多一条 (drain: link→storage / fill: storage→link) */
export interface LinkTransferPlan {
	dedupeKey: string;
	direction: "drain" | "fill";
	linkId: string;
	linkPos: { x: number; y: number };
	amount: number;
	sourceId: string;
	sourcePos: { x: number; y: number };
	destId: string;
	destPos: { x: number; y: number };
}

/** 欧几里得射程判定 (RoomPosition.inRangeTo 同口径) */
const inRange = (ax: number, ay: number, bx: number, by: number, range: number): boolean => {
	const dx = ax - bx;
	const dy = ay - by;
	return dx * dx + dy * dy <= range * range;
};

/** link 调拨规划 (纯函数): 返回当 tick 应存续的调拨计划集 */
export function planLinkTransfers(view: LinkTransferView): LinkTransferPlan[] {
	const storage = view.storage;
	if (!storage) return [];
	let manage: LinkStructureView | null = null;
	let controllerLink: LinkStructureView | null = null;
	const normal: LinkStructureView[] = [];
	for (const link of view.links) {
		if (view.sources.some((source) => inRange(link.x, link.y, source.x, source.y, 2))) continue;
		if (view.controller && inRange(link.x, link.y, view.controller.x, view.controller.y, 2)) {
			controllerLink = link;
			continue;
		}
		if (
			inRange(link.x, link.y, view.center.x, view.center.y, 1) &&
			inRange(link.x, link.y, storage.x, storage.y, 2)
		) {
			manage = link;
			continue;
		}
		normal.push(link);
	}
	if (!manage) return [];

	const starving =
		(controllerLink !== null &&
			controllerLink.energy < LINK_TRANSFER_CONFIG.linkStarveAmount) ||
		normal.some((link) => link.energy < LINK_TRANSFER_CONFIG.linkStarveAmount);
	const storageFree = storage.energyCapacity - storage.energy;
	const key = `carry:link:${view.roomName}:${manage.id}`;

	if (starving) {
		// 补货: storage → 中心 link (link 网络路由的前提库存)
		const free = manage.energyCapacity - manage.energy;
		if (free < LINK_TRANSFER_CONFIG.fillMinFreeCapacity || storage.energy <= 0) return [];
		return [
			{
				dedupeKey: key,
				direction: "fill",
				linkId: manage.id,
				linkPos: { x: manage.x, y: manage.y },
				amount: Math.min(free, storage.energy),
				sourceId: storage.id,
				sourcePos: { x: storage.x, y: storage.y },
				destId: manage.id,
				destPos: { x: manage.x, y: manage.y },
			},
		];
	}

	// 回收: 无饥饿兄弟时中心 link 余量回 storage (原 planLinkTransfer >0 口径)
	if (manage.energy <= 0 || storageFree <= 0) return [];
	return [
		{
			dedupeKey: key,
			direction: "drain",
			linkId: manage.id,
			linkPos: { x: manage.x, y: manage.y },
			amount: Math.min(manage.energy, storageFree),
			sourceId: manage.id,
			sourcePos: { x: manage.x, y: manage.y },
			destId: storage.id,
			destPos: { x: storage.x, y: storage.y },
		},
	];
}

/**
 * 原生房读取 + 任务板 upsert 包装 (planners carry 段接入):
 * link 细节不在感知快照内, 提交阶段读原生房 (planners 消费 Game.rooms 先例);
 * expected 协议: 存续键入集, 条件消失由 planner 主题清扫收口。
 */
export function upsertLinkCarryTasks(
	ctx: TickContext,
	board: TaskBoard,
	room: RoomObservation,
	priority: number,
	expected: Set<string>,
): void {
	if (room.linkCount <= 0) return;
	const nativeRoom = Game.rooms[room.roomName];
	if (!nativeRoom || !nativeRoom.controller?.my) return;
	const storageSummary = room.stores.find((store) => store.structureType === "storage");
	if (!storageSummary) return;

	const center = getRoomData(room.roomName)?.center ?? { x: 25, y: 25 };
	const links = nativeRoom
		.find(FIND_MY_STRUCTURES)
		.filter((structure): structure is StructureLink => structure.structureType === "link")
		.map((link) => ({
			id: link.id,
			x: link.pos.x,
			y: link.pos.y,
			energy: link.store[RESOURCE_ENERGY],
			energyCapacity: link.store.getCapacity(RESOURCE_ENERGY),
		}));

	const plans = planLinkTransfers({
		roomName: room.roomName,
		center,
		storage: {
			id: storageSummary.id,
			x: storageSummary.x,
			y: storageSummary.y,
			energy: storageSummary.energy,
			energyCapacity: storageSummary.energyCapacity,
		},
		controller: room.controller ? { x: room.controller.x, y: room.controller.y } : null,
		sources: room.sources.map((source) => ({ x: source.x, y: source.y })),
		links,
	});

	for (const plan of plans) {
		expected.add(plan.dedupeKey);
		const task = board.upsert(
			{
				dedupeKey: plan.dedupeKey,
				kind: "carry",
				roomName: room.roomName,
				targetId: plan.sourceId,
				targetPos: { x: plan.sourcePos.x, y: plan.sourcePos.y, roomName: room.roomName },
				destId: plan.destId,
				destPos: { x: plan.destPos.x, y: plan.destPos.y, roomName: room.roomName },
				resourceType: RESOURCE_ENERGY,
				amount: plan.amount,
				priority,
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + 200,
			},
			ctx.tick,
		);
		if (task.createdAt === ctx.tick) {
			reserve(ctx, {
				owner: task.id,
				roomName: room.roomName,
				amount: plan.amount,
				destId: plan.destId,
				...(task.deadline !== undefined ? { expiresAt: task.deadline } : {}),
			});
		}
	}
}
