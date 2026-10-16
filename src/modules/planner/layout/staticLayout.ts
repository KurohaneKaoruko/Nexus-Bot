// @ts-nocheck
/**
 * 静态模板布局: 模板平移 + rampart 外环 + 采集基建 (容器/link/道路) + link 建造排序。
 */
import * as StaticPlanner from '../static';
import { compressBatch } from '@/utils/compress';
import type { XY, LayoutStructMap, LayoutCenter, LayoutMemoryMap } from './types'

/** 判断某个位置是否是墙体地形 */
function isWall(terrain: RoomTerrain, x: number, y: number): boolean {
	return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

/** 遍历 8 邻域（不含自身） */
function forNear8(x: number, y: number, fn: (nx: number, ny: number) => void): void {
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (dx === 0 && dy === 0) continue;
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
			fn(nx, ny);
		}
	}
}

/** 计算静态布局的边界盒 */
export function applyStaticBuildings(roomName: string, layoutType: string, center: LayoutCenter): { structMap: LayoutStructMap; minX: number; maxX: number; minY: number; maxY: number } | null {
	const data = (StaticPlanner as any)[layoutType];
	if (!data) return null;
	const structMap: LayoutStructMap = {};
	for (const s in data.buildings) structMap[s] = [];
	if (!structMap.road) structMap.road = [];
	if (!structMap.container) structMap.container = [];
	if (!structMap.link) structMap.link = [];
	if (!structMap.rampart) structMap.rampart = [];
	const terrain = new Room.Terrain(roomName);

	let minX = 49;
	let maxX = 0;
	let minY = 49;
	let maxY = 0;

	for (const s in data.buildings) {
		const poss = data.buildings[s];
		if (!structMap[s]) structMap[s] = [];
		for (const pos of poss) {
			const x = center.x + pos.x;
			const y = center.y + pos.y;
			if (x < 0 || x > 49 || y < 0 || y > 49) continue;
			if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
			structMap[s].push([x, y]);
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
	}

	return { structMap, minX, maxX, minY, maxY };
}

/** 静态布局的 rampart 外圈（用于预览/构建保持一致） */
export function addStaticRampartRing(roomName: string, structMap: LayoutStructMap, bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
	const terrain = new Room.Terrain(roomName);
	let minX = bounds.minX - 3;
	let maxX = bounds.maxX + 3;
	let minY = bounds.minY - 3;
	let maxY = bounds.maxY + 3;

	if (!structMap.rampart) structMap.rampart = [];
	for (let i = minX; i <= maxX; i++) {
		for (let j = minY; j <= maxY; j++) {
			if ([0, 1, 48, 49].includes(i)) continue;
			if ([0, 1, 48, 49].includes(j)) continue;
			if (terrain.get(i, j) == TERRAIN_MASK_WALL) continue;
			if (i == minX || i == maxX || j == minY || j == maxY) {
				structMap.rampart.push([i, j]);
			}
		}
	}
}

/** 将房间坐标编码成稳定 key */
function xyKey(x: number, y: number): string {
	return `${x}:${y}`;
}

/** 计算 Chebyshev 距离（max(|dx|,|dy|)） */
function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

type OrderedLinkEntry = {
	kind: 'source' | 'center' | 'controller' | 'other';
	pos: XY;
	sourceDistance?: number;
	originalIndex: number;
};

/** 对 link 排序: 先距 source 最近, 再 center, 最后其他 (决定建造顺序) */
export function reorderLinkBuildOrder(room: Room, center: LayoutCenter, structMap: LayoutStructMap): void {
	const links = structMap.link;
	if (!links || links.length <= 1) return;

	const sources = room.find(FIND_SOURCES);
	const controller = room.controller;
	const centerPos = new RoomPosition(center.x, center.y, room.name);

	const sourceEntries: OrderedLinkEntry[] = [];
	const otherEntries: OrderedLinkEntry[] = [];
	let centerEntry: OrderedLinkEntry | null = null;
	let controllerEntry: OrderedLinkEntry | null = null;

	links.forEach((pos, originalIndex) => {
		const linkPos = new RoomPosition(pos[0], pos[1], room.name);
		const matchedSource = sources.find((source) => linkPos.inRangeTo(source.pos, 2));
		if (matchedSource) {
			sourceEntries.push({
				kind: 'source',
				pos,
				sourceDistance: chebyshev(matchedSource.pos, center),
				originalIndex,
			});
			return;
		}

		if (linkPos.inRangeTo(centerPos, 1)) {
			centerEntry = { kind: 'center', pos, originalIndex };
			return;
		}

		if (controller && linkPos.inRangeTo(controller.pos, 2)) {
			controllerEntry = { kind: 'controller', pos, originalIndex };
			return;
		}

		otherEntries.push({ kind: 'other', pos, originalIndex });
	});

	sourceEntries.sort((a, b) => {
		const distDelta = (b.sourceDistance || 0) - (a.sourceDistance || 0);
		if (distDelta !== 0) return distDelta;
		return a.originalIndex - b.originalIndex;
	});
	otherEntries.sort((a, b) => a.originalIndex - b.originalIndex);

	const ordered: XY[] = [];
	if (sourceEntries.length > 0) ordered.push(sourceEntries.shift()!.pos);
	if (centerEntry) ordered.push(centerEntry.pos);
	if (controllerEntry) ordered.push(controllerEntry.pos);
	for (const entry of sourceEntries) ordered.push(entry.pos);
	for (const entry of otherEntries) ordered.push(entry.pos);

	if (ordered.length !== links.length) return;
	structMap.link = ordered;
}

/**
 * 静态布局的采集基础设施规划
 * - 资源点：在 source/mineral 临近放置 container（尽量选靠近中心、非墙、非占用格；允许与 road 重叠）
 * - 资源点：在 source 的 container 临近放置 link（优先避开 road；无位可放时允许在 road 上）
 * - 道路：中心点连接到 container / controller，允许与 container 重叠，但避免在 link 上铺 road
 * - 低开销策略：不做全房间 cost 填充，仅用 CostMatrix 标记障碍与已有 road=1；容器优先复用寻路末端格
 */
export function planHarvestInfra(room: Room, center: LayoutCenter, structMap: LayoutStructMap): void {
	if (!structMap.road) structMap.road = [];
	if (!structMap.container) structMap.container = [];
	if (!structMap.link) structMap.link = [];

	const terrain = new Room.Terrain(room.name);

	const roadXy = new Set<string>();
	for (const p of structMap.road) roadXy.add(xyKey(p[0], p[1]));

	const containerXy = new Set<string>();
	for (const p of structMap.container) containerXy.add(xyKey(p[0], p[1]));

	const linkXy = new Set<string>();
	for (const p of structMap.link) linkXy.add(xyKey(p[0], p[1]));

	const rampartXy = new Set<string>();
	for (const p of structMap.rampart || []) rampartXy.add(xyKey(p[0], p[1]));

	const blockedXy = new Set<string>();
	for (const struct of OBSTACLE_OBJECT_TYPES) {
		const points = structMap[struct] || [];
		for (const p of points) blockedXy.add(xyKey(p[0], p[1]));
	}

	const costs = new PathFinder.CostMatrix();
	for (const k of blockedXy) {
		const [xs, ys] = k.split(':');
		costs.set(Number(xs), Number(ys), 255);
	}
	for (const k of roadXy) {
		const [xs, ys] = k.split(':');
		costs.set(Number(xs), Number(ys), 1);
	}
	for (const k of linkXy) {
		const [xs, ys] = k.split(':');
		costs.set(Number(xs), Number(ys), 255);
	}

	const isBlocked = (x: number, y: number): boolean => {
		const k = xyKey(x, y);
		if (blockedXy.has(k)) return true;
		if (linkXy.has(k)) return true;
		return false;
	};

	const canPlaceContainer = (x: number, y: number): boolean => {
		if (isWall(terrain, x, y)) return false;
		if (isBlocked(x, y)) return false;
		const k = xyKey(x, y);
		if (containerXy.has(k)) return false;
		if (linkXy.has(k)) return false;
		return true;
	};

	const canPlaceLink = (x: number, y: number, allowOnRoad = false): boolean => {
		if (isWall(terrain, x, y)) return false;
		if (isBlocked(x, y)) return false;
		const k = xyKey(x, y);
		if (containerXy.has(k)) return false;
		if (linkXy.has(k)) return false;
		if (!allowOnRoad && roadXy.has(k)) return false;
		return true;
	};

	const pickContainer = (target: RoomPosition, preferred?: RoomPosition): XY | null => {
		if (preferred && chebyshev(preferred, target) === 1 && canPlaceContainer(preferred.x, preferred.y)) {
			return [preferred.x, preferred.y];
		}

		let best: XY | null = null;
		let bestScore = Infinity;

		forNear8(target.x, target.y, (x, y) => {
			if (chebyshev({ x, y }, target) !== 1) return;
			if (!canPlaceContainer(x, y)) return;

			const dist = chebyshev({ x, y }, center);
			const swampPenalty = terrain.get(x, y) === TERRAIN_MASK_SWAMP ? 1 : 0;
			const rampartBonus = rampartXy.has(xyKey(x, y)) ? -2 : 0;
			const score = dist * 10 + swampPenalty + rampartBonus;

			if (score < bestScore) {
				bestScore = score;
				best = [x, y];
			}
		});

		return best;
	};

	const pickLinkNear = (container: XY): XY | null => {
		const pick = (allowOnRoad: boolean): XY | null => {
			let best: XY | null = null;
			let bestScore = Infinity;

			forNear8(container[0], container[1], (x, y) => {
				if (!canPlaceLink(x, y, allowOnRoad)) return;

				const k = xyKey(x, y);
				const rampartBonus = rampartXy.has(k) ? -100 : 0;
				const roadPenalty = roadXy.has(k) ? 1000 : 0;
				const score = roadPenalty + rampartBonus;

				if (score < bestScore) {
					bestScore = score;
					best = [x, y];
				}
			});

			return best;
		};

		return pick(false) || pick(true);
	};

	const addRoadPath = (path: RoomPosition[]): void => {
		for (const p of path) {
			if (costs.get(p.x, p.y) === 255) continue;
			const k = xyKey(p.x, p.y);
			if (linkXy.has(k)) continue;
			if (roadXy.has(k)) continue;
			roadXy.add(k);
			structMap.road!.push! ([p.x, p.y]);
			costs.set(p.x, p.y, 1);
		}
	};

	const connect = (start: RoomPosition, target: RoomPosition, range: number): RoomPosition[] => {
		return PathFinder.search(start, { pos: target, range }, {
			plainCost: 2,
			swampCost: 4,
			maxRooms: 1,
			roomCallback: () => costs
		}).path;
	};

	const start = new RoomPosition(center.x, center.y, room.name);
	const sources = room.find(FIND_SOURCES);
	const mineral = room.find(FIND_MINERALS)[0];
	const controller = room.controller;
	if (!controller) return;

	const targets: Array<{ pos: RoomPosition; kind: 'source' | 'mineral' | 'controller' }> = [
		...sources.map((s) => ({ pos: s.pos, kind: 'source' as const })),
		...(mineral ? [{ pos: mineral.pos, kind: 'mineral' as const }] : []),
		{ pos: controller.pos, kind: 'controller' as const }
	];

	targets.sort((a, b) => chebyshev(a.pos, center) - chebyshev(b.pos, center));

	for (const t of targets) {
		if (t.kind === 'controller') {
			addRoadPath(connect(start, t.pos, 1));
			continue;
		}

		const toNearTarget = connect(start, t.pos, 1);
		const preferred = toNearTarget.length > 0 ? toNearTarget[toNearTarget.length - 1] : undefined;
		const container = pickContainer(t.pos, preferred);
		if (!container) {
			addRoadPath(toNearTarget);
			continue;
		}

		const containerKey = xyKey(container[0], container[1]);
		if (!containerXy.has(containerKey)) {
			structMap.container.push([container[0], container[1]]);
			containerXy.add(containerKey);
		}

		if (t.kind === 'source') {
			const link = pickLinkNear(container);
			if (link) {
				const linkKey = xyKey(link[0], link[1]);
				if (!linkXy.has(linkKey)) {
					structMap.link.push([link[0], link[1]]);
					linkXy.add(linkKey);
					costs.set(link[0], link[1], 255);
				}
			}
		}

		if (preferred && preferred.x === container[0] && preferred.y === container[1]) {
			addRoadPath(toNearTarget);
		} else {
			addRoadPath(connect(start, new RoomPosition(container[0], container[1], room.name), 0));
		}
	}
}

/** 将 structMap 压缩成布局子系统的持久化格式 */
export function toLayoutMemory(structMap: LayoutStructMap): LayoutMemoryMap {
	const memory: LayoutMemoryMap = {};
	for (const s in structMap) {
		const pts = structMap[s];
		memory[s] = compressBatch(pts);
	}
	return memory;
}

/** 应用静态模板的全部加工步骤 (rampart 外环 + 采集基建 + link 排序 + 压缩), 返回 null 表示模板不存在 */
export function buildStaticStructMap(roomName: string, layoutType: string, center: LayoutCenter, room: Room): { structMap: LayoutStructMap; layoutMemory: LayoutMemoryMap } | null {
	const base = applyStaticBuildings(roomName, layoutType, center);
	if (!base) return null;
	const { structMap, minX, maxX, minY, maxY } = base;
	addStaticRampartRing(roomName, structMap, { minX, maxX, minY, maxY });
	planHarvestInfra(room, center, structMap);
	reorderLinkBuildOrder(room, center, structMap);
	const layoutMemory = toLayoutMemory(structMap);
	return { structMap, layoutMemory };
}
