/**
 * 任务系统模块 (reconcile 阶段): 对账 (死亡/租约/失效回收) + 贪心分配。
 */
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import { aliveNames } from "@/core/world";
import { createTaskBoard } from "@/modules/tasks/board";
import { assignBatch, profileOf } from "@/modules/tasks/allocator";

export const tasksModule: TickModule = {
	name: "task-system",
	phase: "reconcile",
	band: "P1",
	run(ctx: TickContext): void {
		const world = ctx.world.current;
		if (!world) {
			return;
		}
		const board = createTaskBoard(ctx.memory.tasks);
		const alive = aliveNames(world);
		board.reconcile(ctx.tick, { isAlive: (name) => alive.has(name) });

		const profiles = Object.values(world.rooms).flatMap((room) =>
			room.creeps.filter((creep) => !creep.spawning).map(profileOf),
		);
		assignBatch({
			now: ctx.tick,
			tasks: board.list({ statuses: ["available"] }),
			profiles,
			world,
			currentTaskOf: (name) => Game.creeps[name]?.memory.taskId,
			getTask: (id) => board.get(id),
			claim: (id, name, now, leaseTicks) => {
				const creep = Game.creeps[name];
				if (!creep) {
					return false;
				}
				// 抢占切换: 释放旧租约 (任务回池), 保证单一租约不变量
				const current = creep.memory.taskId;
				if (current !== undefined && current !== id) {
					board.release(current, name, now, "preempted");
				}
				const ok = board.claim(id, name, now, leaseTicks);
				if (ok) {
					creep.memory.taskId = id;
				}
				return ok;
			},
		});
	},
};
