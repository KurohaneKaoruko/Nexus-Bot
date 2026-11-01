/**
 * 外矿选点规划器 (docs/nexus-design/13 §24.7, phase4 4.4)。
 *
 * planning 阶段: 规划 P2 (状态机推进 + scout/reserve 任务生成);
 * 评估 (PathFinder 路程 + 净收益估算) 受 evalPerRun 限额, 属昂贵分析。
 * 候选 = 母房出口相连的 normal 房 (describeExits, 无需视野) + pin 房;
 * 准入按 net/s 降序至 spawnShareCap; 同一外矿房只归一个殖民地。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import type { RemoteRoomRecord, RoomIntelRecord } from "@/core/store/memorySchema";
import type { RemoteTransitionInput } from "@/modules/economy/remote/stateMachine";
import { priorityFor } from "@/core/store/taskSchema";
import { REMOTE_CONFIG } from "@/config/remote";
import { roomKind } from "@/utils/roomName";
import { intelStale } from "@/modules/world/intelState";
import { roomModeProfileFor } from "@/modules/strategy";
import { estimateRemoteNet } from "@/modules/economy/remote/estimate";
import { remoteTransitionOf } from "@/modules/economy/remote/stateMachine";

/** 母房记录初始化 (懒建): 殖民地子树 v17 起在 schema */
function colonyOf(ctx: TickContext, homeName: string) {
	if (!ctx.memory.remotes) ctx.memory.remotes = {};
	let colony = ctx.memory.remotes[homeName];
	if (!colony) {
		colony = { rooms: {} };
		ctx.memory.remotes[homeName] = colony;
	}
	return colony;
}

/** 候选房生成: auto 档 describeExits 相邻 normal 房 (无需视野);
 *  manual 档只取显式目标 (旧 remoteTargets ≙ pin 语义, 不自动扫邻房) */
function candidateRooms(homeName: string, ctx: TickContext, autoScan: boolean): string[] {
	const out: string[] = [];
	if (autoScan) {
		const exits = Game.map.describeExits(homeName) ?? {};
		for (const name of Object.values(exits)) {
			if (roomKind(name) !== "normal") continue;
			out.push(name);
		}
	}
	// 显式目标 (manual 档 remoteTargets / pin 标记) 恒入候选
	const explicit = ctx.memory.economy.remoteTargets ?? [];
	for (const name of explicit) {
		if (!out.includes(name)) out.push(name);
	}
	const colony = ctx.memory.remotes?.[homeName];
	for (const [name, rec] of Object.entries(colony?.rooms ?? {})) {
		if (rec.manual === "pin" && !out.includes(name)) out.push(name);
	}
	return out;
}

/** 安全否决: 他人占有/预定、invader core、敌对结构 (Intel 可选字段) */
function isUnsafe(intel: RoomIntelRecord | undefined): boolean {
	if (!intel) return false;
	const me = myUsername();
	if (intel.owner && intel.owner !== me) return true;
	if (intel.reservation && intel.reservation.username !== me) return true;
	return intel.invaderCore === true || intel.hostileStructures === true;
}

function myUsername(): string | undefined {
	for (const spawn of Object.values(Game.spawns)) {
		return spawn.owner?.username;
	}
	return undefined;
}

/** Intel 源数读取 (评估用; 无 Intel 时不可评估) */
function intelSourceCount(intel: RoomIntelRecord | undefined): number {
	return intel?.sources?.length ?? 0;
}

/** 母房交付点 (spawn 位; PathFinder 起点) */
function deliveryPos(homeName: string): RoomPosition | undefined {
	return Game.rooms[homeName]?.find(FIND_MY_SPAWNS)[0]?.pos;
}

/** 路程评估 (昂贵): PathFinder.search 一次, 结果写 sources[].pathLength */
function evaluatePaths(
	ctx: TickContext,
	homeName: string,
	rec: RemoteRoomRecord,
	intel: { sources?: { id: string; x: number; y: number }[] },
	budget: number,
): boolean {
	const origin = deliveryPos(homeName);
	if (!origin) return false;
	const srcs = intel.sources ?? [];
	let done = 0;
	for (const src of srcs) {
		if (rec.sources[src.id]?.pathLength) continue;
		if (done >= budget) break;
		const target = { pos: src, range: 1 };
		const result = PathFinder.search(origin, target as never, { maxOps: 20000 });
		rec.sources[src.id] = { pathLength: result.path.length };
		done += 1;
	}
	return srcs.every((s) => rec.sources[s.id]?.pathLength !== undefined);
}

