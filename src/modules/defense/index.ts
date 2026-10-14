/**
 * 防御系统装配 (docs/nexus-design/19 §19.3/§19.4 / docs/nexus-design/03 §3.3 第 4 步 emergency):
 * 一个职能系统 = 一个 TickModule + 按房间的规划入口。
 * emergency 阶段顺序: 威胁观测 (updateRoomThreat) → 应急任务 (planDefenseRoom) →
 * 塔行动 (assignTowers) → 塔能耗窗口折叠 (foldTowerSpend)。
 * 所有意图经共享 ActionBroker 提交 (commit 阶段统一 commit), 本模块不直接调用游戏 API。
 * 
 */
import { TOWER_CONFIG } from "@/config/defense";
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { ensureBroker } from "@/modules/agents";
import { planDefenseRoom } from "@/modules/defense/planners";
import { assignTowers } from "@/modules/defense/towerControl";
import { foldTowerSpend, updateRoomThreat } from "@/modules/defense/threatModel";

/** 塔行动 → broker 提案 (结构 actor: actorName = 塔 id, 无任务租约) */
function submitTowerActions(ctx: TickContext, broker: ReturnType<typeof ensureBroker>): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		for (const assignment of assignTowers(room)) {
			broker.submit({
				id: `tower-${assignment.towerId}-${assignment.kind}-${ctx.tick}`,
				tick: ctx.tick,
				actorName: assignment.towerId,
				kind: assignment.kind,
				targetId: assignment.targetId,
				priority: TOWER_CONFIG.actionPriority,
				pipeline: "tower",
				dedupeKey: `tower:${assignment.towerId}:${assignment.kind}`,
			});
		}
	}
}

export const Defense: TickModule = {
	name: "defense-planners",
	phase: "emergency",
	band: "P0",
	run(ctx: TickContext): void {
		const world = ctx.world.current;
		if (!world) {
			return;
		}
		const broker = ensureBroker(ctx);
		const board = createTaskBoard(ctx.memory.tasks);
		for (const room of Object.values(world.rooms)) {
			// 观测: 可见威胁评分 / 失视衰减 / 战损归因 (先于规划, 当 Tick 生效)
			updateRoomThreat(ctx, room);
			// 应急任务: defend/retreat/repair + SafeMode 政策 (经 broker 提交)
			planDefenseRoom(ctx, board, room, broker);
		}
		submitTowerActions(ctx, broker);
		foldTowerSpend(ctx);
	},
};

/** 控制台/HUD 查询入口用的防御快照 (boot 装配消费) */
export { defenseSnapshot, type DefenseSnapshot } from "@/modules/defense/threatModel";
export { maxThreatScore, threatTierOf, recordTowerSpend, rankHostiles } from "@/modules/defense/threatModel";
