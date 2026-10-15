/**
 * 任务系统模块 (reconcile 阶段): 对账 (死亡/租约/失效回收) + 贪心分配。
 */
import type { TickContext, TickModule } from "@/core";

import { aliveNames } from "@/core/world";
import { createTaskBoard } from "@/modules/tasks/board";
import { assignBatch, profileOf } from "@/modules/tasks/allocator";
import { maintainLedger } from "@/modules/economy";
import { roomModeProfileFor } from "@/modules/strategy";

export const Tasks: TickModule = {
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
		// 账本对账: 过期/主体消失的预留清理 (函数契约"reconcile 阶段调用一次", 之前漏接导致预留只增不减)
		// 预留随任务终态释放 (specs/controller-supply-line): 取消/失败/完成的任务
		// 不再持有在途承诺——否则 cancelled 任务的预留压死目的地 headroom (50k 普查实锤)
		maintainLedger(ctx, (owner) => {
			const task = board.get(owner);
			return (
				task !== undefined &&
				task.status !== "completed" &&
				task.status !== "cancelled" &&
					task.status !== "failed"
			);
		});

		const profiles = Object.values(world.rooms).flatMap((room) =>
			room.creeps.filter((creep) => !creep.spawning).map(profileOf),
		);
		// 亲和排他分档 (bugs (十三)): 全场任一房启用 courier 投喂经济 (churn 期
		// 升级体兼差孵化线是承重的) 即关; 全部无 courier 的 main 系才开
		const affinityExclusive = !Object.values(world.rooms).some((room) =>
			roomModeProfileFor(ctx, room.roomName).courierEnabled,
		);
		assignBatch({
			now: ctx.tick,
			tasks: board.list({ statuses: ["available"] }),
			profiles,
			world,
			affinityExclusive,
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

export { createTaskBoard, type TaskBoard } from "./board";
