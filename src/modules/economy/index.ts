/**
 * 经济系统任务源模块 (planning 阶段): 观测 → 任务意向 (docs/nexus-design/02 原则 B 局部层)。
 */
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import { createTaskBoard } from "@/modules/tasks/board";
import { runEconomyPlanners } from "@/modules/economy/planners";

export const economyModule: TickModule = {
	name: "economy-planners",
	phase: "planning",
	band: "P2",
	run(ctx: TickContext): void {
		runEconomyPlanners(ctx, createTaskBoard(ctx.memory.tasks));
	},
};
