/**
 * 行动模块 (agents 阶段提案 + commit 阶段统一提交), 共享每 Tick 的 Broker 单例。
 * commit 前后挂 BetterMove 钩子: preTick 重置移动意图, endTickResolve 统一执行移动与交通疏导。
 * broker 装配抽到 sharedBroker.ts: 防御/编队等职能系统共用同一实例 (docs/nexus-design/19 §19.3)。
 */
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { ensureBroker } from "@/modules/agents/sharedBroker";
import { runAgents } from "@/modules/agents/agentSystem";
import { betterMoveApi } from "@/modules/movement/index";
import { noteMoveIntent, updateCongestion } from "@/modules/movement/trafficMonitor";
import { recordActionRates } from "@/modules/economy";
import { recordTowerSpend } from "@/modules/defense";
import type { NexusMemory } from "@/core/store/memorySchema";

export { ensureBroker };

/** 工作位判定 (不在岗位必须返回 true, 即可被交通调度让位) */
function isWorkTile(creep: Creep | PowerCreep, _pos: RoomPosition): boolean {
	if (!(creep instanceof Creep)) {
		return true;
	}
	const taskId = creep.memory?.taskId;
	const nexus = (Memory as unknown as { nexus?: NexusMemory } | undefined)?.nexus;
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

export const Agents: TickModule = {
	name: "agents",
	phase: "agents",
	band: "P1",
	run(ctx: TickContext): void {
		runAgents(ctx, ensureBroker(ctx), createTaskBoard(ctx.memory.tasks));
	},
};

export const Broker: TickModule = {
	name: "action-broker",
	phase: "commit",
	band: "P1",
	run(ctx: TickContext): void {
		betterMoveApi.preTickBetterMove();
		const results = ensureBroker(ctx).commit(ctx.tick);
		// 有移动意图的单位登记 (结果分类: 已接受或在重试中的移动)
		for (const result of results) {
			if (result.kind === "move" && (result.accepted || result.category === "retryable")) {
				noteMoveIntent(ctx, result.actorName);
			}
		}
		// 速率回填: 采集/交付实际发生量 → 账本滚动速率 (docs/nexus-design/06 §6.8)
		recordActionRates(ctx, results);
		// 塔能耗回填: 防御统计窗口 (docs/nexus-design/14 Phase 3 战损有预算与统计)
		recordTowerSpend(ctx, results);
		betterMoveApi.endTickResolve(isWorkTile);
		// 位置差分在移动解算后进行 (拥堵检测, docs/nexus-design/08 §8.4)
		const world = ctx.world.current;
		if (world) {
			updateCongestion(ctx, world);
		}
	},
};
