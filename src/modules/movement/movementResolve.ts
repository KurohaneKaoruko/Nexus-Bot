/**
 * movement resolve module: 本 tick 移动意图的统一结算 (endTickResolve)。
 * 从 movementTraffic.ts 拆出 (legacy-consolidation-b 4.2 行限), 逻辑零改动。
 */
import { movementConstants, movementState } from "./movementState";
import type { RoomCostEntry } from "./movementState";
import { formalize, getDirection, tile2Pos } from "./movementGeometry";
import moveMatch from "./moveMatch";
import type { MoveMatchEntry, MoveMatchTargetScore } from "./moveMatch";
import { defaultCheckTile } from "./movementIntentSquad";

export function endTickResolve(userIsWorkTile: ((creep: Creep, pos: RoomPosition) => boolean) | undefined) {
	const resolveStart = Game.cpu.getUsed();

	if (userIsWorkTile && typeof userIsWorkTile === "function") {
		movementState.config.isWorkTile = userIsWorkTile;
	} else {
		movementState.config.isWorkTile = movementConstants.defaultIsWorkTile;
	}

	const moveIntents: MoveMatchEntry[] = [];
	const creepAtSquadTarget: string[] = [];

	// 先组装 squad 移动意图
	let noMove = false;
	for (const [curSquadIdx, creepList] of movementState.tick.squadToCreeps) {
		const targetTiles: number[] = [];
		const curTiles: number[] = [];
		const validCreeps: string[] = [];
		noMove = false;
		for (const creepName of creepList) {
			const intentIdx = movementState.tick.cachedMoveIntents.get(creepName);
			if (intentIdx !== undefined) {
				const tile = movementState.tick.intentTiles[intentIdx] ?? 0;
				targetTiles.push(tile);
				curTiles.push(movementState.tick.intentTiles[intentIdx + 1] ?? 0);
				movementState.tick.cachedMoveIntents.set(creepName, 0);
				validCreeps.push(creepName);
				if (tile === 0) {
					noMove = true;
				} else {
					const singleCreepName = movementState.tick.checkedTiles.get(tile ?? 0);
					if (singleCreepName && !movementState.tick.creepToSquad.has(singleCreepName)) {
						creepAtSquadTarget.push(singleCreepName);
					}
				}
			}
		}
		if (targetTiles.length) {
			movementState.tick.squadToCreeps.set(curSquadIdx, validCreeps);
			if (noMove) {
				// 停在原地
				moveIntents.push({
					start: curSquadIdx,
					isSuper: true,
					targetList: [
						{
							target: curTiles,
							score: movementConstants.ultraMoveScore,
						},
					],
				});
			} else {
				moveIntents.push({
					start: curSquadIdx,
					isSuper: true,
					targetList: [
						{
							target: targetTiles,
							score: movementConstants.ultraMoveScore,
						},
						{
							target: curTiles,
							score: 0,
						},
					],
				});
			}
		}
	}

	// 再遍历所有 creep 移动 intent，保留不属于 squad 的
	for (const [creepName, intentIdx] of movementState.tick.cachedMoveIntents) {
		if (intentIdx) {
			const curTile = movementState.tick.intentTiles[intentIdx + 1] ?? 0;
			const targetTile = movementState.tick.intentTiles[intentIdx] ?? 0;
			const score = movementConstants.activeMoveScore << (movementState.tick.priorities[intentIdx] ?? 0);
			const targetList: MoveMatchTargetScore[] =
				curTile === targetTile
					? [
							{
								target: targetTile,
								score,
							},
						]
					: [
							{
								target: targetTile,
								score,
							},
							{
								target: curTile,
								score: 0,
							},
						];
			movementState.tick.nameToIntentIdx.set(creepName, moveIntents.length);
			moveIntents.push({
				start: creepName,
				isSuper: false,
				targetList,
			});
		}
	}
	// 把 squad 所在的连通片的所有 creep 允许强行推动
	let bfsIdx = 0;
	while (bfsIdx < creepAtSquadTarget.length) {
		const creepName = creepAtSquadTarget[bfsIdx++];
		if (!creepName) continue;
		const intentIdx = movementState.tick.nameToIntentIdx.get(creepName);
		const entry = intentIdx !== undefined ? moveIntents[intentIdx] : undefined;
		if (!entry || entry.isSuper) continue;
		const targetList = entry.targetList;
		if (targetList.length > 2) {
			continue;
		}

		const targetTile = targetList[0]?.target;
		if (targetTile === undefined) continue;

		let score;
		const tx = (targetTile & 0x3fff) % 50;
		const ty = (targetTile >> 14) % 50;
		const creep = Game.creeps[creepName];
		if (!creep) continue;
		const roomName = creep.room.name;
		const terrain = creep.room.getTerrain().getRawBuffer();
		const roomCost = movementState.cache.costMatrixCache[roomName] as RoomCostEntry;
		const CostMatrix = roomCost["false"];
		const edgeArray = roomCost["edgeArray"];
		if (!CostMatrix || !edgeArray) continue;
		const startIdx = (creep.pos.y * 50 + creep.pos.x) << 3;
		for (let edgeIdx = startIdx; edgeIdx < startIdx + 8; edgeIdx++) {
			const v = edgeArray[edgeIdx] ?? 0;
			if (v === 0) {
				break;
			}
			const vx = v % 50,
				vy = (v / 50) | 0;
			if (vx === tx && vy === ty) {
				continue;
			}
			const cost = CostMatrix.get(vx, vy);
			if (cost === 255) {
				// 有不可行走的建筑
				continue;
			}
			// 如果和下一步相邻，代价较小
			if (vx - tx <= 1 && tx - vx <= 1 && vy - ty <= 1 && ty - vy <= 1) {
				score = movementConstants.passiveMoveScore;
			} else {
				// 否则，代价较大
				score = movementConstants.badMoveScore;
			}
			// 如果是无路沼泽，代价较大
			if (terrain[v] === TERRAIN_MASK_SWAMP && cost !== 1) {
				score += movementConstants.passiveMoveScore << 2;
			}
			const vFormal = formalize(new RoomPosition(vx, vy, roomName));
			const target = (vFormal.y << 14) | vFormal.x;
			targetList.push({
				target,
				score,
			});
			const singleCreepName = movementState.tick.checkedTiles.get(target);
			if (singleCreepName && !movementState.tick.creepToSquad.has(singleCreepName)) {
				creepAtSquadTarget.push(singleCreepName);
			}
		}
		const singleCreepName = movementState.tick.checkedTiles.get(targetTile);
		if (singleCreepName && !movementState.tick.creepToSquad.has(singleCreepName)) {
			creepAtSquadTarget.push(singleCreepName);
		}
		const formalCreepPos = formalize(creep.pos);
		movementState.tick.checkedTiles.set((formalCreepPos.y << 14) | formalCreepPos.x, ""); // 从 checkedTiles 中删除当前位置，因为它已经被处理过了
	}
	// console.log(`creepAtSquadTarget: ${creepAtSquadTarget}`);
	// if (moveIntents.length) {
	//     for (let idx = 0; idx < moveIntents.length; idx++) {
	//         if (moveIntents[idx].isSuper) {
	//             let text = `squad moveIntents: start: ${moveIntents[idx].start}, targetList: [`;
	//             for (let target of moveIntents[idx].targetList) {
	//                 text += `{target: ${target.target.map(tile => {
	//                     const pos = tile2Pos(tile);
	//                     return `${pos}`;
	//                 })}}, score: ${target.score}}`;
	//             }
	//             text += `]`;
	//             console.log(text);
	//         } else {
	//             let text = `creep moveIntents: start: ${moveIntents[idx].start}, targetList: [`;
	//             for (let target of moveIntents[idx].targetList) {
	//                 text += `{target: ${tile2Pos(target.target)}, score: ${target.score}}`;
	//             }
	//             text += `]`;
	//             console.log(text);
	//         }
	//     }
	// }

	if (!moveIntents.length) {
		return;
	}
	// console.log(`moveIntents starts: ${moveIntents.map(intent => intent.start)}`);

	const result = moveMatch(moveIntents, defaultCheckTile);

	const allCreeps = Game.creeps;
	const allPowerCreeps = Game.powerCreeps;
	// 原始 move(direction) 指令 (绕过猴子补丁的重载解析)
	const moveByDir = movementState.proto.originMove as (this: Creep, direction: DirectionConstant) => number;
	// 单位结算: creep/powerCreep 同名二查, 出口格邻房目标跳过 (发指令会取消边界自动传送)
	const resolveUnit = (name: string, target: number): number => {
		let creep: Creep | PowerCreep | undefined = allCreeps[name];
		if (!creep) {
			creep = allPowerCreeps[name];
		}
		if (!creep) return 0;
		const creepPos = creep.pos;
		const pos = tile2Pos(target);
		if (creep.pos.isRoomEdge() && pos.roomName !== creepPos.roomName) return 0;
		if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
			// 如果 target !== start 当前所在位置才需要移动
			// creep.room.visual.line(creep.pos, pos, lineStyle[0]);
			const puller = movementState.tick.pullPair.get(name);
			const pullerCreep = puller ? Game.creeps[puller] : undefined;
			if (pullerCreep) {
				movementState.proto.originMove.call(creep as Creep, pullerCreep);
			} else {
				const dir = getDirection(creepPos, pos) as DirectionConstant;
				moveByDir.call(creep as Creep, dir);
			}
			return 1;
		}
		return 0;
	};
	let moveCount = 0;
	for (const resultEntry of result) {
		if (typeof resultEntry.start === "string") {
			// 普通 creep
			const start = resultEntry.start;
			const target = resultEntry.target as number;
			const startIdx = movementState.tick.cachedMoveIntents.get(start);
			if (!startIdx) {
				moveCount += resolveUnit(start, target);
			} else if (target !== movementState.tick.intentTiles[startIdx + 1]) {
				// 如果 target !== start 当前所在位置才需要移动
				moveCount += resolveUnit(start, target);
			}
		} else {
			const squad = movementState.tick.squadToCreeps.get(resultEntry.start);
			if (!squad) continue;
			for (let i = squad.length; i--;) {
				const creepName = squad[i];
				if (!creepName) continue;
				let creep: Creep | PowerCreep | undefined = allCreeps[creepName];
				if (!creep) {
					creep = allPowerCreeps[creepName];
				}
				if (!creep) continue;
				const creepPos = creep.pos;
				const tileList = resultEntry.target as number | number[];
				const tile = Array.isArray(tileList) ? tileList[i] : tileList;
				if (tile === undefined) continue;
				const pos = tile2Pos(tile);
				// 出口格 + 邻房目标 = 静止待传送 (发指令会取消边界自动传送)
				if (creep!.pos!.isRoomEdge!() && pos.roomName !== creepPos.roomName) continue;
				if (pos.x !== creepPos.x || pos.y !== creepPos.y) {
					// 如果 target !== start 当前所在位置才需要移动
					// if (pos.roomName === creepPos.roomName) creep.room.visual.line(creep.pos, pos, lineStyle[start % lineStyle.length]);
					// console.log(`squad ${creep.name} from ${JSON.stringify(creepPos)} move to ${JSON.stringify(pos)}: ${getDirection(creepPos, pos)}`);
					const puller = movementState.tick.pullPair.get(creep.name);
					const pullerCreep = puller ? Game.creeps[puller] : undefined;
					if (pullerCreep) {
						movementState.proto.originMove.call(creep as Creep, pullerCreep);
					} else {
						const dir = getDirection(creepPos, pos) as DirectionConstant;
						moveByDir.call(creep as Creep, dir);
					}
					moveCount++;
				}
			}
		}
	}

	const endTickStat = movementState.stats.analyzeCPU["endTickResolve"];
	if (endTickStat) {
		endTickStat.calls = (endTickStat.calls ?? 0) + 1;
		endTickStat.moveCount = (endTickStat.moveCount ?? 0) + moveCount;
		endTickStat.sum = (endTickStat.sum ?? 0) + (Game.cpu.getUsed() - resolveStart - moveCount * 0.2);
	}
}
