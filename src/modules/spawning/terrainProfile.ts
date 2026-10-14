/**
 * 房间地形画像 (specs/adaptive-body-factory / bugs P1-14 根因②):
 * 沼泽密度 (可行走格中沼泽占比) + 关键通道 (spawn↔source/controller) 路网覆盖率,
 * 低频刷新进程级缓存 (有界每房一条, global 重置后首见重建) —— 体型编译按此分档 move 配比。
 */
import { BODY_TERRAIN_CONFIG } from "@/config/economy";

export interface RoomTerrainProfile {
	roomName: string;
	/** 可行走格中沼泽占比 (0..1) */
	swampRatio: number;
	/** 关键通道的路网覆盖率 (0..1, 无通道时为 1) */
	roadCover: number;
	computedAt: number;
}

const profiles = new Map<string, RoomTerrainProfile>();

/** 沼泽密度: 全房扫描一次 (2500 格), 静态值随缓存长期复用 */
function computeSwampRatio(room: Room): number {
	const terrain = room.getTerrain();
	let walkable = 0;
	let swamp = 0;
	for (let y = 0; y < 50; y += 1) {
		for (let x = 0; x < 50; x += 1) {
			const mask = terrain.get(x, y);
			if ((mask & TERRAIN_MASK_WALL) !== 0) {
				continue;
			}
			walkable += 1;
			if ((mask & TERRAIN_MASK_SWAMP) !== 0) {
				swamp += 1;
			}
		}
	}
	return walkable > 0 ? swamp / walkable : 0;
}

/** 关键通道 (spawn→各 source / controller) 的路网覆盖率: 通道格中有路占比 */
function computeRoadCover(room: Room): number {
	const spawn = room.find(FIND_MY_SPAWNS)[0];
	if (!spawn) {
		return 1;
	}
	const anchors: Array<{ x: number; y: number }> = room
		.find(FIND_SOURCES)
		.map((source) => ({ x: source.pos.x, y: source.pos.y }));
	if (room.controller) {
		anchors.push({ x: room.controller.pos.x, y: room.controller.pos.y });
	}
	if (anchors.length === 0) {
		return 1;
	}
	const roads = new Set(
		room
			.find(FIND_STRUCTURES, {
				filter: (structure) => structure.structureType === STRUCTURE_ROAD,
			})
			.map((road) => `${road.pos.x},${road.pos.y}`),
	);
	let tiles = 0;
	let covered = 0;
	for (const anchor of anchors) {
		const path = spawn.pos.findPathTo(anchor.x, anchor.y, { ignoreCreeps: true });
		for (const step of path) {
			tiles += 1;
			if (roads.has(`${step.x},${step.y}`)) {
				covered += 1;
			}
		}
	}
	return tiles > 0 ? covered / tiles : 1;
}

/** 地形画像 (低频刷新): 静态地形 + 路网随建造变化, 每 refreshIntervalTicks 重扫一房 */
export function terrainProfileFor(roomName: string, tick: number): RoomTerrainProfile {
	const cached = profiles.get(roomName);
	if (cached && tick - cached.computedAt < BODY_TERRAIN_CONFIG.refreshIntervalTicks) {
		return cached;
	}
	const room = Game.rooms[roomName];
	if (!room) {
		// 不可见: 沿用旧画像 (若有), 否则按平地保守档
		return cached ?? { roomName, swampRatio: 0, roadCover: 1, computedAt: tick };
	}
	const profile: RoomTerrainProfile = {
		roomName,
		swampRatio: computeSwampRatio(room),
		roadCover: computeRoadCover(room),
		computedAt: tick,
	};
	profiles.set(roomName, profile);
	return profile;
}

/** 体型编译地形档判定: 沼泽密度高且路网未达标 → 慢地形档 (提高 move 配比) */
export function isSlowTerrain(profile: RoomTerrainProfile): boolean {
	return (
		profile.swampRatio >= BODY_TERRAIN_CONFIG.swampRatioThreshold &&
		profile.roadCover < BODY_TERRAIN_CONFIG.roadCoverThreshold
	);
}
