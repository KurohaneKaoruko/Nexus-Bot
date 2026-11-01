/**
 * movement geometry module.
 */
import { movementConstants, movementState } from "./movementState";

/** 最小位置协议: 只要求坐标与房名 (RoomPosition 及其裁剪形态共容) */
export type PosLike = { x: number; y: number; roomName?: string };
/** 世界坐标 (formalize 输出) */
export type WorldPos = { x: number; y: number };

/**
 *
 * @param {string} roomName
 * @returns {{ ew:'W'|'E', ewNum:number, ns:'N'|'S', nsNum:number, baseX:number, baseY:number } | null}
 */
export function parseRoomName(roomName: string) {
	let parsed = movementState.cache.roomNameCache.get(roomName);
	if (parsed) return parsed;

	const len = roomName.length;
	if (len < 4) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}

	const ewCode = roomName.charCodeAt(0);
	if (ewCode !== 69 && ewCode !== 87) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}

	let i = 1;
	let ewNum = 0;
	const ewStart = i;
	while (i < len) {
		const code = roomName.charCodeAt(i);
		if (code === 78 || code === 83) break;
		const digit = code - 48;
		if (digit < 0 || digit > 9) {
			movementState.cache.roomNameCache.set(roomName, null);
			return null;
		}
		ewNum = ewNum * 10 + digit;
		i++;
	}
	if (i === ewStart || i >= len) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}

	const nsCode = roomName.charCodeAt(i);
	if (nsCode !== 78 && nsCode !== 83) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}
	i++;
	if (i >= len) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}

	let nsNum = 0;
	const nsStart = i;
	while (i < len) {
		const digit = roomName.charCodeAt(i) - 48;
		if (digit < 0 || digit > 9) {
			movementState.cache.roomNameCache.set(roomName, null);
			return null;
		}
		nsNum = nsNum * 10 + digit;
		i++;
	}
	if (i === nsStart) {
		movementState.cache.roomNameCache.set(roomName, null);
		return null;
	}

	parsed = {
		ew: /** @type {'W'|'E'} */ (ewCode === 87 ? "W" : "E"),
		ewNum,
		ns: /** @type {'N'|'S'} */ (nsCode === 83 ? "S" : "N"),
		nsNum,
		baseX: (ewCode === 87 ? movementConstants.halfWorldSize - ewNum : movementConstants.halfWorldSize + ewNum + 1) * 50,
		baseY: (nsCode === 83 ? movementConstants.halfWorldSize + nsNum + 1 : movementConstants.halfWorldSize - nsNum) * 50,
	};
	movementState.cache.roomNameCache.set(roomName, parsed);
	return parsed;
}

/**
 *  统一到大地图坐标，平均单次开销0.00005
 * @param {RoomPosition} pos
 */
export function formalize(pos: PosLike): WorldPos {
	const parsed = parseRoomName(pos.roomName ?? "");
	if (parsed) {
		return {
			x: parsed.baseX + pos.x,
			y: parsed.baseY + pos.y,
		};
	} // else 房间名字不是正确格式: 坐标兜底 0 (调用方算术语义与原空对象 NaN 分支一致)
	return { x: 0, y: 0 };
}

/**
 *
 * @param {number} tile
 * @returns
 */
export function tile2Pos(tile: number): RoomPosition {
	const cached = movementState.cache.tile2PosCache.get(tile);
	if (cached) return cached;

	const y = tile >> 14;
	const x = tile & 0x3fff;
	const rx = (x / 50) | 0,
		ry = (y / 50) | 0;
	const roomName =
		(rx <= movementConstants.halfWorldSize ? "W" + (movementConstants.halfWorldSize - rx) : "E" + (rx - movementConstants.halfWorldSize - 1)) +
		(ry <= movementConstants.halfWorldSize ? "N" + (movementConstants.halfWorldSize - ry) : "S" + (ry - movementConstants.halfWorldSize - 1));
	const pos = new RoomPosition(x % 50, y % 50, roomName);
	movementState.cache.tile2PosCache.set(tile, pos);
	return pos;
}

