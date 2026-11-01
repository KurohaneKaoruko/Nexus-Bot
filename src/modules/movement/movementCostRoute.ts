/**
 * movement costRoute module.
 */
import { movementConstants, movementState } from "./movementState";
import type { MyPath, RoomCostEntry } from "./movementState";
import { getDirection, isHighWay } from "./movementGeometry";

export function isClosedRampart(structure: AnyOwnedStructure | AnyStructure) {
	return structure.structureType == STRUCTURE_RAMPART && !structure.my && !structure.isPublic;
}

/**
 *  查看是否有挡路建筑
 * @param {Room} room
 * @param {RoomPosition} pos
 * @param {boolean} ignoreStructures
 */
export function isObstacleStructure(room: Room, pos: RoomPosition, ignoreStructures?: boolean) {
	// 跨房位置：优先用该房间自己的数据；无视野房间视为可通行（引擎允许直接走进去）
	const targetRoom = pos.roomName === room.name ? room : Game.rooms[pos.roomName];
	if (!targetRoom) return false;
	let consSite = targetRoom.lookForAt(LOOK_CONSTRUCTION_SITES, pos);
	if (_.any(consSite, (c: ConstructionSite) => c.my && movementConstants.obstacles.has(c.structureType))) {
		// 工地会挡路
		return true;
	}
	for (const raw of targetRoom.lookForAt(LOOK_STRUCTURES, pos)) {
		const s = raw as AnyStructure;
		if (!s.hits || (s as StructureInvaderCore).ticksToDeploy) {
			// 是新手墙或者无敌中的invaderCore
			return true;
		} else if (movementConstants.obstacles.has(s.structureType)) {
			// 挡路的建筑
			if ((s as AnyOwnedStructure).my || !ignoreStructures) {
				return true;
			}
		} else if (!ignoreStructures && isClosedRampart(s)) {
			return true;
		}
	}
	return false;
	// let possibleStructures = room.lookForAt(LOOK_STRUCTURES, pos);  // room.lookForAt比pos.lookFor快
	// 万一有人把路修在extension上，导致需要每个建筑都判断，最多重叠3个建筑（rap+road+其他）
	// return obstacles.has(possibleStructures[0]) || obstacles.has(possibleStructures[1]) || obstacles.has(possibleStructures[2]);    // 条件判断平均每次0.00013cpu
}

/**
 * 初始化用于计算最大空地正方形的二维数组
 *
 * @param {Uint8Array} terrain
 * @param {CostMatrix} squadNoStructureCostMatrix 多 creep 寻路的 costMatrix
 * @param {CostMatrix} squadStructureCostMatrix 多 creep 寻路的 costMatrix
 */
