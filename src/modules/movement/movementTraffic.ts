/**
 * movement traffic module.
 */
import { movementConstants, movementState, resetTickState } from "./movementState";
import type { CreepMoveCache, MoveOps, MyPath, RoomCostEntry } from "./movementState";
import { formalize, getDirection, isEqual, isNear, tile2Pos } from "./movementGeometry";
import type { PosLike, WorldPos } from "./movementGeometry";
import { checkSquadRoom, generateCostMatrix, isObstacleStructure } from "./movementCostRoute";
import { findSquadPath, findSquadTemporalPath, showVisual } from "./movementPathCache";
import { checkSquadTarget, defaultCheckTile, registerMoveIntent, squadMove, squadStepToPos } from "./movementIntentSquad";
import moveMatch from "./moveMatch";
import type { MoveMatchEntry, MoveMatchTargetScore } from "./moveMatch";

/**
 *  按缓存路径移动
 * @param {Creep} creep
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 */
export function moveOneStep(creep: Creep, ops: MoveOps, toPos: PosLike) {
	const creepCache = movementState.cache.creepPathCache[creep.name];
	if (!creepCache?.path) return ERR_INVALID_ARGS;
	const visualStyle = ops.visualizePathStyle;
	const cachedPath = creepCache.path;

	if (visualStyle) {
		showVisual(creep, toPos, cachedPath.posArray, creepCache.idx, 1, visualStyle);
	}
	if (creep.fatigue) {
		return ERR_TIRED;
	}
	creepCache.idx++;
	movementState.cache.creepMoveCache[creep.name] = Game.time;
	// creep.room.visual.circle(creepCache.path.posArray[creepCache.idx]);
	return registerMoveIntent(creep, cachedPath.posArray[creepCache.idx] ?? creep.pos, ops.priority);
}

/**
 *
 * @param {*} creepCache
 * @param {Creep[]} squad
 * @param {*} leader
 * @param {*} creepPosArray
 * @param {{x:number, y:number}} leaderPos
 * @param {*} visualStyle
 * @param {RoomPosition} toPos
 * @param {boolean} someOneTired
 * @returns
 */
export function moveOneStepSquad(
	creepCache: CreepMoveCache,
	squad: Creep[],
	leader: Creep,
	creepPosArray: WorldPos[],
	leaderPos: WorldPos,
	visualStyle: PolyStyle | undefined,
	toPos: PosLike,
	someOneTired: boolean,
) {
	if (visualStyle && creepCache.path) {
		showVisual(leader, toPos, creepCache.path.posArray, creepCache.idx, 1, visualStyle);
	}

	creepCache.idx++;
	const leaderNextPos = movementState.scratch.posArray?.[creepCache.idx] ?? leader.pos;
	return squadStepToPos(
		leaderNextPos,
		squad,
		leader,
		creepPosArray,
		leaderPos,
		someOneTired,
		creepCache,
	);
}

/**
 *
 * @param {Creep} creep
 * @param {{
        path: MyPath,
        dst: RoomPosition,
        idx: number
    }} pathCache
 * @param {PolyStyle} visualStyle
 * @param {RoomPosition} toPos
 */
export function startRoute(creep: Creep, pathCache: CreepMoveCache, ops: MoveOps, toPos: PosLike) {
	const posArray = pathCache.path?.posArray ?? [];
	const visualStyle = ops.visualizePathStyle;

	let idx = 0;
	while (idx in posArray && isNear(creep.pos, posArray[idx] ?? creep.pos)) {
		idx += 1;
	}
	idx -= 1;
	pathCache.idx = idx;

	if (visualStyle) {
		showVisual(creep, toPos, posArray, idx, 1, visualStyle);
	}
	movementState.cache.creepMoveCache[creep.name] = Game.time;

	return registerMoveIntent(creep, posArray[idx] ?? creep.pos, ops.priority);
}

/**
 *
 * @param {*} squad
 * @param {Creep} leader
 * @param {{x: number, y: number}[]} creepPosArray
 * @param {{x: number, y: number}} leaderPos
 * @param {*} pathCache
 * @param {*} visualStyle
 * @param {*} toPos
 */
