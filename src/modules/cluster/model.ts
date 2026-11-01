/**
 * 编队模型 (docs/nexus-design/19 §19.4 集群 / docs/nexus-design/20 §20.4): 纯函数, 不触碰游戏 API 与 TaskBoard。
 * 编队 = 槽位集合; 槽位与成员任务一一对应 (dedupeKey = squad:<kind>:<room>:slot:<n>)。
 * 所有函数无副作用, 便于单测与复用; 生命周期编排见 cluster/index.ts。
 */
import { CLUSTER_CONFIG } from "@/config/cluster";
import type { SquadRecord, SquadKind, SquadSlotDef } from "@/core/store/memorySchema";
import type { SquadRequest } from "@/core/store/runtime";

/** 编队 id: 每 (类型, 房间) 至多一支 (房间内同类协同需求合并) */
export function squadIdOf(kind: SquadKind, roomName: string): string {
	return `squad:${kind}:${roomName}`;
}

/**
 * 槽位序号 (异构槽位数组的稳定展开序): dedupeKey 依赖它跨 Tick 稳定,
 * 否则续期会因顺序漂移而误取消/重建成员任务。
 */
export function flattenSlots(slots: readonly SquadSlotDef[]): SquadSlotDef[] {
	const out: SquadSlotDef[] = [];
	for (const def of slots) {
		const count = Math.max(0, Math.floor(def.count));
		for (let i = 0; i < count; i += 1) {
			out.push(def);
		}
	}
	return out;
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

/**
 * 需求方给出的同质槽位 → 槽位定义数组 (单条目 count=N)。
 * 异构编队由需求方直接给数组时走 clampSlotDefs; 此处保留数量型需求的兼容入口。
 */
export function homogeneousSlots(count: number): SquadSlotDef[] {
	return [{ taskKind: "defend", capabilities: [], count: clampSlots(count) }];
}

/** 槽位定义数组收敛: 各条目 count 上限求和不得超过单编队槽位上限; 非法条目剔除 */
export function clampSlotDefs(defs: readonly SquadSlotDef[]): SquadSlotDef[] {
	const out: SquadSlotDef[] = [];
	let total = 0;
	for (const def of defs) {
		if (total >= CLUSTER_CONFIG.maxSlotsPerSquad) {
			break;
		}
		const count = Math.floor(def.count);
		if (!Number.isFinite(count) || count <= 0) {
			continue;
		}
		const allowed = Math.min(count, CLUSTER_CONFIG.maxSlotsPerSquad - total);
		if (allowed <= 0) {
			break;
		}
		out.push({ taskKind: def.taskKind, capabilities: [...def.capabilities], count: allowed });
		total += allowed;
	}
	return out;
}

/** 槽位定义数组的总槽位数 (= 期望成员数) */
export function slotTotal(defs: readonly SquadSlotDef[]): number {
	return defs.reduce((sum, def) => sum + Math.max(0, Math.floor(def.count)), 0);
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
export function applyRequest(
	existing: SquadRecord | undefined,
	request: SquadRequest,
	now: number,
): SquadRecord {
	// 异构槽位: 需求方给出定义数组时按其展开, 否则按同质数量入口构造单条目定义。
	const slots = clampSlotDefs(
		request.slotDefs?.length
			? request.slotDefs
			: [{ taskKind: request.taskKind, capabilities: request.capabilities, count: request.slots }],
	);
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
