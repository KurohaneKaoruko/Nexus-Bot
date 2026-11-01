/**
 * movement api module.
 */
import { movementState } from "./movementState";
import type { CreepMoveCache, MoveOps, MyPath, RoomCostEntry } from "./movementState";
import { direction2Pos, formalize, getDirection, hasActiveBodypart, inRange, isEqual, isNear, lookCreepAt, parseRoomName } from "./movementGeometry";
import type { PosLike } from "./movementGeometry";
import { checkRoom, generateCostMatrix, isObstacleStructure } from "./movementCostRoute";
import { addPathIntoCache, clearUnused, deletePath, findLongPathInCache, findPath, findShortPathInCache, findSquadPath, findTemporalPath, generateDirectionArray, setPathTimer, showVisual } from "./movementPathCache";
import { cancelMoveIntent, getMoveIntentStep, hasMoveIntent, isSwapIntent, registerMoveIntent, registerSquad, squadMove } from "./movementIntentSquad";
import { moveOneStep, preTickBetterMove, squadMoveTo, startRoute } from "./movementTraffic";
import { endTickResolve } from "./movementResolve";

/**
 * @param {Function} fn
 */
export function wrapFn<T extends (...args: never[]) => number>(fn: T, name: string): T {
	movementState.stats.analyzeCPU[name] = { sum: 0, calls: 0 };
	const fnTyped = fn as unknown as (this: unknown, ...args: unknown[]) => number;
	return function (this: unknown, ...args: unknown[]) {
		movementState.scratch.startTime = Game.cpu.getUsed(); // 0.0015cpu
		let code = fnTyped.apply(this, args);
		if (code === OK) {
			const stat = movementState.stats.analyzeCPU[name];
			if (stat) {
				stat.sum += Game.cpu.getUsed() - movementState.scratch.startTime;
				stat.calls++;
			}
		}
		return code;
	} as unknown as T;
}

/**
 *  把moveTo重写一遍
 * @param {Creep} this
 * @param {number | RoomObject} firstArg
 * @param {number | MoveToOpts} secondArg
 * @param {MoveToOpts} opts
 */
