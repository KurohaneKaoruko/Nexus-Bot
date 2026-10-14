/**
 * 可视化模块 (commit 阶段)：主状态面板（左上）+ 冲级面板（左下）+ spawn 孵化标注
 * + lab 产物标注 + 布局规划图（旗标触发, ~1 CPU 慎常开）。
 */
import type { TickContext, TickModule } from "@/core";

import {
	drawSpawnInfo,
	drawLabInfo,
	drawLayoutVisual,
	raceVisual,
} from "@/modules/visuals/roomVisuals";
import { drawStatusPanel } from "@/modules/visuals/statusPanel";

export const Visuals: TickModule = {
	name: "visuals",
	phase: "commit",
	band: "P0",
	run(ctx: TickContext): void {
		drawStatusPanel(ctx);
		if (typeof Game === "undefined") return;
		for (const room of Object.values(Game.rooms)) {
			if (!room.controller?.my) continue;
			raceVisual(room);
			drawSpawnInfo(room.find(FIND_MY_SPAWNS));
			drawLabInfo(room.find(FIND_MY_STRUCTURES, {
				filter: (s) => s.structureType === STRUCTURE_LAB,
			}) as StructureLab[], room);
			drawLayoutVisual(room);
		}
	},
};
