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
	type HostileCreepSummary,
	type RoomObservation,
	type StoreSummary,
	type TowerSummary,
	type VisibleRoomObservation,
	type WorldView,
} from "@/core/world";
import { unitCode } from "@/constant/UnitConstant";
import { INTEL_CONFIG } from "@/config/remote";
import { roomKind as roomKindOf } from "@/utils/roomName";

/** 墙/城门类结构: 耐久无实际上限, 用绝对维护线而非 hitsMax 比例 */
const WALL_LIKE: ReadonlySet<string> = new Set(["constructedWall", "rampart"]);

/** 不阻挡站位的结构 (其余结构占格即不可站) */
const NON_BLOCKING_STRUCTURES: ReadonlySet<string> = new Set(["road", "container", "rampart"]);

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 敌方单位摘要 (己方房观察与 visible 快照共用) */
function summarizeHostile(creep: Creep & { owner: { username: string } }, _roomName: string): HostileCreepSummary {	const alivePart = (type: BodyPartConstant): number =>
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
}

/** 非己方可见房轻量快照: 外矿/驻留驱动所需面 (docs/24 §24.5.1), creeps 由调用方填充 */
function summarizeVisibleRoom(room: Room): VisibleRoomObservation {
	const controller = room.controller;
	return {
		roomName: room.name,
		sources: room.find(FIND_SOURCES).map((source) => ({
			id: source.id,
			roomName: room.name,
			x: source.pos.x,
			y: source.pos.y,
			energy: source.energy,
			energyCapacity: source.energyCapacity,
		})),
		piles: room.find(FIND_DROPPED_RESOURCES, {
			filter: (r) => r.resourceType === RESOURCE_ENERGY,
		}).map((pile) => ({
			id: pile.id,
			roomName: room.name,
			x: pile.pos.x,
			y: pile.pos.y,
			amount: pile.amount,
		})),
		stores: room
			.find(FIND_STRUCTURES, {
				filter: (s): s is StructureContainer =>
					s.structureType === STRUCTURE_CONTAINER,
			})
			.map((s) => ({
				id: s.id,
				structureType: s.structureType,
				roomName: room.name,
				x: s.pos.x,
				y: s.pos.y,
				energy: s.store.energy,
				energyCapacity: s.store.getCapacity(RESOURCE_ENERGY),
			})),
		sites: room.find(FIND_MY_CONSTRUCTION_SITES).map((site) => ({
			id: site.id,
			structureType: site.structureType,
			roomName: room.name,
			x: site.pos.x,
			y: site.pos.y,
		})),
		hostiles: room.find(FIND_HOSTILE_CREEPS).map((creep) => summarizeHostile(creep, room.name)),
		...(controller
			? {
					controller: {
						x: controller.pos.x,
						y: controller.pos.y,
						...(controller.owner ? { owner: controller.owner.username } : {}),
						...(controller.reservation
							? {
									reservation: {
										username: controller.reservation.username,
										ticksToEnd: controller.reservation.ticksToEnd,
									},
								}
							: {}),
					},
				}
			: {}),
		invaderCore:
		(room.find(FIND_STRUCTURES, {
					filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
				}).length) > 0,
		creeps: [],
	};
}