export function betterMoveTo(this: Creep, firstArg: unknown, secondArg: unknown, opts: MoveOps | undefined) {
	if (!this.my) {
		return ERR_NOT_OWNER;
	}

	if (this.spawning) {
		return ERR_BUSY;
	}

	if (firstArg !== null && typeof firstArg == "object") {
		movementState.scratch.toPos = (firstArg as { pos?: PosLike }).pos || (firstArg as PosLike);
		movementState.scratch.ops = (secondArg as MoveOps) || {};
	} else {
		movementState.scratch.toPos = { x: firstArg as number, y: secondArg as number, roomName: this.room.name };
		movementState.scratch.ops = opts || {};
	}
	const ops = movementState.scratch.ops;
	const toPos = movementState.scratch.toPos;
	if (!ops || !toPos) return ERR_INVALID_ARGS;
	ops.bypassHostileCreeps = ops.bypassHostileCreeps === undefined || ops.bypassHostileCreeps; // 设置默认值为true
	movementState.scratch.findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;

	if (typeof toPos.x !== "number" || typeof toPos.y !== "number") {
		// 房名无效或目的坐标不是数字，不合法
		return ERR_INVALID_TARGET;
	} else if (inRange(this.pos, toPos, ops.range || 1)) {
		// 已到达，用于走进 portal
		if (isEqual(toPos, this.pos) || ops.range) {
			// 已到达
			return OK;
		} // else 走一步
		movementState.cache.creepMoveCache[this.name] = Game.time; // 用于防止自己移动后被误对穿
		return registerMoveIntent(this, toPos, ops.priority);
	}
	ops.range = ops.range || 1;
	ops.bypassRange = ops.bypassRange || 5;

	if (!hasActiveBodypart(this.body, MOVE)) {
		return ERR_NO_BODYPART;
	}

	if (this.fatigue) {
		if (!ops.visualizePathStyle) {
			// 不用画路又走不动，直接return
			return ERR_TIRED;
		} // else 要画路，画完再return
	}

	// HELP：感兴趣的帮我检查这里的核心逻辑orz
	movementState.scratch.creepCache = movementState.cache.creepPathCache[this.name];
	if (movementState.scratch.creepCache) {
		// 有缓存
		const creepCache = movementState.scratch.creepCache;
		const cachedPath = creepCache.path;
		movementState.scratch.path = cachedPath;
		movementState.scratch.idx = creepCache.idx;
		if (
			cachedPath &&
			movementState.scratch.idx < cachedPath.posArray.length - 1 &&
			cachedPath.ignoreStructures === movementState.scratch.findPathIgnoreCondition
		) {
			// 缓存路条件相同
			const posArray = (movementState.scratch.posArray = cachedPath.posArray);
			if (
				posArray[0] &&
				(isEqual(toPos, creepCache.dst ?? toPos) || inRange(posArray[posArray.length - 1] ?? toPos, toPos, ops.range ?? 1))
			) {
				// 正向走，目的地没变
				if (isEqual(this.pos, posArray[movementState.scratch.idx] ?? toPos)) {
					// 正常
					if (movementState.scratch.idx < posArray.length - 1) {
						// this.say('正常');
						return moveOneStep(this, ops, toPos);
					}
				} else if (movementState.scratch.idx + 2 in posArray && isEqual(this.pos, posArray[movementState.scratch.idx + 1] ?? this.pos)) {
					// 跨房了
					creepCache.idx++;
					if (!cachedPath.directionArray?.[movementState.scratch.idx + 2]) {
						// 第一次见到该房则检查房间
						if (checkRoom(this.room, cachedPath, creepCache.idx)) {
							// 传creep所在位置的idx
							// this.say('新房 可走');
							//console.log(`${Game.time}: ${this.name} check room ${this.pos.roomName} OK`);
							return moveOneStep(this, ops, toPos); // 路径正确，继续走
						} // else 检查中发现房间里有建筑挡路，重新寻路
						//console.log(`${Game.time}: ${this.name} check room ${this.pos.roomName} failed`);
						deletePath(cachedPath);
					} else {
						// this.say('这个房间见过了');
						return moveOneStep(this, ops, toPos); // 路径正确，继续走
					}
				} else if (isNear(this.pos, posArray[movementState.scratch.idx] ?? this.pos)) {
					// 堵路了
					/**
					 * 考虑以下情况：
					 * 1. 和平情景，别人的 creep 挡路，则只绕别人的，不绕自己的，ops.bypassHostileCreeps = true；
					 * 2. 进攻情景，被敌对 creep 挡路则不绕，只绕自己的 creep，ops.bypassHostileCreeps = false；
					 * 3. 撤退情景，绕敌对 creep，不绕自己的，ops.bypassHostileCreeps = true；
					 * 4. 被己方 creep 堵路，时间超过 5 tick 则绕自己的 creep。
					 */
					// 挡路达到 2 tick，被敌对 creep 挡路且不忽略敌对 creep
					if (Game.time - (movementState.cache.creepMoveCache[this.name] ?? Infinity) >= 2) {
						const blockingCreep = lookCreepAt(posArray[movementState.scratch.idx] ?? this.pos)[0];
						if (blockingCreep) {
							if (!blockingCreep.my) {
								// 被敌对 creep 挡路
								if (ops.bypassHostileCreeps) {
									// 如果要绕过敌对 creep，此处是默认情况
									ops.bypassMyCreeps = false; // 不绕自己的
									if (findTemporalPath(this, toPos, ops)) {
										// 有路，creepCache的内容会被这个函数更新
										// this.say('hostile: 开始绕路');
										return startRoute(this, creepCache, ops, toPos);
									} else {
										// 没路
										// this.say('hostile: 没路啦');
									}
								} // else 战斗情况，故意顶着敌对 creep，按原路走
							} else if (Game.time - (movementState.cache.creepMoveCache[this.name] ?? Infinity) >= 5) {
								// 绕过被自己 creep 挡住超过 5 tick
								ops.bypassMyCreeps = true; // 要绕自己的
								if (findTemporalPath(this, toPos, ops)) {
									// 有路，creepCache的内容会被这个函数更新
									// this.say('开始绕路');
									return startRoute(this, creepCache, ops, toPos);
								} else {
									// 没路
									// this.say('没路啦');
								}
								movementState.cache.creepMoveCache[this.name] = Game.time;
							}
							if (ops.visualizePathStyle) {
								showVisual(this, toPos, posArray, movementState.scratch.idx, 1, ops.visualizePathStyle);
							}
							return registerMoveIntent(this, posArray[movementState.scratch.idx] ?? this.pos, ops.priority); // 有可能是第一步就没走上路or通过略过moveTo的move操作偏离路线，直接call可兼容
						} else if (!ops.ignoreDestructibleStructures) {
							// 如果不是被 creep 堵路，且不是 ignoreDestructibleStructures
							if (isObstacleStructure(this.room, posArray[movementState.scratch.idx] ?? this.pos, ops.ignoreDestructibleStructures)) {
								// 发现出现新建筑物挡路，删除costMatrix和path缓存，重新寻路
								// console.log(`${Game.time}: ${this.name} find obstacles at ${this.pos}`);
								delete movementState.cache.costMatrixCache[this.pos.roomName];
								generateCostMatrix(this.room);
								if (cachedPath) deletePath(cachedPath);
								// 不 return，掉下去重新寻路
							}
						} else {
							// 不知道啥情况，兜底
							// this.say('未知堵路')
							if (ops.visualizePathStyle) {
								showVisual(this, toPos, posArray, movementState.scratch.idx, 1, ops.visualizePathStyle);
							}
							return registerMoveIntent(this, posArray[movementState.scratch.idx] ?? this.pos, ops.priority);
						}
					} else {
						// this.say('堵路1t')
						if (ops.visualizePathStyle) {
							showVisual(this, toPos, posArray, movementState.scratch.idx, 1, ops.visualizePathStyle);
						}
						return registerMoveIntent(this, posArray[movementState.scratch.idx] ?? this.pos, ops.priority);
					}
				} else if (movementState.scratch.idx - 1 >= 0 && isNear(this.pos, posArray[movementState.scratch.idx - 1] ?? this.pos)) {
					// 因为堵路而被自动传送反向跨房了
					// this.say('偏离一格');
					if (ops.visualizePathStyle) {
						showVisual(this, toPos, posArray, movementState.scratch.idx, 1, ops.visualizePathStyle);
					}
					return registerMoveIntent(this, posArray[movementState.scratch.idx - 1] ?? this.pos, ops.priority); // 同理兼容略过moveTo的move
				} // else 彻底偏离，重新寻路
			} // else 目的地变了
		} // else 缓存中没路或者条件变了
	} else {
		// else 需要重新寻路，先找缓存路，找不到就寻路
		movementState.scratch.creepCache = {
			dst: { x: NaN, y: NaN },
			idx: 0,
		};
		movementState.cache.creepPathCache[this.name] = movementState.scratch.creepCache;
	}
	const activeCache = movementState.scratch.creepCache;
	if (activeCache) activeCache.path = undefined;

	if (
		typeof ops.range != "number" ||
		typeof ops.bypassRange != "number" ||
		(ops.avoidRooms !== undefined && !(ops.avoidRooms instanceof Set)) ||
		(ops.avoidExits !== undefined && !(ops.avoidExits instanceof Map))
	) {
		return ERR_INVALID_ARGS;
	}

	movementState.scratch.found =
		this.pos.roomName == toPos.roomName
			? findShortPathInCache(formalize(this.pos), formalize(toPos), this.pos, movementState.scratch.creepCache, ops)
			: findLongPathInCache(formalize(this.pos), formalize(toPos), movementState.scratch.creepCache, ops);
	if (movementState.scratch.found) {
		//this.say('cached');
		//console.log(this, this.pos, 'hit');
		movementState.stats.testCacheHits++;
	} else {
		// 没找到缓存路
		movementState.stats.testCacheMiss++;

		if (movementState.cache.autoClearTick < Game.time) {
			// 自动清理
			movementState.cache.autoClearTick = Game.time;
			clearUnused();
		}

		const result = findPath(this.pos, toPos, ops);
		if (!result.path.length || (result.incomplete && result.path.length == 1)) {
			// 一步也动不了了
			//this.say('no path')
			return ERR_NO_PATH;
		}
		const posArray: RoomPosition[] = result.path;
		posArray.unshift(this.pos);

		//this.say('start new');
		let newPath: MyPath = {
			start: formalize(posArray[0] ?? this.pos),
			end: formalize(posArray[posArray.length - 1] ?? this.pos),
			posArray,
			ignoreRoads: !!ops.ignoreRoads,
			ignoreStructures: !!ops.ignoreDestructibleStructures,
			ignoreSwamps: !!ops.ignoreSwamps,
		};
		generateDirectionArray(newPath);
		addPathIntoCache(newPath);
		//console.log(this, this.pos, 'miss');
		movementState.scratch.creepCache.path = newPath;
	}

	movementState.scratch.creepCache.dst = toPos;
	setPathTimer(movementState.scratch.creepCache);

	const cacheSearchStart = movementState.scratch.startCacheSearch ?? Game.cpu.getUsed();
	if (movementState.scratch.found) {
		movementState.stats.cacheHitCost += Game.cpu.getUsed() - cacheSearchStart;
	} else {
		movementState.stats.cacheMissCost += Game.cpu.getUsed() - cacheSearchStart;
	}

	return startRoute(this, movementState.scratch.creepCache as CreepMoveCache, ops, toPos);
}

