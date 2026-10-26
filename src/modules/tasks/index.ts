/**
 * 任务系统模块 (reconcile 阶段): 对账 (死亡/租约/失效回收) + 贪心分配。
 */
import type { TickContext, TickModule } from "@/core";

import { aliveNames } from "@/core/world";
import { createTaskBoard, TERMINAL_STATUSES } from "@/modules/tasks/board";
import { assignBatch, profileOf } from "@/modules/tasks/allocator";
import { maintainLedger } from "@/modules/economy";
import { roomModeProfileFor } from "@/modules/strategy";

export const Tasks: TickModule = {
	name: "task-system",
	phase: "reconcile",
	band: "P1",
	run(ctx: TickContext): void {
		const world = ctx.world.current;
		if (!world) {
			return;
		}
		const board = createTaskBoard(ctx.memory.tasks);
		// 跨 run 残留清理 (实服 4wt 重开路径): 服务器重置清 Game 对象但 Memory
		// 持久, 旧 run 的任务 (roomName 指向已非我房的房间) 无人生产无人认领,
		// 永生堆积抬定编。claim 任务例外——roomName 本就是待声称的目标房。
		// 第二判据: 远程经济任务 (harvest/carry, 目标房 ≠ 挂靠房) 的目标房已无
		// 视野且挂靠房也非我房时失效——旧世界的远程采集任务 targetId 已死,
		// 领到的矿工只会站桩到老死 (run#20 实服事故); 视野存活期内不误杀
		// (scout 点亮→planRemoteHarvest 重建同键任务, 断视野窗口由租约回收兜底)。
		const myRoomNames = new Set(Object.keys(world.rooms));
		for (const task of Object.values(ctx.memory.tasks)) {
			if (TERMINAL_STATUSES.has(task.status)) {
				continue;
			}
			const targetRoomName = task.targetPos?.roomName;
			const remoteEconomic =
				(task.kind === "harvest" || task.kind === "carry") &&
				targetRoomName !== undefined &&
				targetRoomName !== task.roomName;
			const targetVisible = targetRoomName !== undefined && Game.rooms[targetRoomName] !== undefined;
			if (
				task.kind !== "claim" &&
				!myRoomNames.has(task.roomName) &&
				!remoteEconomic
			) {
				board.cancel(task.id, ctx.tick, "room-lost");
			} else if (remoteEconomic && !targetVisible) {
				// 挂靠房仍在我手时放过无视野的远程任务: planner 会持续重建同键
				// 任务, 砍了是清理/planner 的每 tick 自杀循环 (sim 实证 remote
				// harvest 恒 cancelled, 外矿收入线永远连不起来)。挂靠房也丢了
				// 才是真残留 (run#20 口径)。
				if (!myRoomNames.has(task.roomName)) {
					board.cancel(task.id, ctx.tick, "room-lost");
				}
			}
		}
		const alive = aliveNames(world);
		board.reconcile(ctx.tick, { isAlive: (name) => alive.has(name) });
		// 账本对账: 过期/主体消失的预留清理 (函数契约"reconcile 阶段调用一次", 之前漏接导致预留只增不减)
		// 预留随任务终态释放 (specs/controller-supply-line): 取消/失败/完成的任务
		// 不再持有在途承诺——否则 cancelled 任务的预留压死目的地 headroom (50k 普查实锤)
		maintainLedger(ctx, (owner) => {
			const task = board.get(owner);
			return (
				task !== undefined &&
				task.status !== "completed" &&
				task.status !== "cancelled" &&
					task.status !== "failed"
			);
		});

		const profiles = [
			...Object.values(world.rooms).flatMap((room) =>
				room.creeps.filter((creep) => !creep.spawning).map(profileOf),
			),
			// 外矿单位参与分配 (bugs/P1-18 断点④): 可见非己方房的己方爬不进 rooms,
			// 不并入则远程任务到达者无人续租、本矿空闲件也看不到远程缺口
			...world.remoteUnits.filter((creep) => !creep.spawning).map(profileOf),
		];
		// 亲和排他分档 (bugs (十三)): 全场任一房启用 courier 投喂经济 (churn 期
		// 升级体兼差孵化线是承重的) 即关; 全部无 courier 的 main 系才开
		const affinityExclusive = !Object.values(world.rooms).some((room) =>
			roomModeProfileFor(ctx, room.roomName).courierEnabled,
		);
		// 外矿专职分档 (批次 AD): 全场任一房走 auto 外矿链 (专职 remoteMiner +
		// hauler 接驳) 即开; 全部 manual 的 main 系关 (harvester 自回运外矿
		// 是 batch H 环承重设计, 硬排即断其外矿供给)
		const remoteMinerExclusive = Object.values(world.rooms).some((room) =>
			roomModeProfileFor(ctx, room.roomName).remoteMining === "auto",
		);
		assignBatch({
			now: ctx.tick,
			tasks: board.list({ statuses: ["available"] }),
			profiles,
			world,
			affinityExclusive,
			remoteMinerExclusive,
			currentTaskOf: (name) => Game.creeps[name]?.memory.taskId,
			getTask: (id) => board.get(id),
			claim: (id, name, now, leaseTicks) => {
				const creep = Game.creeps[name];
				if (!creep) {
					return false;
				}
				// 抢占切换: 释放旧租约 (任务回池), 保证单一租约不变量
				const current = creep.memory.taskId;
				if (current !== undefined && current !== id) {
					board.release(current, name, now, "preempted");
				}
				const ok = board.claim(id, name, now, leaseTicks);
				if (ok) {
					creep.memory.taskId = id;
				}
				return ok;
			},
		});
	},
};

export { createTaskBoard, type TaskBoard } from "./board";
