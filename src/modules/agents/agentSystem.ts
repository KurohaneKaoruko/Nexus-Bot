/**
 * AgentSystem (api/06 §6.1): 主循环——读取已分配任务, 为每只 Creep 产出本 Tick 的行动提案。
 * 辅助族在 agentLogistics, 任务执行器在 agentHandlers, 快递族在 agentCourier, 远程采集族在 agentRemote。
 */
import type { TickContext } from "@/core";
import type { ActionBroker } from "@/modules/agents/actionBroker";
import type { TaskBoard } from "@/modules/tasks";
import { runCreep, runForeignTask } from "@/modules/agents/agentHandlers";
import { runCourierCreep } from "@/modules/agents/agentCourier";
import { tryRelayHandoff } from "@/modules/agents/agentRemote";
import { clearBlocked, congestionAction } from "@/modules/movement/trafficMonitor";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { acquire } from "@/runtime/actorOwnership";

const idleUnitReportTick: Record<string, number> = {};
function reportIdleUnit(ctx: TickContext, name: string, unitCode: string): void {
	const last = idleUnitReportTick[name] ?? -1000;
	if (ctx.tick - last < 500) return;
	idleUnitReportTick[name] = ctx.tick;
	console.log(`[agents] 无任务待派: ${name} (${unitCode})`);
}

export function runAgents(ctx: TickContext, broker: ActionBroker, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	/** 本 Tick 已驱动过的单位 (接力对的双方不重复进入默认驱动) */
	const processed = new Set<string>();
	// 驱动序保持重构前口径 (rooms 房序 + remoteUnits 序): 交通解算对意图提交
	// 序敏感, 遍历序改变会平移门读数; 两段并集恰为名册 units 的可驱动全集
	// (不可见外房单位无 Game 对象本就不可驱动), docs/24 §24.5.3。
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			if (processed.has(creep.name)) {
				continue;
			}
			// 孵化中单位不驱动 (bugs/P0-16c 同源防护): 出生前任何计划都是
			// actor-missing-or-spawning 无效提交; 角色记录由孵化簿记保证
			if (creep.spawning) {
				continue;
			}
			// 快递爬: 无任务租约的角色驱动 (specs/rush-courier)
			if (creep.unitCode === UNIT_CODES["rush-courier"]) {
				acquire(creep.name, "nexus-agent", ctx.tick);
				runCourierCreep(ctx, broker, room, creep);
				continue;
			}
			const taskId = Game.creeps[creep.name]?.memory.taskId;
			if (!taskId) {
				// 无任务待派诊断 (限频): 任务驱动是唯一路径后, 持续无租约的
				// 存活单位 = 词表孤儿或孵化链脏数据, 归因移交域 6 裁撤
				reportIdleUnit(ctx, creep.name, creep.unitCode);
				continue;
			}
			const task = board.get(taskId);
			// 指针生命周期: 任务不存在/终态/已改派他人 → 清除指针, 本 Tick 不产出计划
			const record = Game.creeps[creep.name];
			if (
				!task ||
				task.assignedTo !== creep.name ||
				task.status === "completed" ||
				task.status === "cancelled" ||
				task.status === "failed"
			) {
				if (record) {
					delete record.memory.taskId;
				}
				continue;
			}
			// 拥堵分级响应 (docs/nexus-design/08 §8.6): 让路已由 endTickResolve 推开承担,
			// 这里处理 repath (本 Tick 让位) 与 release (释放任务重分配)
			const action = congestionAction(ctx, creep.name);
			if (action === "repath") {
				clearBlocked(ctx, creep.name);
				continue;
			}
			if (action === "release") {
				board.release(taskId, creep.name, ctx.tick, "traffic-stuck");
				if (record) {
					delete record.memory.taskId;
				}
				clearBlocked(ctx, creep.name);
				continue;
			}
			board.heartbeat(taskId, creep.name, ctx.tick);
			acquire(creep.name, "nexus-agent", ctx.tick);
			// 接力搬运 (specs/接力搬运): 相向对穿整仓交接, 任务随货走后双方同 Tick 重跑
			const relay = tryRelayHandoff(ctx, broker, board, room, creep, task, processed);
			if (relay) {
				for (const name of [relay.supplierName, relay.receiverName]) {
					const member = room.creeps.find((c) => c.name === name);
					const memberTaskId = Game.creeps[name]?.memory.taskId;
					const swapped = memberTaskId ? board.get(memberTaskId) : undefined;
					processed.add(name);
					if (member && swapped && swapped.assignedTo === name) {
						runCreep(ctx, broker, board, room, member, swapped);
					}
				}
				continue;
			}
			runCreep(ctx, broker, board, room, creep, task);
			processed.add(creep.name);
		}
	}

	// 外房驻留单位 (bugs/P1-18 断点④): 可见非己方房的己方爬不进 world.rooms,
	// 上面循环驱动不到。上下文按任务锚点房取 observation (本矿), runCreep 的
	// remote 分支按 task 定位目标; 锚点也为外房 (scout/reserve/claim/retreat
	// 直挂目标房, 缺陷一修复后可存活) 时无本方房上下文可取, 走免上下文的
	// runForeignTask 直驱。
	for (const creep of world.remoteUnits) {
		if (creep.spawning) {
			continue;
		}
		const live = Game.creeps[creep.name];
		if (!live) {
			continue;
		}
		const taskId = live.memory.taskId;
		if (!taskId) {
			continue;
		}
		const task = board.get(taskId);
		if (
			!task ||
			task.assignedTo !== creep.name ||
			task.status === "completed" ||
			task.status === "cancelled" ||
			task.status === "failed"
		) {
			delete live.memory.taskId;
			continue;
		}
		board.heartbeat(taskId, creep.name, ctx.tick);
		acquire(creep.name, "nexus-agent", ctx.tick);
		const homeRoom = world.rooms[task.roomName];
		if (homeRoom) {
			runCreep(ctx, broker, board, homeRoom, creep, task);
		} else {
			runForeignTask(ctx, broker, board, creep, task);
		}
	}
}