/**
 *
 * @param {Creep} this 写好后删这个参数
 * @param {DirectionConstant | Creep} target
 */
export function betterMove(this: Creep, target: DirectionConstant | Creep) {
	if (!this.my) {
		return ERR_NOT_OWNER;
	}
	if (this.spawning) {
		return ERR_BUSY;
	}

	if (target && target instanceof Creep) {
		if (!target.pos.isNearTo(this.pos)) {
			return ERR_NOT_IN_RANGE;
		}

		registerMoveIntent(this, target.pos);
		return OK;
	}

	if (this.fatigue > 0) {
		return ERR_TIRED;
	}
	if (!hasActiveBodypart(this.body, MOVE)) {
		return ERR_NO_BODYPART;
	}
	let direction = +target;
	if (!direction || direction < 1 || direction > 8) {
		return ERR_INVALID_ARGS;
	}
	const nextPos = direction2Pos(this.pos, direction);
	// 跨房目标可能落在无视野的邻房：无法做地形检查时仍然登记意图（走过去顶多原地重试）
	const nextRoom = nextPos ? Game.rooms[nextPos.roomName] : undefined;
	if (
		nextPos &&
		(!nextRoom || nextRoom.getTerrain().get(nextPos.x, nextPos.y) !== TERRAIN_MASK_WALL)
	) {
		registerMoveIntent(this, nextPos);
	}
	return OK;
}

