/**
 * 外矿路网集成 (docs/nexus-design/13 §24.2 二期, remote-roads 1.2/2.x/3.1):
 * 干线规划节拍 + 放量意图 + coverage 维护 + 路段维修登记。
 * 由 remote planner 主循环调用, 不自持 tick 相位。
 */
import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import type { RoomIntelRecord } from "@/core/store/memorySchema";
import { REMOTE_CONFIG } from "@/config/remote";
import { priorityFor } from "@/core/store/taskSchema";
import { submitIntent } from "@/runtime/intentQueue";
import {
	planRemoteRoad,
	roadNeedsPlanning,
	roadRecordOf,
	writeRoadRecord,
} from "@/modules/planner/roadPlanner";

/** 干线规划 + 放量节拍 (每 active 房每 planInterval 跑一次) */
export function runRemoteRoads(
	ctx: TickContext,
	board: TaskBoard,
	homeName: string,
	roomName: string,
	intel: RoomIntelRecord | undefined,
): void {
	if (!intel?.sources?.length) return;

	// 规划: 无记录/超期时, 从第一个源的容器位起一条干线
	if (roadNeedsPlanning(ctx, roomName)) {
		const anchor = intel.sources[0];
		if (anchor) {
			const record = planRemoteRoad(homeName, roomName, { x: anchor.x, y: anchor.y });
			if (record) writeRoadRecord(roomName, record);
		}
	}

	const record = roadRecordOf(roomName);
	if (!record) return;

	maintainCoverage(ctx, roomName, record);
	emitSiteIntents(ctx, homeName, roomName, record);
	emitRepairs(ctx, board, homeName, roomName, record);
}

/** coverage 回填: 视野内路段已建成数 / 总数 */
function maintainCoverage(ctx: TickContext, roomName: string, record: { segments: { room: string; xy: number[] }[]; total: number; built: number; coverage: number }): void {
	let built = 0;
	for (const seg of record.segments) {
		const live = Game.rooms[seg.room];
		if (!live) continue;
		const roadAt = new Set(
			live
				.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_ROAD })
				.map((s) => s.pos.x * 50 + s.pos.y),
		);
		for (const packed of seg.xy) {
			if (roadAt.has(packed)) built += 1;
		}
	}
	// 无视野房维持上次计数: 只在可见房间集合变化时重算 (简版: 全量重扫可见房)
	record.built = built;
	record.coverage = record.total > 0 ? built / record.total : 0;
}

/** 放量: 未建成路段按序提 createSite 意图 (每房每 tick 至多一段, 限速) */
function emitSiteIntents(
	ctx: TickContext,
	homeName: string,
	roomName: string,
	record: { segments: { room: string; xy: number[] }[]; built: number; coverage: number },
): void {
	if (record.coverage >= 1) return;
	let placed = 0;
	for (const seg of record.segments) {
		const live = Game.rooms[seg.room];
		if (!live) continue;
		const siteAt = new Set(
			live
				.find(FIND_CONSTRUCTION_SITES, { filter: (s) => s.structureType === STRUCTURE_ROAD })
				.map((s) => s.pos.x * 50 + s.pos.y),
		);
		const roadAt = new Set(
			live
				.find(FIND_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_ROAD })
				.map((s) => s.pos.x * 50 + s.pos.y),
		);
		for (const packed of seg.xy) {
			if (siteAt.has(packed) || roadAt.has(packed)) continue;
			const x = Math.floor(packed / 50);
			const y = packed % 50;
			submitIntent(ctx.tick, {
				actorName: homeName,
				kind: "createSite",
				pipeline: "construction",
				priority: REMOTE_CONFIG.roads.sitePriority,
				targetPos: { x, y, roomName: seg.room },
				payload: { structureType: STRUCTURE_ROAD },
				dedupeKey: `remote-road:${homeName}:${seg.room}:${x}:${y}`,
			});
			placed += 1;
			if (placed >= 2) return; // 每 tick 每房限两段 (放量限速)
		}
	}
}

/** 维修登记: 已建路段 hits 低于阈值出 repair 任务 (paused 房由调用方跳过) */
function emitRepairs(
	ctx: TickContext,
	board: TaskBoard,
	homeName: string,
	roomName: string,
	record: { segments: { room: string; xy: number[] }[]; repairEmitted?: number },
): void {
	const threshold = REMOTE_CONFIG.roads.repairBelow;
	const siteSet = new Set<string>();
	for (const seg of record.segments) {
		const live = Game.rooms[seg.room];
		if (!live) continue;
		const roads = live.find(FIND_STRUCTURES, {
			filter: (s): s is StructureRoad => s.structureType === STRUCTURE_ROAD,
		});
		const byPos = new Map(roads.map((r) => [r.pos.x * 50 + r.pos.y, r]));
		for (const packed of seg.xy) {
			const road = byPos.get(packed);
			if (!road) continue;
			if (road.hits / road.hitsMax >= threshold) continue;
			const x = Math.floor(packed / 50);
			const y = packed % 50;
			const key = `remote:repair:${seg.room}:${x}:${y}`;
			siteSet.add(key);
			record.repairEmitted = (record.repairEmitted ?? 0) + 1;
			board.upsert(
				{
					dedupeKey: key,
					kind: "repair",
					roomName: homeName,
					targetId: road.id,
					targetPos: { x, y, roomName: seg.room },
					priority: priorityFor("repair"),
					requiredCapabilities: ["work", "carry", "move"],
				},
				ctx.tick,
			);
		}
	}
	// 路段已修好/消失: 撤销不再续命的历史维修任务
	for (const task of board.list({ kinds: ["repair"], roomName: homeName })) {
		if (!task.dedupeKey?.startsWith("remote:repair:")) continue;
		if (siteSet.has(task.dedupeKey)) continue;
		if (task.status === "completed" || task.status === "cancelled") continue;
		board.cancel(task.id, ctx.tick, "road-repaired");
	}
}