/** 源坐标数组值相等判定 (Intel 增量写入的「值变化才写」判据) */
function sameSources(
	a: { id: string; x: number; y: number }[] | undefined,
	b: { id: string; x: number; y: number }[],
): boolean {
	if (!a || a.length !== b.length) return false;
	return a.every((s, i) => b[i] !== undefined && s.id === b[i].id && s.x === b[i].x && s.y === b[i].y);
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
					spawnRemainingTicks:
						structure.structureType === STRUCTURE_SPAWN && structure.spawning
							? structure.spawning.remainingTime
							: null,
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
			const hostiles = room.find(FIND_HOSTILE_CREEPS).map((creep) => summarizeHostile(creep, roomName));
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
				// 升级链路 link 距离 (race-speedrun 任务4.1): 控制器 link (控制器 2 格内)
				// 与最近其他 link 均在位才输出距离, 供吞吐封顶 floor(800/(range+1))
				...observeUpgradeLinkRange(room),
				...(controllerBuffer ? { controllerBuffer } : {}),
			};
			rooms[roomName] = observation;

			// Intel 增量更新 (docs/nexus-design/04 §4.3): 观测到即刷新, 置信度重置;
			// 未见房间的置信度在读取端按 lastSeen 推导, 避免每 Tick 写 Memory
			const intel = ctx.memory.rooms[roomName] ?? {
				lastSeen: ctx.tick,
				confidence: 1,
				sourceIds: [],
				kind: roomKindOf(roomName),
			};
			intel.lastSeen = ctx.tick;
			intel.kind ??= roomKindOf(roomName);
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

		// 名册与可见房 (docs/24 §24.5.1): 全部本方单位以 Game.creeps 键序入册;
		// 驻留非己方房 (外矿/侦查/预订, bugs/P1-18 断点④) 建轻量 visible 快照。
		// 数单位一律读 units 键, 「某房里有谁」才读 rooms/visible 的 creeps。
		const units: Record<string, CreepSummary> = {};
		const visible: Record<string, VisibleRoomObservation> = {};
		for (const name in Game.creeps) {
			const creep = Game.creeps[name];
			if (!creep) {
				continue;
			}
			// 己方房单位在房观察构建段已 summarize——复用同一对象 (摘要等价, 避免双份)
			const inOwned = rooms[creep.room.name];
			units[name] =
				inOwned?.creeps.find((c) => c.name === name) ?? summarizeCreep(creep, creep.room.name);
		}
		// remoteUnits 保持旧口径 (Game.rooms 遍历序, 分配器拼接顺序不漂移):
		// 过渡期字段, 1.5 收口后由 units+visible 全量替换
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
				const summary = units[creep.name] ?? summarizeCreep(creep, roomName);
				remoteUnits.push(summary);
				let vis = visible[roomName];
				if (!vis) {
					vis = summarizeVisibleRoom(room);
					visible[roomName] = vis;
				}
				vis.creeps.push(summary);
			}
		}

		// visible 房 Intel 增量写入 (docs/24 §24.6.1): 写入方唯一, 值变化才写;
		// 无本方单位驻留的可见房 (路过视野) 不建 visible 快照, 也不写 Intel
		for (const roomName of Object.keys(visible)) {
			const vis = visible[roomName];
			if (!vis) continue;
			const room = Game.rooms[roomName];
			if (!room) continue;
			let intel = ctx.memory.rooms[roomName];
			if (!intel) {
				intel = { lastSeen: ctx.tick, confidence: 1, sourceIds: [], kind: roomKindOf(roomName) };
				ctx.memory.rooms[roomName] = intel;
			}
			intel.lastSeen = ctx.tick;
			intel.confidence = 1;
			intel.kind ??= roomKindOf(roomName);
			const sourceIds = vis.sources.map((source) => source.id);
			if (intel.sourceIds.length !== sourceIds.length || intel.sourceIds.some((id, i) => id !== sourceIds[i])) {
				intel.sourceIds = sourceIds;
			}
			const sources = vis.sources.map((source) => ({ id: source.id, x: source.x, y: source.y }));
			if (!sameSources(intel.sources, sources)) {
				intel.sources = sources;
			}
			if (vis.controller) {
				if (
					!intel.controllerPos ||
					intel.controllerPos.x !== vis.controller.x ||
					intel.controllerPos.y !== vis.controller.y
				) {
					intel.controllerPos = { x: vis.controller.x, y: vis.controller.y };
				}
				const owner = vis.controller.owner ?? null;
				if (intel.owner !== owner) {
					intel.owner = owner;
				}
				const reservation = vis.controller.reservation
					? {
							username: vis.controller.reservation.username,
							untilTick: ctx.tick + vis.controller.reservation.ticksToEnd,
						}
					: null;
				if (
					intel.reservation === undefined ||
					intel.reservation?.username !== reservation?.username ||
					intel.reservation?.untilTick !== reservation?.untilTick
				) {
					intel.reservation = reservation;
				}
			}
			if (intel.invaderCore !== vis.invaderCore) {
				intel.invaderCore = vis.invaderCore;
			}
			// 敌对结构口径仅结构 (docs/24 §24.9): 敌 creep 在场不算 unsafe——
			// active 期 invader 进驻走威胁暂停 (paused) 而非安全否决 (rejected),
			// 清理后可恢复; 敌 creep 的暂停信号走 threat.confidence
			const hostileStructures = room.find(FIND_HOSTILE_STRUCTURES).length > 0;
			if (intel.hostileStructures !== hostileStructures) {
				intel.hostileStructures = hostileStructures;
			}
		}

		// Intel 有界清理 (docs/24 §24.6.1): 非己方、非外矿、遗忘阈外的条目删除;
		// 超上限时淘汰最旧者。频控按 forgetTicks 取模——首轮在 tick 0 (bootstrap) 即扫一次
		if (ctx.tick % INTEL_CONFIG.forgetTicks === 0) {
			const owned = new Set(Object.keys(rooms));
			const remoteActive = new Set<string>();
			for (const colony of Object.values(ctx.memory.remotes ?? {})) {
				for (const [roomName, record] of Object.entries(colony.rooms)) {
					if (record.state === "active" || record.state === "scouting" || record.manual !== undefined) {
						remoteActive.add(roomName);
					}
				}
			}
			const intelRooms = ctx.memory.rooms;
			for (const roomName of Object.keys(intelRooms)) {
				const record = intelRooms[roomName];
				if (!record) continue;
				if (owned.has(roomName) || remoteActive.has(roomName)) continue;
				if (ctx.tick - record.lastSeen > INTEL_CONFIG.forgetTicks) {
					delete intelRooms[roomName];
				}
			}
			const names = Object.keys(intelRooms);
			if (names.length > INTEL_CONFIG.maxRooms) {
				names
					.filter((name) => !owned.has(name) && !remoteActive.has(name))
					.sort((a, b) => (intelRooms[a]?.lastSeen ?? 0) - (intelRooms[b]?.lastSeen ?? 0))
					.slice(0, names.length - INTEL_CONFIG.maxRooms)
					.forEach((name) => delete intelRooms[name]);
			}
		}

		const view: WorldView = { tick: ctx.tick, rooms, visible, units, remoteUnits };

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

