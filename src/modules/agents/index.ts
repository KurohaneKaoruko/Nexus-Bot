/**
 * 行动模块 (agents 阶段提案 + commit 阶段统一提交), 共享每 Tick 的 Broker 单例。
 * 移动窗口与工作位判定由 movementWindow.ts 单独装配。
 * broker 装配抽到 sharedBroker.ts: 防御/编队等职能系统共用同一实例 (docs/nexus-design/19 §19.3)。
 */
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { ensureBroker } from "@/modules/agents/sharedBroker";
import { runAgents } from "@/modules/agents/agentSystem";
import { noteMoveIntent } from "@/modules/movement/trafficMonitor";
import { recordActionRates } from "@/modules/economy";
import { recordTowerSpend } from "@/modules/defense";
import { takeIntents } from "@/runtime/intentQueue";

export { ensureBroker };

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
		// 意图队列 → broker: planner/spawning/market 等系统级命令统一入站 (api/17)
		const broker = ensureBroker(ctx);
		const intents = takeIntents(ctx.tick);
		for (const intent of intents) {
			broker.submit({
				id: intent.id,
				tick: ctx.tick,
				actorName: intent.actorName,
				kind: intent.kind,
				pipeline: intent.pipeline,
				priority: intent.priority,
				targetId: intent.targetId,
				targetPos: intent.targetPos,
				resourceType: intent.resourceType as ResourceConstant | undefined,
				amount: intent.amount,
				payload: intent.payload,
				dedupeKey: intent.dedupeKey,
			});
		}
		const results = broker.commit(ctx.tick);
		// 结果回投: 提交方注册的强一致回调 (预约核销/簿记等)
		const byPlanId = new Map(results.map((r) => [r.planId, r]));
		for (const intent of intents) {
			const result = byPlanId.get(intent.id);
			if (intent.onResult) {
				intent.onResult(result?.accepted ?? false, result?.nativeReturnCode);
			}
		}
		// 有移动意图的单位登记 (结果分类: 已接受或在重试中的移动); reason 供 5.1 场景归因
		for (const result of results) {
			if (result.kind === "move" && (result.accepted || result.category === "retryable")) {
				noteMoveIntent(ctx, result.actorName, result.intentReason);
			}
		}
		// 速率回填: 采集/交付实际发生量 → 账本滚动速率 (docs/nexus-design/06 §6.8)
		recordActionRates(ctx, results);
		// 塔能耗回填: 防御统计窗口 (docs/nexus-design/14 Phase 3 战损有预算与统计)
		recordTowerSpend(ctx, results);
	},
};

// ── 公共面: 行动结果类型 / 工作层 (经济角色单位消费) ──
export type { ActionBroker, ActionResult } from "@/modules/agents/actionBroker";
export { WORK_EVENTS, runWorkLayer, type WorkEvent } from "@/modules/agents/workLayer";
