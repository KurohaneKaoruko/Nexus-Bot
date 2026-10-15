/**
 * 编队模块 (docs/nexus-design/19 §19.4 集群 / docs/nexus-design/20, planning 阶段):
 * 需求方 (防御系统 = emergency 阶段) 经 requestSquad 登记需求 →
 * 本模块续期/新建编队 → 维持槽位任务 (成员任务, kind = 需求方指定) → 回填成员 →
 * 需求未续期超 TTL 解散并回收槽位任务。
 * 编队不直接指挥单位: 槽位任务由 Allocator 分配、AgentSystem 提案、ActionBroker 提交,
 * 成员行动仍走统一仲裁 (docs/nexus-design/19 §19.4 指挥层级)。
 * 有界: 编队数上限 + 槽位上限 + TTL; 编队/槽位规模由配置表约束。
 */
import type { TickContext, TickModule } from "@/core";

import type { SquadRecord } from "@/core/store/memorySchema";
import type { TaskKind } from "@/core/store/taskSchema";
import { takeSquadRequests } from "@/core/store/runtime";
import { createTaskBoard, type TaskBoard } from "@/modules/tasks";
import {
	applyRequest,
	atSquadCapacity,
	flattenSlots,
	isExpired,
	ownsSlot,
	slotDedupeKey,
	slotTotal,
	squadIdOf,
} from "@/modules/cluster/model";
import { updateSquadBenefit, type SquadBenefitSample } from "@/modules/cluster/benefit";

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["available", "leased", "in_progress"]);

function isActive(task: { status: string }): boolean {
	return ACTIVE_STATUSES.has(task.status);
}

/**
 * 编队涉及的槽位任务种类 (异构槽位可跨 kind, 故取消/清理按全部已用 kinds 扫描)。
 * 命名空间仍由 dedupeKey 前缀隔离, 与规划器直建任务互不越权。
 */
function squadTaskKinds(squad: SquadRecord): TaskKind[] {
	const kinds = new Set<TaskKind>([squad.taskKind]);
	for (const def of squad.slots) {
		kinds.add(def.taskKind);
	}
	return [...kinds];
}

/** 解散编队: 取消其槽位任务 (不回池——需求消失后回池会产生幽灵任务被经济单位误领) */
function disband(ctx: TickContext, board: TaskBoard, squad: SquadRecord): void {
	for (const task of board.list({ roomName: squad.roomName, kinds: squadTaskKinds(squad) })) {
		if (ownsSlot(squad.id, task.dedupeKey) && isActive(task)) {
			board.cancel(task.id, ctx.tick, "squad-disbanded");
		}
	}
}

/** 维持编队: 异构槽位按定义数组展开 → 槽位任务幂等 upsert + 收缩清理 + 成员回填 */
function maintain(ctx: TickContext, board: TaskBoard, squad: SquadRecord): void {
	const expected = new Set<string>();
	const members: string[] = [];
	const defs = flattenSlots(squad.slots);
	for (let slot = 0; slot < defs.length; slot += 1) {
		const def = defs[slot];
		if (!def) {
			continue;
		}
		const dedupeKey = slotDedupeKey(squad.id, slot);
		expected.add(dedupeKey);
		const task = board.upsert(
			{
				dedupeKey,
				kind: def.taskKind,
				roomName: squad.roomName,
				priority: squad.priority,
				requiredCapabilities: def.capabilities,
			},
			ctx.tick,
		);
		if (task.assignedTo !== undefined) {
			members.push(task.assignedTo);
		}
	}
	// 槽位收缩 (需求方下调槽位定义) → 多余槽位任务取消 (不释放回池)
	for (const task of board.list({ roomName: squad.roomName, kinds: squadTaskKinds(squad) })) {
		if (ownsSlot(squad.id, task.dedupeKey) && !expected.has(task.dedupeKey) && isActive(task)) {
			board.cancel(task.id, ctx.tick, "squad-shrunk");
		}
	}
	squad.members = members;
	squad.updatedAt = ctx.tick;
}

