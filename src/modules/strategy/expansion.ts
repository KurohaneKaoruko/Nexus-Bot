/**
 * 扩张决策: RCL≥3 且 GCL 允许时, 寻找最近未占有房产出 claim 任务。
 * claimer 走任务板 (kind=claim), 声称后新房自动进入感知 → 全模块接管。
 */
import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";

/** 扩张条件: 有己方房 RCL≥3 且 GCL 有余量 */
function canExpand(ctx: TickContext): boolean {
	const world = ctx.world.current;
	if (!world) return false;
	const hasRcl3 = Object.values(world.rooms).some((r) => r.rcl >= 3);
	if (!hasRcl3) return false;
	return Game.gcl.level > Object.keys(world.rooms).length;
}

/** 找最近的未占有邻房 */
function findExpandTarget(ctx: TickContext): string | null {
	const world = ctx.world.current;
	if (!world) return null;
	for (const room of Object.values(world.rooms)) {
		if (room.rcl < 3) continue;
		// 正交 4 向邻房
		const match = room.roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
		if (!match) continue;
		const x = parseInt(match[2] ?? "0", 10) || 0;
		const y = parseInt(match[4] ?? "0", 10) || 0;
		const candidates = [
			`E${x}N${y + 1}`, `E${x}N${y - 1}`,
			`E${x + 1}N${y}`, `E${x - 1}N${y}`,
		];
		for (const name of candidates) {
			const game = Game.rooms[name];
			if (!game) continue;
			if (game.controller?.my) continue;
			if (game.controller?.owner) continue; // 已有主人
			if (!game.controller?.reservation || game.controller.reservation.username !== (Game as any).username) return name;
			return name;
		}
	}
	return null;
}

export function planExpansion(ctx: TickContext, board: TaskBoard): void {
	if (!canExpand(ctx)) return;
	const target = findExpandTarget(ctx);
	if (!target) return;
	// 已有活 claim 任务不重复
	for (const task of Object.values(ctx.memory.tasks)) {
		if (task.kind === "claim" && task.status !== "completed" && task.status !== "cancelled") return;
	}
	const controller = Game.rooms[target]?.controller;
	if (!controller) return;
	board.upsert({
		dedupeKey: `claim:${target}`,
		kind: "claim",
		roomName: target,
		targetId: controller.id,
		targetPos: { x: controller.pos.x, y: controller.pos.y, roomName: target },
		priority: priorityFor("claim"),
		requiredCapabilities: ["claim", "move"],
	}, ctx.tick);
}
