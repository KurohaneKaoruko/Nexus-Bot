/**
 * 扩张决策: RCL≥3 且 GCL 允许时, 寻找最近未占有房产出 claim 任务。
 * claimer 走任务板 (kind=claim), 声称后新房自动进入感知 → 全模块接管。
 */
import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";
import { orthogonalNeighbors } from "@/utils/roomCoord";

/** 扩张条件: 有己方房 RCL≥3 且 GCL 有余量; 否决时输出原因 (bugs/P1-17 不静默) */
function canExpand(ctx: TickContext): { allowed: boolean; reason?: string } {
	const world = ctx.world.current;
	if (!world) return { allowed: false };
	const hasRcl3 = Object.values(world.rooms).some((r) => r.rcl >= 3);
	if (!hasRcl3) return { allowed: false, reason: "no-rcl3-room" };
	if (Game.gcl.level <= Object.keys(world.rooms).length) {
		return {
			allowed: false,
			reason: `gcl-exhausted (gcl=${Game.gcl.level} rooms=${Object.keys(world.rooms).length})`,
		};
	}
	return { allowed: true };
}

/** 找最近的未占有邻房 (E/W 镜像换算经 utils/roomCoord, bugs/P1-17) */
function findExpandTarget(ctx: TickContext): string | null {
	const world = ctx.world.current;
	if (!world) return null;
	for (const room of Object.values(world.rooms)) {
		if (room.rcl < 3) continue;
		for (const name of orthogonalNeighbors(room.roomName)) {
			const game = Game.rooms[name];
			if (!game) continue;
			if (game.controller?.my) continue;
			if (game.controller?.owner) continue; // 已有主人
			return name;
		}
	}
	return null;
}

const EXPAND_LOG_INTERVAL = 1000;

/** 上次 GCL 否决日志 tick (限频) */
let lastVetoLogTick = -EXPAND_LOG_INTERVAL;

export function planExpansion(ctx: TickContext, board: TaskBoard): void {
	const gate = canExpand(ctx);
	if (!gate.allowed) {
		// GCL 门槛否决时限频输出原因 (bugs/P1-17: 不再静默短路)
		if (gate.reason?.startsWith("gcl-exhausted") && ctx.tick - lastVetoLogTick >= EXPAND_LOG_INTERVAL) {
			lastVetoLogTick = ctx.tick;
			console.log(`[expansion.veto] ${gate.reason} — 有 RCL3 房但无 GCL 余量, 扩张暂停`);
		}
		return;
	}
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