/** 编队规划入口: 需求续期 → 解散过期 → 维持活跃 (纯编排, 不调用游戏 API) */
export function runClusterPlanner(ctx: TickContext, board: TaskBoard): void {
	const squads = ctx.memory.squads;
	const requests = takeSquadRequests();
	const active = new Set<string>();

	// 1. 需求续期 / 新建 (有界: 超上限只续期已有编队)
	for (const request of requests) {
		const id = squadIdOf(request.kind, request.roomName);
		if (atSquadCapacity(squads, id)) {
			ctx.logger.warn("cluster.capacity", `编队数已达上限, 忽略 ${id} 的建队请求`);
			continue;
		}
		squads[id] = applyRequest(squads[id], request, ctx.tick);
		active.add(id);
	}

	// 2. 需求未续期: TTL 内保持 (迟滞防抖), 超期解散
	for (const squad of Object.values(squads)) {
		if (active.has(squad.id)) {
			continue;
		}
		if (!isExpired(squad, ctx.tick)) {
			active.add(squad.id);
			continue;
		}
		disband(ctx, board, squad);
		delete squads[squad.id];
	}

	// 3. 维持活跃编队
	for (const id of active) {
		const squad = squads[id];
		if (squad) {
			maintain(ctx, board, squad);
		}
	}

	// 4. 编队收益对比 (specs/squad-coordination-metrics): 编队建立前基线 vs 协同窗口
	recordSquadBenefit(ctx, squads);
}

/**
 * 采集本 Tick 战斗事件并刷新编队收益记录。
 * 击杀口径 = 敌对 creep 从视野消失数; 战损口径 = 编队成员本 Tick 死亡数;
 * 存活时长口径 = 编队成员在编 tick 累计 (成员名取自 SquadRecord.members 反填)。
 */
function recordSquadBenefit(ctx: TickContext, squads: Record<string, SquadRecord>): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	const dead = new Set(ctx.world.dead);
	const samples: SquadBenefitSample[] = [];
	const liveRooms = new Set<string>();
	for (const room of Object.values(world.rooms)) {
		liveRooms.add(room.roomName);
		const memberNames = new Set<string>();
		for (const squad of Object.values(squads)) {
			if (squad.roomName !== room.roomName) {
				continue;
			}
			for (const name of squad.members) {
				memberNames.add(name);
			}
		}
		const prevHostiles = hostileSeen.get(room.roomName);
		samples.push({
			room,
			squadMembers: memberNames,
			lostMembers: [...memberNames].filter((name) => dead.has(name)),
			vanishedHostiles:
				prevHostiles === undefined ? 0 : Math.max(0, prevHostiles - room.hostiles.length),
		});
		hostileSeen.set(room.roomName, room.hostiles.length);
	}
	// 有界: 房间消失即清 (记录随房增减而非随 tick 增长)
	for (const roomName of hostileSeen.keys()) {
		if (!liveRooms.has(roomName)) {
			hostileSeen.delete(roomName);
		}
	}
	const activeSquadRooms = new Set(Object.values(squads).map((squad) => squad.roomName));
	updateSquadBenefit(ctx, samples, activeSquadRooms);
}

/** 上 Tick 各房敌对 creep 数 (本 Tick 减少量 = 击杀口径); 有界: 随房增减 */
const hostileSeen = new Map<string, number>();

export const Cluster: TickModule = {
	name: "cluster-squads",
	phase: "planning",
	band: "P1",
	run(ctx: TickContext): void {
		if (!ctx.world.current) {
			return;
		}
		runClusterPlanner(ctx, createTaskBoard(ctx.memory.tasks));
	},
};

/* ── 观测快照 (HUD/控制台, docs/nexus-design/02 原则 F) ── */

export interface ClusterSnapshot {
	squadCount: number;
	/** 编队 id → 已就位成员数 / 槽位数 */
	rosters: Array<{
		id: string;
		roomName: string;
		taskKind: string;
		members: number;
		slots: number;
	}>;
}

export function clusterSnapshot(ctx: TickContext): ClusterSnapshot {
	const rosters = Object.values(ctx.memory.squads).map((squad) => ({
		id: squad.id,
		roomName: squad.roomName,
		taskKind: squad.taskKind,
		members: squad.members.length,
		slots: slotTotal(squad.slots),
	}));
	return { squadCount: rosters.length, rosters };
}

export { squadBenefitSnapshot, benefitGatePassed } from "@/modules/cluster/benefit";
