/**
 * 编队模型 (docs/nexus-design/19 §19.4 集群 / docs/nexus-design/20 §20.4): 纯函数, 不触碰游戏 API 与 TaskBoard。
 * 编队 = 槽位集合; 槽位与成员任务一一对应 (dedupeKey = squad:<kind>:<room>:slot:<n>)。
 * 所有函数无副作用, 便于单测与复用; 生命周期编排见 cluster/index.ts。
 */
import { CLUSTER_CONFIG } from "@/config/cluster";
import type { SquadRecord, SquadKind } from "@/store/memorySchema";
import type { SquadRequest } from "@/store/runtime";

/** 编队 id: 每 (类型, 房间) 至多一支 (房间内同类协同需求合并) */
export function squadIdOf(kind: SquadKind, roomName: string): string {
	return `squad:${kind}:${roomName}`;
}

/** 槽位任务去重键 (幂等 upsert 的锚点) */
export function slotDedupeKey(squadId: string, slot: number): string {
	return `${squadId}:slot:${slot}`;
}

/** 槽位键前缀 (判定任务是否归本编队管辖) */
export function slotPrefix(squadId: string): string {
	return `${squadId}:slot:`;
}

/** 槽位数收敛: 至少 1, 至多配置上限 */
export function clampSlots(slots: number): number {
	return Math.max(1, Math.min(CLUSTER_CONFIG.maxSlotsPerSquad, Math.floor(slots)));
}

/** 槽位任务优先级: 需求方优先级与配置下限取大 (编队任务不被经济任务抢占) */
export function squadPriority(priority: number): number {
	return Math.max(CLUSTER_CONFIG.priorityFloor, priority);
}

/**
 * 用需求续期或创建编队记录 (纯函数, 返回新记录):
 * 已存在 → 更新槽位/优先级/原因/种类并顺延 TTL, 保留 members 与 createdAt;
 * 不存在 → 新建, members 为空 (由槽位任务的 assignedTo 反填)。
 */
export function applyRequest(existing: SquadRecord | undefined, request: SquadRequest, now: number): SquadRecord {
	const slots = clampSlots(request.slots);
	const expiresAt = now + CLUSTER_CONFIG.requestTtlTicks;
	const priority = squadPriority(request.priority);
	if (existing) {
		return {
			...existing,
			slots,
			priority,
			taskKind: request.taskKind,
			capabilities: [...request.capabilities],
			reason: request.reason,
			updatedAt: now,
			expiresAt,
		};
	}
	return {
		id: squadIdOf(request.kind, request.roomName),
		kind: request.kind,
		roomName: request.roomName,
		taskKind: request.taskKind,
		capabilities: [...request.capabilities],
		slots,
		members: [],
		priority,
		reason: request.reason,
		createdAt: now,
		updatedAt: now,
		expiresAt,
	};
}

/** 需求未续期且超过 TTL → 可解散 */
export function isExpired(squad: SquadRecord, now: number): boolean {
	return now >= squad.expiresAt;
}

/** 编队是否达到创建上限 (已有记录不受限, 只约束新建) */
export function atSquadCapacity(squads: Record<string, SquadRecord>, id: string): boolean {
	return squads[id] === undefined && Object.keys(squads).length >= CLUSTER_CONFIG.maxSquads;
}

/** 槽位任务是否归本编队管辖 (清理判定用) */
export function ownsSlot(squadId: string, dedupeKey: string): boolean {
	return dedupeKey.startsWith(slotPrefix(squadId));
}
