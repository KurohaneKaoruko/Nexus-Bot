/**
 * 每 Tick 共享 ActionBroker 的装配入口 (docs/nexus-design/19 §19.3 接入契约):
 * 任意阶段的职能系统 (经济/防御/编队) 都经此取得同一个 broker 提交意图,
 * 由 commit 阶段的 broker 模块统一 commit —— 保证「全项目唯一原生行动调用点」。
 * 独立成文件以避免领域模块之间互相依赖 (defense → agents/index 的环)。
 */
import type { TickContext } from "@/core";
import { createTaskBoard } from "@/modules/tasks";
import { getSharedBroker, type ActionBroker } from "@/modules/agents/actionBroker";

/** broker 注释里明确「视为成功路径」的 replan 原因 (bugs/P0-2): 只释放回池, 不计失败次数 */
const TRANSIENT_REPLAN_REASONS: ReadonlySet<string> = new Set([
	"carry-empty", // 快照与实际负载偏差: 交回分配环重推导
	"site-gone", // 工地建成/消失: 任务完成由对账确认
	"store-empty", // 货源被抢先取空: 等待补货
]);

export function ensureBroker(ctx: TickContext): ActionBroker {
	return getSharedBroker(ctx.tick, {
		logger: ctx.logger,
		getTask: (id) => createTaskBoard(ctx.memory.tasks).get(id),
		onReplan: (taskId, creepName, reason) => {
			const board = createTaskBoard(ctx.memory.tasks);
			if (TRANSIENT_REPLAN_REASONS.has(reason)) {
				// 瞬态原因: 释放租约回池, 由对账决定后续 (失败计数会误杀常驻任务)
				board.release(taskId, creepName, ctx.tick, `transient:${reason}`);
				return;
			}
			board.fail(taskId, creepName, ctx.tick, reason);
		},
	});
}
