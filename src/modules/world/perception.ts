/**
 * 感知模块 (docs/nexus-design/03 §3.3 Perception/World Update):
 * 每 Tick 一次聚合房间对象为纯数据快照, 更新 Intel, 对比前后发现死亡单位。
 * 快照挂到 TickContext.world, 下游只读快照, 不各自 room.find。
 * 结构类观测 (存储/塔/墙体/受损建筑) 共用一趟 FIND_STRUCTURES 分发, 不多扫。
 * screeps 类型与常量为全局声明 (@types/screeps 非 module)。
 */
import type { TickContext } from "@/core/tickContext";
import type { TickModule } from "@/core/scheduler";
import { REPAIR_CONFIG } from "@/config/defense";
import {
	aliveNames,
	roleCodeFromName,
	type DamageableSummary,
	type RoomObservation,
	type StoreSummary,
	type TowerSummary,
	type WorldView,
} from "@/core/world";

/** 墙/城门类结构: 耐久无实际上限, 用绝对维护线而非 hitsMax 比例 */
const WALL_LIKE: ReadonlySet<string> = new Set(["constructedWall", "rampart"]);

export const perceptionModule: TickModule = {
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
						structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION,
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
			for (const structure of room.find(FIND_STRUCTURES)) {
				const type = structure.structureType;
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
			const creeps = room.find(FIND_MY_CREEPS).map((creep) => {
				const alivePart = (type: BodyPartConstant): number =>
					creep.body.filter((part) => part.type === type && part.hits > 0).length;
				return {
					name: creep.name,
					id: creep.id,
					roomName,
					roleCode: roleCodeFromName(creep.name),
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
			});
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
			const observation: RoomObservation = {
				roomName,
				rcl: room.controller.level,
				controller: {
					id: room.controller.id,
					x: room.controller.pos.x,
					y: room.controller.pos.y,
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
			intel.confidence = 1;
			intel.sourceIds = sources.map((source) => source.id);
			ctx.memory.rooms[roomName] = intel;
		}

		const view: WorldView = { tick: ctx.tick, rooms };

		// 死亡发现: 上一 Tick 存在而本 Tick 不在本方单位集合
		const previousAlive = aliveNames(ctx.world.current);
		const currentAlive = aliveNames(view);
		ctx.world.dead = [...previousAlive].filter((name) => !currentAlive.has(name));
		ctx.world.current = view;
	},
};
