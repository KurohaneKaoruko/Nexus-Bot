/**
 * movement intentSquad module.
 */
import { movementConstants, movementState } from "./movementState";
import type { CreepMoveCache, RoomCostEntry } from "./movementState";
import type { MoveMatchSingleEntry } from "./moveMatch";
import { formalize, hasActiveBodypart, tile2Pos } from "./movementGeometry";
import type { PosLike, WorldPos } from "./movementGeometry";
import { generateCostMatrix } from "./movementCostRoute";

/**
 *
 * @param {Creep} creep
 * @param {RoomPosition} targetPos
 * @param {number} priority
 * @returns
 */
export function registerMoveIntent(creep: Creep, targetPos: PosLike | number, priority?: number) {
	const formalCreepPos = formalize(creep.pos);
	// 所有登记 intents 都把当前 tick creep 脚下格子缓存为已检查过的 target
	movementState.tick.checkedTiles.set((formalCreepPos.y << 14) | formalCreepPos.x, creep.name);

	let targetTile;
	if (typeof targetPos === "number") {
		targetTile = targetPos;
	} else {
		const targetFormalPos = formalize(targetPos);
		// 跨房目标直接用世界坐标 tile id（与 formalize 同一坐标系，邻房边界格天然相邻，
		// 解析器因此能识别门口「互换」结构，让对向 creep 互相穿行）。
		// 原实现对跨界目标再做 ±1 位移，会把「邻房边界格」折叠成 creep 自己脚下的格子
		// （target == cur），结算器于是只匹配原地不动——creep 永远跨不出房间（卡门根源之一）。
		targetTile = (targetFormalPos.y << 14) | targetFormalPos.x;
	}
	const curTile = (formalCreepPos.y << 14) | formalCreepPos.x;
	priority = priority || 0;
	// 每个 creep 单独记录目标格子
	movementState.tick.cachedMoveIntents.set(creep.name, movementState.tick.creepIdx);
	movementState.tick.priorities[movementState.tick.creepIdx] = priority;
	movementState.tick.intentTiles[movementState.tick.creepIdx++] = targetTile;
	// 记录 creep 自身所在格子
	movementState.tick.intentTiles[movementState.tick.creepIdx++] = curTile;
	return OK;
}

export function registerSquad(creep1: Creep, creep2: Creep) {
	const squad1 = movementState.tick.creepToSquad.get(creep1.name);
	const squad2 = movementState.tick.creepToSquad.get(creep2.name);
	// console.log(`set ${creep1.name} ${squad1} 和 ${creep2.name} ${squad2}`);
	if (squad1) {
		if (squad2) {
			// console.log(`有两个 squad: ${squad1} 和 ${squad2}`);
			if (squad1 !== squad2) {
				// 将所有 squad2 的 creep 加入 squad1
				const squad1List = movementState.tick.squadToCreeps.get(squad1);
				const squad2List = movementState.tick.squadToCreeps.get(squad2);
				if (squad1List && squad2List) {
					for (const creepName of squad2List) {
						movementState.tick.creepToSquad.set(creepName, squad1);
						squad1List.push(creepName);
					}
				}
				movementState.tick.squadToCreeps.delete(squad2);
			}
		} else {
			// console.log(`只有 squad1: ${squad1}`);
			movementState.tick.creepToSquad.set(creep2.name, squad1);
			movementState.tick.squadToCreeps.get(squad1)?.push(creep2.name);
		}
	} else if (squad2) {
		// console.log(`只有 squad2: ${squad2}`);
		movementState.tick.creepToSquad.set(creep1.name, squad2);
		movementState.tick.squadToCreeps.get(squad2)?.push(creep1.name);
	} else {
		const squadName = movementState.tick.squadIdx++;
		movementState.tick.creepToSquad.set(creep1.name, squadName);
		movementState.tick.creepToSquad.set(creep2.name, squadName);
		movementState.tick.squadToCreeps.set(squadName, [creep1.name, creep2.name]);
		// console.log(`新建 squad: ${squadName}`);
	}
}

/**
 * 在当前小队的前方是否有其他未绕路小队
 */
