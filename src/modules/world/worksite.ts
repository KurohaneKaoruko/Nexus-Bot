/**
 * 固定采集工作位 (docs/nexus-design/06 §6.3 / docs/nexus-design/17 §17.4 / bugs/P0-3):
 * 每个 Source 从相邻可行走格中选定固定驻点, 结果缓存进房间 Intel (仅坐标);
 * 每 Tick 用快照校验 (被不可通行工地占用则重选), 环境不变时替补继承原驻点;
 * Source 容器期望位与驻点**同格**——矿工站在容器上采集, 溢出/落地能量经官方
 * `_create-energy` 直接流入同格容器 (无需给矿工加 carry), 供建造模块幂等落站点。
 */
import { WORKSITE_CONFIG } from "@/config/economy";
import { decompressBatch } from "@/utils/compress";
import type { RoomIntelRecord, WorksiteRecord } from "@/core/store/memorySchema";
import type { RoomObservation, SourceSummary } from "@/core/world";

/** 可通行的工地类型: 建在驻点上不使驻点失效、不阻挡通行 (路/容器) */
const PASSABLE_SITE_TYPES: ReadonlySet<string> = new Set(["road", "container"]);

/** 工地是否阻挡通行 (容器/道路可通行, 其余视为占用) */
function isBlockingSite(site: { structureType: string }): boolean {
	return !PASSABLE_SITE_TYPES.has(site.structureType);
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 是否房间边缘格 (贴边格易堵出口/被出口流量挤压, 不宜驻点) */
function isEdge(x: number, y: number): boolean {
	return x <= 0 || x >= 49 || y <= 0 || y >= 49;
}

/** Source 相邻 8 格中的可行走格 (地形非墙), 排除不可通行工地占用的格 */
function walkableAdjacents(
	source: SourceSummary,
	room: RoomObservation,
): Array<{ x: number; y: number }> {
	const terrain = new Room.Terrain(source.roomName);
	const blocked = new Set(room.sites.filter(isBlockingSite).map((site) => `${site.x}:${site.y}`));
	// 已有容器 (结构或工地) 的格优先: 驻点合一后替补可无缝继承既有容器位
	const containerTiles = new Set<string>();
	for (const store of room.stores) {
		if (store.structureType === "container") {
			containerTiles.add(`${store.x}:${store.y}`);
		}
	}
	for (const site of room.sites) {
		if (site.structureType === "container") {
			containerTiles.add(`${site.x}:${site.y}`);
		}
	}
	const candidates: Array<{ x: number; y: number; score: number }> = [];
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			if (dx === 0 && dy === 0) {
				continue;
			}
			const x = source.x + dx;
			const y = source.y + dy;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL || blocked.has(`${x}:${y}`)) {
				continue;
			}
			// 评分: 不贴边 + 开阔 (周边可行走多, 便于换位/通道) + 靠近房间中心 + 容器亲和
			let open = 0;
			for (let oy = -1; oy <= 1; oy += 1) {
				for (let ox = -1; ox <= 1; ox += 1) {
					if (terrain.get(x + ox, y + oy) !== TERRAIN_MASK_WALL) {
						open += 1;
					}
				}
			}
			const affinity = containerTiles.has(`${x}:${y}`) ? WORKSITE_CONFIG.containerAffinityBonus : 0;
			const score = (isEdge(x, y) ? -100 : 0) + open * 10 - chebyshev(x, y, 25, 25) + affinity;
			candidates.push({ x, y, score });
		}
	}
	candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
	return candidates;
}

/**
 * 校验缓存的驻点仍可用: 非墙且未被不可通行工地占用。
 * 容器/道路工地不使驻点失效 (驻点与容器同格是设计目标, bugs/P0-3);
 * 结构占用不在快照内, 由 Agent 层的不可达反馈触发重算兜底。
 */
function worksiteValid(
	source: SourceSummary,
	worksite: WorksiteRecord,
	room: RoomObservation,
): boolean {
	const terrain = new Room.Terrain(source.roomName);
	if (terrain.get(worksite.x, worksite.y) === TERRAIN_MASK_WALL) {
		return false;
	}
	return !room.sites.some(
		(site) => isBlockingSite(site) && site.x === worksite.x && site.y === worksite.y,
	);
}