export function startSquadRoute(
	squad: Creep[],
	leader: Creep,
	creepPosArray: WorldPos[],
	leaderPos: WorldPos,
	pathCache: CreepMoveCache,
	visualStyle: PolyStyle | undefined,
	toPos: PosLike,
	someOneTired: boolean,
) {
	const posArray = pathCache.path?.posArray ?? [];

	let idx = 0;
	while (idx in posArray && isNear(leader.pos, posArray[idx] ?? leader.pos)) {
		idx += 1;
	}
	idx -= 1;
	pathCache.idx = idx;

	if (visualStyle) {
		showVisual(leader, toPos, posArray, idx, 1, visualStyle);
	}
	movementState.cache.creepMoveCache[leader.name] = Game.time;
	//console.log(`startSquadRoute: ${JSON.stringify(posArray)}`);

	const leaderNextPos = posArray[idx] ?? leader.pos;
	if (movementState.scratch.findPathIgnoreCondition && leaderNextPos.roomName === leader.room.name) {
		if (!(leaderNextPos.roomName in movementState.cache.costMatrixCache)) {
			generateCostMatrix(leader.room);
		}
		const costMatrix = (movementState.cache.costMatrixCache[leaderNextPos.roomName] as RoomCostEntry)["squad"]?.["false"] ?? movementState.cache.emptyCostMatrix;
		if (costMatrix.get(leaderNextPos.x, leaderNextPos.y) === 255) {
			// leader.say('有障碍建筑');
			if (idx > 0) pathCache.idx -= 1;
			squadMove(squad);
			return ERR_FULL;
		}
	}
	return squadStepToPos(
		leaderNextPos,
		squad,
		leader,
		creepPosArray,
		leaderPos,
		someOneTired,
		pathCache,
	);
}


export function preTickBetterMove() {
	resetTickState();
}

/**
 *
 * @param {Creep[]} squad 只允许 4 creep 小队
 */
