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
	checkSameMissionInPool,
	deleteMissionFromPool,
	getAllMissionFromPool,
	getMissionNumInPool,
	submitMission,
	updateMissionPool,
} from "@/modules/spawning/mission/pool/MissionPools";
export { default as Mission } from "@/modules/spawning/mission";
export { default as MissionSubmit } from "@/modules/spawning/mission/pool/MissionSubmit";
export { default as ManageMission, ManageTaskGetter } from "@/modules/spawning/mission/updaters/manageMission";
export { default as WorkMission, WorkTaskGetter } from "@/modules/spawning/mission/updaters/workMission";
export { default as MineMission } from "@/modules/spawning/mission/updaters/mineMission";
export { default as SpawnMission, SpawnTaskGetter } from "@/modules/spawning/mission/updaters/spawnMission";
export { default as BoostMission } from "@/modules/spawning/mission/updaters/boostMission";
export { default as TransportMission, TransportTaskGetter } from "@/modules/spawning/mission/updaters/transportMission";
export { default as SpawnControl } from "@/modules/spawning/legacy/spawnControl";
export { directSpawn } from "@/modules/spawning/spawnDirector";
export { buildBody } from "@/modules/spawning/bodyFactory";
