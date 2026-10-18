/**
 * 感知模块 (docs/nexus-design/03 §3.3 Perception/World Update):
 * 每 Tick 一次聚合房间对象为纯数据快照, 更新 Intel, 对比前后发现死亡单位与失守房间。
 * 快照挂到 TickContext.world, 下游只读快照, 不各自 room.find。
 * 结构类观测 (存储/塔/墙体/受损建筑) 共用一趟 FIND_STRUCTURES 分发, 不多扫。
 * screeps 类型与常量为全局声明 (@types/screeps 非 module)。
 */
import type { TickContext, TickModule } from "@/core";

import { REPAIR_CONFIG } from "@/config/defense";
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";
import {
	aliveNames,
	unitCodeFromName,
	type ControllerBufferSummary,
	type CreepSummary,
	type DamageableSummary,
	type RoomObservation,
	type StoreSummary,
	type TowerSummary,
	type WorldView,
} from "@/core/world";
import { unitCode } from "@/constant/UnitConstant";

/** 墙/城门类结构: 耐久无实际上限, 用绝对维护线而非 hitsMax 比例 */
const WALL_LIKE: ReadonlySet<string> = new Set(["constructedWall", "rampart"]);

/** 不阻挡站位的结构 (其余结构占格即不可站) */
const NON_BLOCKING_STRUCTURES: ReadonlySet<string> = new Set(["road", "container", "rampart"]);

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 己方单位摘要工厂 (己方房/可见外矿房共用) */
function summarizeCreep(creep: Creep, roomName: string): CreepSummary {
	const alivePart = (type: BodyPartConstant): number =>
		creep.body.filter((part) => part.type === type && part.hits > 0).length;
	// 角色判定 Memory 权威化 (任务 5.5): unit/unitCode 第一来源是 creep.memory,
	// 名称解析仅 fallback (改名/直操等场景名字可能失真; Memory 由孵化簿记写入)
	const memUnit = (creep.memory as { unit?: string; unitCode?: string } | undefined) ?? {};
	const memCode = memUnit.unitCode ?? (memUnit.unit ? unitCode(memUnit.unit) : undefined);
	return {
		name: creep.name,
		id: creep.id,
		roomName,
		unitCode: memCode ?? unitCodeFromName(creep.name),
		x: creep.pos.x,
		y: creep.pos.y,
		ticksToLive: creep.ticksToLive ?? 0,
		carryEnergy: creep.store.energy,
		freeCapacity: creep.store.getFreeCapacity(),
		spawning: creep.spawning,
		hits: creep.hits,
		hitsMax: creep.hitsMax,
		bodyWork: alivePart("work"),
		bodyCarry: alivePart("carry"),
		bodyMove: alivePart("move"),
		bodyClaim: alivePart("claim"),
		bodyAttack: alivePart("attack"),
		bodyRanged: alivePart("ranged_attack"),
		bodyHeal: alivePart("heal"),
		bodyTough: alivePart("tough"),
	};
}

/**
 * 控制器缓冲观测 (specs/controller-upgrade-buffer): 采纳范围内容器为 cc,
 * 工位 = cc 相邻 ∩ 控制器升级射程 ∩ 可站位 (地形非墙且无阻挡结构), 固定顺序输出。
 */
function observeControllerBuffer(
	room: Room,
	controller: StructureController,
	stores: StoreSummary[],
	structureBlocked: ReadonlySet<string>,
): ControllerBufferSummary | undefined {
	const cc = stores.find(
		(store) =>
			store.structureType === "container" &&
			chebyshev(store.x, store.y, controller.pos.x, controller.pos.y) <=
				CONTROLLER_BUFFER_CONFIG.adoptRange,
	);
	if (!cc) {
		return undefined;
	}
	const terrain = room.getTerrain();
	const slots: Array<{ x: number; y: number }> = [];
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			if (dx === 0 && dy === 0) {
				continue;
			}
			const x = cc.x + dx;
			const y = cc.y + dy;
			if (x < 0 || x > 49 || y < 0 || y > 49) {
				continue;
			}
			// 工位必须在控制器升级射程内: cc 旁格子可能落在射程外, 站上去满仓也升不了级
			if (chebyshev(x, y, controller.pos.x, controller.pos.y) > 3) {
				continue;
			}
			if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) {
				continue;
			}
			if (structureBlocked.has(`${x},${y}`)) {
				continue;
			}
			slots.push({ x, y });
		}
	}
	return { id: cc.id, x: cc.x, y: cc.y, slots };
}

