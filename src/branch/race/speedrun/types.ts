// @ts-nocheck
import {
	SRC,
	SPAWN,
	S27,
	S26,
	SIN,
	BOXES,
	BOX,
	SLOTS,
	LANE_Y,
	BAY,
	RBAY,
	RING_HOME,
	HUBS,
	K,
	pos,
	RP,
	go,
	L,
	CTRL,
	siteOrder,
} from "./layout";
import { boxes, hubBox, hubBoxes, takeBox, spare, fill } from "./economy";
import { tow, swapLoad } from "./towing";
import { bayUnload, bayStop } from "./spawning";
/**
 * 类型实现: spawnFiller/paver/hauler/hubFiller/miner/upgrader/builder/reserver/tug。
 * 泊位续能 (bay/bayStop/bayUnload): 续能划算的 hauler 停进 spawn 旁泊位卸货等 renew。
 * 巷道卸货 (laneUnload): row 28 直接卸进相邻箱体或丢堆给 row 27 升级工。
 * 链式升级 (chainUpgrader): 升级后把烧不完的余量传给相邻更饿的升级工。
 */

const TYPES = {
	spawnFiller(c, home) {
		const room = Game.rooms[home];
		const sp = room
			.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
			.find((x) => x.structureType === STRUCTURE_SPAWN);
		if (c.store.energy && sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
			return c.transfer(sp, RESOURCE_ENERGY);
		if (c.store.getFreeCapacity() === 0) return;
		const box = _.max(
			c.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store.energy > 0,
			}),
			(s) => s.store.energy,
		);
		if (box !== -Infinity) return c.withdraw(box, RESOURCE_ENERGY);
		const pile = c.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
			filter: (r) => r.resourceType === RESOURCE_ENERGY,
		})[0];
		if (pile) c.pickup(pile);
	},

	// road crew: lays its route from the source end, fed by the pile at that source; idles once the route stands
	paver(c, _home) {
		const r = (Memory.roads || []).find((x) => x.k === c.memory.k);
		if (!r || (Memory.roadDone || {})[c.memory.k]) return;
		if (c.store.energy === 0) c.memory.w = false;
		if (c.store.getFreeCapacity() === 0) c.memory.w = true;
		const s = SRC[c.memory.i];
		if (!c.memory.w) {
			const p = pos(s.mx, s.my, c.memory.room);
			if (c.room.name !== p.roomName || !c.pos.inRangeTo(p, 1))
				return c.moveTo(p, { range: 1, reusePath: 20 });
			const pile = c.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
				filter: (x) => x.resourceType === RESOURCE_ENERGY,
			})[0];
			if (pile) c.pickup(pile);
			else if (c.store.energy > 0) c.memory.w = true;
			return;
		}
		const sites = [];
		for (const t of r.tiles) {
			const [rn, x, y] = t.split(",");
			const room = Game.rooms[rn];
			if (!room) continue;
			const site = room.lookForAt(LOOK_CONSTRUCTION_SITES, +x, +y)[0];
			if (site) sites.push(site);
		}
		const here = sites.filter((x) => x.pos.roomName === c.room.name);
		const t = c.pos.findClosestByRange(here.length ? here : []) || sites[sites.length - 1];
		if (!t) return;
		if (c.pos.roomName === t.pos.roomName && c.pos.inRangeTo(t, 3)) {
			if (c.build(t) === OK) L("build", Math.min(5 * c.getActiveBodyparts(WORK), c.store.energy));
		} else c.moveTo(t, { range: 3, reusePath: 20 });
	},

	// all MOVE: pulls towed creeps to their posts, waits by the spawn in between
	tug(c, home) {
		if (c.memory.towing) {
			const cargo = Game.creeps[c.memory.towing];
			if (cargo && !cargo.memory.arrived && cargo.memory.tug === c.name) return tow(c, cargo, home);
			delete c.memory.towing;
		}
		c.moveTo(pos(K.tugX, K.tugY, home), { range: 1, reusePath: 20 });
	},

	// stands still between its hub container and the extensions: one withdraw and one transfer a tick
	hubFiller(c, home) {
		const h = HUBS[c.memory.h];
		const [fx, fy] = h.fill[c.memory.f];
		if (!c.pos.isEqualTo(fx, fy)) return c.moveTo(pos(fx, fy, home), { reusePath: 20 });
		const room = Game.rooms[home];
		if (room.energyAvailable === room.energyCapacityAvailable && c.store.getFreeCapacity() === 0)
			return;
		const box = hubBox(room, h);
		if (box && box.store.energy && c.store.getFreeCapacity()) c.withdraw(box, RESOURCE_ENERGY);
		if (c.store.energy && room.energyAvailable < room.energyCapacityAvailable) {
			const t = c.pos.findInRange(FIND_MY_STRUCTURES, 1, {
				filter: (x) =>
					(x.structureType === STRUCTURE_EXTENSION || x.structureType === STRUCTURE_SPAWN) &&
					x.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
			})[0];
			if (t) c.transfer(t, RESOURCE_ENERGY);
		}
	},

	miner(c) {
		const s = SRC[c.memory.i];
		const p = c.memory.alt ? pos(s.ax, s.ay, c.memory.room) : pos(s.mx, s.my, c.memory.room);
		if (!c.pos.isEqualTo(p)) return c.moveTo(p, { reusePath: RP() });
		const src = Game.getObjectById(c.memory.id) || c.room.lookForAt(LOOK_SOURCES, s.x, s.y)[0];
		c.memory.id = src.id;
		if (!c.memory.alt) (Memory.mined = Memory.mined || {})[c.memory.k] = 1;
		// the early second miner hands its load to the first one, so everything piles on the one tile haulers visit
		if (c.memory.alt) {
			if (c.harvest(src) === OK) L("harvest", Math.min(2 * c.getActiveBodyparts(WORK), src.energy));
			const main = c.room
				.lookForAt(LOOK_CREEPS, s.mx, s.my)
				.find((o) => o.my && o.memory.type === "miner");
			if (c.store.energy >= 30) {
				if (main) c.transfer(main, RESOURCE_ENERGY);
				else c.drop(RESOURCE_ENERGY);
			}
			return;
		}
		// the miner keeps its own container: energy in a container doesn't decay, a pile does
		const box = c.pos.lookFor(LOOK_STRUCTURES).find((x) => x.structureType === STRUCTURE_CONTAINER);
		const homeName = Object.values(Game.spawns)[0].room.name;
		if (
			!box &&
			Game.rooms[homeName].controller.level >= K.minerBoxRcl &&
			(!K.boxHomeOnly || c.memory.room === homeName)
		) {
			const site = c.pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
			if (!site) c.room.createConstructionSite(p.x, p.y, STRUCTURE_CONTAINER);
			else if (c.store.energy >= c.getActiveBodyparts(WORK) * 5 || (c.store.energy && !src.energy))
				return c.build(site) === OK && L("build", c.store.energy);
		} else if (
			box &&
			c.store.energy &&
			(box.hits < box.hitsMax * 0.15 || (box.hits < box.hitsMax * 0.6 && src.energy === 0))
		)
			return c.repair(box);
		if (c.harvest(src) === OK) {
			const got = Math.min(2 * c.getActiveBodyparts(WORK), src.energy);
			Memory.harvested = (Memory.harvested || 0) + got;
			L("harvest", got);
		}
		// no container yet: pass the load straight to a hauler so it never hits the ground
		if (c.store.energy && !box) {
			// the fullest waiting hauler first, so it leaves soonest
			const h = _.max(
				c.pos.findInRange(FIND_MY_CREEPS, 1, {
					filter: (o) => o.memory.type === "hauler" && !o.memory.full && o.store.getFreeCapacity() > 0,
				}),
				(o) => o.store.energy,
			);
			if (h !== -Infinity && (K.mxfer || c.store.energy > c.getActiveBodyparts(WORK) * 5))
				c.transfer(h, RESOURCE_ENERGY);
		}
	},

	hauler(c, home) {
		if (c.memory.towing) {
			const cargo = Game.creeps[c.memory.towing];
			if (cargo && !cargo.memory.arrived && cargo.memory.tug === c.name) return tow(c, cargo, home);
			delete c.memory.towing;
		}
		if (c.memory.swapped && c.memory.swapped < Game.time) delete c.memory.swapped;
		if (K.swap && c.memory.full && c.store.energy && !c.memory.swapped && swapLoad(c, home)) return;
		if (c.store.energy === 0 && c.memory.swapped !== Game.time) c.memory.full = false;
		if (c.store.getFreeCapacity() === 0) c.memory.full = true;
		// dieMargin: a dying hauler must reach home before it dies, or its load drops in a remote room and decays
		if (c.ticksToLive < (c.memory.dist || 0) + K.dieMargin && c.store.energy)
			c.memory.full = true;
		// parked in a bay waiting for renewal: stay (empty or not) until renewed or K.bayWait runs out
		if (
			RBAY &&
			K.renew &&
			!K.renewPass &&
			BAY.some(([x, y]) => c.pos.isEqualTo(x, y)) &&
			c.room.name === home
		) {
			c.memory.bayT = (c.memory.bayT || 0) + 1;
			const room = Game.rooms[home];
			const sp = Game.spawns[Object.keys(Game.spawns)[0]];
			if (
				c.memory.bayT <= K.bayWait &&
				renewable(c, room) &&
				(!sp.spawning || sp.spawning.remainingTime <= 3)
			) {
				bayUnload(c, room);
				return;
			}
		} else c.memory.bayT = 0;
		if (!c.memory.full) {
			const s = SRC[c.memory.i];
			let p = pos(s.mx, s.my, c.memory.room);
			// keepHome: a hauler that cannot finish the round trip stays home to die empty. A load dropped in a
			// remote room decays at ceil(amount/1000) per tick and nothing walks back for it.
			if (K.keepHome && !c.store.energy && c.ticksToLive < 2 * (c.memory.dist || 0) + 12)
				return c.moveTo(pos(28, 34, home), { range: 2, reusePath: 10 });
			// The opening miner has no CARRY, so its helper cannot hand energy to it.
			// Recover the helper's pile as well as the main miner's output.
			if (K.recoverAlt && c.memory.room === home && c.room.name === home) {
				const other = pos(s.ax, s.ay, home);
				const mainPile = c.room
					.lookForAt(LOOK_RESOURCES, p)
					.find((r) => r.resourceType === RESOURCE_ENERGY);
				const altPile = c.room
					.lookForAt(LOOK_RESOURCES, other)
					.find((r) => r.resourceType === RESOURCE_ENERGY);
				if (altPile && (!mainPile || altPile.amount > mainPile.amount)) p = other;
			}
			if (c.room.name !== p.roomName || !c.pos.inRangeTo(p, 1))
				return c.moveTo(p, { range: 1, reusePath: RP() });
			const pile = c.room
				.lookForAt(LOOK_RESOURCES, p)
				.find((r) => r.resourceType === RESOURCE_ENERGY);
			if (pile) return c.pickup(pile);
			// pileNear: a load dropped beside the post (a dying hauler, the alt miner) is still a pickup away
			if (K.pileNear) {
				const near = c.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
					filter: (r) => r.resourceType === RESOURCE_ENERGY,
				})[0];
				if (near) return c.pickup(near);
			}
			const box = c.room
				.lookForAt(LOOK_STRUCTURES, p)
				.find((x) => x.structureType === STRUCTURE_CONTAINER);
			if (box && box.store.energy) c.withdraw(box, RESOURCE_ENERGY);
			return;
		}
		// paving: a hauler with a WORK spends its load on road sites it passes
		if (c.memory.pave && c.store.energy) {
			const site = c.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
				filter: (s) => s.structureType === STRUCTURE_ROAD,
			})[0];
			if (site && c.build(site) === OK) L("build", Math.min(5, c.store.energy));
		}
		const room = Game.rooms[home];
		// only as many haulers head for the spawn/extensions as their deficit needs; the rest unload at the boxes
		if (K.fillClaim && c.room.name === home && !hubBoxes(room).length) {
			const g = (global.FILL =
				global.FILL && global.FILL.t === Game.time
					? global.FILL
					: { t: Game.time, left: room.energyCapacityAvailable - room.energyAvailable });
			if (g.left > 0) {
				g.left -= c.store.energy;
				if (fill(c, room)) return;
			}
		} else if (c.room.name === home && room.energyAvailable < room.energyCapacityAvailable) {
			// top up whatever spawn/extension we brush past; the filler does the rest
			const t = c.pos.findInRange(FIND_MY_STRUCTURES, 1, {
				filter: (x) =>
					(x.structureType === STRUCTURE_EXTENSION || x.structureType === STRUCTURE_SPAWN) &&
					x.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
			})[0];
			if (t) c.transfer(t, RESOURCE_ENERGY);
			else if (!hubBoxes(room).length && fill(c, room)) return;
			if (t) return;
		}
		if (RBAY && K.renew && c.room.name === home && bayStop(c, room, home)) return;
		if (c.room.name === home) {
			// while builders work the hubs fill to the brim: builders draw from them before the upgraders get any
			const hubWant = K.hubLow;
			const low = hubBoxes(room).filter((b) => b.store.energy < hubWant);
			if (low.length) {
				const b = c.pos.findClosestByRange(low);
				return c.pos.isNearTo(b)
					? c.transfer(b, RESOURCE_ENERGY)
					: c.moveTo(b, { range: 1, reusePath: 20 });
			}
		}
		if (c.room.name !== home)
			return c.moveTo(pos(BOX.x, BOX.y, home), { range: 2, reusePath: RP() });
		if (K.chain) return laneUnload(c, room, home);
		const bx = boxes(room).filter((b) => b.free > 0);
		// boxes full: help the filler, or park out of the way so the filler can reach the boxes
		if (!bx.length) return c.moveTo(pos(28, 34, home), { range: 2, reusePath: 10 });
		const here = bx.find((b) =>
			b.c ? c.pos.getRangeTo(b.x, b.y) <= 1 : c.pos.isEqualTo(b.x, b.y),
		);
		if (here) return here.c ? c.transfer(here.c, RESOURCE_ENERGY) : c.drop(RESOURCE_ENERGY);
		const b = _.min(bx, (b) => b.energy + c.pos.getRangeTo(b.x, b.y) * 20);
		c.moveTo(pos(b.x, b.y, home), { range: b.c ? 1 : 0, reusePath: RP() });
	},

	upgrader(c, home) {
		if (K.chain) return chainUpgrader(c, home);
		const room = Game.rooms[home];
		if (c.memory.slot === undefined || c.memory.slotRing !== RING_HOME.v) {
			c.memory.slotRing = RING_HOME.v;
			const taken = new Set(
				_.filter(Game.creeps, (o) => o.memory.type === "upgrader" && o !== c).map(
					(o) => o.memory.slot,
				),
			);
			c.memory.slot = SLOTS.findIndex((_s, i) => !taken.has(i));
		}
		const [x, y] = SLOTS[c.memory.slot] || [BOX.x, BOX.y + 1];
		if (!c.pos.isEqualTo(x, y)) c.moveTo(x, y, { reusePath: RP() });
		if (
			c.store.getFreeCapacity() > 0 &&
			spare(room) > (K.bfeed && global.BUILDERS ? K.upKeep : 0)
		) {
			const b = _.max(
				boxes(room).filter((b) => b.energy && c.pos.getRangeTo(b.x, b.y) <= 1),
				"energy",
			);
			if (b && b.energy) takeBox(c, b);
		}
		if (c.store.energy) c.upgradeController(room.controller);
	},

	builder(c, home) {
		const room = Game.rooms[home];
		if (c.store.energy === 0) c.memory.w = false;
		if (c.store.getFreeCapacity() === 0) c.memory.w = true;
		if (c.memory.w) {
			const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
			const first = _.min(sites.map(siteOrder));
			const site = c.pos.findClosestByRange(sites.filter((x) => siteOrder(x) === first));
			if (site)
				return c.pos.inRangeTo(site, 3)
					? (L("bt_build", 1),
						c.build(site) === OK &&
							L("build", Math.min(5 * c.getActiveBodyparts(WORK), c.store.energy)))
					: (L("bt_toSite", 1), c.moveTo(site, { range: 3, reusePath: 10 }));
			return go(c, room.controller, 3) === true && c.upgradeController(room.controller);
		}
		L("bt_fetch", 1);
		if (K.bfeed) {
			// builders eat before upgraders: hub containers (above what the spawn needs), boxes, piles near the hubs
			const deficit = room.energyCapacityAvailable - room.energyAvailable;
			// hub 1 sits on the spawn's exit: only its fillers draw from it
			const hubs = hubBoxes(room).filter(
				(x) => x.store.energy > deficit + 50 && !x.pos.isEqualTo(HUBS[0].c[0], HUBS[0].c[1]),
			);
			const piles = room.find(FIND_DROPPED_RESOURCES, {
				filter: (r) =>
					r.resourceType === RESOURCE_ENERGY &&
					r.amount > 50 &&
					r.pos.getRangeTo(SPAWN.x, SPAWN.y) <= 8,
			});
			const bx = boxes(room)
				.filter((x) => x.energy > 50)
				.map((x) => x.c || x.pile)
				.filter(Boolean);
			const best = _.max(
				[...hubs, ...bx, ...piles],
				(y) => (y.amount || y.store.energy) - 20 * c.pos.getRangeTo(y),
			);
			if (best && best !== -Infinity)
				return c.pos.isNearTo(best)
					? best.amount
						? c.pickup(best)
						: c.withdraw(best, RESOURCE_ENERGY)
					: c.moveTo(best, { range: 1, reusePath: 10 });
			// nothing to eat: wait clear of the spawn's exit and the hub
			L("bt_starve", 1);
			return c.moveTo(pos(K.parkX, K.parkY, home), { range: 2, reusePath: 20 });
		}
		// feed from the fattest home pile or source container, then the boxes
		const piles = room.find(FIND_DROPPED_RESOURCES, {
			filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 100,
		});
		const cans = SRC.map((x) =>
			room
				.lookForAt(LOOK_STRUCTURES, x.mx, x.my)
				.find((y) => y.structureType === STRUCTURE_CONTAINER),
		).filter((y) => y && y.store.energy > 100);
		const best = _.max(
			[...piles, ...cans],
			(y) => (y.amount || y.store.energy) - 10 * c.pos.getRangeTo(y),
		);
		if (best && best !== -Infinity)
			return c.pos.isNearTo(best)
				? best.amount
					? c.pickup(best)
					: c.withdraw(best, RESOURCE_ENERGY)
				: c.moveTo(best, { reusePath: 10 });
		const b = _.max(boxes(room), "energy");
		if (b && b.energy && spare(room) > 0) {
			if (c.pos.getRangeTo(b.x, b.y) <= 1) takeBox(c, b);
			else c.moveTo(pos(b.x, b.y, home), { range: 1, reusePath: 10 });
		} else L("bt_starve", 1);
	},

	claimer(c) {
		const room = Game.rooms[c.memory.room];
		if (!room) return c.moveTo(pos(CTRL.x, CTRL.y, c.memory.room), { range: 1, reusePath: 50 });
		if (room.controller.my) return;
		if (go(c, room.controller) === true) {
			const result = c.claimController(room.controller);
			if (result === ERR_INVALID_TARGET && !room.controller.owner && room.controller.level === 0) {
				Memory.claimDisabled = true;
				c.reserveController(room.controller);
			}
		}
	},

	reserver(c) {
		const room = Game.rooms[c.memory.room];
		if (!room) return c.moveTo(pos(CTRL.x, CTRL.y, c.memory.room), { range: 1, reusePath: 50 });
		if (go(c, room.controller) === true) c.reserveController(room.controller);
	},
};