export function squadMoveTo(squad: Creep[], firstArg: unknown, secondArg: unknown, opts: MoveOps | undefined) {
	let leaderFormalX = 0,
		leaderFormalY = 0,
		xLeader = 0,
		yLeader = 0,
		leader: Creep | undefined,
		creepPosArray: WorldPos[] = [];
	if (squad.length !== 4) {
		return ERR_INVALID_ARGS;
	}

	if (typeof firstArg == "object") {
		movementState.scratch.toPos = (firstArg as { pos?: PosLike }).pos || (firstArg as PosLike);
		movementState.scratch.ops = (secondArg as MoveOps) || {};
	} else {
		movementState.scratch.toPos = { x: firstArg as number, y: secondArg as number, roomName: leader!.room!.name! };
		movementState.scratch.ops = opts || {};
	}
	const ops = movementState.scratch.ops;
	const toPos = movementState.scratch.toPos;
	if (!ops || !toPos || !leader) return ERR_INVALID_ARGS;
	ops.enableAutoPull = ops.enableAutoPull === undefined || ops.enableAutoPull;
	let someOneTired = false;

	// 检查 fatigue, my, spawning
	for (const creep of squad) {
		if (creep.my) {
			if (creep.spawning) {
				return ERR_BUSY;
			}
			if (creep.fatigue) {
				if (!movementState.scratch.ops.enableAutoPull) {
					squadMove(squad);
					return ERR_TIRED;
				}
				someOneTired = true;
			}
			const pos = formalize(creep.pos); // 用 formalize 后的兼容跨房情况
			if (pos.x > leaderFormalX || pos.y > leaderFormalY) {
				leaderFormalX = pos.x;
				leaderFormalY = pos.y;
				xLeader = creep.pos.x;
				yLeader = creep.pos.y;
				leader = creep;
			}
			creepPosArray.push(pos);
		} else {
			return ERR_NOT_OWNER;
		}
	}
	// 检查是否相邻
	let crossRoom = xLeader === 0 || xLeader === 49 || yLeader === 0 || yLeader === 49;
	let xDiff1 = 0,
		xDiff2 = 0,
		yDiff1 = 0,
		yDiff2 = 0;
	for (const pos of creepPosArray) {
		const xDiff = leaderFormalX - pos.x;
		const yDiff = leaderFormalY - pos.y;
		if (xDiff < 0 || xDiff > 2 || yDiff < 0 || yDiff > 2) {
			return ERR_NOT_IN_RANGE;
		}
		if (xDiff === 1) xDiff1 += 1;
		if (xDiff === 2) xDiff2 += 1;
		if (yDiff === 1) yDiff1 += 1;
		if (yDiff === 2) yDiff2 += 1;
	}
	if (xDiff2) {
		if (xDiff1 || yDiff2 || xLeader > 1) return ERR_NOT_IN_RANGE;
		//leader.say("跨房");
		crossRoom = true;
	}
	if (yDiff2) {
		if (yDiff1 || yLeader > 1) return ERR_NOT_IN_RANGE;
		//leader.say("跨房");
		crossRoom = true;
	}
	// console.log(`没掉队: ${leaderFormalX}, ${leaderFormalY}, ${xDiff1}, ${xDiff2}, ${yDiff1}, ${yDiff2}, ${JSON.stringify(creepPosArray)}`);

	movementState.scratch.findPathIgnoreCondition = !!ops.ignoreDestructibleStructures;

	// 已到达，注册不可推动的小队
	const rangeToPos = leader.pos.getRangeTo(toPos as RoomPosition);
	if (rangeToPos === 0) {
		squadMove(squad);
		return OK;
	} else if (rangeToPos === 1) {
		if (toPos.roomName === leader.room.name) {
			if (!(toPos.roomName in movementState.cache.costMatrixCache)) {
				generateCostMatrix(leader.room);
			}
			if (((movementState.cache.costMatrixCache[toPos.roomName] as RoomCostEntry)["squad"]?.["false"] ?? movementState.cache.emptyCostMatrix).get(toPos.x, toPos.y) === 255) {
				// leader.say('有障碍建筑');
				squadMove(squad);
				return movementState.scratch.findPathIgnoreCondition ? ERR_FULL : OK;
			}
		}
		return squadStepToPos(
			toPos,
			squad,
			leader,
			creepPosArray,
			{ x: leaderFormalX, y: leaderFormalY },
			someOneTired,
			movementState.scratch.creepCache as CreepMoveCache,
		);
	}

	/** x、y 是 formal pos */
	const leaderPos = { x: leaderFormalX, y: leaderFormalY };
	const key = leader.name + "_quad";
	movementState.scratch.creepCache = movementState.cache.creepPathCache[key];
	if (movementState.scratch.creepCache) {
		// 有缓存
		if (isEqual(toPos, movementState.scratch.creepCache.dst ?? toPos)) {
			// 目的地没变
			const squadCache = movementState.scratch.creepCache;
			const squadPath = squadCache.path;
			movementState.scratch.path = squadPath;
			movementState.scratch.idx = squadCache.idx;
			if (
				squadPath &&
				movementState.scratch.idx < squadPath.posArray.length - 1 &&
				squadPath.ignoreStructures === movementState.scratch.findPathIgnoreCondition
			) {
				const posArray = (movementState.scratch.posArray = squadPath.posArray);
				if (crossRoom) {
					if (movementState.scratch.idx + 2 < posArray.length && isNear(leader.pos, posArray[movementState.scratch.idx + 2] ?? leader.pos)) {
						squadCache.idx++;
					} else if (!isNear(leader.pos, posArray[movementState.scratch.idx + 1] ?? leader.pos)) {
						squadCache.idx--;
					}
					if (
						leader.room.name in movementState.cache.costMatrixCache ||
						checkSquadRoom(leader.room, squadPath, squadCache.idx)
					) {
						// 房间已见过 或 检查路径正常，TODO：若寻路是在无视野时，然后被其他 creep 先进入了建立了 costMatrix，仍然需要检查路径
						movementState.cache.creepMoveCache[leader.name] = Game.time;
						return moveOneStepSquad(
							squadCache,
							squad,
							leader,
							creepPosArray,
							leaderPos,
							ops.visualizePathStyle,
							toPos,
							someOneTired,
						);
					} // else 需要重新寻路
				} else if (isEqual(leader.pos, posArray[movementState.scratch.idx] ?? leader.pos)) {
					// 正常
					if (movementState.scratch.findPathIgnoreCondition) {
						const leaderNextPos = posArray[movementState.scratch.idx + 1] ?? leader.pos;
						const roomName = leaderNextPos.roomName;

						if (roomName === leader.room.name) {
							if (!(roomName in movementState.cache.costMatrixCache)) {
								generateCostMatrix(leader.room);
							}
							const costMatrix = (movementState.cache.costMatrixCache[roomName] as RoomCostEntry)["squad"]?.["false"] ?? movementState.cache.emptyCostMatrix;
							if (costMatrix.get(leaderNextPos.x, leaderNextPos.y) === 255) {
								if (movementState.scratch.ops.visualizePathStyle) {
									showVisual(leader, movementState.scratch.toPos, movementState.scratch.posArray, movementState.scratch.idx, 1, movementState.scratch.ops.visualizePathStyle);
								}
								// leader.say('有障碍建筑');
								squadMove(squad);
								return ERR_FULL;
							}
						}
					}
					movementState.cache.creepMoveCache[leader.name] = Game.time;
					return moveOneStepSquad(
						squadCache,
						squad,
						leader,
						creepPosArray,
						leaderPos,
						ops.visualizePathStyle,
						toPos,
						someOneTired,
					);
					// } else if (idx + 1 in posArray && idx + 2 in posArray && isEqual(leader.pos, posArray[idx + 1])) {  // 跨房了
				} else if (isNear(leader.pos, posArray[movementState.scratch.idx] ?? leader.pos)) {
					// 堵路了
					if (checkSquadTarget(creepPosArray, leaderPos, posArray[movementState.scratch.idx] ?? leader.pos)) {
						// 有其他小队在前方，绕路
						if (findSquadTemporalPath(leader, toPos, ops, key)) {
							// leader.say("绕路");
							for (const creep of squad) {
								movementState.tick.rerouteSquad.add(creep.name);
							}
							return startSquadRoute(
								squad,
								leader,
								creepPosArray,
								leaderPos,
								squadCache,
								ops.visualizePathStyle,
								toPos,
								someOneTired,
							);
						} else {
							// leader.say("没路了");
							squadMove(squad);
							return ERR_NO_PATH;
						}
					} else if (isObstacleStructure(leader.room, posArray[movementState.scratch.idx] ?? leader.pos, true)) {
						// 有己方建筑物
						// leader.say("绕建筑");
						// 删除路和 costMatrix 后重新寻路
						delete movementState.cache.costMatrixCache[leader.pos.roomName];
						generateCostMatrix(leader.room);
					} else if (
						leader.name in movementState.cache.creepMoveCache &&
						(movementState.cache.creepMoveCache[leader.name] ?? Infinity) <= Game.time - 4
					) {
						// 赌得严重
						if (
							findSquadTemporalPath(
								leader,
								toPos,
								ops,
								key,
								true,
								new Set(squad.map((c: Creep) => c.name)),
							)
						) {
							// leader.say("严重绕路");
							for (const creep of squad) {
								movementState.tick.rerouteSquad.add(creep.name);
							}
							return startSquadRoute(
								squad,
								leader,
								creepPosArray,
								leaderPos,
								squadCache,
								ops.visualizePathStyle,
								toPos,
								someOneTired,
							);
						} else {
							// leader.say("没路了");
							squadMove(squad);
							return ERR_NO_PATH;
						}
					} else {
						// 没有其他小队在前方正常走
						// leader.say(`${Game.time - creepMoveCache[leader.name]}`)
						// console.log(`${Game.time - creepMoveCache[leader.name]}: ${JSON.stringify(creepCache.path)}`);
						if (squadCache.idx > 0) squadCache.idx -= 1;
						return moveOneStepSquad(
							squadCache,
							squad,
							leader,
							creepPosArray,
							leaderPos,
							ops.visualizePathStyle,
							toPos,
							someOneTired,
						);
					}
				} else if (movementState.scratch.idx - 1 >= 0 && isNear(leader.pos, posArray[movementState.scratch.idx - 1] ?? leader.pos)) {
					// 因为堵路而被自动传送反向跨房了
					// TODO 解决跨房问题
					// leader.say("偏离一格");
					squadCache.idx -= 2;
					return moveOneStepSquad(
						squadCache,
						squad,
						leader,
						creepPosArray,
						leaderPos,
						ops.visualizePathStyle,
						toPos,
						someOneTired,
					);
				} // else 彻底偏离，重新寻路
			} // else 缓存中没路
		} // 目的地变了
	} else {
		movementState.scratch.creepCache = {
			dst: { x: NaN, y: NaN },
			path: undefined,
			idx: 0,
		};
		movementState.cache.creepPathCache[key] = movementState.scratch.creepCache;
	}

	// 按照 squadCostMatrix 寻路
	let result = findSquadPath(leader.pos, toPos, ops);
	// console.log(`findSquadPath to ${JSON.stringify(toPos)}: ${result.incomplete}, ${JSON.stringify(result.path)}`);
	const squadCache = movementState.scratch.creepCache;
	if (!squadCache) return ERR_INVALID_ARGS;
	if (!result.path.length || (result.incomplete && result.path.length == 1)) {
		// 一步也动不了了
		squadCache.path = undefined;
		squadMove(squad);
		return ERR_NO_PATH;
	}
	const posArray: RoomPosition[] = result.path;
	posArray.unshift(leader.pos);
	let newPath: MyPath = {
		end: formalize(posArray[posArray.length - 1] ?? leader.pos),
		posArray,
		ignoreStructures: movementState.scratch.findPathIgnoreCondition,
	};
	squadCache.path = newPath;
	squadCache.dst = toPos;
	return startSquadRoute(
		squad,
		leader,
		creepPosArray,
		leaderPos,
		movementState.scratch.creepCache,
		movementState.scratch.ops.visualizePathStyle,
		movementState.scratch.toPos,
		someOneTired,
	);
}
