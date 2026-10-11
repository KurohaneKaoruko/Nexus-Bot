/**
 * 生产模块 (spawn 阶段): 死亡单位记录回收 + 缺口驱动的生产排程。
 */
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import { createTaskBoard } from "@/modules/tasks/board";
import { runSpawnDirector } from "@/modules/spawning/spawnDirector";

export const spawnModule: TickModule = {
	name: "spawn-director",
	phase: "spawn",
	band: "P1",
	run(ctx: TickContext): void {
		runSpawnDirector(ctx, createTaskBoard(ctx.memory.tasks));
	},
};
