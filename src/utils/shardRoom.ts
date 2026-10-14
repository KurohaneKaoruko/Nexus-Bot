/**
 * 跨 shard 房名解析: 纯算法, 零依赖 (Game.shard 为引擎触点)。
 * 带 shard 前缀的房名形如 "shard1/W5N8"。
 */

export interface ShardRoomSpec {
	full: string;
	shard?: string;
	roomName: string;
}

/** 解析 "shard/roomName" 形式; 无前缀时 shard 缺省 */
export function parseShardRoomName(input: string): ShardRoomSpec {
	const full = String(input || "");
	const idx = full.indexOf("/");
	if (idx <= 0) return { full, roomName: full };
	const shard = full.slice(0, idx);
	const roomName = full.slice(idx + 1);
	return { full, shard, roomName };
}

/** 取本地房名 (剥离 shard 前缀) */
export function getLocalRoomName(input: string): string {
	return parseShardRoomName(input).roomName;
}

/** 是否当前 shard 的房 (无前缀视为本地) */
export function isSameShardRoom(input: string): boolean {
	const spec = parseShardRoomName(input);
	return !spec.shard || spec.shard === Game.shard.name;
}