/**
 *  阉割版isEqualTo，提速
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
export function isEqual(pos1: PosLike, pos2: PosLike): boolean {
	return pos1.x === pos2.x && pos1.y === pos2.y && pos1.roomName == pos2.roomName;
}

/**
 *  兼容房间边界
 *  参数具有x和y属性就行
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 */
export function isNear(pos1: PosLike, pos2: PosLike): boolean {
	if (pos1.roomName == pos2.roomName) {
		// undefined == undefined 也成立
		return (
			-1 <= pos1.x - pos2.x && pos1.x - pos2.x <= 1 && -1 <= pos1.y - pos2.y && pos1.y - pos2.y <= 1
		);
	} else if (pos1.roomName && pos2.roomName) {
		// 是完整的RoomPosition
		if (pos1.x + pos2.x != 49 && pos1.y + pos2.y != 49) return false; // 肯定不是两个边界点, 0.00003 cpu
		let parsed1 = parseRoomName(pos1.roomName);
		let parsed2 = parseRoomName(pos2.roomName);
		if (parsed1 && parsed2) {
			let formalizedEW = parsed1.baseX + pos1.x - parsed2.baseX - pos2.x;
			let formalizedNS = parsed1.baseY + pos1.y - parsed2.baseY - pos2.y;
			return -1 <= formalizedEW && formalizedEW <= 1 && -1 <= formalizedNS && formalizedNS <= 1;
		}
	}
	return false;
}

/**
 *
 * @param {RoomPosition} pos1
 * @param {RoomPosition} pos2
 * @param {number} range
 * @returns {boolean}
 */
export function inRange(pos1: PosLike, pos2: PosLike, range: number): boolean {
	if (pos1.roomName == pos2.roomName) {
		return (
			-range <= pos1.x - pos2.x &&
			pos1.x - pos2.x <= range &&
			-range <= pos1.y - pos2.y &&
			pos1.y - pos2.y <= range
		);
	} else {
		try {
			const w1 = formalize(pos1);
			const w2 = formalize(pos2);
			return !!(w1.x !== undefined && w2.x !== undefined && Math.abs(w1.x - w2.x) <= range && w1.y !== undefined && w2.y !== undefined && Math.abs(w1.y - w2.y) <= range);
		} catch (error) {
			console.log(
				`inRange: pos1: [${typeof pos1}, ${JSON.stringify(pos1)}] pos2: [${typeof pos2}, ${JSON.stringify(pos2)}}]\nposArray: ${JSON.stringify(movementState.scratch.posArray)}\n${error}`,
			);
			return false;
		}
	}
}

/**
 *  fromPos和toPos是pathFinder寻出的路径上的，只可能是同房相邻点或者跨房边界点
 * @param {RoomPosition} fromPos
 * @param {RoomPosition} toPos
 */
export function getDirection(fromPos: PosLike, toPos: PosLike): DirectionConstant | 0 {
	if (fromPos.roomName === toPos.roomName) {
		if (toPos.x > fromPos.x) {
			// 下一步在右边
			if (toPos.y > fromPos.y) {
				// 下一步在下面
				return BOTTOM_RIGHT;
			} else if (toPos.y === fromPos.y) {
				// 下一步在正右
				return RIGHT;
			}
			return TOP_RIGHT; // 下一步在上面
		} else if (toPos.x === fromPos.x) {
			// 横向相等
			if (toPos.y > fromPos.y) {
				// 下一步在下面
				return BOTTOM;
			} else if (toPos.y < fromPos.y) {
				return TOP;
			}
			return 0;
		} else {
			// 下一步在左边
			if (toPos.y > fromPos.y) {
				// 下一步在下面
				return BOTTOM_LEFT;
			} else if (toPos.y === fromPos.y) {
				return LEFT;
			}
			return TOP_LEFT;
		}
	} else {
		// 房间边界点
		if (fromPos.x <= 1 || fromPos.x >= 48) {
			// 左右相邻的房间
			if (toPos.y > fromPos.y) {
				// 下一步在下面
				if (fromPos.x === 1) return BOTTOM_LEFT;
				if (fromPos.x === 48) return BOTTOM_RIGHT;
				if (fromPos.x === 0) return BOTTOM_LEFT; // 站在西边界格：斜跨进左邻房
				if (fromPos.x === 49) return BOTTOM_RIGHT; // 站在东边界格：斜跨进右邻房
				return BOTTOM;
			} else if (toPos.y < fromPos.y) {
				// 下一步在上
				if (fromPos.x === 1) return TOP_LEFT;
				if (fromPos.x === 48) return TOP_RIGHT;
				if (fromPos.x === 0) return TOP_LEFT;
				if (fromPos.x === 49) return TOP_RIGHT;
				return TOP;
			} // else 正左正右（跨房同排：站在边界格上必须直接给出跨越方向，否则卡门）
			if (fromPos.x <= 1) return LEFT;
			if (fromPos.x >= 48) return RIGHT;
			return 0;
		} else if (fromPos.y <= 1 || fromPos.y >= 48) {
			// 上下相邻的房间
			if (toPos.x > fromPos.x) {
				// 下一步在右边
				if (fromPos.y === 1) return TOP_RIGHT;
				if (fromPos.y === 48) return BOTTOM_RIGHT;
				if (fromPos.y === 0) return TOP_RIGHT;
				if (fromPos.y === 49) return BOTTOM_RIGHT;
				return RIGHT;
			} else if (toPos.x < fromPos.x) {
				if (fromPos.y === 1) return TOP_LEFT;
				if (fromPos.y === 48) return BOTTOM_LEFT;
				if (fromPos.y === 0) return TOP_LEFT;
				if (fromPos.y === 49) return BOTTOM_LEFT;
				return LEFT;
			} // else 正上正下（跨房同列：站在边界格上必须直接给出跨越方向）
			if (fromPos.y <= 1) return TOP;
			if (fromPos.y >= 48) return BOTTOM;
			return 0;
		}
		return 0;
	}
}

