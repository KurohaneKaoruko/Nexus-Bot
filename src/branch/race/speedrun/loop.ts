// @ts-nocheck
import { SPAWN, S26, S27, SIN, BAYS, EXIT, DXY, K, configure, jitterK, cost, shape } from "./layout";
import { plan, roads } from "./economy";
import { unjam, shove } from "./traffic";
import { towAssign, towDest } from "./towing";
import { TYPES } from "./types";
import { nextSpawn, newRun, spawnIt, renewLow, renew } from "./spawning";
import { record, debug } from "./telemetry";
/**
 * 每 tick 主循环: 记忆清理 → 布局放站/道路 → 控制点遥测 → 拖拽分派 →
 * 类型分派 (tow 等待/出口保持/让位) → unjam/shove → 孵化段
 * (续能优先级 → fillerJump → nextSpawn → spawnIt)。
 */

export function loop() {
	configure();
	// Standard-room guard: the whole layout assumes the fixed landmark tiles. On any other
	// terrain the fixed posts point at walls or empty ground (every miner tick would throw),
	// so stand still instead of crashing the loop.
	const spawn0 = Object.values(Game.spawns)[0];
	// newRun runs BEFORE the guard: it wipes Memory each new spawn, so a roomOk=false from a
	// bad landing room can never outlive that run (run 35 stuck ~38 runs silent this way)
	if (spawn0) newRun(spawn0);
	if (spawn0 && !Memory.roomOk) {
		const ctrl = spawn0.room.controller;
		Memory.roomOk =
			spawn0.room.lookForAt(LOOK_SOURCES, 21, 13).length > 0 &&
			spawn0.room.lookForAt(LOOK_SOURCES, 30, 29).length > 0 &&
			!!ctrl &&
			ctrl.pos.x === 17 &&
			ctrl.pos.y === 25;
		if (!Memory.roomOk) return;
	}
	jitterK();
	for (const n in Memory.creeps) if (!Game.creeps[n]) delete Memory.creeps[n];
	const spawn = Object.values(Game.spawns)[0];
	if (!spawn) return;
	const room = spawn.room;
	// hybrid shape (K.ringTo): ring below the gate RCL, legacy triple after — refresh BOXES/SLOTS
	shape(room.controller.level);
	global.HOME = room.name;
	if (Game.time % 25 === 0) plan(room);
	roads(room.name);
	// smoothed control points per tick, for the upgrader count
	const cum =
		room.controller.progress +
		_.sum(_.range(1, room.controller.level), (i) => CONTROLLER_LEVELS[i]);
	Memory.upRate = 0.98 * (Memory.upRate || 0) + 0.02 * (cum - (Memory.upCum || cum));
	Memory.upCum = cum;
	if (K.towUp || K.towMiner) towAssign(room.name);
	const by = _.groupBy(Game.creeps, (c) => c.memory.type);
	global.BUILDERS = (by.builder || []).length;
	for (const name in Game.creeps) {
		const c = Game.creeps[name];
		if (c.spawning) continue;
		// no tug came, or the tow takes far too long: walk
		if (
			c.memory.tow &&
			!c.memory.arrived &&
			c.getActiveBodyparts(MOVE) &&
			1500 - c.ticksToLive >
				(c.memory.tug ? 2 * K.towWait + 3 * (c.memory.dist || 20) : 2 * K.towWait)
		)
			c.memory.arrived = 1;
		if (c.memory.tow && !c.memory.arrived) {
			if (c.pos.isEqualTo(towDest(c, room.name))) c.memory.arrived = 1;
			else {
				const t = c.memory.tug && Game.creeps[c.memory.tug];
				// the tug went over the border first: step onto the exit to follow
				if (
					t &&
					t.memory.towing === c.name &&
					t.room.name !== c.room.name &&
					c.getActiveBodyparts(MOVE)
				)
					c.moveTo(t.pos, { reusePath: 0 });
				// A mobile miner can start toward its post while waiting for a free towing unit.
				else if (K.walkToTow && !t && c.getActiveBodyparts(MOVE))
					c.moveTo(towDest(c, room.name), { reusePath: 10 });
				continue;
			}
		}
		// the spawn's exit (hub 1's container tile) is never a place to stand
		// the exit tile is cleared only when a newborn is due (spawn26: it is also the way out of the upgrade block)
		const exitDue = !S26 || (spawn.spawning && spawn.spawning.remainingTime <= 2);
		if (EXIT && exitDue && c.room.name === room.name && c.pos.isEqualTo(EXIT[0], EXIT[1])) {
			const free = [TOP, TOP_LEFT, TOP_RIGHT, LEFT, RIGHT].find((d) => {
				const [dx, dy] = DXY[d];
				return (
					!room.lookForAt(LOOK_CREEPS, c.pos.x + dx, c.pos.y + dy).length &&
					!room
						.lookForAt(LOOK_STRUCTURES, c.pos.x + dx, c.pos.y + dy)
						.some((s) => OBSTACLE_OBJECT_TYPES.includes(s.structureType))
				);
			});
			c.move(free || TOP);
			continue;
		}
		TYPES[c.memory.type](c, room.name);
	}
	if (K.jamTicks) unjam();
	if (K.shove) shove();
	global.MV = {};
	if (Memory.debug) debug(room, by, spawn);
	// spawn26: a newborn is due but its tile is taken: whoever stands there steps aside
	if (S26 && spawn.spawning && spawn.spawning.remainingTime === 0) {
		for (const d of spawn.spawning.directions || [BOTTOM]) {
			const [dx, dy] = DXY[d];
			const o = room.lookForAt(LOOK_CREEPS, SPAWN.x + dx, SPAWN.y + dy)[0];
			if (o && o.my && o.getActiveBodyparts(MOVE)) {
				const away = [BOTTOM, BOTTOM_LEFT, BOTTOM_RIGHT, LEFT, RIGHT].find((e) => {
					const [ex, ey] = DXY[e];
					const x = o.pos.x + ex,
						y = o.pos.y + ey;
					return (
						!(x === SPAWN.x && y === SPAWN.y) &&
						!room.lookForAt(LOOK_CREEPS, x, y).length &&
						room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL
					);
				});
				if (away) o.move(away);
			}
		}
	}
	if (S27 && spawn.spawning && spawn.spawning.remainingTime <= 2) {
		// keep one lane tile under the spawn free for the newborn
		const below = [16, 17, 18].map((x) => room.lookForAt(LOOK_CREEPS, x, SPAWN.y + 1)[0]);
		if (below.every(Boolean) && below[1].my) below[1].move(BOTTOM);
	}
	if (K.rec) record(room, by, spawn, spawn.spawning ? null : nextSpawn(room, by));
	if (spawn.spawning) return;
	const s = nextSpawn(room, by);
	// pass mode renews whoever stands by the spawn, but only in ticks the spawn would idle anyway (nothing it can
	// pay for now); an upgrader parked by the spawn is renewed first when it runs low, since nothing replaces it
	if (K.renew && (K.renewPass || S26) && SIN && renewLow(spawn)) return;
	const renewOk =
		K.renewPass === 2
			? !(s && ["miner", "reserver", "hubFiller"].includes(s.type)) // renew instead of a hauler/upgrader
			: K.renewPass
				? !(s && cost(s.body) <= room.energyAvailable) // only in ticks the spawn would idle
				: !global.URGENT && !(s && ["miner", "reserver", "hubFiller"].includes(s.type));
	if (K.renew && (SIN || BAYS) && renewOk && renew(spawn, room)) return;
	if (K.fillerJump && s && s.type !== "hubFiller" && cost(s.body) > room.energyAvailable) {
		const f =
			global.WANT &&
			global.WANT.find((w) => w.type === "hubFiller" && cost(w.body) <= room.energyAvailable);
		if (f) return spawnIt(f);
	}
	if (!s || cost(s.body) > room.energyAvailable) return;
	spawnIt(s);
}

export { loop };