/**
 * 发生 pull 时自动合并成小队
 *
 * @param {Creep} this 写好后删这个参数
 * @param {Creep} target
 */
export function betterPull(this: Creep, target: Creep) {
	const ret = movementState.proto.originPull.call(this, target);
	if (ret === OK) {
		// 只需登记小队，无需登记 move intent
		movementState.tick.pullPair.set(target.name, this.name);
		registerSquad(this, target);
	}
	return ret;
}

export function betterCancelOrder(this: Creep, methodName: string) {
	// 只拦截取消移动需求
	if (methodName == "move" || methodName == "moveTo") {
		// 取消移动需求
		movementState.tick.cachedMoveIntents.delete(this.name);
		const formalCreepPos = formalize(this.pos);
		const curTile = (formalCreepPos.y << 14) | formalCreepPos.x;
		movementState.tick.checkedTiles.delete(curTile);
	}
	return movementState.proto.originCancelOrder.call(this, methodName);
}

/**
 * 若当前位置不可作为四人小队站位的右下角，则返回 ERR_NO_PATH
 *
 * @param {RoomPosition} this 写好后删这个参数
 * @param {RoomPosition | RoomObject} toPos
 * @param {*} opts  支持 costCallback, ignoreDestructibleStructures, range, maxOps, maxCost, maxRooms, heuristicWeight
 */