/**
 *
 * @param {string} roomName
 * @returns {boolean}
 */
export function isHighWay(roomName: string): boolean {
	// 1. 检查末位（Y坐标个位）
	if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

	// 2. 探测 N(78) 或 S(83) 的位置并检查前一位
	// Index 2（例如 E0N1）
	let code = roomName.charCodeAt(2);
	if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;

	// Index 3（例如 E10N1）
	code = roomName.charCodeAt(3);
	if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;

	// Index 4（例如 E100N1）
	code = roomName.charCodeAt(4);
	if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;

	return false;
}

/**
 *  检查creep是否有指定的bodypart
 * @param {BodyPartDefinition[]} body
 * @param {BodyPartConstant} type
 * @returns {boolean}
 */

export function hasActiveBodypart(body: BodyPartDefinition[] | undefined, type: BodyPartConstant): boolean {
	if (!body) {
		return true;
	}

	for (let i = body.length - 1; i >= 0; i--) {
		const part = body[i];
		if (!part) break;
		if (part.hits <= 0) break;
		if (part.type === type) return true;
	}

	return false;
}

/**
 *  将用在Creep.prototype.move中
 * @param {RoomPosition} pos
 * @param {DirectionConstant} target
 */
export function direction2Pos(pos: PosLike, target: number | string): RoomPosition | undefined {
	// if (typeof target != "number") {
	//     // target 不是方向常数
	//     return undefined;
	// }

	const direction = +target; // 如果是string则由此运算转换成number
	let tarpos = {
		x: pos.x,
		y: pos.y,
	};
	if (direction !== 7 && direction !== 3) {
		if (direction > 7 || direction < 3) {
			--tarpos.y;
		} else {
			++tarpos.y;
		}
	}
	if (direction !== 1 && direction !== 5) {
		if (direction < 5) {
			++tarpos.x;
		} else {
			--tarpos.x;
		}
	}
	if (tarpos.x < 0 || tarpos.y > 49 || tarpos.x > 49 || tarpos.y < 0) {
		// 跨房边界步：换算到邻房坐标。
		// 原实现直接返回 undefined，会让 betterMove 静默不登记移动意图，
		// creep 站在出口格上永远无法跨越房间边界（卡门）。
		const parsed = parseRoomName(pos.roomName ?? "");
		if (!parsed) return undefined;
		const wx = parsed.baseX + tarpos.x;
		const wy = parsed.baseY + tarpos.y;
		const rx = (wx / 50) | 0,
			ry = (wy / 50) | 0;
		const roomName =
			(rx <= movementConstants.halfWorldSize ? "W" + (movementConstants.halfWorldSize - rx) : "E" + (rx - movementConstants.halfWorldSize - 1)) +
			(ry <= movementConstants.halfWorldSize ? "N" + (movementConstants.halfWorldSize - ry) : "S" + (ry - movementConstants.halfWorldSize - 1));
		return new RoomPosition(wx % 50, wy % 50, roomName);
	} else {
		return new RoomPosition(tarpos.x, tarpos.y, pos.roomName ?? "");
	}
}

/**
 *
 * @param {RoomPosition} pos
 * @returns
 */
export function lookCreepAt(pos: RoomPosition): Creep[] | PowerCreep[] {
	// 无视野房间（如外矿未探明）：无法 lookFor，视为无 creep——不可推挤但也不阻塞寻路
	if (!Game.rooms[pos.roomName]) return [];
	return pos.lookFor(LOOK_CREEPS) || pos.lookFor(LOOK_POWER_CREEPS) || [];
}