export function initialMap(terrain: Uint8Array, squadNoStructureCostMatrix: CostMatrix, squadStructureCostMatrix: CostMatrix) {
	const squareMap = new Uint8Array(2500);
	const edgeArray = new Uint16Array(2500 << 3);
	const edgeIdx = new Uint8Array(2500);
	// 写一条 a→b 边并推进 a 的边计数 (a 必在 0..2499 界内)
	const pushEdge = (a: number, b: number) => {
		const i = edgeIdx[a] ?? 0;
		edgeArray[(a << 3) + i] = b;
		edgeIdx[a] = i + 1;
	};

	// 设置动态规划的递推所需的初始值，只需考虑房间正方形左、上两条边的所有格子
	for (let u = 0; u < 50; u++) {
		if ((terrain[u] ?? 0) & TERRAIN_MASK_WALL) {
			squareMap[u] = 0; // 是墙则0
		} else {
			squareMap[u] = 1;
			const v = u - 1;
			if (squareMap[v] === 0) {
				squadNoStructureCostMatrix.set(u, 0, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(u, 0, movementConstants.unWalkableCost);
			} else {
				pushEdge(u, v);
				pushEdge(v, u);
			}
		}
	}
	for (let y = 1, u = 50; y < 50; y++, u += 50) {
		if ((terrain[u] ?? 0) & TERRAIN_MASK_WALL) {
			squareMap[u] = 0; // 是墙则0
		} else {
			squareMap[u] = 1;
			const v = u - 50;
			if (squareMap[v] === 0) {
				squadNoStructureCostMatrix.set(0, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(0, y, movementConstants.unWalkableCost);
			} else {
				pushEdge(u, v);
				pushEdge(v, u);
			}
		}
	}
	return { squareMap, edgeArray, edgeIdx };
}

/**
 *
 *
 *
 * @param {Room} room
 * @param {CostMatrix} costMatrix 单 creep 寻路的 costMatrix，有路
 * @param {CostMatrix} squadNoStructureCostMatrix 多 creep 寻路的 costMatrix
 * @param {CostMatrix} squadStructureCostMatrix
 */
export function getEdgeArray(room: Room, costMatrix: CostMatrix, squadNoStructureCostMatrix: CostMatrix, squadStructureCostMatrix: CostMatrix) {
	const terrain = room.getTerrain().getRawBuffer();
	const { squareMap, edgeArray, edgeIdx } = initialMap(
		terrain,
		squadNoStructureCostMatrix,
		squadStructureCostMatrix,
	); // 二维数组，每一个值代表以此为右下角的最大空地正方形边长
	let current, u, v, w;
	// 写一条 a→b 边并推进 a 的边计数 (索引必在界内)
	const pushEdge = (a: number, b: number) => {
		const i = edgeIdx[a] ?? 0;
		edgeArray[(a << 3) + i] = b;
		edgeIdx[a] = i + 1;
	};

	for (let y = 1, y50 = 50; y <= 49; y++, y50 += 50) {
		for (let x = 1, idx = y50 + 1; x <= 49; x++, idx++) {
			const curTerrain = terrain[idx] ?? 0;
			if (curTerrain & TERRAIN_MASK_WALL) {
				squareMap[idx] = 0;

				u = idx - 1;
				v = idx - 50;
				if (squareMap[u] && squareMap[v]) {
					pushEdge(v, u);
					pushEdge(u, v);
				}
				squadNoStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
			} else {
				u = idx - 1;
				v = idx - 50;
				w = idx - 51;
				const uTerrain = terrain[u],
					vTerrain = terrain[v],
					wTerrain = terrain[w];
				if (uTerrain !== TERRAIN_MASK_WALL) {
					pushEdge(idx, u);
					pushEdge(u, idx);
					if (vTerrain !== TERRAIN_MASK_WALL) {
						pushEdge(idx, v);
						pushEdge(v, idx);

						pushEdge(v, u);
						pushEdge(u, v);
					}
				} else if (vTerrain !== TERRAIN_MASK_WALL) {
					pushEdge(idx, v);
					pushEdge(v, idx);
				}
				if (wTerrain !== TERRAIN_MASK_WALL) {
					pushEdge(idx, w);
					pushEdge(w, idx);
				}

				// DP: 最大空地正方形
				current = squareMap[w];
				if (current! > squareMap! [u]!) {
					// 取min
					current = squareMap[u];
				}
				if (current! > squareMap! [v]!) {
					// 取min
					current = squareMap[v];
				}
				current = current! + 1; // 递推
				squareMap[idx] = current;
				if (current >= 2) {
					// 有 2x2 空地正方形，可以走，要看 terrain 决定 cost
					// 如果左上格是无路的 swamp，当前格、正上格、正左格也代价大
					if (wTerrain === TERRAIN_MASK_SWAMP && costMatrix.get(x - 1, y - 1) !== 1) {
						if (!squadNoStructureCostMatrix.get(x, y)) squadNoStructureCostMatrix.set(x, y, 5);
						if (!squadStructureCostMatrix.get(x, y)) squadStructureCostMatrix.set(x, y, 5);

						if (!squadNoStructureCostMatrix.get(x - 1, y)) squadNoStructureCostMatrix.set(x - 1, y, 5);
						if (!squadStructureCostMatrix.get(x - 1, y)) squadStructureCostMatrix.set(x - 1, y, 5);

						if (!squadNoStructureCostMatrix.get(x, y - 1)) squadNoStructureCostMatrix.set(x, y - 1, 5);
						if (!squadStructureCostMatrix.get(x, y - 1)) squadStructureCostMatrix.set(x, y - 1, 5);
					} // else costMatrix 为默认0，按地形是平原 1
				} else {
					squadNoStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
				}
			}
			//rv.text(squareMap[x + y*50], x, y, { opacity: 0.3 });
		}
	}
	return { edgeArray, squareMap };
}

/**
 *  为房间保存costMatrix，ignoreDestructibleStructures这个参数的两种情况各需要一个costMatrix
 *  设置costMatrix缓存的过期时间
 * @param {Room} room
 * @param {RoomPosition | undefined} pos
 */
export function generateCostMatrix(room: Room, pos?: RoomPosition) {
	const noStructureCostMat = new PathFinder.CostMatrix(); // 不考虑可破坏的建筑，但是要考虑墙上资源点和无敌的3种建筑，可能还有其他不能走的？
	const structureCostMat = new PathFinder.CostMatrix(); // 在noStructrue的基础上加上所有不可行走的建筑
	const noStructureSquadCostMatrix = new PathFinder.CostMatrix();
	const squadStructureCostMatrix = new PathFinder.CostMatrix();
	let totalStructures = room.find(FIND_STRUCTURES);

	// 优化：避免创建大数组，分别遍历
	let sources = room.find(FIND_SOURCES);
	for (let i = sources.length; i--;) {
		const src = sources[i];
		if (src) noStructureCostMat.set(src.pos.x, src.pos.y, movementConstants.unWalkableCost);
	}
	let minerals = room.find(FIND_MINERALS);
	for (let i = minerals.length; i--;) {
		const mineral = minerals[i];
		if (mineral) noStructureCostMat.set(mineral.pos.x, mineral.pos.y, movementConstants.unWalkableCost);
	}
	let deposits = room.find(FIND_DEPOSITS);
	for (let i = deposits.length; i--;) {
		const deposit = deposits[i];
		if (deposit) noStructureCostMat.set(deposit.pos.x, deposit.pos.y, movementConstants.unWalkableCost);
	}

	let x, y, noviceWall, deployingCore, centralPortal;
	let clearDelay = Infinity;
	const roomName = room.name;

	if (room.controller && (room.controller.my || room.controller.safeMode)) {
		// 自己的工地不能踩
		for (let consSite of room.find(FIND_CONSTRUCTION_SITES)) {
			if (movementConstants.obstacles.has(consSite.structureType)) {
				x = consSite.pos.x;
				y = consSite.pos.y;
				noStructureCostMat.set(x, y, 255);
				structureCostMat.set(x, y, 255);
			}
		}
	}

	for (let i = totalStructures.length; i--;) {
		const s = totalStructures[i] as AnyStructure;
		if (!s) continue;
		x = s.pos.x;
		y = s.pos.y;

		switch (s.structureType) {
			case STRUCTURE_INVADER_CORE: // 第1种可能无敌的建筑
				if (s.ticksToDeploy) {
					deployingCore = true;
					clearDelay = clearDelay > s.ticksToDeploy ? s.ticksToDeploy : clearDelay;
					noStructureCostMat.set(x, y, movementConstants.unWalkableCost);
					noStructureSquadCostMatrix.set(x, y, movementConstants.unWalkableCost);
					noStructureSquadCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
					noStructureSquadCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
					noStructureSquadCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
				}
				structureCostMat.set(x, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
				break;
			case STRUCTURE_PORTAL: // 第2种无敌建筑
				if (!isHighWay(roomName)) {
					centralPortal = true;
					const decay = s.ticksToDecay;
					if (decay !== undefined) clearDelay = clearDelay > decay ? decay : clearDelay;
				}
				structureCostMat.set(x, y, movementConstants.unWalkableCost);
				noStructureCostMat.set(x, y, movementConstants.unWalkableCost);

				squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
				squadStructureCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);

				noStructureSquadCostMatrix.set(x, y, movementConstants.unWalkableCost);
				noStructureSquadCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
				noStructureSquadCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
				noStructureSquadCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
				break;
			case STRUCTURE_WALL: // 第3种可能无敌的建筑
				if (!s.hits) {
					noviceWall = true;
					noStructureCostMat.set(x, y, movementConstants.unWalkableCost);
					noStructureSquadCostMatrix.set(x, y, movementConstants.unWalkableCost);
					if (s.pos.x < 49) {
						noStructureSquadCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
						if (s.pos.y < 49) {
							noStructureSquadCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
							noStructureSquadCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
						}
					} else if (s.pos.y < 49) {
						noStructureSquadCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
					}
				}
				structureCostMat.set(x, y, movementConstants.unWalkableCost);

				squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
				if (s.pos.x < 49) {
					squadStructureCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
					if (s.pos.y < 49) {
						squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
						squadStructureCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
					}
				} else if (s.pos.y < 49) {
					squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
				}
				break;
			case STRUCTURE_ROAD:
				if (noStructureCostMat.get(x, y) == 0) {
					// 不是在3种无敌建筑或墙中资源上
					noStructureCostMat.set(x, y, 1);
					if (structureCostMat.get(x, y) == 0) {
						// 不是在不可行走的建筑上
						structureCostMat.set(x, y, 1);
					}
				}
				break;
			case STRUCTURE_RAMPART:
				if (!s.my && !s.isPublic) {
					structureCostMat.set(x, y, movementConstants.unWalkableCost);

					squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
				}
				break;
			default:
				if (movementConstants.obstacles.has(s.structureType)) {
					// console.log(`${Game.time}: generateCostMatrix: ${s.structureType} at ${x}, ${y}`);
					structureCostMat.set(x, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x + 1, y, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x, y + 1, movementConstants.unWalkableCost);
					squadStructureCostMatrix.set(x + 1, y + 1, movementConstants.unWalkableCost);
				}
				break;
		}
	}

	const { edgeArray, squareMap } = getEdgeArray(
		room,
		structureCostMat,
		noStructureSquadCostMatrix,
		squadStructureCostMatrix,
	);

	// 房间出口设为沼泽
	for (let i = 1, j = 50; i < 49; i++, j += 50) {
		if (squareMap[i]) {
			noStructureCostMat.set(i, 0, 5);
			structureCostMat.set(i, 0, 5);
			if (!squadStructureCostMatrix.get(i, 0)) squadStructureCostMatrix.set(i, 0, 5);
			if (!squadStructureCostMatrix.get(i, 1)) squadStructureCostMatrix.set(i, 1, 5);
			if (!noStructureSquadCostMatrix.get(i, 0)) noStructureSquadCostMatrix.set(i, 0, 5);
			if (!noStructureSquadCostMatrix.get(i, 1)) noStructureSquadCostMatrix.set(i, 1, 5);
		}
		if (squareMap[i + 2450]) {
			noStructureCostMat.set(i, 49, 5);
			structureCostMat.set(i, 49, 5);
			if (!squadStructureCostMatrix.get(i, 49)) squadStructureCostMatrix.set(i, 49, 5);
			if (!noStructureSquadCostMatrix.get(i, 49)) noStructureSquadCostMatrix.set(i, 49, 5);
		}
		if (squareMap[j]) {
			noStructureCostMat.set(0, i, 5);
			structureCostMat.set(0, i, 5);
			if (!squadStructureCostMatrix.get(0, i)) squadStructureCostMatrix.set(0, i, 5);
			if (!squadStructureCostMatrix.get(1, i)) squadStructureCostMatrix.set(1, i, 5);
			if (!noStructureSquadCostMatrix.get(0, i)) noStructureSquadCostMatrix.set(0, i, 5);
			if (!noStructureSquadCostMatrix.get(1, i)) noStructureSquadCostMatrix.set(1, i, 5);
		}
		if (squareMap[j + 49]) {
			noStructureCostMat.set(49, i, 5);
			structureCostMat.set(49, i, 5);
			if (!squadStructureCostMatrix.get(49, i)) squadStructureCostMatrix.set(49, i, 5);
			if (!noStructureSquadCostMatrix.get(49, i)) noStructureSquadCostMatrix.set(49, i, 5);
		}
	}

	const entry: RoomCostEntry = {
		roomName: roomName,
		true: noStructureCostMat, // 对应 ignoreDestructibleStructures = true
		false: structureCostMat, // 对应 ignoreDestructibleStructures = false
		squad: {
			true: noStructureSquadCostMatrix, // 对应 ignoreDestructibleStructures = true
			false: squadStructureCostMatrix, // 对应 ignoreDestructibleStructures = false
		},
		edgeArray: edgeArray,
	};
	if (room.controller?.my) entry.my = true;
	movementState.cache.costMatrixCache[roomName] = entry;

	let avoids: string[] = [];
	if (
		room.controller &&
		room.controller.owner &&
		!room.controller.my &&
		movementState.config.hostileCostMatrixClearDelay
	) {
		// 他人房间，删除costMat才能更新被拆的建筑位置
		const clearTick = Game.time + movementState.config.hostileCostMatrixClearDelay;
		if (!(clearTick in movementState.cache.costMatrixCacheTimer)) {
			movementState.cache.costMatrixCacheTimer[clearTick] = [];
		}
		movementState.cache.costMatrixCacheTimer[clearTick]!.push({
			roomName: roomName,
			avoids: avoids,
		}); // 记录清理时间
	} else if (noviceWall || deployingCore || centralPortal) {
		// 如果遇到可能消失的挡路建筑，这3种情况下clearDelay才可能被赋值为非Infinity
		if (noviceWall) {
			// 如果看见新手墙
			const neighbors = Game.map.describeExits(roomName);
			for (const direction in neighbors) {
				const neighbor = neighbors[direction as ExitKey];
				if (!neighbor) continue;
				const status = Game.map.getRoomStatus(neighbor);
				if (status.status == "closed") {
					if (!movementState.config.avoidRooms.has(neighbor)) {
						movementState.config.avoidRooms.add(neighbor);
					}
				} else if (status.status != "normal" && status.timestamp != null) {
					let estimateTickToChange = (status.timestamp - new Date().getTime()) / 10000; // 10s per tick
					clearDelay =
						clearDelay > estimateTickToChange ? Math.ceil(estimateTickToChange) : clearDelay;
				}
			}
			if (pos) {
				// 如果知道自己的pos
				for (let direction in neighbors) {
					const neighbor = neighbors[direction as ExitKey];
					if (neighbor && !movementState.config.avoidRooms.has(neighbor)) {
						const exits = room.find(+direction as FIND_EXIT_TOP) as RoomPosition[];
						if (
							PathFinder.search(
								pos,
								exits.map((e: RoomPosition) => ({ pos: e, range: 0 })),
								{ maxRooms: 1, roomCallback: () => noStructureCostMat },
							).incomplete
						) {
							// 此路不通
							movementState.config.avoidRooms.add(neighbor);
							avoids.push(neighbor);
						}
					}
				}
			}
		}
		//console.log(roomName + ' costMat 设置清理 ' + clearDelay);
		const clearTick = Game.time + clearDelay;
		if (!(clearTick in movementState.cache.costMatrixCacheTimer)) {
			movementState.cache.costMatrixCacheTimer[clearTick] = [];
		}
		movementState.cache.costMatrixCacheTimer[clearTick]!.push({
			roomName: roomName,
			avoids: avoids, // 因新手墙导致的avoidRooms需要更新
		}); // 记录清理时间
	}
	//console.log('生成costMat ' + roomName);
}

/**
 *  第一次拿到该room视野，startIdx是新房中唯一有direction的位置
 * @param {Room} room
 * @param {MyPath} path
 * @param {number} startIdx
 */
export function checkRoom(room: Room, path: MyPath, startIdx: number) {
	if (!(room.name in movementState.cache.costMatrixCache)) {
		generateCostMatrix(room, path.posArray[startIdx]);
	}
	const thisRoomName = room.name;
	/** @type {CostMatrix} */
	let costMat = (movementState.cache.costMatrixCache[thisRoomName] as RoomCostEntry)[path.ignoreStructures ? "true" : "false"] ?? movementState.cache.emptyCostMatrix;
	let posArray = path.posArray;
	let i;
	const directionArray = path.directionArray ?? [];
	for (i = startIdx; i + 1 in posArray && posArray[i]?.roomName == thisRoomName; i++) {
		if (costMat.get(posArray[i]!.x, posArray[i]!.y) == 255) {
			// 路上有东西挡路
			return false;
		}
		directionArray[i + 1] = getDirection(posArray[i]!, posArray[i + 1]!);
	}
	return true;
}

/**
 *  第一次拿到该room视野，startIdx是新房中要检查的第一个位置
 * @param {Room} room
 * @param {MyPath} path
 * @param {number} startIdx
 */
export function checkSquadRoom(room: Room, path: MyPath, startIdx: number) {
	if (!(room.name in movementState.cache.costMatrixCache)) {
		generateCostMatrix(room);
	}
	const thisRoomName = room.name;
	/** @type {CostMatrix} */
	let costMat = (movementState.cache.costMatrixCache[thisRoomName] as RoomCostEntry)["squad"]?.[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix;
	let posArray = path.posArray;
	let i;
	for (i = startIdx; i + 1 in posArray && posArray[i]?.roomName == thisRoomName; i++) {
		if (costMat.get(posArray[i]!.x, posArray[i]!.y) == 255) {
			// 路上有东西挡路
			return false;
		}
	}
	return true;
}

export function routeCallback(nextRoomName: string, fromRoomName: string) {
	// 避开avoidRooms设置了的
	if (movementState.scratch.curAvoidRooms?.has(nextRoomName)) {
		//console.log('Infinity at ' + nextRoomName);
		return Infinity;
	} else if (movementState.scratch.curAvoidExits?.has(fromRoomName) && movementState.scratch.curAvoidExits.get(fromRoomName)?.has(nextRoomName)) {
		return Infinity;
	}
	return isHighWay(nextRoomName) ? 1 : 1.15;
}

export function bypassRouteCallback(nextRoomName: string, fromRoomName: string) {
	if (fromRoomName == movementState.scratch.temporalAvoidFrom && nextRoomName == movementState.scratch.temporalAvoidTo) {
		//console.log(`Infinity from ${fromRoomName} to ${nextRoomName}`);
		return Infinity;
	}
	return routeCallback(nextRoomName, fromRoomName);
}

/**
 *  遇到跨房寻路，先以房间为单位寻route，再寻精细的path
 * @param {string} fromRoomName
 * @param {string} toRoomName
 * @param {boolean} bypass
 */
export function findRoute(fromRoomName: string, toRoomName: string, bypass?: boolean) {
	// TODO 以后跨shard寻路也放在这个函数里
	//console.log('findRoute', fromRoomName, toRoomName, bypass);
	return Game.map.findRoute(fromRoomName, toRoomName, {
		routeCallback: bypass ? bypassRouteCallback : routeCallback,
	});
}

/**
 * @param {RoomPosition} pos
 * @param {Room} room
 * @param {CostMatrix} costMat
 */
export function checkTemporalAvoidExit(pos: RoomPosition, room: Room, costMat: CostMatrix) {
	// 用于记录因creep堵路导致的房间出口临时封闭
	let neighbors = Game.map.describeExits(room.name);
	movementState.scratch.temporalAvoidFrom = movementState.scratch.temporalAvoidTo = ""; // 清空旧数据
	for (let direction in neighbors) {
		const neighbor = neighbors[direction as ExitKey];
		if (neighbor && !movementState.scratch.curAvoidRooms?.has(neighbor)) {
			const exits = room.find(+direction as FIND_EXIT_TOP) as RoomPosition[];
			if (
				PathFinder.search(
					pos,
					exits.map((e: RoomPosition) => ({ pos: e, range: 0 })),
					{
						maxRooms: 1,
						roomCallback: () => costMat,
					},
				).incomplete
			) {
				// 此路不通
				movementState.scratch.temporalAvoidFrom = room.name;
				movementState.scratch.temporalAvoidTo = neighbor ?? "";
			}
		}
	}
}

export function routeReduce(temp: Record<string, number>, item: { room: string }) {
	temp[item.room] = 1;
	return temp;
}

export function bypassRoomCallback(roomName: string) {
	if (movementState.config.avoidRooms.has(roomName)) {
		return false;
	}
	let costMat: CostMatrix;
	if (roomName === movementState.scratch.bypassRoomName) {
		// 在findTemporalRoute函数里刚刚建立了costMatrix
		costMat = movementState.scratch.bypassCostMat ?? movementState.cache.emptyCostMatrix;
	} else {
		const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
		costMat = roomCache ? (roomCache[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
	}

	if (movementState.scratch.userCostCallback) {
		const resultCostMat = movementState.scratch.userCostCallback(
			roomName,
			movementState.cache.costMatrixCache[roomName] ? costMat.clone() : new PathFinder.CostMatrix(),
		) as CostMatrix | boolean | void;
		if (resultCostMat instanceof PathFinder.CostMatrix) {
			costMat = resultCostMat;
		}
	}
	movementState.scratch.costMat = costMat;
	return costMat;
}

export function bypassRoomCallbackWithRoute(roomName: string) {
	if (roomName in (movementState.scratch.routeSet ?? {})) {
		let costMat: CostMatrix;
		if (roomName == movementState.scratch.bypassRoomName) {
			// 在findTemporalRoute函数里刚刚建立了costMatrix
			costMat = movementState.scratch.bypassCostMat ?? movementState.cache.emptyCostMatrix;
		} else {
			const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
			costMat = roomCache ? (roomCache[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
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
	return false;
}

/**
 * @param {{[roomName:string]:1}} temp
 * @param {{room:string}} item
 * @returns {{[roomName:string]:1}}
 */
export function roomCallback(roomName: string) {
	if (movementState.config.avoidRooms.has(roomName)) {
		return false;
	}
	const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
	let costMat: CostMatrix = roomCache ? (roomCache[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
	if (movementState.scratch.userCostCallback) {
		const resultCostMat = movementState.scratch.userCostCallback(
			roomName,
			roomCache ? costMat.clone() : new PathFinder.CostMatrix(),
		) as CostMatrix | boolean | void;
		if (resultCostMat instanceof PathFinder.CostMatrix) {
			costMat = resultCostMat;
		}
	}
	movementState.scratch.costMat = costMat;
	return costMat;
}

export function roomCallbackWithRoute(roomName: string) {
	if (roomName in (movementState.scratch.routeSet ?? {})) {
		const roomCache = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
		let costMat: CostMatrix = roomCache ? (roomCache[movementState.scratch.findPathIgnoreCondition ? "true" : "false"] ?? movementState.cache.emptyCostMatrix) : movementState.cache.emptyCostMatrix;
		//console.log('in route ' + roomName);
		if (movementState.scratch.userCostCallback) {
			const resultCostMat = movementState.scratch.userCostCallback(
				roomName,
				roomCache ? costMat.clone() : new PathFinder.CostMatrix(),
			) as CostMatrix | boolean | void;
			if (resultCostMat instanceof PathFinder.CostMatrix) {
				costMat = resultCostMat;
			}
		}
		movementState.scratch.costMat = costMat;
		return costMat;
	}
	//console.log('out route ' + roomName);
	return false; // 不在route上的不搜索
}
