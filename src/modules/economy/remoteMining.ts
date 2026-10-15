/**
 * 外矿同名-unit 实现: 侦查邻房 → 记录远程 source → 产出跨房采集任务。
 * 远程 harvester 与本矿同名 (memory.targetRoom 区分), 任务 kind 仍为 harvest。
 * 侦查无状态化: 邻房不可见时产出 scout 任务 (到达即获视野), 可见时产出采集任务。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";
import { roomModeProfileFor } from "@/modules/strategy";

/** 邻房名计算 (正角 4 向 + 对角 4 向) */
function neighborRooms(roomName: string): string[] {
	const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
	if (!match) return [];
	const ex = match[2] ?? "0"; const ny = match[4] ?? "0";
	const x = parseInt(ex, 10) || 0;
	const y = parseInt(ny, 10) || 0;
	const rooms: string[] = [];
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (dx === 0 && dy === 0) continue;
			const nx = x + dx;
			const ny2 = y + dy;
			const xDir = nx >= 0 ? "E" : "W";
			const yDir = ny2 >= 0 ? "N" : "S";
			rooms.push(`${xDir}${Math.abs(nx)}${yDir}${Math.abs(ny2)}`);
		}
	}
	return rooms;
}

/**
 * 外矿任务产出:
 * - 邻房不可见 → scout 任务 (每房一个, 到达获视野后由采集任务自然接替);
 * - 邻房可见且非己方 → 每远程 source 一个采集任务 (roomName = 本源房, targetPos = 远程)。
 */
export function planRemoteHarvest(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
): void {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (!profile.remoteMining) return;
	if (room.rcl < 3) return;

	for (const neighborName of neighborRooms(room.roomName)) {
		const neighbor = Game.rooms[neighborName];
		// 无视野邻房: 派侦查 (RCL3 起经济余量才养侦查件)
		if (!neighbor) {
			board.upsert({
				dedupeKey: `scout:${room.roomName}:${neighborName}`,
				kind: "scout",
				roomName: room.roomName,
				targetPos: { x: 25, y: 25, roomName: neighborName },
				priority: priorityFor("scout"),
				requiredCapabilities: ["move"],
			}, ctx.tick);
			continue;
		}
		if (neighbor.controller?.my) continue; // 己方房跳过
		if (neighbor.controller?.owner || neighbor.controller?.reservation) continue; // 有主之地不开矿
		const sources = neighbor.find(FIND_SOURCES);
		for (const source of sources) {
			board.upsert({
				dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
				kind: "harvest",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: {
					x: source.pos.x,
					y: source.pos.y,
					roomName: neighborName,
				},
				priority: priorityFor("harvest") - 10, // 低于本矿
				requiredCapabilities: ["work", "move"],
			}, ctx.tick);
		}
	}
}

/** 活跃远程采集任务数 (定编口径: 本矿 harvester 编制 = 本矿源数 + 远程任务数) */
export function activeRemoteHarvestCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["harvest"] })) {
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/** 活跃侦查任务数 (定编口径: scout 编制 = min(1, 活跃 scout 任务)) */
export function activeScoutCount(ctx: TickContext, board: TaskBoard): number {
	const tasks = board.list({ kinds: ["scout"] });
	return tasks.length > 0 ? 1 : 0;
}
