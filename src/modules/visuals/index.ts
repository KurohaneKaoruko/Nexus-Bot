/**
 * 可视化模块 (commit 阶段)：冲级面板 + 孵化标注。
 * 面板渲染自 Room 对象（含 visual），不需要 WorldView 快照。
 */
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import { drawSpawnInfo, raceVisual } from "@/modules/visuals/roomVisuals";

export const visualsModule: TickModule = {
	name: "visuals",
	phase: "commit",
	band: "P0",
	run(_ctx: TickContext): void {
		if (typeof Game === "undefined") return;
		for (const room of Object.values(Game.rooms)) {
			if (!room.controller?.my) continue;
			raceVisual(room);
			drawSpawnInfo(room.find(FIND_MY_SPAWNS));
		}
	},
};
