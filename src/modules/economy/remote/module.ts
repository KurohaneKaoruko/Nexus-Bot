/**
 * 外矿子系统模块 (phase4 4.4): remote-planner 的调度壳。
 *
 * 注册在 economy-planners 之后、spawn 阶段之前 (docs/24 §24.13);
 * 每 planInterval tick 或外矿事件触发主循环 (死亡/威胁/Intel 更新
 * 的事件化在防御联动节接入, 先按周期跑)。
 * 评估 (PathFinder) 每轮 ≤ evalPerRun 条, 属昂贵分析, 模块内自限。
 */
import type { TickContext, TickModule } from "@/core";
import { createTaskBoard } from "@/modules/tasks";
import { planRemoteColony } from "@/modules/economy/remote/planner";
import { REMOTE_CONFIG } from "@/config/remote";

export const RemoteMining: TickModule = {
	name: "remote-planner",
	phase: "planning",
	band: "P2",
	run(ctx: TickContext): void {
		if (ctx.tick % REMOTE_CONFIG.planInterval !== 0) return;
		const board = createTaskBoard(ctx.memory.tasks);
		const world = ctx.world.current;
		if (!world) return;
		for (const room of Object.values(world.rooms)) {
			planRemoteColony(ctx, room, board);
		}
	},
};