/**
 * 容器期望位 = 驻点本身 (bugs/P0-3 定案):
 * 矿工站在容器上采矿, 溢出能量经官方机制直接入同格容器; carrier 从容器取货。
 */
function containerSpotFor(worksite: WorksiteRecord): { x: number; y: number } {
	return { x: worksite.x, y: worksite.y };
}

/**
 * 布局为该 Source 规划的容器位 (docs/nexus-design/17 §17.4):
 * 布局接管容器选址后, 驻点必须与布局容器合一, 避免两套选址各放各的;
 * 已有容器 (结构/工地) 时沿用它 (布局每源限一, 不会重复放量);
 * 无布局记录时返回 undefined, 驻点沿用本地评分选址。
 */
function layoutContainerSpot(room: RoomObservation, source: SourceSummary): { x: number; y: number } | undefined {
	const record = Memory.Nexus?.layout?.rooms?.[source.roomName];
	const compressed = record?.data?.container;
	if (!compressed?.length) {
		return undefined;
	}
	// 已有容器 (结构或工地): 布局不会再为该源放量, 驻点对齐现存容器
	const existingContainer = room.stores.find(
		(store) =>
			store.structureType === "container" &&
			Math.max(Math.abs(store.x - source.x), Math.abs(store.y - source.y)) <= 1,
	);
	const existingSite = room.sites.find(
		(site) =>
			site.structureType === "container" &&
			Math.max(Math.abs(site.x - source.x), Math.abs(site.y - source.y)) <= 1,
	);
	const existing = existingContainer ?? existingSite;
	if (existing) {
		return { x: existing.x, y: existing.y };
	}
	for (const [x, y] of decompressBatch(compressed)) {
		if (Math.max(Math.abs(x - source.x), Math.abs(y - source.y)) <= 1) {
			return { x, y };
		}
	}
	return undefined;
}

/**
 * 取 Source 的固定工作位 (带缓存): 首见计算并写 Intel, 环境变化时重算。
 * 布局容器位存在且可行走时优先采用; 返回 undefined 表示该 Source 周边不可驻点 (全墙)。
 */
export function worksiteFor(
	intel: RoomIntelRecord,
	room: RoomObservation,
	source: SourceSummary,
): WorksiteRecord | undefined {
	intel.worksites ??= {};
	const cached = intel.worksites[source.id];
	const layoutSpot = layoutContainerSpot(room, source);
	if (cached && worksiteValid(source, cached, room)) {
		// 布局容器位存在时, 缓存驻点必须与之合一 (布局是容器选址的唯一真相源)
		if (!layoutSpot || (cached.x === layoutSpot.x && cached.y === layoutSpot.y)) {
			return cached;
		}
	}
	let best: { x: number; y: number } | undefined;
	if (layoutSpot) {
		const terrain = new Room.Terrain(source.roomName);
		if (terrain.get(layoutSpot.x, layoutSpot.y) !== TERRAIN_MASK_WALL) {
			best = layoutSpot;
		}
	}
	if (!best) {
		[best] = walkableAdjacents(source, room);
	}
	if (!best) {
		delete intel.worksites[source.id];
		return undefined;
	}
	const record: WorksiteRecord = {
		x: best.x,
		y: best.y,
		containerSpot: containerSpotFor({ x: best.x, y: best.y }),
	};
	intel.worksites[source.id] = record;
	return record;
}

/**
 * 落点重算 (Agent 不可达反馈兜底): 清除缓存, 下次 worksiteFor 重新选址。
 * 返回是否确实清除了缓存。
 */
export function invalidateWorksite(intel: RoomIntelRecord, sourceId: string): boolean {
	if (intel.worksites && intel.worksites[sourceId]) {
		delete intel.worksites[sourceId];
		return true;
	}
	return false;
}

/** 采集任务容量: Source 相邻可行走格数 (环境变化时重算, 上限即工作位数) */
export function worksiteCapacity(source: SourceSummary, room: RoomObservation): number {
	return walkableAdjacents(source, room).length;
}

/** 是否位于该 Source 的固定工作位上 (驻点判定, Agent/BetterMove 共用) */
export function atWorksite(
	creep: { x: number; y: number },
	worksite: WorksiteRecord | undefined,
): boolean {
	return worksite !== undefined && creep.x === worksite.x && creep.y === worksite.y;
}
