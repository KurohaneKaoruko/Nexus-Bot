/**
 * 基础设施建造 (docs/nexus-design/17 §17.3/§17.10 最小闭环 + bugs/P0-1):
 * Source 容器沿用 worksite 规划的期望位, 本模块在 commit 段幂等创建站点;
 * extension 按 RCL 上限在 spawn 周围环带落位 (容量扩容是一切产能的前提);
 * 主干道 (spawn↔controller↔sources) 在 extension 落位后低频规划;
 * 创建失败按类型冷却, 不重复请求、不阻塞主闭环; 被摧毁后存在性检查失效自动重建。
 */
import { CONSTRUCTION_CONFIG, WORKSITE_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import type { WorksiteRecord } from "@/store/memorySchema";
import type { RoomObservation, SourceSummary } from "@/core/world";

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function hasContainerNearSource(room: RoomObservation, source: SourceSummary): boolean {
	return room.stores.some(
		(store) => store.structureType === "container" && chebyshev(store.x, store.y, source.x, source.y) <= 1,
	);
}

function hasSiteAt(room: RoomObservation, spot: { x: number; y: number }, structureType?: string): boolean {
	return room.sites.some(
		(site) =>
			site.x === spot.x &&
			site.y === spot.y &&
			(structureType === undefined || site.structureType === structureType),
	);
}

/** 创建失败冷却 (docs/nexus-design/17 §17.10): invalid_placement/site_limit/rcl_limit 都暂停到重试点 */
function coolDown(worksite: WorksiteRecord, ctx: TickContext): void {
	worksite.siteRetryAt = ctx.tick + WORKSITE_CONFIG.siteRetryInterval;
}

/** 已占格集合: 现有结构 + 已有站点 (extension 不得顶掉路/容器等) */
function occupiedTiles(roomObj: Room): Set<string> {
	const occupied = new Set<string>();
	for (const structure of roomObj.find(FIND_STRUCTURES)) {
		occupied.add(`${structure.pos.x}:${structure.pos.y}`);
	}
	return occupied;
}

/** extension 候选格: spawn 周围环带 (确定性顺序), 排除墙/占用/工作位/容器位/controller 周边 */
function extensionCandidates(
	room: RoomObservation,
	roomObj: Room,
	spawn: { x: number; y: number },
	intel: { worksites?: Record<string, WorksiteRecord> },
): Array<{ x: number; y: number }> {
	const terrain = new Room.Terrain(room.roomName);
	const occupied = occupiedTiles(roomObj);
	const reserved = new Set<string>();
	for (const worksite of Object.values(intel.worksites ?? {})) {
		reserved.add(`${worksite.x}:${worksite.y}`);
		if (worksite.containerSpot) {
			reserved.add(`${worksite.containerSpot.x}:${worksite.containerSpot.y}`);
		}
	}
	const candidates: Array<{ x: number; y: number }> = [];
	for (let radius = CONSTRUCTION_CONFIG.extensionRingMin; radius <= CONSTRUCTION_CONFIG.extensionRingMax; radius += 1) {
		for (let dy = -radius; dy <= radius; dy += 1) {
			for (let dx = -radius; dx <= radius; dx += 1) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
					continue;
				}
				const x = spawn.x + dx;
				const y = spawn.y + dy;
				if (x < 2 || x > 47 || y < 2 || y > 47) {
					continue;
				}
				if (terrain.get(x, y) === TERRAIN_MASK_WALL || occupied.has(`${x}:${y}`) || reserved.has(`${x}:${y}`)) {
					continue;
				}
				if (room.sites.some((site) => site.x === x && site.y === y)) {
					continue;
				}
				if (room.controller && chebyshev(x, y, room.controller.x, room.controller.y) <= CONSTRUCTION_CONFIG.controllerClearRange) {
					continue;
				}
				candidates.push({ x, y });
			}
		}
	}
	return candidates;
}

/** extension 缺口: RCL 上限 - 现有数 - 在建站点数 */
function missingExtensions(room: RoomObservation): number {
	const allowed = CONSTRUCTION_CONFIG.extensionMaxByRcl[room.rcl] ?? 0;
	const existing =
		room.energyStructures.filter((structure) => structure.structureType === "extension").length +
		room.sites.filter((site) => site.structureType === "extension").length;
	return allowed - existing;
}

