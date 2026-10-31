/**
 * 移动意图生命周期窗口: tick 开头重置, 所有 commit 移动生产模块之后统一结算。
 *
 * MovementStart 必须在入口模块清单首位注册, 先于 perception 阶段任何模块;
 * MovementEnd 必须在所有 commit 移动生产模块之后、可视化消费者之前注册。
 * 新增晚于 MovementEnd 的移动生产模块会重现移动意图跨 tick 丢失。
 */
import type { TickContext, TickModule } from "@/core";
import { betterMoveApi } from "@/modules/movement";
import { updateCongestion } from "@/modules/movement/trafficMonitor";

/** 工作位判定 (不在岗位必须返回 true, 即可被交通调度让位) */
export function isWorkTile(creep: Creep | PowerCreep, _pos: RoomPosition): boolean {
	if (!(creep instanceof Creep)) {
		return true;
	}
	const taskId = creep.memory?.taskId;
	// 持久化根是 Memory.Nexus (大写, 与 calibration / accessor 同键); 曾误读小写 nexus 致恒 undefined、工位锁失效
	const nexus = Memory.Nexus;
	if (!taskId || !nexus) {
		return true;
	}
	const task = nexus.tasks[taskId];
	if (!task || task.kind !== "harvest" || !task.targetId) {
		return true;
	}
	const worksite = nexus.rooms[creep.room.name]?.worksites?.[task.targetId];
	if (worksite) {
		// 钉在固定驻点上的采集工不被推开
		return !(creep.pos.x === worksite.x && creep.pos.y === worksite.y);
	}
	// 驻点缓存缺失时的兜底: 贴源采集视为在岗
	return !creep.pos.findInRange(FIND_SOURCES, 1).some((source) => source.id === task.targetId);
}

/** tick 开头清空上一 tick 的移动意图与缓存; 不依赖 world.current */
export const MovementStart: TickModule = {
	name: "movement-start",
	phase: "perception",
	band: "P0",
	run(): void {
		betterMoveApi.preTickBetterMove();
	},
};

/** commit 末段统一结算移动; 必须在全部 commit 移动生产模块之后执行 */
export const MovementEnd: TickModule = {
	name: "movement-end",
	phase: "commit",
	band: "P0",
	run(ctx: TickContext): void {
		betterMoveApi.endTickResolve(isWorkTile);
		// 位置差分在移动解算后进行 (拥堵检测)
		const world = ctx.world.current;
		if (world) {
			updateCongestion(ctx, world);
		}
	},
};
