/**
 * AgentSystem 远程采集族 (api/06): 跨房 harvest/carry、驻点矿工、容器选点与接力交接。
 */
import type { TickContext } from "@/core";
import type { CreepSummary, RoomObservation } from "@/core/world";
import type { ActionBroker } from "@/modules/agents/actionBroker";
import type { NexusTask } from "@/core/store/taskSchema";
import { relayHandoffAllowed, type RelayCreepView } from "@/utils/carryRelay";
import { RELAY_CONFIG, REMOTE_CARRY_CONFIG } from "@/config/economy";
import { dist } from "@/modules/agents/agentLogistics";
import type { TaskBoard } from "@/modules/tasks";
import { roomModeProfileFor } from "@/modules/strategy";
import { UNIT_CODES } from "@/constant/UnitConstant";

export function runRemoteHarvest(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
): void {
	const targetRoom = task.targetPos?.roomName;
	if (!targetRoom) return;

	// 驻点矿工档 (批次 AD, 上游 remoteMiner 口径): auto 档 (rush) 的远程矿工
	// 恒驻源边 drop 采矿, 回运全交专职 hauler; manual 档 (main 系) 维持自回运。
	const stationary =
		roomModeProfileFor(ctx, task.roomName).remoteMining === "auto" &&
		creep.unitCode === UNIT_CODES.remoteMiner;

	if (stationary) {
		runStationaryRemoteMiner(ctx, broker, creep, task, targetRoom);
		return;
	}

	// 满载且在目标房: 优先卸源旁容器 (W1-2 carrier 链, 驻点化零往返);
	// 无容器再走自回运兜底 (远程容器由本矿 carrier 跨房 carry 接力)
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0 && creep.roomName === targetRoom) {
		const remoteRoom = Game.rooms[targetRoom];
		const source = remoteRoom
			? (Game.getObjectById(task.targetId ?? "") as Source | null)
			: null;
		const container =
			source && remoteRoom
				? remoteRoom
						.find(FIND_STRUCTURES, {
							filter: (s): s is StructureContainer =>
								s.structureType === STRUCTURE_CONTAINER &&
								s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange) &&
								s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
						})
						.find((c) => dist(creep.x, creep.y, c.pos.x, c.pos.y) <= 1)
				: undefined;
		if (container) {
			broker.submit({
				id: `${creep.name}-rcd-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "transfer",
				targetId: container.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
			return;
		}
		// 无成品容器但有自家工地 (W2 建设期): 满载去工地浇筑, 不走自回运——
		// 回运一趟 2×路程 tick, 容器不落地 carry 链永远不开
		const liveRoomFull = Game.rooms[targetRoom];
		const ownSiteFull = liveRoomFull
			? liveRoomFull.find(FIND_CONSTRUCTION_SITES, {
					filter: (s) =>
						s.structureType === STRUCTURE_CONTAINER &&
						Math.max(Math.abs(s.pos.x - (task.targetPos?.x ?? 0)), Math.abs(s.pos.y - (task.targetPos?.y ?? 0))) <= REMOTE_CARRY_CONFIG.containerRange + 1,
				})[0]
			: undefined;
		if (ownSiteFull && creep.bodyWork > 0) {
			broker.submit({
				id: `${creep.name}-rhb2-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "build",
				targetId: ownSiteFull.id,
				priority: task.priority,
				pipeline: "work",
				dedupeKey: `${creep.name}:work:${task.id}`,
			});
			return;
		}
	}

	// 满载且不在本矿 → 走回本矿
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0 && creep.roomName !== task.roomName) {
		broker.submit({
			id: `${creep.name}-ret-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "move",
			targetPos: { x: 25, y: 25, roomName: task.roomName },
			priority: task.priority,
			pipeline: "move",
			reason: "return-home",
			dedupeKey: `${creep.name}:move:${task.id}`,
		});
		return;
	}

	// 满载且在本矿 → 卸到 cc (升级线优先) / spawn-ext
	if (creep.carryEnergy > 0 && creep.roomName === task.roomName) {
		const dest = remoteDropoffFor(ctx, task.roomName);
		if (dest) {
			const live = Game.getObjectById(dest.id as Id<AnyStoreStructure>);
			// 距离预判 (bugs/P1-18 断点⑥): 卸货点不在脚边时先走过去——
			// 直接 transfer 只会每 tick ERR_NOT_IN_RANGE, 爬原地罚站到租约耗尽
			if (live && dist(creep.x, creep.y, live.pos.x, live.pos.y) > 1) {
				broker.submit({
					id: `${creep.name}-del-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: { x: live.pos.x, y: live.pos.y, roomName: task.roomName },
					priority: task.priority,
					pipeline: "move",
					reason: "remote-dropoff",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			broker.submit({
				id: `${creep.name}-del-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "transfer",
				targetId: dest.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
		}
		return;
	}

	// 未满载且在目标房 → 采集
	if (creep.roomName === targetRoom) {
		const remoteRoom = Game.rooms[targetRoom];
		const source = remoteRoom ? (Game.getObjectById(task.targetId ?? "") as Source | null) : null;
		if (source) {
			// 远程基建 (W2): 源旁无容器且无在建 → 就地放站; 兼职建造——
			// 容器是 carrier 回运链的开关 (W1-2), 无容器期采集掉落堆满地腐烂。
			// 门控: 非己方房且 (无 controller 或无主) 才动工——有主之地禁建
			const liveRoom = Game.rooms[targetRoom];
			const remoteCtrl = liveRoom?.controller;
			const buildableRemote =
				liveRoom !== undefined && !remoteCtrl?.my && (remoteCtrl === undefined || !remoteCtrl.owner);
			if (buildableRemote) {
				const existing = liveRoom.find(FIND_STRUCTURES, {
					filter: (s): s is StructureContainer =>
						s.structureType === STRUCTURE_CONTAINER &&
						s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange),
				});
				const site = liveRoom.find(FIND_CONSTRUCTION_SITES, {
					filter: (s) => s.structureType === STRUCTURE_CONTAINER,
				});
				if (existing.length === 0 && site.length === 0 && creep.bodyWork > 0) {
					// 站点位置: 采集工位即容器位 (驻点采集本就贴源), 找源旁一格空地
					const spot = pickRemoteContainerSpot(liveRoom, source);
					if (spot) {
						broker.submit({
							id: `${creep.name}-rcs-${ctx.tick}`,
							tick: ctx.tick,
							taskId: task.id,
							actorName: liveRoom.name,
							kind: "createSite",
							targetPos: { x: spot.x, y: spot.y, roomName: targetRoom },
							payload: { structureType: STRUCTURE_CONTAINER },
							priority: 40,
							pipeline: "construction",
							dedupeKey: `remote-container:${targetRoom}:${spot.x}:${spot.y}`,
						});
					}
				}
			}
			const d = Math.max(Math.abs(creep.x - source.pos.x), Math.abs(creep.y - source.pos.y));
			if (d <= 1) {
				// 兼职建造 (W2): 工地贴源且身上有货 → 先 build (采集间隙推进容器)。
				// 射程用原生 build 上限 3: 容器位与矿工工位可能分居源两侧 (切比雪夫 2),
				// 收紧到 1 会让站点永远无人建造直到衰亡重放
				const buildTarget = liveRoom
					? liveRoom.find(FIND_CONSTRUCTION_SITES, {
							filter: (s) =>
								s.structureType === STRUCTURE_CONTAINER &&
								Math.max(Math.abs(s.pos.x - source.pos.x), Math.abs(s.pos.y - source.pos.y)) <= REMOTE_CARRY_CONFIG.containerRange,
						})[0]
					: undefined;
				if (buildTarget && creep.carryEnergy > 0 && dist(creep.x, creep.y, buildTarget.pos.x, buildTarget.pos.y) <= 3) {
					broker.submit({
						id: `${creep.name}-rhb-${ctx.tick}`,
						tick: ctx.tick,
						taskId: task.id,
						actorName: creep.name,
						kind: "build",
						targetId: buildTarget.id,
						priority: task.priority,
						pipeline: "work",
						dedupeKey: `${creep.name}:work:${task.id}`,
					});
					return;
				}
				// 容器维修 (W2): 成品容器耐久低于阈值即修——不修则 decay 拆链,
				// carry 回运的取料点周期性消失 (sim 实证 cont 周期性归零重放)
				const wornContainer = liveRoom
					? liveRoom.find(FIND_STRUCTURES, {
							filter: (s): s is StructureContainer =>
								s.structureType === STRUCTURE_CONTAINER &&
								s.hits < s.hitsMax * REMOTE_CARRY_CONFIG.repairRatio &&
								s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange + 1),
						})[0]
					: undefined;
				if (wornContainer && creep.carryEnergy > 0) {
					broker.submit({
						id: `${creep.name}-rhr-${ctx.tick}`,
						tick: ctx.tick,
						taskId: task.id,
						actorName: creep.name,
						kind: "repair",
						targetId: wornContainer.id,
						priority: task.priority,
						pipeline: "work",
						dedupeKey: `${creep.name}:work:${task.id}`,
					});
					return;
				}
				broker.submit({
					id: `${creep.name}-hv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "harvest",
					targetId: source.id,
					priority: task.priority,
					pipeline: "work",
					dedupeKey: `${creep.name}:work:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-m-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: { x: source.pos.x, y: source.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "remote-source",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
		}
		return;
	}

	// 未满载且不在目标房 → 走到目标房
	broker.submit({
		id: `${creep.name}-go-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "move",
		targetPos: { x: task.targetPos?.x ?? 25, y: task.targetPos?.y ?? 25, roomName: targetRoom },
		priority: task.priority,
		pipeline: "move",
		reason: "remote-room",
		dedupeKey: `${creep.name}:move:${task.id}`,
	});
}

/**
 * 驻点远程矿工 (批次 AD, 上游 miner 行为逐位):
 * - 贴源 harvest (恒驻, 无往返);
 * - 满仓: 邻格 hauler (carry 型 creep) 在场 → transfer; 否则 drop 成堆
 *   (上游 mxfer=0 口径: 矿工不等 hauler, 堆给 hauler pickup);
 * - 容器: 仅 RCL ≥ minerBoxRcl (上游 9, 40k 窗口外) 才建——窗口内纯
 *   drop 堆 + hauler, 零基建, 省下的 builder 工全在矿上。
 */
function runStationaryRemoteMiner(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
	targetRoom: string,
): void {
	const liveRoom = Game.rooms[targetRoom];
	// 占位任务 (无 targetId): 到房获视野后自认空闲源 (无 creep 贴身的),
	// 注册表/任务由 ensureRemoteSourceIntel + 有视野分支下拍修正
	const source = liveRoom
		? ((Game.getObjectById(task.targetId ?? "") as Source | null) ??
			liveRoom
				.find(FIND_SOURCES)
				.filter((s) => liveRoom.lookForAtArea(LOOK_CREEPS, s.pos.y - 1, s.pos.x - 1, s.pos.y + 1, s.pos.x + 1, true)
					.filter((r) => r.creep && r.creep.my && r.creep.name !== creep.name && r.creep.memory.taskId === task.id)
					.length === 0)[0] ?? null)
		: null;
	if (!source) {
		broker.submit({
			id: `${creep.name}-go-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "move",
			targetPos: { x: task.targetPos?.x ?? 25, y: task.targetPos?.y ?? 25, roomName: targetRoom },
			priority: task.priority,
			pipeline: "move",
			reason: "remote-room",
			dedupeKey: `${creep.name}:move:${task.id}`,
		});
		return;
	}
	const d = Math.max(Math.abs(creep.x - source.pos.x), Math.abs(creep.y - source.pos.y));
	if (d > 1) {
		broker.submit({
			id: `${creep.name}-m-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "move",
			targetPos: { x: source.pos.x, y: source.pos.y, roomName: targetRoom },
			priority: task.priority,
			pipeline: "move",
			reason: "remote-source",
			dedupeKey: `${creep.name}:move:${task.id}`,
		});
		return;
	}
	// 满仓交接: 邻格 hauler 优先 (零损耗), 否则 drop (上游满仓即弃口径)
	if (creep.freeCapacity === 0 && creep.carryEnergy > 0) {
		const live = ctx.world.current;
		const hauler = live
			? Object.values(live.rooms[targetRoom]?.creeps ?? {}).find(
					(c) =>
						c.name !== creep.name &&
						(c.unitCode === UNIT_CODES.carrier || c.unitCode === UNIT_CODES.universal) &&
						c.freeCapacity > 0 &&
						Math.max(Math.abs(c.x - creep.x), Math.abs(c.y - creep.y)) <= 1,
				)
			: undefined;
		if (hauler) {
			broker.submit({
				id: `${creep.name}-rx-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "transfer",
				targetId: hauler.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
			return;
		}
		broker.submit({
			id: `${creep.name}-rd-${ctx.tick}`,
			tick: ctx.tick,
			taskId: task.id,
			actorName: creep.name,
			kind: "drop",
			targetPos: { x: creep.x, y: creep.y, roomName: targetRoom },
			resourceType: "energy",
			priority: task.priority,
			pipeline: "carry",
			dedupeKey: `${creep.name}:drop:${task.id}`,
		});
		return;
	}
	broker.submit({
		id: `${creep.name}-hv-${ctx.tick}`,
		tick: ctx.tick,
		taskId: task.id,
		actorName: creep.name,
		kind: "harvest",
		targetId: source.id,
		priority: task.priority,
		pipeline: "work",
		dedupeKey: `${creep.name}:work:${task.id}`,
	});
}

function room_energyStructures_findSpawn(ctx: TickContext) {
	const world = ctx.world.current;
	if (!world) return undefined;
	for (const room of Object.values(world.rooms)) {
		const spawn = room.energyStructures.find((s) => s.structureType === "spawn" && s.energy < s.energyCapacity);
		if (spawn) return spawn;
	}
	return undefined;
}

/**
 * 远程采集件在本矿的卸货地: 优先 cc (升级线是外矿冲级收入的最终去处,
 * 直灌孵化线会把 cc 抽干——bugs (十二) 实证 control −82%), spawn/ext 次之。
 */
/** 远程容器选址: 源旁一格非墙空地 (无结构/工地), 确定性序 (dx/dy 升序) */
function pickRemoteContainerSpot(
	room: Room,
	source: Source,
): { x: number; y: number } | undefined {
	const terrain = room.getTerrain();
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			if (dx === 0 && dy === 0) continue;
			const x = source.pos.x + dx;
			const y = source.pos.y + dy;
			if (x < 1 || x > 48 || y < 1 || y > 48) continue;
			if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) continue;
			if (room.lookForAt(LOOK_STRUCTURES, x, y).length > 0) continue;
			if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
			return { x, y };
		}
	}
	return undefined;
}

/**
 * 跨房 carry (W1-2 远程容器回运): fetch 腿在容器房 (withdraw 装满),
 * deliver 腿回本矿卸货点 (remoteDropoffFor)——与 runRemoteHarvest 的
 * 自回运兜底同构, 但由专职 carrier 承担, 5W 矿工驻源不出场。
 */
export function runRemoteCarry(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	task: NexusTask,
): void {
	const live = Game.creeps[creep.name];
	// deliver 态: 有货即回本矿卸 (空载才回 fetch)
	if (live?.memory.mode === "deliver") {
		if (creep.carryEnergy === 0) {
			live.memory.mode = "fetch";
		} else {
			const dest = remoteDropoffFor(ctx, task.roomName);
			const destLive = dest
				? (Game.getObjectById(dest.id as Id<AnyStoreStructure>)?.pos ?? null)
				: null;
			if (dest && destLive && dist(creep.x, creep.y, destLive.x, destLive.y) <= 1 && creep.roomName === task.roomName) {
				broker.submit({
					id: `${creep.name}-rhd-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "transfer",
					targetId: dest.id,
					resourceType: "energy",
					priority: task.priority,
					pipeline: "carry",
					dedupeKey: `${creep.name}:carry:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-rhg-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move",
					targetPos: destLive
						? { x: destLive.x, y: destLive.y, roomName: task.roomName }
						: { x: 25, y: 25, roomName: task.roomName },
					priority: task.priority,
					pipeline: "move",
					reason: "carry-deliver",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
			return;
		}
	}
	// fetch 态: 满载切 deliver; 未满去容器取
	if (creep.carryEnergy > 0 && creep.freeCapacity === 0) {
		if (live) live.memory.mode = "deliver";
		return;
	}
	// 取料点可能是容器 (稳态) 或掉落堆 (矿工 drop 期): 掉落堆按 amount, 容器按 store
	const target = Game.getObjectById(task.targetId ?? "") as StructureContainer | Resource | null;
	const targetEnergy =
		target === null ? 0 : "store" in target ? target.store.energy : target.amount;
	if (target !== null && targetEnergy > 0) {
		const isDrop = !("store" in target);
		if (creep.roomName === target.pos.roomName && dist(creep.x, creep.y, target.pos.x, target.pos.y) <= 1) {
			broker.submit({
				id: `${creep.name}-rhf-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: isDrop ? "pickup" : "withdraw",
				targetId: target.id,
				resourceType: "energy",
				priority: task.priority,
				pipeline: "carry",
				dedupeKey: `${creep.name}:carry:${task.id}`,
			});
		} else {
			broker.submit({
				id: `${creep.name}-rhm-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "move",
				targetPos: { x: target.pos.x, y: target.pos.y, roomName: target.pos.roomName },
				priority: task.priority,
				pipeline: "move",
				reason: "carry-fetch",
				dedupeKey: `${creep.name}:move:${task.id}`,
			});
		}
		return;
	}
	// 容器空/消失: 任务由 planner 存量门自然回收, 空载待命避免空跑
}

function remoteDropoffFor(ctx: TickContext, roomName: string): { id: string } | undefined {
	const room = ctx.world.current?.rooms[roomName];
	if (!room) return room_energyStructures_findSpawn(ctx);
	const buffer = room.controllerBuffer;
	const bufferStore = buffer
		? room.stores.find(
				(s) => s.id === buffer.id && s.structureType === "container" && s.energy < s.energyCapacity,
			)
		: undefined;
	if (bufferStore) return bufferStore;
	const spawnish = room.energyStructures.find((s) => s.energy < s.energyCapacity);
	return spawnish ?? room_energyStructures_findSpawn(ctx);
}

/**
 * 接力搬运交接 (specs/接力搬运): 满载供方与空载受方在通道上相向对穿时
 * 同 Tick 整仓移交——判据纯函数在 utils/carryRelay, 意图格为朝任务锚点的几何步进。
 * 任务随货走: 受方承接供方的交付任务租约、供方转回受方的取货任务;
 * 交接 transfer 不带 taskId (broker 免租约校验, 快递 lease-lost 教训不重演)。
 * 返回交接后的两个 (creep, task) 对, 调用方同 Tick 重跑双方行为; 未命中返回 null。
 */
export function tryRelayHandoff(
	ctx: TickContext,
	broker: ActionBroker,
	board: TaskBoard,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
	processed: Set<string>,
): { supplierName: string; receiverName: string } | null {
	if ((room.rcl ?? 0) >= RELAY_CONFIG.maxRcl) {
		return null;
	}
	if (creep.unitCode !== UNIT_CODES.carrier || creep.spawning) {
		return null;
	}
	const liveSelf = Game.creeps[creep.name];
	if (!liveSelf) {
		return null;
	}
	const selfMode = liveSelf.memory.mode;
	// 供方相位: 满载交付中; 锚点 = 交付目的地
	const selfSupplying =
		selfMode === "deliver" && creep.carryEnergy > 0 && creep.freeCapacity === 0;
	const selfAnchor = selfSupplying ? (task.destPos ?? task.targetPos) : task.targetPos;
	// 受方相位要求 carry 取货 (fill_spawn 取货无确定锚点, 不参与)
	if (!selfSupplying && task.kind !== "carry") {
		return null;
	}
	const relayedSelf = liveSelf.memory.relayedTick === ctx.tick;
	const selfView: RelayCreepView = {
		x: creep.x,
		y: creep.y,
		supplying: selfSupplying,
		bodyCarry: creep.bodyCarry,
		ticksToLive: creep.ticksToLive,
		relayedThisTick: relayedSelf,
		anchor: selfAnchor ? { x: selfAnchor.x, y: selfAnchor.y } : undefined,
	};
	for (const other of room.creeps) {
		if (other.name === creep.name || processed.has(other.name)) {
			continue;
		}
		if (other.unitCode !== UNIT_CODES.carrier || other.spawning) {
			continue;
		}
		const otherLive = Game.creeps[other.name];
		const otherTaskId = otherLive?.memory.taskId;
		if (!otherLive || !otherTaskId) {
			continue;
		}
		const otherTask = board.get(otherTaskId);
		if (
			!otherTask ||
			otherTask.assignedTo !== other.name ||
			(otherTask.kind !== "carry" && otherTask.kind !== "fill_spawn")
		) {
			continue;
		}
		const otherMode = otherLive.memory.mode;
		const otherSupplying =
			otherMode === "deliver" && other.carryEnergy > 0 && other.freeCapacity === 0;
		// 相位必须相反: 供方=满载交付, 受方=空载取货 (carry)
		if (selfSupplying === otherSupplying) {
			continue;
		}
		if (!otherSupplying && otherTask.kind !== "carry") {
			continue;
		}
		const otherAnchor = otherSupplying
			? (otherTask.destPos ?? otherTask.targetPos)
			: otherTask.targetPos;
		const otherView: RelayCreepView = {
			x: other.x,
			y: other.y,
			supplying: otherSupplying,
			bodyCarry: other.bodyCarry,
			ticksToLive: other.ticksToLive,
			relayedThisTick: otherLive.memory.relayedTick === ctx.tick,
			anchor: otherAnchor ? { x: otherAnchor.x, y: otherAnchor.y } : undefined,
		};
		const supplier = selfSupplying ? selfView : otherView;
		const receiver = selfSupplying ? otherView : selfView;
		if (!relayHandoffAllowed(supplier, receiver, RELAY_CONFIG.minSupplierTtl)) {
			continue;
		}
		const supplierName = supplier === selfView ? creep.name : other.name;
		const receiverName = supplier === selfView ? other.name : creep.name;
		const supplierTask = supplier === selfView ? task : otherTask;
		const receiverTask = supplier === selfView ? otherTask : task;
		// 整仓移交 (不带 taskId, broker 免租约校验)
		broker.submit({
			id: `${supplierName}-relay-${ctx.tick}`,
			tick: ctx.tick,
			actorName: supplierName,
			kind: "transfer",
			targetId: receiverName,
			resourceType: RESOURCE_ENERGY,
			priority: supplierTask.priority,
			pipeline: "carry",
			dedupeKey: `${supplierName}:relay:${ctx.tick}`,
		});
		// 任务随货走: 受方承接交付任务, 供方转回取货任务; 同 Tick 防重入标记
		const supplierLive = Game.creeps[supplierName];
		const receiverLive = Game.creeps[receiverName];
		if (!supplierLive || !receiverLive) {
			return null;
		}
		supplierTask.assignedTo = receiverName;
		receiverTask.assignedTo = supplierName;
		supplierTask.updatedAt = ctx.tick;
		receiverTask.updatedAt = ctx.tick;
		receiverLive.memory.taskId = supplierTask.id;
		supplierLive.memory.taskId = receiverTask.id;
		receiverLive.memory.mode = "deliver";
		supplierLive.memory.mode = "fetch";
		supplierLive.memory.relayedTick = ctx.tick;
		receiverLive.memory.relayedTick = ctx.tick;
		return { supplierName, receiverName };
	}
	return null;
}

/** 无任务待派限频诊断 (exec() 双轨退役后): 同名单位每 500 tick 提示一次 */
