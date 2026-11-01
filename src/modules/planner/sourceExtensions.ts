/**
 * 源旁 extension 直供链落位 (SOURCE_EXTENSION_CONFIG / bugs P1-14):
 * 冲级档在每个 source 的 ring-2 (切比雪夫距离恰为 ring) 放 ext 工地——
 * ring-1 是采集工位, ring-2 与工位相邻不相占, 驻点矿工在工位上直接把能量
 * 填进相邻 ext (agentSystem harvest 分支的直填行为), source → spawn 供能零腿化。
 * 遵守 RCL 的 ext 配额 (已建成 + 全部在建 ≤ 上限), 与布局放量共享配额。
 */
import { SOURCE_EXTENSION_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import type { RoomObservation, SourceSummary } from "@/core/world";
import type { RoomIntelRecord } from "@/core/store/memorySchema";
import { submitIntent } from "@/runtime/intentQueue";

/** 源旁 ext 工地在途意图 tick (房间 → 提交 tick; 超时未成站视为失败) */
const pendingByRoom = new Map<string, number>();

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 站点创建失败冷却 (进程级, 有界每房一条) */
const retryAtByRoom = new Map<string, number>();

function isRingExtension(
	structure: { x: number; y: number; structureType: string },
	sources: SourceSummary[],
): boolean {
	if (structure.structureType !== "extension") {
		return false;
	}
	return sources.some(
		(source) => chebyshev(structure.x, structure.y, source.x, source.y) === SOURCE_EXTENSION_CONFIG.ring,
	);
}

/**
 * 评分选点: 候选 = 距 source 恰为 ring 的非墙且无结构/工地格;
 * 必须与该 source 的采集工位 (驻点) 相邻, 否则矿工够不着、直填不成立;
 * 评分 = 相邻驻点数 × 10 + 非墙邻格数 (不堵路), 返回按分排序的点位列表。
 */
export function pickSourceExtensionSpots(
	roomObj: Room,
	source: SourceSummary,
	standableTiles: { x: number; y: number }[],
): { x: number; y: number }[] {
	const terrain = roomObj.getTerrain();
	const ring = SOURCE_EXTENSION_CONFIG.ring;
	const candidates: { x: number; y: number; score: number }[] = [];
	for (let dy = -ring; dy <= ring; dy += 1) {
		for (let dx = -ring; dx <= ring; dx += 1) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
				continue;
			}
			const x = source.x + dx;
			const y = source.y + dy;
			if (x < 0 || x > 49 || y < 0 || y > 49) {
				continue;
			}
			if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) {
				continue;
			}
			if (roomObj.lookForAt(LOOK_STRUCTURES, x, y).length > 0) {
				continue;
			}
			if (roomObj.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) {
				continue;
			}
			const workAdjacent = standableTiles.some(
				(tile) => chebyshev(x, y, tile.x, tile.y) <= 1,
			);
			if (!workAdjacent) {
				continue;
			}
			let standable = 0;
			for (let ny = -1; ny <= 1; ny += 1) {
				for (let nx = -1; nx <= 1; nx += 1) {
					if (nx === 0 && ny === 0) {
						continue;
					}
					if ((terrain.get(x + nx, y + ny) & TERRAIN_MASK_WALL) === 0) {
						standable += 1;
					}
				}
			}
			candidates.push({ x, y, score: workAdjacentCount(standableTiles, x, y) * 10 + standable });
		}
	}
	return candidates
		.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)
		.map(({ x, y }) => ({ x, y }));
}

function workAdjacentCount(tiles: { x: number; y: number }[], x: number, y: number): number {
	return tiles.filter((tile) => chebyshev(x, y, tile.x, tile.y) <= 1).length;
}

/**
 * 源旁 ext 落位决策 (Planner commit 阶段逐 owned room 调用, 冲级档生效):
 * RCL 门控 → 配额门控 (ext 建成+在建 < RCL 上限) → 并发工地门控 →
 * 逐 source 评分选点落一个工地, 失败按配置冷却。
 */
export function runSourceExtensionPlacement(
	ctx: TickContext,
	room: RoomObservation,
	roomObj: Room,
	intel: RoomIntelRecord,
): void {
	if (room.rcl > SOURCE_EXTENSION_CONFIG.maxRcl || room.rcl < SOURCE_EXTENSION_CONFIG.minRcl) {
		return;
	}
	const retryAt = retryAtByRoom.get(room.roomName);
	if (retryAt !== undefined && ctx.tick < retryAt) {
		return;
	}
	const pending = pendingByRoom.get(room.roomName);
	if (pending !== undefined && ctx.tick - pending < SOURCE_EXTENSION_CONFIG.siteRetryInterval) {
		// 在途意图未超时: 等待 broker 执行落地, 不重复提交
		return;
	}
	const extCap = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.rcl] ?? 0;
	const built = room.energyStructures.filter((s) => s.structureType === "extension").length;
	const sited = room.sites.filter((s) => s.structureType === "extension").length;
	if (built + sited >= extCap) {
		return;
	}
	const ringSites = room.sites.filter((site) => isRingExtension(site, room.sources)).length;
	if (ringSites >= SOURCE_EXTENSION_CONFIG.maxConcurrentSites) {
		return;
	}
	for (const source of room.sources) {
		const worksite = intel.worksites?.[source.id];
		if (!worksite) {
			continue;
		}
		const standableTiles = [{ x: worksite.x, y: worksite.y }];
		for (const spot of pickSourceExtensionSpots(roomObj, source, standableTiles)) {
			// 经命令边界提交工地创建 (api/17); 原生调用权收编进 broker
			submitIntent(ctx.tick, {
				actorName: room.roomName,
				kind: "createSite",
				pipeline: "construction",
				priority: 40,
				targetPos: { x: spot.x, y: spot.y, roomName: room.roomName },
				payload: { structureType: STRUCTURE_EXTENSION },
				dedupeKey: `src-ext:${room.roomName}:${spot.x}:${spot.y}`,
			});
			pendingByRoom.set(room.roomName, ctx.tick);
			ctx.logger.info(
				`src-ext:${room.roomName}:${ctx.tick} 源旁 ext 站点意图提交 (${spot.x},${spot.y})`,
			);
			return;
		}
	}
}
