/**
 * 房间坐标换算 (bugs/P1-17 抽公共):
 * Screeps 世界坐标 E1=1, W1=0, W2=-1 … (W 数字从 0 镜像);
 * 邻房计算统一经此, 禁止各处硬编码半球候选。
 */

export type RoomWorldCoord = { x: number; y: number };

/** 房名 → 世界坐标; 非法房名返回 null */
export function roomWorldCoord(roomName: string): RoomWorldCoord | null {
	const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
	if (!match) return null;
	const toWorldX = (dir: string, digits: string) =>
		dir === "E" ? parseInt(digits, 10) : -(parseInt(digits, 10) - 1);
	const toWorldY = (dir: string, digits: string) =>
		dir === "N" ? parseInt(digits, 10) : -(parseInt(digits, 10) - 1);
	return {
		x: toWorldX(match[1] ?? "W", match[2] ?? "0"),
		y: toWorldY(match[3] ?? "N", match[4] ?? "0"),
	};
}

/** 世界坐标 → 房名 */
export function roomNameFromWorld(x: number, y: number): string {
	const roomX = x >= 0 ? `E${x}` : `W${-x + 1}`;
	const roomY = y >= 0 ? `N${y}` : `S${-y + 1}`;
	return `${roomX}${roomY}`;
}

/** 邻房名 (正角 4 向 + 对角 4 向), 顺次确定性; 非法房名返回空 */
export function neighborRooms(roomName: string): string[] {
	const coord = roomWorldCoord(roomName);
	if (!coord) return [];
	const rooms: string[] = [];
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (dx === 0 && dy === 0) continue;
			rooms.push(roomNameFromWorld(coord.x + dx, coord.y + dy));
		}
	}
	return rooms;
}

/** 房间类型: 高速路 / SK 房 / 扇区中央房 / 普通房 */
export type RoomKind = "normal" | "highway" | "keeper" | "center";

/**
 * 按房名数字推导房间类型, 无需视野: 任一坐标为 10 的倍数 → highway;
 * 两坐标对 10 取余都在 4..6 → (5,5) 为 center, 其余为 keeper (SK 房)。
 * 口径为官服 / 标准私服地图; 自定义地图的私服不保证成立。非法房名返回 null。
 */
export function roomKind(roomName: string): RoomKind | null {
	const match = roomName.match(/^[WE](\d+)[NS](\d+)$/);
	if (!match) return null;
	const x = parseInt(match[1] ?? "0", 10) % 10;
	const y = parseInt(match[2] ?? "0", 10) % 10;
	if (x === 0 || y === 0) return "highway";
	if (x >= 4 && x <= 6 && y >= 4 && y <= 6) return x === 5 && y === 5 ? "center" : "keeper";
	return "normal";
}

/** 正交 4 向邻房 (扩张候选用), 顺次确定性 */
export function orthogonalNeighbors(roomName: string): string[] {
	const coord = roomWorldCoord(roomName);
	if (!coord) return [];
	return [
		roomNameFromWorld(coord.x, coord.y + 1),
		roomNameFromWorld(coord.x, coord.y - 1),
		roomNameFromWorld(coord.x + 1, coord.y),
		roomNameFromWorld(coord.x - 1, coord.y),
	];
}