// Lane unload: on row 28 a hauler puts its load into a box it touches, or drops it on the lane for the
// row-27 upgraders to pick up. Off the lane it heads for the nearest free lane tile.

function laneUnload(c, room, home) {
	// spawn26: while the spawn is short, haulers top it up from the box tile under it
	if (S26) {
		const sp = room
			.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
			.find((x) => x.structureType === STRUCTURE_SPAWN);
		if (sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
			if (c.pos.isNearTo(sp)) return c.transfer(sp, RESOURCE_ENERGY);
			const g = (global.SPF =
				global.SPF && global.SPF.t === Game.time ? global.SPF : { t: Game.time, n: 0 });
			if (g.n++ < 1 && !room.lookForAt(LOOK_CREEPS, SPAWN.x, SPAWN.y + 1).some((o) => o !== c))
				return c.moveTo(SPAWN.x, SPAWN.y + 1, { reusePath: 5 });
		}
	}
	if (c.pos.y === LANE_Y && c.pos.x >= 14 && c.pos.x <= 20) {
		if (SIN && c.pos.isNearTo(SPAWN.x, SPAWN.y)) {
			const sp = room
				.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
				.find((s) => s.structureType === STRUCTURE_SPAWN);
			if (sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
				return c.transfer(sp, RESOURCE_ENERGY);
		}
		// ring: the box is the buffer (main-code cc semantics) — a full load lands in it in one
		// tick and the hauler leaves; the passing happens upgrader-to-upgrader (K.chain relay)
		if (RING_HOME.v) {
			const box1 = c.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: (s) =>
					s.structureType === STRUCTURE_CONTAINER &&
					BOXES.some((b) => s.pos.isEqualTo(b.x, b.y)) &&
					s.store.getFreeCapacity() > 0,
			});
			if (box1.length)
				return c.transfer(
					_.min(box1, (s) => s.store.energy),
					RESOURCE_ENERGY,
				);
			const lanePile1 = _.sum(
				room.lookForAtArea(LOOK_RESOURCES, LANE_Y, 14, LANE_Y, 20, true),
				(r) => r.resource.amount,
			);
			if (lanePile1 < K.lanePileMax) return c.drop(RESOURCE_ENERGY);
			return c.moveTo(pos(K.parkX, K.parkY + 4, home), { range: 2, reusePath: 10 });
		}
		const box = c.pos.findInRange(FIND_STRUCTURES, 1, {
			filter: (s) =>
				s.structureType === STRUCTURE_CONTAINER &&
				BOXES.some((b) => s.pos.isEqualTo(b.x, b.y)) &&
				s.store.getFreeCapacity() > 0,
		});
		if (box.length)
			return c.transfer(
				_.min(box, (s) => s.store.energy),
				RESOURCE_ENERGY,
			);
		const lanePile = _.sum(
			room.lookForAtArea(LOOK_RESOURCES, LANE_Y, 14, LANE_Y, 20, true),
			(r) => r.resource.amount,
		);
		if (lanePile < K.lanePileMax) return c.drop(RESOURCE_ENERGY);
		return c.moveTo(pos(K.parkX, K.parkY + 4, home), { range: 2, reusePath: 10 });
	}
	// the free lane tile whose boxes are emptiest (spread the load over all three), then the nearest
	const bx = boxes(room);
	// a tile is worth what its boxes lack; before the boxes stand, what the row-27 upgraders next to it lack
	const ups = _.filter(
		Game.creeps,
		(o) => o.memory.type === "upgrader" && o.room.name === home && o.pos.y === LANE_Y - 1,
	);
	const need = (x) => {
		const near = bx.filter((b) => (b.c || !S27) && Math.abs(b.x - x) <= 1);
		if (near.length) return _.sum(near, (b) => b.energy) / near.length;
		if (!S27) return 1000;
		if (!ups.some((o) => Math.abs(o.pos.x - x) <= 1)) return 5000;
		return _.sum(room.lookForAt(LOOK_RESOURCES, x, LANE_Y), "amount");
	};
	const free = [];
	for (let x = 14; x <= 20; x++)
		if (!room.lookForAt(LOOK_CREEPS, x, LANE_Y).length) free.push(pos(x, LANE_Y, home));
	// ring: head for a tile that touches the box while it has room (full-rate unload), else the nearest
	if (RING_HOME.v && c.pos.y !== LANE_Y) {
		const box = bx[0];
		if (box && box.free > 0) {
			const lane = free.filter((p) => Math.abs(p.x - BOX.x) <= 1);
			if (lane.length) return c.moveTo(_.min(lane, (p) => 30 * c.pos.getRangeTo(p)), { reusePath: 5 });
		}
		if (free.length)
			return c.moveTo(_.min(free, (p) => 30 * c.pos.getRangeTo(p)), { reusePath: 5 });
	}
	const renewMe =
		SIN && K.renew && !K.renewPass && c.ticksToLive < 1500 - Math.floor(600 / c.body.length) - 50;
	// spawn27: the spawn's own store is refilled only from the lane tiles under it: go there while it is short
	const spawnShort =
		S27 &&
		(() => {
			const sp = room
				.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
				.find((x) => x.structureType === STRUCTURE_SPAWN);
			return sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
		})();
	const t = _.min(
		free,
		(p) =>
			need(p.x) +
			30 * c.pos.getRangeTo(p) -
			((renewMe || spawnShort) && Math.abs(p.x - SPAWN.x) <= 1 ? 3000 : 0),
	);
	if (t !== Infinity && t) return c.moveTo(t, { reusePath: 5 });
	return c.moveTo(pos(17, LANE_Y + 2, home), { range: 1, reusePath: 5 });
}

