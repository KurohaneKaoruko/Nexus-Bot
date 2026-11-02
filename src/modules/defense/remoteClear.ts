/**
 * 外矿清理编队规划 (docs/nexus-design/13 §24.2 三期, remote-defense 1.2):
 * active 且因威胁暂停的外矿房, 威胁 nature 为 npc/core 时向 cluster 提
 * kind="remote" 清理编队请求; 玩家骚扰不开编队 (暂停止损 + 人工介入口径)。
 * 止损: 交战超时/单位全灭 → 撤请求 + retryCooldown 冷却 (有界 Map)。
 * 恢复闭环不经此文件: 一期 resumeThreat 在威胁归零后自动恢复外矿。
 */
import type { TickContext } from "@/core";
import { requestSquad } from "@/core/store/runtime";
import { REMOTE_CONFIG } from "@/config/remote";
import { THREAT_CONFIG } from "@/config/defense";
import type { RoomThreatRecord } from "@/core/store/memorySchema";

/** 清理配槽 (旧链 externalMine.defend 同构: 低本多小件, 高本精简) */
function squadSlotsOf(threat: RoomThreatRecord, rcl: number): number {
	if (threat.category === "core") {
		const level = threat.coreLevel ?? 1;
		if (level <= 2) return 1;
		if (level <= 4) return 2;
		return 3;
	}
	// npc: 弱敌 1 攻击件; 强敌 (score 超强档) 2; 低本 3 小件
	if (rcl < 4) return 3;
	if (rcl < 6) return 2;
	return threat.score >= THREAT_CONFIG.harmlessScore * 8 ? 2 : 1;
}

/**
 * 外矿清理规划主入口 (Defense 模块每节拍调用):
 * 扫 remotes 子树 active+paused(threat) 房, 分类判定 → 请求/续期/撤回。
 */
export function planRemoteClearSquads(ctx: TickContext): void {
	const engagements = (ctx.memory.defense.remoteEngagements ??= {});
	let dirty = false;

	for (const [homeName, colony] of Object.entries(ctx.memory.remotes ?? {})) {
		for (const [roomName, rec] of Object.entries(colony.rooms)) {
			if (rec.state !== "paused") {
				// 非暂停房: 清理交战记录 (外矿恢复/转评估)
				if (engagements[roomName]) {
					delete engagements[roomName];
					dirty = true;
				}
				continue;
			}
			const threat = ctx.memory.rooms[roomName]?.threat;
			// 暂停但威胁已消 (等恢复窗口): 清记录不请求
			if (!threat || threat.scope !== "remote" || threat.confidence < REMOTE_CONFIG.pauseThreat) {
				if (engagements[roomName]) {
					delete engagements[roomName];
					dirty = true;
				}
				continue;
			}
			// 玩家骚扰: 不开编队 (策略域决策, 本档止损优先)
			if (threat.category === "player") continue;

			// 冷却期: 上次清理失败后 retryCooldown 内不再请求
			const cooldownUntil = ctx.memory.defense.remoteCooldown?.[roomName] ?? 0;
			if (ctx.tick < cooldownUntil) continue;

			// 交战超时止损: 请求在 engagementTimeout 内未清掉威胁 → 撤 + 冷却
			const engaged = engagements[roomName];
			if (engaged && ctx.tick - engaged.since > REMOTE_CONFIG.defense.engagementTimeout) {
				engaged.failures += 1;
				(ctx.memory.defense.remoteCooldown ??= {})[roomName] =
					ctx.tick + REMOTE_CONFIG.defense.retryCooldown * engaged.failures;
				delete engagements[roomName];
				dirty = true;
				continue;
			}

			const rcl = Math.max(0, ...Object.values(
				ctx.memory.rooms[homeName]?.rclTimeline as Record<string, number> ?? { 0: 0 },
			));
			requestSquad({
				kind: "remote",
				roomName,
				slots: squadSlotsOf(threat, rcl),
				taskKind: "defend",
				capabilities: ["attack", "move"],
				priority: 60,
				reason: `remote-clear:${threat.category} lvl:${threat.coreLevel ?? "-"} score:${Math.round(threat.score)}`,
			});
			if (!engaged) {
				engagements[roomName] = { since: ctx.tick, failures: 0 };
				dirty = true;
			}
		}
	}
	// 有界性: 交战记录随房状态清; 冷却表随 4wt 重开清
	if (dirty && Object.keys(engagements).length === 0) {
		delete ctx.memory.defense.remoteEngagements;
	}
}