export function findSquadPathTo(this: RoomPosition, targetPos: PosLike, opts: MoveOps) {
	if (!(this.roomName in movementState.cache.costMatrixCache) && this.roomName in Game.rooms) {
		generateCostMatrix(Game.rooms[this.roomName]!);
	}
	const goalPos = (targetPos as { pos?: PosLike }).pos || targetPos;
	targetPos = goalPos;
	opts = opts || {};
	movementState.scratch.findPathIgnoreCondition = !!opts.ignoreDestructibleStructures;
	if (this.roomName in movementState.cache.costMatrixCache) {
		const costMatrix = (movementState.cache.costMatrixCache[this.roomName] as RoomCostEntry)["squad"]?.[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix;
		if (costMatrix.get(this.x, this.y) === 255) {
			return ERR_NO_PATH;
		}
	}
	let result = findSquadPath(this, targetPos, opts);
	return result;
}

export const betterMoveApi = {
	squadMove,
	squadMoveTo,
	preTickBetterMove,
	endTickResolve,
	cancelMoveIntent,
	hasMoveIntent,
	isSwapIntent,
	getMoveIntentStep,
	getDirection,
	direction2Pos,
	getSquadCostMatrix: function (roomName: string, ignoreDestructibleStructures: boolean) {
		const cache = movementState.cache.costMatrixCache[roomName];
		if (cache) {
			return (cache["squad"]?.[ignoreDestructibleStructures ? "true" : "false"] ?? movementState.cache.emptyCostMatrix).clone();
		}
		return undefined;
	},
	setPathClearDelay: function (number: unknown) {
		if (typeof number == "number" && number > 0) {
			movementState.config.pathClearDelay = Math.ceil(number);
			return OK;
		}
		return ERR_INVALID_ARGS;
	},
	setHostileCostMatrixClearDelay: function (number: unknown) {
		if (typeof number == "number" && number > 0) {
			movementState.config.hostileCostMatrixClearDelay = Math.ceil(number);
			return OK;
		}
		return ERR_INVALID_ARGS;
	},
	deleteCostMatrix: function (roomName: string) {
		let parsed = parseRoomName(roomName);
		if (parsed) {
			delete movementState.cache.costMatrixCache[roomName];
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	deletePath: function (_fromPos: PosLike, _toPos: PosLike, _opts: MoveOps) {
		// TODO
		//if(!(fromPos instanceof RoomPosition))
		return "not implemented";
	},
	deletePathInRoom: function (roomName: string) {
		let parsed = parseRoomName(roomName);
		if (parsed) {
			this.deleteCostMatrix(roomName);
			let fromalCentralPos = formalize({ x: 25, y: 25, roomName: roomName });
			movementState.scratch.minX = fromalCentralPos.x + fromalCentralPos.y - 48;
			movementState.scratch.maxX = fromalCentralPos.x + fromalCentralPos.y + 48;
			movementState.scratch.minY = movementState.scratch.minX;
			movementState.scratch.maxY = movementState.scratch.maxX;
			for (movementState.scratch.combinedX = movementState.scratch.minX; movementState.scratch.combinedX <= movementState.scratch.maxX; movementState.scratch.combinedX++) {
				if (movementState.scratch.combinedX in movementState.cache.globalPathCache) {
					for (movementState.scratch.combinedY = movementState.scratch.minY; movementState.scratch.combinedY <= movementState.scratch.maxY; movementState.scratch.combinedY++) {
						if (movementState.scratch.combinedY in movementState.cache.globalPathCache[movementState.scratch.combinedX]!) {
							for (let cachedPath of movementState.cache.globalPathCache[movementState.scratch.combinedX]![movementState.scratch.combinedY] ?? []) {
								// 这个数组应该会很短
								let posList = cachedPath.posArray;
							if (
									posList[0]?.roomName == roomName &&
									posList[posList.length - 1]?.roomName == roomName
								) {
									// 是这个房间的路
									deletePath(cachedPath);
								}
							}
						}
					}
				}
			}
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	addAvoidRooms: function (roomName: string) {
		let parsed = parseRoomName(roomName);
		if (parsed) {
			movementState.config.avoidRooms.add(roomName);
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	deleteAvoidRooms: function (roomName: string) {
		let parsed = parseRoomName(roomName);
		if (parsed) {
			movementState.config.avoidRooms.delete(roomName);
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	addAvoidExits: function (fromRoomName: string, toRoomName: string) {
		let parsed1 = parseRoomName(fromRoomName);
		let parsed2 = parseRoomName(toRoomName);
		if (parsed1 && parsed2) {
			const exits = movementState.config.avoidExits.get(fromRoomName);
			if (exits) {
				exits.add(toRoomName);
			} else {
				movementState.config.avoidExits.set(fromRoomName, new Set([toRoomName]));
			}
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	deleteAvoidExits: function (fromRoomName: string, toRoomName: string) {
		// 【未启用】
		let parsed1 = parseRoomName(fromRoomName);
		let parsed2 = parseRoomName(toRoomName);
		if (parsed1 && parsed2) {
			movementState.config.avoidExits.get(fromRoomName)?.delete(toRoomName);
			return OK;
		} else {
			return ERR_INVALID_ARGS;
		}
	},
	print: function () {
		let text = "\navarageTime\tcalls\tFunctionName";
		for (let fn in movementState.stats.analyzeCPU) {
			const stat = movementState.stats.analyzeCPU[fn];
		if (!stat) return;
			const avg = stat.calls > 0 ? (stat.sum / stat.calls).toFixed(5) : "0.0";
			text += `\n${avg}\t\t${stat.calls}\t\t${fn}`;
		}
		const totalCacheSearches = movementState.stats.testCacheMiss + movementState.stats.testCacheHits;
		const hitCost = movementState.stats.testCacheHits > 0 ? movementState.stats.cacheHitCost / movementState.stats.testCacheHits : 0;
		const missCost = movementState.stats.testCacheMiss > 0 ? movementState.stats.cacheMissCost / movementState.stats.testCacheMiss : 0;
		const missRate = totalCacheSearches > 0 ? movementState.stats.testCacheMiss / totalCacheSearches : 0;
		const endTickStat = movementState.stats.analyzeCPU["endTickResolve"] ?? { sum: 0, calls: 0, moveCount: 0 };
		const moveToStat = movementState.stats.analyzeCPU["moveTo"] ?? { sum: 0, calls: 0 };
		const moveCount = endTickStat.moveCount || 0;
		const costPerMove =
			moveCount > 0
				? ((moveToStat.sum + endTickStat.sum) / moveCount).toFixed(5)
				: "0.00000";
		text += `\nnormal logical cost per move: ${costPerMove}, total move count: ${moveCount}`;
		const moveToCalls = moveToStat.calls || 0;
		const searchRate = moveToCalls > 0 ? (totalCacheSearches / moveToCalls).toFixed(4) : "0.0000";
		const avgCheckPaths =
			totalCacheSearches > 0 ? (movementState.stats.pathCounter / totalCacheSearches).toFixed(3) : "0.000";
		text += `\ncache search rate: ${searchRate}, total hit rate: ${(1 - missRate).toFixed(4)}, avg check paths: ${avgCheckPaths}`;
		text += `\ncache hit avg cost: ${hitCost.toFixed(5)}, cache miss avg cost: ${missCost.toFixed(5)}, total avg cost: ${(hitCost * (1 - missRate) + missCost * missRate).toFixed(5)}`;
		return text;
	},
	clear: () => {},
	// clear: clearUnused
};
