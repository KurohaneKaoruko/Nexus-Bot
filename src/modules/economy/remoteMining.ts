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

/** 邻房名计算 (正角 4 向 + 对角 4 向)。Screeps 世界坐标: E1=1, W1=0, W2=-1 … (W 数字从 0 镜像) */
function neighborRooms(roomName: string): string[] {
	const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
	if (!match) return [];
	const xDir = match[1] ?? "W";
	const xDigits = match[2] ?? "0";
	const yDir = match[3] ?? "N";
	const yDigits = match[4] ?? "0";
	// W 数字转世界坐标须按 0 点镜像: W1=0, W2=-1, W(n)=-(n-1); E 数字即本身
	const toWorldX = (dir: string, digits: string) =>
		dir === "E" ? parseInt(digits, 10) : -(parseInt(digits, 10) - 1);
	const toWorldY = (dir: string, digits: string) =>
		dir === "N" ? parseInt(digits, 10) : -(parseInt(digits, 10) - 1);
	const x = toWorldX(xDir, xDigits);
	const y = toWorldY(yDir, yDigits);
	const toRoomX = (worldX: number) => (worldX >= 0 ? `E${worldX}` : `W${-worldX + 1}`);
	const toRoomY = (worldY: number) => (worldY >= 0 ? `N${worldY}` : `S${-worldY + 1}`);
	const rooms: string[] = [];
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (dx === 0 && dy === 0) continue;
			rooms.push(`${toRoomX(x + dx)}${toRoomY(y + dy)}`);
		}
	}
	return rooms;
}

/**
 * 外矿任务产出 (remoteMining 政策, 用户口径 2026-10-15):
 * - "auto" (仅 rush): 自动扫描发展——邻房不可见派 scout, 可见无主即登记采集;
 * - "manual" (main 系): 只挖 Memory.Nexus.economy.remoteTargets 显式登记的源,
 *   未登记的邻房一概不碰 (侦查也不派);
 * - "off": 不挖。
 */
export function planRemoteHarvest(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
): void {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (profile.remoteMining === "off") return;
	// RCL3 起才开外矿 (含 auto 档): ① harvester 体型要到 RCL3 预算档 (≥650) 才带
	// 1-CARRY 下限, 无 carry 的远程件只会在外矿 drop 堆积、永不返程 (sim 实证采集
	// 167k→150k 净负); ② 低 RCL 孵化槽紧, 外矿件会掏空本地采集面。冲级收入靠
	// RCL3 后的外矿增量 (L4 段), 不抢 L3 前的本地窗口。
	if (room.rcl < 3) return;

	if (profile.remoteMining === "manual") {
		const targets = ctx.memory.economy.remoteTargets ?? [];
		for (const targetRoomName of targets) {
			const remoteRoom = Game.rooms[targetRoomName];
			// 无视野: 对手动指定的房间定向侦查 (不扫列表外邻房)
			if (!remoteRoom) {
				board.upsert({
					dedupeKey: `scout:${room.roomName}:${targetRoomName}`,
					kind: "scout",
					roomName: room.roomName,
					targetPos: { x: 25, y: 25, roomName: targetRoomName },
					priority: priorityFor("scout"),
					requiredCapabilities: ["move"],
				}, ctx.tick);
				continue;
			}
			if (remoteRoom.controller?.my) continue;
			if (remoteRoom.controller?.owner || remoteRoom.controller?.reservation) continue;
			for (const source of remoteRoom.find(FIND_SOURCES)) {
				board.upsert({
					dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
					kind: "harvest",
					roomName: room.roomName,
					targetId: source.id,
					targetPos: {
						x: source.pos.x,
						y: source.pos.y,
						roomName: targetRoomName,
					},
					priority: priorityFor("harvest") - 10, // 低于本矿
					requiredCapabilities: ["work", "move"],
				}, ctx.tick);
			}
		}
		return;
	}

	// auto 档发展房上限: 按 neighborRooms 固定顺序确定性选取, 防止 8 邻房全开
	// 抬高定编淹没孵化队列 (历史 rush 控制冻结机理)。产出任务 (scout/harvest)
	// 的房才消耗配额; 有主/无源的房跳过不占坑。
	let budget = profile.remoteAutoMaxRooms ?? Number.POSITIVE_INFINITY;
	for (const neighborName of neighborRooms(room.roomName)) {
		if (budget <= 0) break;
		const neighbor = Game.rooms[neighborName];
		// 无视野邻房: 派侦查 (到达获视野后由采集任务自然接替)
		if (!neighbor) {
			board.upsert({
				dedupeKey: `scout:${room.roomName}:${neighborName}`,
				kind: "scout",
				roomName: room.roomName,
				targetPos: { x: 25, y: 25, roomName: neighborName },
				priority: priorityFor("scout"),
				requiredCapabilities: ["move"],
			}, ctx.tick);
			budget -= 1;
			continue;
		}
		if (neighbor.controller?.my) continue; // 己方房跳过
		if (neighbor.controller?.owner || neighbor.controller?.reservation) continue; // 有主之地不开矿
		const sources = neighbor.find(FIND_SOURCES);
		if (sources.length === 0) continue; // 无源房不占发展配额
		budget -= 1;
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
