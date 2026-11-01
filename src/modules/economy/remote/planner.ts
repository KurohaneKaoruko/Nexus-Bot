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
import { worksiteForUnseen } from "@/modules/world/worksite";
import { submitIntent } from "@/runtime/intentQueue";
import { roomModeProfileFor } from "@/modules/strategy";
import { estimateRemoteNet } from "@/modules/economy/remote/estimate";
import { remoteTransitionOf } from "@/modules/economy/remote/stateMachine";

/** 容器工地重试间隔 (对齐 WORKSITE_CONFIG.siteRetryInterval 语义) */
const SITE_RETRY = 50;
/** haul 起运量: 容器存量 ≥ 单程满载才值得跨房跑一趟 */
const REMOTE_HAUL_MIN = 100;

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
			emitActiveColonyTasks(ctx, board, room, name, rec, intel);
		}
	}
}

/** active 态任务生成 (§24.8.1 任务形态表): 每源采集/工地/容器任务 + 预定 */
function emitActiveColonyTasks(
	ctx: TickContext,
	board: TaskBoard,
	room: RoomObservation,
	roomName: string,
	rec: RemoteRoomRecord,
	intel: RoomIntelRecord | undefined,
): void {
	if (!intel?.sources) return;
	const live = Game.rooms[roomName];

	for (const src of intel.sources) {
		// 采集任务: 驻点矿工 (remoteHarvester hint 由孵化侧定体型)
		board.upsert({
			dedupeKey: `remote:harvest:${room.roomName}:${src.id}`,
			kind: "harvest",
			roomName: room.roomName,
			targetId: src.id,
			targetPos: { x: src.x, y: src.y, roomName },
			priority: priorityFor("harvest"),
			requiredCapabilities: ["work", "move"],
		}, ctx.tick);

		// 容器: 工位=驻点同格 (bugs/P0-3); 无成品容器/工地时放工地
		// (sitePending/siteRetryAt 防重, 沿用 planner 开局容器写法)
		const worksite = worksiteForUnseen(intel, roomName, src);
		const spot = worksite?.containerSpot ?? worksite;
		const hasContainer = Boolean(
			live?.find(FIND_STRUCTURES, {
				filter: (s) =>
					s.structureType === STRUCTURE_CONTAINER &&
					s.pos.x === spot?.x &&
					s.pos.y === spot?.y,
			}).length,
		);
		const hasSite = Boolean(
			live?.find(FIND_CONSTRUCTION_SITES, {
				filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.pos.x === spot?.x && s.pos.y === spot?.y,
			}).length,
		);
		if (live && spot && !hasContainer && !hasSite) {
			if (
				(worksite?.siteRetryAt ?? 0) <= ctx.tick &&
				(worksite?.sitePending ?? 0) <= ctx.tick - SITE_RETRY
			) {
				submitIntent(ctx.tick, {
					actorName: room.roomName,
					kind: "createSite",
					pipeline: "construction",
					priority: 40,
					targetPos: { x: spot.x, y: spot.y, roomName },
					payload: { structureType: STRUCTURE_CONTAINER },
					dedupeKey: `remote-container:${room.roomName}:${src.id}`,
				});
				if (worksite) {
					worksite.sitePending = ctx.tick;
				}
			}
		}

		// 搬运任务: 容器存量 ≥ 单只运量时发 haul (取货=容器, dest 由 quota 主干)
		const container = live
			?.find(FIND_STRUCTURES, {
				filter: (s): s is StructureContainer =>
					s.structureType === STRUCTURE_CONTAINER &&
					s.pos.inRangeTo(src.x, src.y, 2),
			})
			.find((c) => c.store.getUsedCapacity(RESOURCE_ENERGY) >= REMOTE_HAUL_MIN);
		if (container) {
			board.upsert({
				dedupeKey: `remote:haul:${room.roomName}:${container.id}`,
				kind: "carry",
				roomName: room.roomName,
				targetId: container.id,
				targetPos: { x: container.pos.x, y: container.pos.y, roomName },
				amount: container.store.getUsedCapacity(RESOURCE_ENERGY),
				priority: priorityFor("carry"),
				requiredCapabilities: ["carry", "move"],
			}, ctx.tick);
		}
	}

	// 预定任务 (docs/24 §24.8.1): 无主控制器的 active 外矿房。容量门 1300 =
	// 2×[CLAIM,MOVE] 造价 (§24.8.2 预定净增长需 2 CLAIM): 低于此容量装不下
	// 预定体, 缩水体 1 CLAIM 预定不净增长, 纯耗 spawn 槽 (任务书 5.6 口径);
	// 容量降档时取消存量任务 (升级丢房/迁移场景)
	const controller = live?.controller;
	const reserveAffordable = room.energyCapacity >= 2 * (600 + 50);
	const reserveKey = `remote:reserve:${room.roomName}:${roomName}`;
	if (controller && !controller.owner && reserveAffordable) {
		const reservation = controller.reservation;
		const me = myUsername();
		if (!reservation || (reservation.username === me && reservation.ticksToEnd < REMOTE_CONFIG.reserveRefreshBelow)) {
			board.upsert({
				dedupeKey: reserveKey,
				kind: "reserve",
				roomName: room.roomName,
				targetId: controller.id,
				targetPos: { x: controller.pos.x, y: controller.pos.y, roomName },
				priority: priorityFor("reserve"),
				requiredCapabilities: ["claim", "move"],
			}, ctx.tick);
		}
	} else {
		// 容量不足/控制器有主: 终结存量预定任务 (upsert 不再续命)
		const stale = board
			.list({ kinds: ["reserve"], roomName: room.roomName })
			.find((t) => t.dedupeKey === reserveKey);
		if (stale && stale.status !== "completed" && stale.status !== "cancelled") {
			board.cancel(stale.id, ctx.tick, "reserve-unaffordable");
		}
	}
}

/** 净收益准入排序后的 active 房列表 (HUD/控制台查询用) */
export function activeColonyRooms(ctx: TickContext, homeName: string): RemoteRoomRecord[] {
	return Object.values(ctx.memory.remotes?.[homeName]?.rooms ?? {}).filter(
		(r) => r.state === "active",
	);
}