export function checkSquadTarget(creepPosArray: WorldPos[], leaderPos: WorldPos, leaderNextPos: PosLike) {
	const formalPos = formalize(leaderNextPos);
	for (const pos of creepPosArray) {
		const x = formalPos.x + pos.x - leaderPos.x;
		const y = formalPos.y + pos.y - leaderPos.y;
		const tile = (y << 14) | x;
		const creepName = movementState.tick.checkedTiles.get(tile);
		// rerouteSquad 存的是 creep 名: 该格上的爬属于某小队且未被标记重路由时视为占用
		if (creepName !== undefined && movementState.tick.creepToSquad.has(creepName) && !movementState.tick.rerouteSquad.has(creepName)) {
			return true;
		}
	}
	return false;
}

/**
 * 这里检查格子时，遇到新的 creep 只会将其视为单人，不会考虑是否属于小队
 *
 * @param {number[]} tileList 格子的世界坐标（一个整数表示）
 */
export function defaultCheckTile(tileList: number[]): MoveMatchSingleEntry[] {
	const moveIntents: MoveMatchSingleEntry[] = [];
	for (let tile of tileList) {
		// 从解算算法回来的 tile 都是本 tick 格子
		let pos = tile2Pos(tile); // 此处 pos 是本 tick 对应的格子
		if (!movementState.tick.checkedTiles.has(tile)) {
			// 只检查未检查过的格子
			const roomName = pos.roomName;
			const room = Game.rooms[roomName];
			if (!room) {
				movementState.tick.checkedTiles.set(tile, "");
				continue;
			}
			// 只能把自己的 creep 作为新 start
			let creep = room.lookForAt("creep", pos.x, pos.y).filter((c) => c.my)[0];
			if (!creep) {
				// 没有普通 creep，看看 pc
				creep = room.lookForAt("powerCreep", pos.x, pos.y).filter((c) => c.my)[0] as unknown as Creep | undefined;
				if (!creep) {
					// 也没有 pc，无需处理这个格子
					movementState.tick.checkedTiles.set(tile, "");
					continue;
				}
			}
			movementState.tick.checkedTiles.set(tile, creep.name); // 这个 tile 是 creep 当前 tick 位置
			const intent = [];
			const px = pos.x;
			const py = pos.y;
			if (creep.fatigue || !hasActiveBodypart(creep.body, MOVE)) {
				// 走不动，又没有被人为 pull
				intent.push({
					// 送入解算的 tile 是 creep 当前 tick 位置
					target: tile,
					score: movementConstants.activeMoveScore,
				});
			} else {
				// 检查这个 creep 周围8个格子，允许它被推走
				intent.push({
					target: tile, // 这个 tile 是 creep 当前 tick 位置
					score: 0,
				});

				const terrain = creep.room.getTerrain().getRawBuffer();
				if (!(roomName in movementState.cache.costMatrixCache)) {
					generateCostMatrix(room);
				}
				const roomCost = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
				const CostMatrix = roomCost["false"];
				const edgeArray = roomCost["edgeArray"]; // edgeArray 保证了只检查同一房间的格子，不会遍历到跨房
				const startIdx = (py * 50 + px) << 3;
				for (let idx = startIdx; idx < startIdx + 8; idx++) {
					const v = edgeArray?.[idx];
					if (v === 0) {
						break;
					}
					if (v === undefined || !CostMatrix) {
						break;
					}
					const x = v % 50;
					const y = (v / 50) | 0;
					const cost = CostMatrix.get(x, y);
					if (cost === 255) {
						continue;
					}
					const adjPos = new RoomPosition(x, y, roomName);
					let score = movementConstants.passiveMoveScore;
					if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {
						// 没造路的 swamp，开销较大
						score += movementConstants.passiveMoveScore << 2;
					}
					if (!movementState.config.isWorkTile(creep, adjPos)) {
						score += movementConstants.badMoveScore;
					}
					const formalPos = formalize(adjPos);
					intent.push({
						target: (formalPos.y << 14) | formalPos.x,
						score,
					});
				}
			}

			moveIntents.push({
				start: creep.name,
				isSuper: false,
				targetList: intent,
			});
		}
	}

	// console.log(`defaultCheckTile moveIntents: ${JSON.stringify(moveIntents.map(intent => intent.start))}`);
	return moveIntents;
}

export function hasMoveIntent(creep: { name?: string } | undefined | null) {
	if (!creep || !creep.name) return false;
	return movementState.tick.cachedMoveIntents.has(creep.name);
}

