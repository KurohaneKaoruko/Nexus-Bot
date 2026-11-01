/**
 * movement pathCache module.
 */
import { movementConstants, movementState } from "./movementState";
import type { CreepMoveCache, MoveOps, MyPath, RoomCostEntry } from "./movementState";
import { formalize, getDirection, inRange, isNear } from "./movementGeometry";
import type { PosLike, WorldPos } from "./movementGeometry";
import { bypassRoomCallback, bypassRoomCallbackWithRoute, checkTemporalAvoidExit, findRoute, generateCostMatrix, roomCallback, roomCallbackWithRoute, routeReduce } from "./movementCostRoute";

/**
 *  缓存的路径和当前moveTo参数相同
 * @param {MyPath} path
 * @param {*} ops
 */
export function isSameOps(path: MyPath, ops: MoveOps) {
	return (
		path.ignoreRoads == !!ops.ignoreRoads &&
		path.ignoreSwamps == !!ops.ignoreSwamps &&
		path.ignoreStructures == !!ops.ignoreDestructibleStructures
	);
}

/**
 *  影响参数：ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range, bypassRange
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 */
export function findTemporalPath(creep: Creep, toPos: PosLike, ops: MoveOps) {
	// 周围所有creep
	let nearbyCreeps: (Creep | PowerCreep)[] = creep.pos
		.findInRange(FIND_CREEPS, ops.bypassRange ?? 5);
	nearbyCreeps = nearbyCreeps.concat(creep.pos.findInRange(FIND_POWER_CREEPS, ops.bypassRange ?? 5));

	if (ops.bypassHostileCreeps && !ops.bypassMyCreeps) {
		// 情况 1：只绕过别人的 creep
		nearbyCreeps = nearbyCreeps.filter(bypassHostile);
	} else if (ops.bypassMyCreeps && !ops.bypassHostileCreeps) {
		// 情况 2：只绕过自己的
		nearbyCreeps = nearbyCreeps.filter((c: Creep | PowerCreep) => c.my);
	} // else 都要绕

	if (!(creep.room.name in movementState.cache.costMatrixCache)) {
		// 这个房间的costMatrix已经被删了
		generateCostMatrix(creep.room, creep.pos);
	}
	/** @type {CostMatrix} */
	const roomCache = movementState.cache.costMatrixCache[creep.room.name] as RoomCostEntry;
	const bypassMat: CostMatrix = (roomCache[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix).clone();
	movementState.scratch.bypassCostMat = bypassMat;
	for (let c of nearbyCreeps) {
		bypassMat.set(c.pos.x, c.pos.y, 255);
	}
	movementState.scratch.bypassRoomName = creep.room.name;
	movementState.scratch.userCostCallback = typeof ops.costCallback == "function" ? ops.costCallback : undefined;

/**@type {PathFinderOpts} */
	let PathFinderOpts: PathFinderOpts = {
		maxOps: 200,
		heuristicWeight: ops.heuristicWeight || 1.2,
	};
	if (ops.maxRooms !== undefined) PathFinderOpts.maxRooms = ops.maxRooms;
	if (ops.maxCost !== undefined) PathFinderOpts.maxCost = ops.maxCost;
	if (ops.ignoreSwamps) {
		// HELP 这里有没有什么不增加计算量的简短写法
		PathFinderOpts.plainCost = ops.plainCost ?? 1;
		PathFinderOpts.swampCost = ops.swampCost || 1;
	} else if (ops.ignoreRoads) {
		PathFinderOpts.plainCost = ops.plainCost ?? 1;
		PathFinderOpts.swampCost = ops.swampCost || 5;
	} else {
		PathFinderOpts.plainCost = ops.plainCost || 2;
		PathFinderOpts.swampCost = ops.swampCost || 10;
	}

	if (creep.pos.roomName != toPos.roomName) {
		// findRoute会导致非最优path的问题

		movementState.scratch.curAvoidRooms = ops.avoidRooms || movementState.config.avoidRooms;
		movementState.scratch.curAvoidExits = ops.avoidExits || movementState.config.avoidExits;

		checkTemporalAvoidExit(creep.pos, creep.room, bypassMat); // 因为creep挡路导致的无法通行的出口
		const route = findRoute(creep.pos.roomName, toPos.roomName ?? creep.pos.roomName, true);
		if (route == ERR_NO_PATH) {
			return false;
		}
		PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
		// PathFinderOpts.maxOps = ops.maxOps || 2000 + route.length ** 2 * 100;  // 跨10room则有2000+10*10*100=12000
		movementState.scratch.routeSet = route.reduce(routeReduce, { [creep.pos.roomName]: 1 }); // 因为 key in Object 比 Array.includes(value) 快，但不知道值值得reduce
		PathFinderOpts.roomCallback = bypassRoomCallbackWithRoute as (roomName: string) => boolean | CostMatrix;
	} else {
		// PathFinderOpts.maxOps = ops.maxOps;
		PathFinderOpts.roomCallback = bypassRoomCallback as (roomName: string) => boolean | CostMatrix;
	}

	const creepCache = movementState.cache.creepPathCache[creep.name];
	if (!creepCache?.path) return false;
	const posArray = creepCache.path.posArray;
	const goals: { pos: RoomPosition; range: number }[] = [{ pos: toPos as RoomPosition, range: ops.range ?? 1 }];
	// 把 path 中当前 idx 之后的位置都加入 goals，寻到之前的 path 上都算成功
	for (let idx = creepCache.idx + 2; idx < posArray.length; idx++) {
		if (posArray[idx]) goals.push({ pos: posArray[idx]!, range: 0 });
	}
	const searchResult = PathFinder.search(creep.pos, { pos: toPos as RoomPosition, range: ops.range ?? 1 }, PathFinderOpts);
	if (searchResult.incomplete && searchResult.path.length <= 1) {
		return false;
	}
	// console.log(`${creep.name} temporal path: incomplete ${searchResult.incomplete}, length ${searchResult.path.length}`);
	const result: RoomPosition[] = searchResult.path;
	const resultFinalPos = result[result.length - 1];
	if (!resultFinalPos) return false;
	if (resultFinalPos.getRangeTo(toPos as RoomPosition) > (ops.range ?? 1)) {
		// 是寻到旧路上
		let idx;
		for (idx = creepCache.idx + 2; idx < posArray.length; idx++) {
			if (posArray[idx]?.getRangeTo(resultFinalPos) === 0) {
				idx++;
				break;
			}
		}
		while (idx < posArray.length) {
			result.push(posArray[idx++]!);
		}
	}
	creepCache.path = {
		// 弄个新的自己走，不修改公用的缓存路，只会用于正向走所以也不需要start属性，idx属性会在startRoute中设置
		end: formalize(result[result.length - 1] ?? toPos),
		posArray: result,
		ignoreStructures: !!ops.ignoreDestructibleStructures,
	};
	generateDirectionArray(creepCache.path);
	return true;
}

export function squadTemporalRoomCallback(roomName: string) {
	let costMat: CostMatrix;
	if (roomName === movementState.scratch.bypassRoomName) {
		// 在findTemporalRoute函数里刚刚建立了costMatrix
		costMat = movementState.scratch.bypassCostMat ?? movementState.cache.emptyCostMatrix;
	} else {
		const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
		costMat = roomCache ? (roomCache["squad"]?.[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
	}
	if (movementState.scratch.userCostCallback) {
		const resultCostMat = movementState.scratch.userCostCallback(
			roomName,
			roomName in movementState.cache.costMatrixCache ? costMat.clone() : new PathFinder.CostMatrix(),
		) as CostMatrix | boolean | void;
		if (resultCostMat instanceof PathFinder.CostMatrix) {
			costMat = resultCostMat;
		}
	}
	movementState.scratch.costMat = costMat;
	return costMat;
}

/**
 *
 * @param {Creep} leader
 * @param {RoomPosition} toPos
 * @param {*} ops
 * @param {string} key
 * @param {boolean} severe
 * @param {Set<string>} squadNames
 */
export function findSquadTemporalPath(leader: Creep, toPos: PosLike, ops: MoveOps, key: string, severe?: boolean, squadNames?: Set<string>) {
	movementState.scratch.bypassRoomName = leader.room.name;
	movementState.scratch.userCostCallback = typeof ops.costCallback == "function" ? ops.costCallback : undefined;
	const nearbyCreeps = leader.pos.findInRange(FIND_CREEPS, 5);
	/** @type {CostMatrix} */
	const roomCache = movementState.cache.costMatrixCache[movementState.scratch.bypassRoomName] as RoomCostEntry;
	const bypassMat: CostMatrix = (roomCache["squad"]?.[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix).clone();
	movementState.scratch.bypassCostMat = bypassMat;
	if (severe && squadNames) {
		for (let c of nearbyCreeps) {
			if (!squadNames.has(c.name)) {
				bypassMat.set(c.pos.x, c.pos.y, 10);
				bypassMat.set(
					c.pos.x + 1,
					c.pos.y,
					bypassMat.get(c.pos.x + 1, c.pos.y) === 255 ? 255 : 10,
				);
				bypassMat.set(
					c.pos.x,
					c.pos.y + 1,
					bypassMat.get(c.pos.x, c.pos.y + 1) === 255 ? 255 : 10,
				);
				bypassMat.set(
					c.pos.x + 1,
					c.pos.y + 1,
					bypassMat.get(c.pos.x + 1, c.pos.y + 1) === 255 ? 255 : 10,
				);
			}
		}
	} else {
		for (let c of nearbyCreeps) {
			if (movementState.tick.creepToSquad.has(c.name) && !movementState.tick.rerouteSquad.has(c.name)) {
				bypassMat.set(c.pos.x, c.pos.y, 255);
				bypassMat.set(c.pos.x + 1, c.pos.y, 255);
				bypassMat.set(c.pos.x, c.pos.y + 1, 255);
				bypassMat.set(
					c.pos.x + 1,
					c.pos.y + 1,
					bypassMat.get(c.pos.x + 1, c.pos.y + 1) === 255 ? 255 : 5,
				);
				// leader.room.visual.circle(c.pos, { radius: 0.5, fill: 'red', opacity: 0.1 });
			}
		}
	}
	const PathFinderOpts: PathFinderOpts = {
		maxRooms: ops.maxRooms || 10,
		maxCost: ops.maxCost || 1000,
		heuristicWeight: ops.heuristicWeight || 1.2,
		roomCallback: squadTemporalRoomCallback,
	};
	const searchResult = PathFinder.search(leader.pos, { pos: toPos as RoomPosition, range: ops.range || 1 }, PathFinderOpts);
	if (searchResult.incomplete && searchResult.path.length <= 1) {
		return false;
	}
	const result: RoomPosition[] = searchResult.path;
	const squadCache = movementState.scratch.creepCache;
	if (squadCache) {
		squadCache.path = {
			end: formalize(result[result.length - 1] ?? toPos),
			posArray: result,
			ignoreStructures: movementState.scratch.findPathIgnoreCondition,
		};
	}
	return true;
}

/**
 *  影响参数：ignoreRoads, ignoreDestructibleStructures, ignoreSwamps, costCallback, range
 *  及所有PathFinder参数：plainCost, SwampCost, masOps, maxRooms, maxCost, heuristicWeight
 * @param {RoomPosition} fromPos
 * @param {RoomPosition} toPos
 * @param {MoveToOpts} ops
 */
export function findPath(fromPos: RoomPosition, toPos: PosLike, ops: MoveOps): PathFinderPath {
	if (!(fromPos.roomName in movementState.cache.costMatrixCache) && Game.rooms[fromPos.roomName]) {
		// 有视野没costMatrix
		generateCostMatrix(Game.rooms[fromPos.roomName]!, fromPos);
	}

	movementState.scratch.userCostCallback = typeof ops.costCallback == "function" ? ops.costCallback : undefined;

	/**@type {PathFinderOpts} */
	let PathFinderOpts: PathFinderOpts = {
		maxOps: 2000,
		heuristicWeight: ops.heuristicWeight || 1.2,
	};
	if (ops.maxRooms !== undefined) PathFinderOpts.maxRooms = ops.maxRooms;
	if (ops.maxCost !== undefined) PathFinderOpts.maxCost = ops.maxCost;
	if (ops.ignoreSwamps) {
		// HELP 这里有没有什么不增加计算量的简短写法
		PathFinderOpts.plainCost = ops.plainCost ?? 1;
		PathFinderOpts.swampCost = ops.swampCost || 1;
	} else if (ops.ignoreRoads) {
		PathFinderOpts.plainCost = ops.plainCost ?? 1;
		PathFinderOpts.swampCost = ops.swampCost || 5;
	} else {
		PathFinderOpts.plainCost = ops.plainCost || 2;
		PathFinderOpts.swampCost = ops.swampCost || 10;
	}

	if (fromPos.roomName != toPos.roomName) {
		// findRoute会导致非最优path的问题
		movementState.scratch.curAvoidRooms = ops.avoidRooms || movementState.config.avoidRooms;
		movementState.scratch.curAvoidExits = ops.avoidExits || movementState.config.avoidExits;
		const route = findRoute(fromPos.roomName, toPos.roomName ?? fromPos.roomName);
		if (route == ERR_NO_PATH) {
			return { path: [], ops: 0, cost: 0, incomplete: true };
		}
		PathFinderOpts.maxOps = ops.maxOps || 2000 + route.length ** 2 * 100; // 跨10room则有2000+10*10*50=7000
		PathFinderOpts.maxRooms = PathFinderOpts.maxRooms || route.length + 1;
		movementState.scratch.routeSet = route.reduce(routeReduce, { [fromPos.roomName]: 1 }); // 因为 key in Object 比 Array.includes(value) 快，但不知道值值得reduce
		//console.log(fromPos + ' using route ' + JSON.stringify(route));
		PathFinderOpts.roomCallback = roomCallbackWithRoute as (roomName: string) => boolean | CostMatrix;
	} else {
		if (ops.maxOps !== undefined) PathFinderOpts.maxOps = ops.maxOps;
		PathFinderOpts.roomCallback = roomCallback as (roomName: string) => boolean | CostMatrix;
	}

	return PathFinder.search(fromPos, { pos: toPos as RoomPosition, range: ops.range ?? 1 }, PathFinderOpts);
}

export function squadRoomCallback(roomName: string) {
	const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
	let costMat: CostMatrix = roomCache ? (roomCache["squad"]?.[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
	if (movementState.scratch.userCostCallback) {
		const resultCostMat = movementState.scratch.userCostCallback(
			roomName,
			roomCache ? costMat.clone() : new PathFinder.CostMatrix(),
		) as CostMatrix | boolean | void;
		if (resultCostMat instanceof PathFinder.CostMatrix) {
			costMat = resultCostMat;
		}
	}
	// if (roomName in Game.rooms) {
	//     const room = Game.rooms[roomName];
	//     for (let x = 0; x <= 49; x++) {
	//         for (let y = 0; y <= 49; y++) {
	//             room.visual.text(costMat.get(x, y), x, y);
	//         }
	//     }
	// }
	movementState.scratch.costMat = costMat;
	return costMat;
}

/**
 * 影响参数：ignoreDestructibleStructures, costCallback, range
 * 及 PathFinder 参数：masOps, maxRooms, maxCost, heuristicWeight
 */
export function findSquadPath(fromPos: RoomPosition, toPos: PosLike, ops: MoveOps) {
	if (!(fromPos.roomName in movementState.cache.costMatrixCache) && Game.rooms[fromPos.roomName]) {
		// 有视野没costMatrix
		generateCostMatrix(Game.rooms[fromPos.roomName]!, fromPos);
	}

	movementState.scratch.userCostCallback = typeof ops.costCallback == "function" ? ops.costCallback : undefined;

	const PathFinderOpts: PathFinderOpts = {
		maxRooms: ops.maxRooms || 10,
		maxCost: ops.maxCost || 1000,
		maxOps: ops.maxOps || 2000,
		heuristicWeight: ops.heuristicWeight || 1.2,
		roomCallback: squadRoomCallback as (roomName: string) => boolean | CostMatrix,
	};
	return PathFinder.search(fromPos, { pos: toPos as RoomPosition, range: ops.range || 1 }, PathFinderOpts);
}

/**
 * @param {MyPath} newPath
 */
export function addPathIntoCache(newPath: MyPath) {
	const startX = newPath.start?.x ?? 0;
	const startY = newPath.start?.y ?? 0;
	const endX = newPath.end?.x ?? 0;
	const endY = newPath.end?.y ?? 0;
	movementState.scratch.combinedX = startX + startY;
	movementState.scratch.combinedY = endX + endY;
	const globalCache = movementState.cache.globalPathCache;
	if (!(movementState.scratch.combinedX in globalCache)) {
		globalCache[movementState.scratch.combinedX] = {
			[movementState.scratch.combinedY]: [], // 数组里放不同ops的及其他start、end与此对称的
		};
	} else if (!(movementState.scratch.combinedY in globalCache[movementState.scratch.combinedX]!)) {
		globalCache[movementState.scratch.combinedX]![movementState.scratch.combinedY] = []; // 数组里放不同ops的及其他start、end与此对称的
	}
	globalCache[movementState.scratch.combinedX]![movementState.scratch.combinedY]!.push(newPath);
}

export function invalidate(): number {
	return 0;
}

/**
 * @param {MyPath} path
 */
export function deletePath(path: MyPath) {
	if (path.start) {
		// 有start属性的不是临时路
		let pathArray = movementState.cache.globalPathCache[(path.start?.x ?? 0) + (path.start?.y ?? 0)]?.[(path.end?.x ?? 0) + (path.end?.y ?? 0)];
		if (pathArray) pathArray.splice(pathArray.indexOf(path), 1);
		path.posArray = path.posArray.map(invalidate) as unknown as RoomPosition[]; // 置 0 但保留长度, 与 posArray.length 消费语义一致
	}
}

/**
 *  寻找房内缓存路径，起始位置两步限制避免复用非最优路径
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {RoomPosition} fromPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
export function findShortPathInCache(formalFromPos: WorldPos, formalToPos: WorldPos, fromPos: RoomPosition, creepCache: CreepMoveCache, ops: MoveOps) {
	// ops.range设置越大找的越慢
	movementState.scratch.startCacheSearch = Game.cpu.getUsed();
	movementState.scratch.minX = formalFromPos.x + formalFromPos.y - 2;
	movementState.scratch.maxX = formalFromPos.x + formalFromPos.y + 2;
	movementState.scratch.minY = formalToPos.x + formalToPos.y - 1 - (ops.range ?? 1);
	movementState.scratch.maxY = formalToPos.x + formalToPos.y + 1 + (ops.range ?? 1);
	for (movementState.scratch.combinedX = movementState.scratch.minX; movementState.scratch.combinedX <= movementState.scratch.maxX; movementState.scratch.combinedX++) {
		if (movementState.scratch.combinedX in movementState.cache.globalPathCache) {
			for (movementState.scratch.combinedY = movementState.scratch.minY; movementState.scratch.combinedY <= movementState.scratch.maxY; movementState.scratch.combinedY++) {
				if (movementState.scratch.combinedY in movementState.cache.globalPathCache[movementState.scratch.combinedX]!) {
					for (let path of movementState.cache.globalPathCache[movementState.scratch.combinedX]![movementState.scratch.combinedY] ?? []) {
						// 这个数组应该会很短
						movementState.stats.pathCounter++;
						if (
							isNear(path.start ?? formalFromPos, formalFromPos) &&
							isNear(fromPos, path.posArray[1] ?? fromPos) &&
							inRange(path.end ?? formalToPos, formalToPos, ops.range ?? 1) &&
							isSameOps(path, ops)
						) {
							// 找到路了
							creepCache.path = path;
							return true;
						}
					}
				}
			}
		}
	}
	return false;
}

/**
 *  寻找跨房缓存路径，允许起始位置少量的误差
 * @param {RoomPosition} formalFromPos
 * @param {RoomPosition} formalToPos
 * @param {CreepPaths} creepCache
 * @param {MoveToOpts} ops
 */
export function findLongPathInCache(formalFromPos: WorldPos, formalToPos: WorldPos, creepCache: CreepMoveCache, ops: MoveOps) {
	// ops.range设置越大找的越慢
	movementState.scratch.startCacheSearch = Game.cpu.getUsed();
	movementState.scratch.minX = formalFromPos.x + formalFromPos.y - 2;
	movementState.scratch.maxX = formalFromPos.x + formalFromPos.y + 2;
	movementState.scratch.minY = formalToPos.x + formalToPos.y - 1 - (ops.range ?? 1);
	movementState.scratch.maxY = formalToPos.x + formalToPos.y + 1 + (ops.range ?? 1);
	for (movementState.scratch.combinedX = movementState.scratch.minX; movementState.scratch.combinedX <= movementState.scratch.maxX; movementState.scratch.combinedX++) {
		if (movementState.scratch.combinedX in movementState.cache.globalPathCache) {
			for (movementState.scratch.combinedY = movementState.scratch.minY; movementState.scratch.combinedY <= movementState.scratch.maxY; movementState.scratch.combinedY++) {
				if (movementState.scratch.combinedY in movementState.cache.globalPathCache[movementState.scratch.combinedX]!) {
					for (let path of movementState.cache.globalPathCache[movementState.scratch.combinedX]![movementState.scratch.combinedY] ?? []) {
						// 这个数组应该会很短
						movementState.stats.pathCounter++;
						if (
							isNear(path.start ?? formalFromPos, formalFromPos) &&
							inRange(path.end ?? formalToPos, formalToPos, ops.range ?? 1) &&
							isSameOps(path, ops)
						) {
							// 找到路了
							creepCache.path = path;
							return true;
						}
					}
				}
			}
		}
	}
	return false;
}

/**
 *  起止点都在自己房间的路不清理
 * @param {CreepPaths['name']} creepCache
 */
export function setPathTimer(creepCache: CreepMoveCache) {
	const cachedPath = creepCache.path;
	if (movementState.config.pathClearDelay && cachedPath) {
		const posArray = cachedPath.posArray;
		const startRoomName = posArray[0]?.roomName;
		const endRoomName = posArray[posArray.length - 1]?.roomName;
		movementState.scratch.startRoomName = startRoomName;
		movementState.scratch.endRoomName = endRoomName;
		if (
			startRoomName !== undefined &&
			endRoomName !== undefined &&
			(startRoomName != endRoomName ||
			(startRoomName in Game.rooms &&
				Game!.rooms! [startRoomName]!.controller! &&
				!Game!.rooms! [startRoomName]!.controller!.my))
		) {
			// 跨房路或者敌方房间路
			const clearTick = Game.time + movementState.config.pathClearDelay;
			if (!(clearTick in movementState.cache.pathCacheTimer)) {
				movementState.cache.pathCacheTimer[clearTick] = [];
			}
			movementState.cache.pathCacheTimer[clearTick]!.push(cachedPath);
			cachedPath.lastTime = Game.time;
		}
	}
}

/**
 *
 * @param {Creep} creep
 * @param {RoomPosition} toPos
 * @param {RoomPosition[]} posArray
 * @param {number} startIdx
 * @param {number} idxStep
 * @param {PolyStyle} visualStyle
 */
export function showVisual(creep: Creep, toPos: PosLike, posArray: RoomPosition[], startIdx: number, idxStep: number, visualStyle: PolyStyle) {
	movementState.scratch.tempArray.length = 0;
	movementState.scratch.tempArray.push(creep.pos);
	let thisRoomName = creep.room.name;
	_.defaults(visualStyle, movementConstants.defaultVisualizePathStyle);
	for (let i = startIdx; i in posArray && posArray[i]?.roomName == thisRoomName; i += idxStep) {
		movementState.scratch.tempArray.push(posArray[i]!);
	}
	if (toPos.roomName == thisRoomName && toPos.x !== undefined) {
		movementState.scratch.tempArray.push(toPos as RoomPosition);
	}
	creep.room.visual.poly(movementState.scratch.tempArray as [number, number][], visualStyle);
}

export function clearUnused() {
	if (Game.time % movementState.config.pathClearDelay == 0) {
		// 随机清一次已死亡creep
		for (let name in movementState.cache.creepPathCache) {
			if (!(name in Game.creeps)) {
				delete movementState.cache.creepPathCache[name];
			}
		}
	}
	for (const time in movementState.cache.pathCacheTimer) {
		if (Number(time) > Game.time) {
			break;
		}
		//console.log('clear path');
		for (const path of movementState.cache.pathCacheTimer[time] ?? []) {
			if (path.lastTime == Number(time) - movementState.config.pathClearDelay) {
				deletePath(path);
			}
		}
		delete movementState.cache.pathCacheTimer[time];
	}
	for (const time in movementState.cache.costMatrixCacheTimer) {
		if (Number(time) > Game.time) {
			break;
		}
		//console.log('clear costMat');
		for (let data of movementState.cache.costMatrixCacheTimer[time] ?? []) {
			delete movementState.cache.costMatrixCache[data.roomName];
			for (let avoidRoomName of data.avoids) {
				movementState.config.avoidRooms.delete(avoidRoomName);
			}
		}
		delete movementState.cache.costMatrixCacheTimer[time];
	}
}

/**
 *  把路径上有视野的位置的正向移动方向拿到，只有在找新路时调用，找新路时会把有视野房间都缓存进costMatrixCache
 * @param {MyPath} path
 */
export function generateDirectionArray(path: MyPath) {
	let posArray = path.posArray;
	let directionArray: (DirectionConstant | number | undefined)[] = [];
	directionArray.length = posArray.length;
	let incomplete = 0;
	for (let idx = 1; idx in posArray; idx++) {
		const prevRoomName = posArray[idx - 1]?.roomName;
		if (prevRoomName !== undefined && prevRoomName in movementState.cache.costMatrixCache) {
			// 有costMat，是准确路径，否则需要在有视野时checkRoom()
			directionArray[idx] = getDirection(posArray[idx - 1]!, posArray[idx]!);
		} else if (!incomplete) {
			// 记录第一个缺失准确路径的位置
			incomplete = idx;
		}
	}
	path.directionArray = directionArray;
}

export function bypassHostile(creep: Creep | PowerCreep) {
	return !creep.my;
}