/** 状态机输入快照现算 */
function transitionInputOf(
	ctx: TickContext,
	rec: RemoteRoomRecord,
	roomName: string,
	spawnBudgetAvailable: boolean,
): RemoteTransitionInput {
	const intel = ctx.memory.rooms[roomName];
	const stale = !intel || intelStale(intel, ctx.tick);
	const input: RemoteTransitionInput = {
		intelStale: stale,
		scouted: !stale,
		unsafe: isUnsafe(intel),
		threatConfidence: 0, // 威胁模型接入在防御联动 (后续节)
		spawnBudgetAvailable,
	};
	if (rec.estimate?.net !== undefined) input.net = rec.estimate.net;
	if (rec.measured?.netEma !== undefined) input.measuredNetEma = rec.measured.netEma;
	if (rec.manual !== undefined) input.manual = rec.manual;
	return input;
}

/**
 * 单母房规划主循环:
 * 1. 开闸 (档位 + storage + 非 survive);
 * 2. 候选生成/状态机推进;
 * 3. scouting → remote:scout: 任务; active → remote:reserve: 任务。
 */
export function planRemoteColony(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
): void {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (profile.remoteMining === "off") return;
	const hasStorage = room.stores.some((s) => s.structureType === STRUCTURE_STORAGE);
	if (!hasStorage) return;

	const colony = colonyOf(ctx, room.roomName);

	// 候选注册: 新房建 candidate 记录
	for (const name of candidateRooms(room.roomName, ctx, profile.remoteMining === "auto")) {
		if (!colony.rooms[name]) {
			colony.rooms[name] = {
				state: "candidate",
				since: ctx.tick,
				reason: "new-candidate",
				sources: {},
				profile: "energy",
			};
		}
	}

	// spawn 预算: 已 active 的 s 合计 < cap × spawn 数 (简版: 每母房 spawn 数)
	const spawnCount = Object.keys(Game.spawns).filter(
		(name) => Game.spawns[name]?.room.name === room.roomName,
	).length;
	const usedShare = Object.values(colony.rooms)
		.filter((r) => r.state === "active")
		.reduce((sum, r) => sum + (r.estimate?.s ?? 0), 0);
	const shareCap = REMOTE_CONFIG.spawnShareCap * Math.max(1, spawnCount);
	const budgetAvailable = usedShare < shareCap;

	// 状态机推进 + 动作生成
	for (const [name, rec] of Object.entries(colony.rooms)) {
		// 评估 (evaluated/scouting 且有 Intel): 路程 + 净收益
		const intel = ctx.memory.rooms[name];
		if (
			(rec.state === "scouting" || rec.state === "evaluated" || rec.state === "candidate") &&
			intel && !intelStale(intel, ctx.tick)
		) {
			const target = Game.rooms[name] ?? undefined;
			const visIntel = target ? { sources: intel.sources } : intel;
			if (evaluatePaths(ctx, room.roomName, rec, visIntel as never, REMOTE_CONFIG.evalPerRun)) {
				const d = Math.max(
					...Object.values(rec.sources).map((s) => s.pathLength),
					1,
				);
				const estimate = estimateRemoteNet({
					pathLength: d,
					energyCapacity: room.energyCapacity,
					reserved: true,
					sourceCount: intelSourceCount(intel),
				});
				rec.estimate = { ...estimate, at: ctx.tick };
			}
		}

		// 转移
		const input = transitionInputOf(ctx, rec, name, budgetAvailable);
		const t = remoteTransitionOf(rec, input, ctx.tick);
		if (t) {
			rec.state = t.state;
			rec.since = ctx.tick;
			rec.reason = t.reason;
		}

		// 动作生成
		if (rec.state === "scouting" || rec.state === "candidate") {
			if (input.intelStale) {
				board.upsert({
					dedupeKey: `remote:scout:${room.roomName}:${name}`,
					kind: "scout",
					roomName: room.roomName,
					targetPos: { x: 25, y: 25, roomName: name },
					priority: priorityFor("scout"),
					requiredCapabilities: ["move"],
					deadline: ctx.tick + REMOTE_CONFIG.scoutDeadline,
				}, ctx.tick);
			}
		}
		if (rec.state === "active") {
			// 预定任务一期暂缓: 旧链 (planRemoteHarvest reserve: 前缀) 仍在产
			// 预定任务, 双键并行会孵两只 reserver; 第 5 节闭环切换时统一接管
			// (remote:reserve: 键已在任务形态表 §24.8.1 定义, 届时启用)
			continue;
		}
	}
}

/** 净收益准入排序后的 active 房列表 (HUD/控制台查询用) */
export function activeColonyRooms(ctx: TickContext, homeName: string): RemoteRoomRecord[] {
	return Object.values(ctx.memory.remotes?.[homeName]?.rooms ?? {}).filter(
		(r) => r.state === "active",
	);
}