export const Perception: TickModule = {
	name: "perception",
	phase: "perception",
	band: "P1",
	run(ctx: TickContext): void {
		const rooms: Record<string, RoomObservation> = {};
		for (const roomName in Game.rooms) {
			const room = Game.rooms[roomName];
			if (!room || !room.controller?.my) {
				continue;
			}
			const sources = room.find(FIND_SOURCES).map((source) => ({
				id: source.id,
				roomName,
				x: source.pos.x,
				y: source.pos.y,
				energy: source.energy,
				energyCapacity: source.energyCapacity,
			}));
			const energyStructures = room
				.find(FIND_MY_STRUCTURES, {
					filter: (structure): structure is StructureSpawn | StructureExtension =>
						structure.structureType === STRUCTURE_SPAWN ||
						structure.structureType === STRUCTURE_EXTENSION,
				})
				.map((structure) => ({
					id: structure.id,
					structureType: structure.structureType as "spawn" | "extension",
					roomName,
					x: structure.pos.x,
					y: structure.pos.y,
					energy: structure.store.energy,
					energyCapacity: structure.store.getCapacity(RESOURCE_ENERGY),
				}));
			const sites = room.find(FIND_MY_CONSTRUCTION_SITES).map((site) => ({
				id: site.id,
				structureType: site.structureType as string,
				roomName,
				x: site.pos.x,
				y: site.pos.y,
			}));
			const piles = room
				.find(FIND_DROPPED_RESOURCES, {
					filter: (pile) => pile.resourceType === RESOURCE_ENERGY && pile.amount >= 20,
				})
				.map((pile) => ({
					id: pile.id,
					roomName,
					x: pile.pos.x,
					y: pile.pos.y,
					amount: pile.amount,
				}));
			// 单趟结构扫描分发: 储存结构 / 塔 / 可受损结构 (维修目标, docs/nexus-design/09 §9.3)
			const stores: StoreSummary[] = [];
			const towers: TowerSummary[] = [];
			const damageables: DamageableSummary[] = [];
			/** 阻挡站位的结构占格 (cc 工位过滤用) */
			const structureBlocked = new Set<string>();
			for (const structure of room.find(FIND_STRUCTURES)) {
				const type = structure.structureType;
				if (!NON_BLOCKING_STRUCTURES.has(type as string)) {
					structureBlocked.add(`${structure.pos.x},${structure.pos.y}`);
				}
				if (type === STRUCTURE_CONTAINER || type === STRUCTURE_STORAGE) {
					stores.push({
						id: structure.id,
						structureType: type as string,
						roomName,
						x: structure.pos.x,
						y: structure.pos.y,
						energy: structure.store.energy,
						energyCapacity: structure.store.getCapacity(RESOURCE_ENERGY),
					});
					// 储存结构受损 (容器随时间衰减) 仍需进入维修流, 不提前 continue
				}
				const hits = structure.hits ?? 0;
				const hitsMax = structure.hitsMax ?? 0;
				if (type === STRUCTURE_TOWER) {
					towers.push({
						id: structure.id,
						roomName,
						x: structure.pos.x,
						y: structure.pos.y,
						energy: structure.store.energy,
						energyCapacity: structure.store.getCapacity(RESOURCE_ENERGY),
					});
				}
				// 收录规则: 墙/城门按绝对扫描上限 (高于视为完好, 快照有界), 其余受损即录
				const worthScanning = WALL_LIKE.has(type as string)
					? hits < REPAIR_CONFIG.wallScanCeiling
					: hitsMax > 0 && hits < hitsMax;
				if (worthScanning) {
					damageables.push({
						id: structure.id,
						structureType: type as string,
						roomName,
						x: structure.pos.x,
						y: structure.pos.y,
						hits,
						hitsMax,
					});
				}
			}
			const creeps = room.find(FIND_MY_CREEPS).map((creep) => summarizeCreep(creep, roomName));
			const hostiles = room.find(FIND_HOSTILE_CREEPS).map((creep) => {
				const alivePart = (type: BodyPartConstant): number =>
					creep.body.filter((part) => part.type === type && part.hits > 0).length;
				return {
					id: creep.id,
					name: creep.name,
					owner: creep.owner.username,
					isNpc: creep.owner.username === "Invader",
					x: creep.pos.x,
					y: creep.pos.y,
					hits: creep.hits,
					hitsMax: creep.hitsMax,
					bodyAttack: alivePart("attack"),
					bodyRanged: alivePart("ranged_attack"),
					bodyHeal: alivePart("heal"),
					bodyTough: alivePart("tough"),
					bodyMove: alivePart("move"),
					boostedParts: creep.body.filter((part) => part.boost !== undefined).length,
				};
			});
			const controllerBuffer = room.controller
				? observeControllerBuffer(room, room.controller, stores, structureBlocked)
				: undefined;
			const observation: RoomObservation = {
				roomName,
				rcl: room.controller.level,
				energyCapacity: room.energyCapacityAvailable,
				controller: {
					id: room.controller.id,
					x: room.controller.pos.x,
					y: room.controller.pos.y,
					...(room.controller.level !== undefined ? { level: room.controller.level } : {}),
					...(room.controller.progress !== undefined ? { progress: room.controller.progress } : {}),
					...(room.controller.progressTotal !== undefined
						? { progressTotal: room.controller.progressTotal }
						: {}),
					...(room.controller.ticksToDowngrade !== undefined
						? { ticksToDowngrade: room.controller.ticksToDowngrade }
						: {}),
					safeModeAvailable: room.controller.safeModeAvailable,
					...(room.controller.safeMode !== undefined ? { safeMode: room.controller.safeMode } : {}),
					...(room.controller.safeModeCooldown !== undefined
						? { safeModeCooldown: room.controller.safeModeCooldown }
						: {}),
				},
				sources,
				energyStructures,
				sites,
				piles,
				stores,
				creeps,
				hostiles,
				towers,
				damageables,
				spawnBusy: room.find(FIND_MY_SPAWNS).some((spawn) => spawn.spawning !== null),
				linkCount: room.find(FIND_MY_STRUCTURES, {
					filter: (structure) => structure.structureType === STRUCTURE_LINK,
				}).length,
				...(controllerBuffer ? { controllerBuffer } : {}),
			};
			rooms[roomName] = observation;

			// Intel 增量更新 (docs/nexus-design/04 §4.3): 观测到即刷新, 置信度重置;
			// 未见房间的置信度在读取端按 lastSeen 推导, 避免每 Tick 写 Memory
			const intel = ctx.memory.rooms[roomName] ?? {
				lastSeen: ctx.tick,
				confidence: 1,
				sourceIds: [],
			};
			intel.lastSeen = ctx.tick;
			// RCL 时间线 (speedrun 取证): 首次观测到新等级即记账 (等值跳过, 零写放大)
			if (observation.rcl !== undefined) {
				if (!intel.rclTimeline) intel.rclTimeline = {};
				if (intel.rclTimeline[observation.rcl] === undefined) {
					intel.rclTimeline[observation.rcl] = ctx.tick;
				}
			}
			intel.confidence = 1;
			intel.sourceIds = sources.map((source) => source.id);
			if (intel.lostAt !== undefined) {
				// 复得: 房间重新为己方观测, 清除失守标记 (bugs/P1-10)
				delete intel.lostAt;
			}
			ctx.memory.rooms[roomName] = intel;
		}

		// 可见非己方房中的己方单位 (外矿链路, bugs/P1-18 断点④): world.rooms 只收
		// 己方房, 外矿采集/侦查/预订件在 rooms 里没有归属——不收集则分配与驱动失联
		const remoteUnits: CreepSummary[] = [];
		for (const roomName in Game.rooms) {
			if (rooms[roomName] !== undefined) {
				continue;
			}
			const room = Game.rooms[roomName];
			if (!room || room.controller?.my) {
				continue;
			}
			for (const creep of room.find(FIND_MY_CREEPS)) {
				remoteUnits.push(summarizeCreep(creep, roomName));
			}
		}

		const view: WorldView = { tick: ctx.tick, rooms, remoteUnits };

		const previous = ctx.world.current;

		// 死亡发现: 上一 Tick 存在而本 Tick 不在本方单位集合
		ctx.world.dead = [...aliveNames(previous)].filter((name) => !aliveNames(view).has(name));

		// 失守发现 (bugs/P1-10): 上一 Tick 己方、本 Tick 可见且 controller 非己方 → 显式失守事件,
		// 而非从世界模型静默消失; 纯视野丢失 (Game.rooms 无该房) 不算失守
		const lostRooms: string[] = [];
		for (const roomName of Object.keys(previous?.rooms ?? {})) {
			const live = Game.rooms[roomName];
			if (!live || !live.controller || live.controller.my) {
				continue;
			}
			let intel = ctx.memory.rooms[roomName];
			if (!intel) {
				intel = { lastSeen: ctx.tick, confidence: 0, sourceIds: [] };
				ctx.memory.rooms[roomName] = intel;
			}
			intel.lostAt = ctx.tick;
			lostRooms.push(roomName);
		}
		ctx.world.lostRooms = lostRooms;
		ctx.world.current = view;
	},
};
