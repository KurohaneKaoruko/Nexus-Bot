// @ts-nocheck
import { L, cost } from "./layout";
import { boxEnergy, hubBoxes } from "./economy";
/**
 * 遥测: record (每 tick 能量台账 + 每 100t 一行快照), debug (Memory.debug 周期状态行)。
 */

// K.rec: every tick the energy ledger (Memory.L), every 100 ticks one row in Memory.R: elapsed tick, RCL and
// control, energy, structures, piles, boxes, and per role creeps/parts at home and away.
function record(room, by, spawn, s) {
	const l = (Memory.L = Memory.L || {});
	L(
		"decay",
		_.sum(Game.rooms, (r) =>
			_.sum(r.find(FIND_DROPPED_RESOURCES), (p) => Math.ceil(p.amount / 1000)),
		),
	);
	const c = room.controller;
	L(
		"upWorkAvailable",
		_.sum(by.upgrader || [], (u) => u.getActiveBodyparts(WORK)),
	);
	L(
		"upWorkOnPost",
		_.sum(
			(by.upgrader || []).filter((u) => !u.spawning && u.pos.inRangeTo(c, 3)),
			(u) => u.getActiveBodyparts(WORK),
		),
	);
	L(
		"upWorkFed",
		_.sum(
			(by.upgrader || []).filter((u) => !u.spawning && u.pos.inRangeTo(c, 3)),
			(u) => Math.min(u.store.energy, u.getActiveBodyparts(WORK)),
		),
	);
	const cum = c.progress + _.sum(_.range(1, c.level), (i) => CONTROLLER_LEVELS[i]);
	L("control", cum - (Memory.cumR === undefined ? cum : Memory.cumR));
	Memory.cumR = cum;
	if (!spawn.spawning)
		L(!s ? "idle_none" : cost(s.body) > room.energyAvailable ? "idle_poor_" + s.type : "go_" + s.type, 1);
	else if (spawn.spawning.remainingTime === 0) L("blocked", 1); // done but no free tile to step onto
	const el = Game.time - Memory.boot.t;
	if (el % 100 !== 99) return;
	const st = _.countBy(room.find(FIND_STRUCTURES), "structureType");
	const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
	const roles = {};
	for (const r in by)
		roles[r] = [
			by[r].length,
			_.sum(by[r], (x) => x.body.length),
			_.filter(by[r], (x) => x.room.name === room.name).length,
		];
	const pile = (rs) => _.sum(rs, (r) => _.sum(r.find(FIND_DROPPED_RESOURCES), "amount"));
	// where the away-from-home energy actually lies: per room totals and the bigger piles by tile
	const away = _.filter(Game.rooms, (r) => r.name !== room.name);
	const pr = {};
	const pp = [];
	for (const r of away)
		for (const p of r.find(FIND_DROPPED_RESOURCES)) {
			pr[r.name] = (pr[r.name] || 0) + p.amount;
			if (p.amount >= 150) pp.push(`${r.name}:${p.pos.x},${p.pos.y}=${p.amount}`);
		}
	const R = (Memory.R = Memory.R || []);
	R.push({
		t: el + 1,
		pr,
		pp,
		rcl: c.level,
		cum,
		e: room.energyAvailable,
		cap: room.energyCapacityAvailable,
		ext: st.extension || 0,
		box: st.container || 0,
		site: _.sum(sites, (x) => x.progressTotal - x.progress),
		pileH: pile([room]),
		pileA: pile(_.filter(Game.rooms, (r) => r.name !== room.name)),
		boxE: boxEnergy(room).energy,
		hub: _.sum(hubBoxes(room), (b) => b.store.energy),
		roles,
		L: l,
	});
	if (R.length > 220) R.shift();
	Memory.L = {};
}

// sim only: scenario memory {"debug": N} prints a status line and an energy ledger every N ticks
function debug(room, by, spawn, _next) {
	const l = (Memory.L = Memory.L || {});
	L(
		"decay",
		_.sum(Game.rooms, (r) =>
			_.sum(r.find(FIND_DROPPED_RESOURCES), (p) => Math.ceil(p.amount / 1000)),
		),
	);
	const c = room.controller;
	L(
		"upWorkAvailable",
		_.sum(by.upgrader || [], (u) => u.getActiveBodyparts(WORK)),
	);
	L(
		"upWorkOnPost",
		_.sum(
			(by.upgrader || []).filter((u) => !u.spawning && u.pos.inRangeTo(c, 3)),
			(u) => u.getActiveBodyparts(WORK),
		),
	);
	L(
		"upWorkFed",
		_.sum(
			(by.upgrader || []).filter((u) => !u.spawning && u.pos.inRangeTo(c, 3)),
			(u) => Math.min(u.store.energy, u.getActiveBodyparts(WORK)),
		),
	);
	const cum = c.progress + _.sum(_.range(1, c.level), (i) => CONTROLLER_LEVELS[i]);
	L("control", cum - (Memory.cum || 0));
	Memory.cum = cum;
	if (!spawn.spawning) L(boxEnergy(room).energy > 1000 ? "idleBoxFull" : "idleBoxLow", 1);
	if (Game.time % Memory.debug) return;
	const n = _.mapValues(by, (g) => `${g.length}/${_.sum(g, (x) => x.body.length)}p`);
	const up = _.sum(by.upgrader || [], (x) => x.getActiveBodyparts(WORK));
	const piles = _.sum(Game.rooms, (r) => _.sum(r.find(FIND_DROPPED_RESOURCES), "amount"));
	console.log(
		`t${Game.time} rcl${c.level}+${c.progress} e${room.energyAvailable}/${room.energyCapacityAvailable} box${boxEnergy(room).energy} piles${piles} upW${up} ${JSON.stringify(n)}`,
	);
	console.log(`   ledger ${JSON.stringify(l)}`);
	Memory.L = {};
}

export { record, debug };