/**
 * 两只 creep 本 tick 是否「正面对穿」：互为对方移动意图的目标格。
 *
 * 引擎不允许两只 creep 在同一 tick 交换位置，所以这种队形到 tick 末结算时两边都走不动。
 * 这是「谁挡着谁」最直接的判据——比任何几何推算都可靠。
 * 外矿搬运接力用它认接头对象：并排同行、同向超越、反向相遇都天然不成立，不需要额外排除。
 *
 * 两侧都必须**本 tick 已经登记过**移动意图才算数（只见过一面不构成对穿）；
 * 索引 0 是 endTickResolve 用过的「已消费」标记，按无意图处理。
 *
 * @param {{name: string}} a
 * @param {{name: string}} b
 * @returns {boolean}
 */
export function isSwapIntent(a: { name?: string } | undefined | null, b: { name?: string } | undefined | null) {
	if (!a || !b || !a.name || !b.name || a.name === b.name) return false;
	const ia = movementState.tick.cachedMoveIntents.get(a.name);
	const ib = movementState.tick.cachedMoveIntents.get(b.name);
	if (!ia || !ib) return false;
	// IntentTiles[idx] = 目标格，IntentTiles[idx + 1] = creep 自己脚下的格子
	return movementState.tick.intentTiles[ia] === movementState.tick.intentTiles[ib + 1] && movementState.tick.intentTiles[ib] === movementState.tick.intentTiles[ia + 1];
}

/**
 * 取 creep 本 tick 移动意图的「步进向量」：{dx, dy} = 意图目标格 − 当前格（世界坐标差）。
 *
 * BetterMove 是唯一知道每只 creep 本 tick 打算踏进哪一格的地方，
 * 涉及「将要怎么走」的判定（如外矿搬运接力的平行擦肩）都从这里取，不要自己再推算几何。
 *
 * 两侧取的是同一坐标系（formalize 之后的世界坐标），同一房间内的两只 creep
 * 步进向量可以直接比较。无意图（或索引 0 的「已消费」标记）返回 null。
 *
 * @param {{name: string}} creep
 * @returns {{dx: number, dy: number} | null}
 */
export function getMoveIntentStep(creep: { name?: string } | undefined | null) {
	if (!creep || !creep.name) return null;
	const intentIdx = movementState.tick.cachedMoveIntents.get(creep.name);
	if (!intentIdx) return null;
	const targetTile = movementState.tick.intentTiles[intentIdx];
	const curTile = movementState.tick.intentTiles[intentIdx + 1];
	return {
		dx: (targetTile! & 0x3fff) - (curTile! & 0x3fff),
		dy: (targetTile! >> 14) - (curTile! >> 14),
	};
}

/**
 * 取消指定 creep 本 tick 已登记的移动意图（不含 squad 关系与其他 order）。
 *
 * 使用场景：tick 中途发生"角色/状态交换"（如外矿搬运接力交换双方 memory）后，
 * 交换前按旧目标登记的移动意图不应再参与 endTickResolve，
 * 否则旧方向移动会在 tick 末照常执行、导致双方互相穿过后位置关系颠倒。
 *
 * 与 cancelOrder 的区别：不调用原生 cancelOrder，因此不会误删
 * 本 tick 已成功下达的其他意图（例如接力中的 transfer）。
 *
 * @param {Creep | PowerCreep | {name: string, pos: RoomPosition}} creep
 * @returns {boolean} 是否确实清掉了一个待结算意图
 */
export function cancelMoveIntent(creep: { name?: string; pos?: RoomPosition } | undefined | null) {
	if (!creep || !creep.name || !creep.pos) return false;
	const formalCreepPos = formalize(creep.pos);
	const curTile = (formalCreepPos.y << 14) | formalCreepPos.x;
	movementState.tick.checkedTiles.delete(curTile);
	return movementState.tick.cachedMoveIntents.delete(creep.name);
}