/** 升级链路 link 距离 (race-speedrun 任务4.1, race bot getUpgradeCapacity 口径):
 *  控制器 link (控制器 2 格内) 与最近其他 link 均在位时返回 { upgradeLinkRange },
 *  升级吞吐封顶 floor(800/(range+1)) 的输入 (800 = LINK_CAPACITY×0.97/15t 折算);
 *  link 不全时返回空对象 (走 cc/无缓冲口径)。 */
function observeUpgradeLinkRange(room: Room): { upgradeLinkRange?: number } {
	const links = room.find(FIND_MY_STRUCTURES, {
		filter: (structure): structure is StructureLink =>
			structure.structureType === STRUCTURE_LINK,
	});
	const controller = room.controller;
	if (links.length < 2 || !controller) {
		return {};
	}
	const controllerLink = links.find((link) => link.pos.inRangeTo(controller.pos, 2));
	if (!controllerLink) {
		return {};
	}
	let range: number | undefined;
	for (const link of links) {
		if (link.id === controllerLink.id) {
			continue;
		}
		const d = Math.max(
			Math.abs(link.pos.x - controllerLink.pos.x),
			Math.abs(link.pos.y - controllerLink.pos.y),
		);
		if (range === undefined || d < range) {
			range = d;
		}
	}
	return range === undefined ? {} : { upgradeLinkRange: range };
}
