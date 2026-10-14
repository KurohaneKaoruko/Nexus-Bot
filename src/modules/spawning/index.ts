/**
 * 生产模块 (spawn 阶段): 死亡单位记录回收 + 缺口驱动的生产排程。
 */
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { runSpawnDirector } from "@/modules/spawning/spawnDirector";

export const Spawning: TickModule = {
	name: "spawn-director",
	phase: "spawn",
	band: "P1",
	run(ctx: TickContext): void {
		runSpawnDirector(ctx, createTaskBoard(ctx.memory.tasks));
	},
};