export function squadStepToPos(
	leaderNextPos: PosLike,
	squad: Creep[],
	leader: Creep,
	creepPosArray: WorldPos[],
	leaderPos: WorldPos,
	someOneTired: boolean,
	creepCache: CreepMoveCache,
) {
	const formalPos = formalize(leaderNextPos);
	const targets = [];
	for (let i = 0; i < squad.length; i++) {
		let xdiff = (creepPosArray[i]?.x ?? leaderPos.x) - leaderPos.x;
		if (xdiff === -2) {
			// 如果小队被出口隔开
			if (leader.pos.x === 1) {
				// 如果是需要等待跳房的情况
				if (formalPos.x > leaderPos.x) {
					//console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
					squadMove(squad);
					return OK;
				}
			} else if (leaderNextPos.x === 49 && leader.pos.x === 0) {
				// 如果是需要等待跳房的情况
				xdiff = -1;
			}
		} else if (
			xdiff === -1 &&
			((leader.pos.x === 1 && formalPos.x < leaderPos.x) ||
				(leader.pos.x === 49 && formalPos.x > leaderPos.x))
		) {
			// 需要等待跳房的情况
			//console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
			squadMove(squad);
			return OK;
		}
		let ydiff = (creepPosArray[i]?.y ?? leaderPos.y) - leaderPos.y;
		if (ydiff === -2) {
			// 如果小队被出口隔开
			if (leader.pos.y === 1) {
				// 如果是需要等待跳房的情况
				if (formalPos.y > leaderPos.y) {
					//console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
					squadMove(squad);
					return OK;
				}
			} else if (leaderNextPos.y === 49 && leader.pos.y === 0) {
				// 如果是需要等待跳房的情况
				ydiff = -1;
			}
		} else if (
			ydiff === -1 &&
			((leader.pos.y === 1 && formalPos.y < leaderPos.y) ||
				(leader.pos.y === 49 && formalPos.y > leaderPos.y))
		) {
			// 需要等待跳房的情况
			//console.log(`等跳房 leaderNextPos ${JSON.stringify(leaderNextPos)}`);
			squadMove(squad);
			return OK;
		}

		const px = formalPos.x + xdiff;
		const py = formalPos.y + ydiff;
		targets.push(tile2Pos((py << 14) | px));
	}
	if (someOneTired) {
		for (let i = 0; i < squad.length; i++) {
			const creep = squad[i];
			if (!creep) continue;
			if (creep.fatigue) {
				// 如果这个 creep 有疲劳，看他移动目标位置上有没有队友能拉它
				const target = targets[i];
				const targetPos = formalize(target ?? creep.pos);
				for (let j = 0; j < squad.length; j++) {
					// 遍历队友
					const creep2 = squad[j];
					if (!creep2) continue;
					const creepPos = formalize(creep2.pos);
					if (creepPos.x === targetPos.x && creepPos.y === targetPos.y) {
						// 位置相同
						if (creep2.name == creep.name) {
							// 如果目标位置就是当前位置，不处理
							break;
						}
						if (creep2.fatigue) {
							// 队友也有疲劳
							creepCache.idx--;
							squadMove(squad);
							return ERR_TIRED;
						}
						creep2.pull(creep); // 队友拉一把
						break;
					}
				}
			}
		}
	}
	squadMove(squad, targets);
	return OK;
}

/**
 * target === undefined 表示注册小队，允许被推动
 *
 * @param {Creep[]} squad 只允许 2~9 个 creep 为一队
 * @param {SquadMoveTarget | undefined} target 若非 undefined，数量必须和小队 creep 数一致
 */
export function squadMove(squad: Creep[], target?: PosLike[]) {
	// console.log(`squadMove: [${squad.map(creep => creep.name).join(', ')}], target: ${JSON.stringify(target)}`);
	if (squad.length <= 1 || squad.length > 9 || (target && target.length !== squad.length)) {
		return ERR_INVALID_ARGS;
	}
	if (target) {
		// 如果是真要移动
		registerMoveIntent(squad[0]!, (target[0] as { pos?: PosLike }).pos || target[0]!);
		for (let i = squad.length; --i;) {
			registerMoveIntent(squad[i]!, (target[i] as { pos?: PosLike }).pos || target[i]!);
			registerSquad(squad[0]!, squad[i]!);
		}
	} else {
		// 否则仅注册小队，不可被推动
		registerMoveIntent(squad[0]!, 0);
		for (let i = squad.length; --i;) {
			registerMoveIntent(squad[i]!, 0);
			registerSquad(squad[0]!, squad[i]!);
		}
	}
	return OK;
}
