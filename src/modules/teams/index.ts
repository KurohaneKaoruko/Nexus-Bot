
/**
 * Team 模块入口。
 *
 * @remarks
 * - TeamSpawner：负责从旗帜/指令生成队伍与孵化任务（生成端）
 * - TeamController：负责驱动队伍与队员的运行逻辑（执行端）
 * - Teams：正式 TickModule 挂载（commit 阶段，先孵化后控制——原 SupportModules 驱动时序）
 * - Nukes：核弹打击请求处理（原 NukeModule App 壳承接, commit 主段）
 */
import type { TickContext, TickModule } from "@/core";
import TeamSpawner from "@/modules/teams/runtime/TeamSpawner";
import TeamController from "@/modules/teams/runtime/TeamController";
import { NukeModule } from "@/modules/teams/NukeModule";

export { TeamSpawner, TeamController };

export const Teams: TickModule = {
	name: "teams",
	phase: "commit",
	band: "P2",
	run(_ctx: TickContext): void {
		TeamSpawner.run();
		TeamController.run();
	},
};

export const Nukes: TickModule = {
	name: "nukes",
	phase: "commit",
	band: "P2",
	run(_ctx: TickContext): void {
		NukeModule.tick?.();
	},
};