/** extension 落位: 优先于主干道 (容量扩容封顶一切产能, bugs/P0-1) */
function planExtensions(ctx: TickContext, room: RoomObservation, roomObj: Room): number {
	const missing = missingExtensions(room);
	if (missing <= 0) {
		return 0;
	}
	const spawn = room.energyStructures.find((structure) => structure.structureType === "spawn");
	const intel = ctx.memory.rooms[room.roomName];
	if (!spawn || !intel) {
		return 0;
	}
	let created = 0;
	const budget = Math.min(missing, CONSTRUCTION_CONFIG.extensionSitesPerTick);
	for (const spot of extensionCandidates(room, roomObj, spawn, intel)) {
		if (created >= budget) {
			break;
		}
		const code = roomObj.createConstructionSite(spot.x, spot.y, STRUCTURE_EXTENSION);
		if (code === OK) {
			created += 1;
			continue;
		}
		if (code === ERR_RCL_NOT_ENOUGH || code === ERR_FULL) {
			break; // 站点数满/等级不足: 本 tick 放弃
		}
		// 单格不可用 (地形/占用): 尝试下一候选
	}
	if (created > 0) {
		ctx.logger.info(`extension-site:${room.roomName}:${ctx.tick} 落位 ${created} 个 (缺口 ${missing})`);
	}
	return created;
}

/** 主干道: spawn ↔ controller ↔ sources 的 findPath 线铺路 (低频重查, 路满即零新增) */
function planRoads(ctx: TickContext, room: RoomObservation, roomObj: Room): void {
	const spawn = room.energyStructures.find((structure) => structure.structureType === "spawn");
	if (!spawn || !room.controller) {
		return;
	}
	const occupied = occupiedTiles(roomObj);
	const targets: Array<{ x: number; y: number }> = [room.controller, ...room.sources];
	const from = new RoomPosition(spawn.x, spawn.y, room.roomName);
	for (const target of targets) {
		const path = roomObj.findPath(from, new RoomPosition(target.x, target.y, room.roomName), {
			range: 1,
			ignoreCreeps: true,
		});
		for (const step of path) {
			const key = `${step.x}:${step.y}`;
			if (occupied.has(key) || room.sites.some((site) => site.x === step.x && site.y === step.y)) {
				continue;
			}
			const code = roomObj.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
			if (code === OK) {
				occupied.add(key);
			} else if (code === ERR_FULL) {
				return;
			}
		}
	}
}

export function runConstructionPlanner(ctx: TickContext): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		if (room.rcl < WORKSITE_CONFIG.containerMinRcl) {
			continue;
		}
		const roomObj = Game.rooms[room.roomName];
		if (!roomObj || roomObj.controller?.my !== true) {
			continue;
		}
		const intel = ctx.memory.rooms[room.roomName];
		if (!intel?.worksites) {
			continue;
		}
		// extension 优先扩容; 道路让位 (有 extension 缺口时不分流量给道路)
		planExtensions(ctx, room, roomObj);
		if (missingExtensions(room) === 0 && ctx.tick % CONSTRUCTION_CONFIG.roadReplanInterval === 0) {
			planRoads(ctx, room, roomObj);
		}
		for (const source of room.sources) {
			const worksite = intel.worksites[source.id];
			const spot = worksite?.containerSpot;
			if (!worksite || !spot) {
				continue;
			}
			if (worksite.siteRetryAt !== undefined && ctx.tick < worksite.siteRetryAt) {
				continue;
			}
			if (hasContainerNearSource(room, source) || hasSiteAt(room, spot, "container")) {
				continue;
			}
			const code = roomObj.createConstructionSite(spot.x, spot.y, STRUCTURE_CONTAINER);
			if (code === OK) {
				ctx.logger.info(`container-site:${room.roomName}:${ctx.tick} Source 容器站点落位 (${spot.x},${spot.y})`);
			} else {
				coolDown(worksite, ctx);
				ctx.logger.warn(
					`container-site:${code}`,
					`容器站点创建失败 code=${code}, 冷却 ${WORKSITE_CONFIG.siteRetryInterval}t`,
				);
			}
		}
	}
}

export const constructionModule: TickModule = {
	name: "construction-sites",
	phase: "commit",
	band: "P2",
	run(ctx: TickContext): void {
		runConstructionPlanner(ctx);
	},
};
