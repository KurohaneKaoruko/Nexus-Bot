/**
 * SK 房 lair 撤离节律 (docs/nexus-design/13 §24.2 四期, remote-keeper 3.1):
 * lair 临近刷新 (Intel nextSpawnAt 进入 avoidWindow) 且采集单位在其半径内 →
 * 高优 move 撤离到安全距离。规划/执行同读 RoomIntelRecord.lairs 一张表。
 */
import type { TickContext } from "@/core";
import type { ActionBroker } from "@/modules/agents";
import type { CreepSummary } from "@/core/world";
import type { NexusTask } from "@/core/store/taskSchema";

function dist(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * 采集单位处于 lair 刷新危险窗口 → 提交撤离 move, 返回 true (本 tick 撤离优先)。
 * 口径: nextSpawnAt - tick ≤ avoidWindow 且单位与 lair 距离 ≤ avoidRadius。
 */
export function submitSkLairAvoid(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	avoidWindow: number,
	avoidRadius: number,
): boolean {
	const targetRoom = task.targetPos?.roomName;
	if (!targetRoom || creep.roomName !== targetRoom) return false;
	const lairs = ctx.memory.rooms[targetRoom]?.lairs ?? [];
	for (const lair of lairs) {
		const next = lair.nextSpawnAt;
		if (next === undefined || next - ctx.tick > avoidWindow) continue;
		if (dist(creep.x, creep.y, lair.x, lair.y) > avoidRadius) continue;
		// 撤向远离 lair 的延长线 8 格外 (同房内近似安全点)
		const dx = creep.x - lair.x;
		const dy = creep.y - lair.y;
		const len = Math.max(1, Math.abs(dx) + Math.abs(dy));
		const safeX = Math.min(48, Math.max(1, Math.round(creep.x + (dx / len) * 8)));
		const safeY = Math.min(48, Math.max(1, Math.round(creep.y + (dy / len) * 8)));
		broker.submit({
			id: `${creep.name}-skflee-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "move" as const,
			targetPos: { x: safeX, y: safeY, roomName: targetRoom },
			priority: task.priority + 20,
			pipeline: "move",
			reason: "sk-lair-window",
			dedupeKey: `${creep.name}:skflee:${task.id}`,
		});
		return true;
	}
	return false;
}