// Chained upgraders (ultimate-bot's relay): upgrade, then one carry action: pass what this tick doesn't burn
// to the neighbour upgrader that is shortest (furthest from the lane first), else top up from an adjacent
// box or lane pile. Neighbours form a chain from the lane inwards; nobody walks for energy.
function chainUpgrader(c, home) {
	const room = Game.rooms[home];
	// hybrid (K.ringTo): the slot table swaps with the shape — indices from the old shape
	// would park creeps on the wrong tiles, so re-pick once per shape change
	if (c.memory.slot === undefined || c.memory.slotRing !== RING_HOME.v) {
		c.memory.slotRing = RING_HOME.v;
		const taken = new Set(
			_.filter(Game.creeps, (o) => o.memory.type === "upgrader" && o !== c).map(
				(o) => o.memory.slot,
			),
		);
		c.memory.slot = SLOTS.findIndex((_s, i) => !taken.has(i));
	}
	const [x, y] = SLOTS[c.memory.slot] || [BOX.x, BOX.y - 1];
	if (!c.pos.isEqualTo(x, y)) c.moveTo(x, y, { reusePath: RP() });
	const burn = c.getActiveBodyparts(WORK);
	if (c.store.energy) c.upgradeController(room.controller);
	const surplus = c.store.energy - burn;
	if ((S27 || S26) && surplus > 0 && c.pos.isNearTo(SPAWN.x, SPAWN.y)) {
		const sp = room
			.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
			.find((s) => s.structureType === STRUCTURE_SPAWN);
		if (sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
			return c.transfer(
				sp,
				RESOURCE_ENERGY,
				Math.min(surplus, sp.store.getFreeCapacity(RESOURCE_ENERGY)),
			);
	}
	if (surplus > 0) {
		// ring: relay outwards from the box (chebyshev distance to the box grows along the chain);
		// legacy: relay inwards off the lane (y shrinks). Both keep the flow one-way.
		const dist = RING_HOME.v
			? (p) => Math.max(Math.abs(p.pos.x - BOX.x), Math.abs(p.pos.y - BOX.y))
			: (p) => LANE_Y - p.pos.y;
		const near = c.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: (o) =>
				o.memory.type === "upgrader" &&
				o.store.energy < 2 * o.getActiveBodyparts(WORK) &&
				(RING_HOME.v || o.pos.y < c.pos.y + 1),
		});
		const to = _.max(near, (o) => o.store.getFreeCapacity() * 10 + dist(o));
		if (to !== -Infinity && dist(to) >= dist(c)) {
			const result = c.transfer(to, RESOURCE_ENERGY, Math.min(surplus, to.store.getFreeCapacity()));
			// Transfer and withdraw are separate intents. Refill available CARRY space
			// this tick as well, so relaying energy need not leave the upgrader empty.
			if (!K.chainFetch) return result;
		}
	}
	if (c.store.getFreeCapacity() < burn) return;
	// spawn27: an upgrader beside the spawn fetches for it even when the boxes are lean (nobody else can)
	const feedsSpawn =
		(S27 || S26) &&
		c.pos.isNearTo(SPAWN.x, SPAWN.y) &&
		(() => {
			const sp = room
				.lookForAt(LOOK_STRUCTURES, SPAWN.x, SPAWN.y)
				.find((s) => s.structureType === STRUCTURE_SPAWN);
			return sp && sp.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
		})();
	if (!feedsSpawn && spare(room) <= 0) return;
	const box = c.pos.findInRange(FIND_STRUCTURES, 1, {
		filter: (s) =>
			s.structureType === STRUCTURE_CONTAINER &&
			s.store.energy > 0 &&
			BOXES.some((b) => s.pos.isEqualTo(b.x, b.y)),
	})[0];
	if (box) return c.withdraw(box, RESOURCE_ENERGY);
	// ring: a loaded hauler on the lane hands its load over directly (creep-to-creep feed)
	if (RING_HOME.v) {
		const feed = c.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: (o) => o.memory.type === "hauler" && o.store.energy > 0,
		})[0];
		if (feed && feed.transfer(c, RESOURCE_ENERGY) === OK) return;
	}
	const pile = c.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
		filter: (r) => r.resourceType === RESOURCE_ENERGY,
	})[0];
	if (pile) c.pickup(pile);
}

export { TYPES };
