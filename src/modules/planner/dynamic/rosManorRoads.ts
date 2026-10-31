import type { StructMap } from '../shared/plannerUtils'

/**
 * 容器道路连通域：以枢纽为中心为 container 寻路，并把路径写入 road。
 */
export function connectContainerRoads(
    structMap: StructMap,
    storageX: number,
    storageY: number,
    centerX: number,
    centerY: number,
    roomName: string,
    pushRoad: (x: number, y: number) => void
): void {
	const costs = new PathFinder.CostMatrix();
	const terrain = new Room.Terrain(roomName);
	for (let i = 0; i < 50; i++) {
		for (let j = 0; j < 50; j++) {
			const te = terrain.get(i, j);
			costs.set(i, j, te == TERRAIN_MASK_WALL ? 255 : te == TERRAIN_MASK_SWAMP ? 4 : 2);
		}
	}
	for (const struct of OBSTACLE_OBJECT_TYPES) {
		const arr = structMap[struct];
		if (arr) {
			for (let i = 0; i < arr.length; i++) {
				const e = arr[i]!;
				costs.set(e[0], e[1], 255);
			}
		}
	}
	const roads = structMap['road'] ?? [];
	for (let i = 0; i < roads.length; i++) {
		const e = roads[i]!;
		costs.set(e[0], e[1], 1);
	}
	const containers = structMap['container'] ?? [];
	containers.sort((a, b) => {
		const adx = a[0] - storageX;
		const ady = a[1] - storageY;
		const bdx = b[0] - storageX;
		const bdy = b[1] - storageY;
		return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
	});
	for (let i = 0; i < containers.length; i++) {
		const e = containers[i]!;
		const result = PathFinder.search(
			new RoomPosition(centerX, centerY, roomName),
			{ pos: new RoomPosition(e[0]!, e[1]!, roomName), range: 1 },
			{
				roomCallback: () => costs,
				maxRooms: 1
			}
		);
		const path = result.path || [];
		for (let j = 0; j < path.length; j++) {
			const pos = path[j];
			if (costs.get(pos!.x!, pos!.y!) != 1) {
				pushRoad(pos!.x!, pos!.y!);
				costs.set(pos!.x!, pos!.y!, 1);
			}
		}
	}
}
