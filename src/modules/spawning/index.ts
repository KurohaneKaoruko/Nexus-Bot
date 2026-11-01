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

// ── 公共面: 任务池 / 任务更新器 / 孵化执行 ──
export {
	addMissionToPool,
	deleteMissionFromPool,
	getAllMissionFromPool,
	getMissionNumInPool,
} from "@/modules/spawning/mission/pool/MissionPools";
export { default as MissionSubmit } from "@/modules/spawning/mission/pool/MissionSubmit";
export { default as SpawnMission } from "@/modules/spawning/mission/updaters/spawnMission";
export { directSpawn } from "@/modules/spawning/spawnDirector";
export { buildBody } from "@/modules/spawning/bodyFactory";
