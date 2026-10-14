/**
 * 房间相位: 纯算法, 零依赖 (Game.time 为引擎触点)。
 * 所有「每 N tick 执行一次」的周期门控都应叠加房间相位:
 *   (Game.time + getRoomPhase(room.name)) % N === 0
 * 多个房间的同频任务由此摊到不同 tick, 削平多房 CPU 尖峰。
 */

const roomPhaseCache = new Map<string, number>();

/** 房间相位 (0~996, 按房名哈希, 结果稳定) */
export function getRoomPhase(roomName: string): number {
	let phase = roomPhaseCache.get(roomName);
	if (phase === undefined) {
		let hash = 0;
		for (let i = 0; i < roomName.length; i += 1) {
			hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0;
		}
		phase = hash % 997;
		roomPhaseCache.set(roomName, phase);
	}
	return phase;
}

/** 周期门控: 叠加房间相位的「每 N tick 执行一次」判定 */
export function isRoomTickAligned(roomName: string, interval: number, offset = 0): boolean {
	const phase = getRoomPhase(roomName);
	return (Game.time + phase + offset) % interval === 0;
}
