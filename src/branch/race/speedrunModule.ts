// @ts-nocheck
/**
 * 冲级直通模块: 把 speedrun 固定布局引擎挂进 Nexus 调度链。
 *
 * 挂载即接管: 本模块注册时, 入口不再装配 Agents (betterMove 覆写在
 * Agents 的 preTick/endTickResolve 之间结算, 会吃掉 speedrun 引擎依赖的
 * 裸 move/moveTo 语义)——race 分支的模块清单差异就在于此。
 *
 * P0 + commit 阶段: 冲级引擎必须每 tick 完整跑 (预算门/熔断都不适用),
 * 放在链尾独占, 主链其余阶段 (perception 等) 在冲级服上不产生副作用面。
 */
import type { TickModule } from "@/core";
import { loop as speedrunLoop } from "./speedrun/loop";

export const RaceSpeedrun: TickModule = {
	name: "race-speedrun",
	phase: "commit",
	band: "P0",
	run(): void {
		speedrunLoop();
	},
};
