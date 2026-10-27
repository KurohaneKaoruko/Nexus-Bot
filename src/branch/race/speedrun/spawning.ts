// @ts-nocheck
import {
	SPAWN,
	S27,
	S26,
	S29,
	S29B,
	SIN,
	BAYS,
	BAY,
	BOXES,
	RING_HOME,
	SLOTS,
	HUBS,
	K,
	REMOTES,
	pos,
	NOW,
	L,
	cost,
	bodyCost,
	SPF_POS,
} from "./layout";
import { sources, hubBox, boxEnergy, resRooms } from "./economy";
import { generateCreepName } from "@/utils/naming";
/**
 * 孵化调度: 身体规格 (repeat/remoteMiner/haulerSpec)、定编口径 (reservedRate/resRooms)、
 * LP 计划路径 (planTime/planAt/planSpawn/dueAt/replaySpawn, K.usePlan 控制)、
 * 程序化调度 (nextSpawn, usePlan=0 的实测最优路径)、续能 (renew/renewLow)、
 * 新档清账 (newRun) 与孵化执行 (spawnIt)。
 */
import PLAN from "./plan.json";

function repeat(unit, cost, cap, max) {
	const n = Math.max(1, Math.min(max, Math.floor(cap / cost)));
	const out = [];
	for (let i = 0; i < n; i++) out.push(...unit);
	return out;
}

// as many WORK as the capacity buys (up to w), a MOVE per two (per three when that is what fits), one CARRY to hand off
function remoteMiner(w, cap) {
	for (let W = w; W > 2; W--)
		for (const M of [Math.ceil(W / 2), Math.ceil(W / 3)])
			if (100 * W + 50 * M + 50 <= cap)
				return [...Array(W).fill(WORK), ...Array(M).fill(MOVE), CARRY];
	return [WORK, WORK, MOVE, CARRY];
}

// Hub 1's fillers are born directly onto their posts; other layouts still need MOVE.
const fillerBody = (hi) => [
	CARRY,
	CARRY,
	CARRY,
	CARRY,
	...(K.fixedFill && hi === 0 && !SIN ? [] : [MOVE]),
];

// hauler for source s with n CARRY: 2 CARRY : 1 MOVE once its road stands; while its road is being laid
// (and paving has begun) one WORK rides along to build the sites it passes

function haulerSpec(s, cap, n) {
	// haulMax: cap the CARRY per hauler — a bigger body fills slower at a hand-off miner, so a high cap must
	// not turn the fleet into a few slow haulers (the carry need is the same either way)
	if (K.haulMax) n = Math.min(n, K.haulMax);
	const paved = Memory.roadDone && Memory.roadDone[s.k];
	if (paved) {
		const pairs = Math.max(1, Math.min(16, Math.floor(cap / 150), Math.ceil(n / 2)));
		return {
			type: "hauler",
			body: [...Array(2 * pairs).fill(CARRY), ...Array(pairs).fill(MOVE)],
			k: s.k,
			i: s.i,
			room: s.room,
			dist: s.dist,
		};
	}
	const paving =
		K.paved &&
		!K.crew &&
		NOW() >= K.roadFrom &&
		Memory.roads &&
		Memory.roads.some((r) => r.k === s.k);
	if (paving && cap >= 300) {
		const nc = Math.max(1, Math.min(n, 23, Math.floor((cap - 150) / 100)));
		return {
			type: "hauler",
			body: [WORK, ...Array(nc).fill(CARRY), ...Array(nc + 1).fill(MOVE)],
			k: s.k,
			i: s.i,
			room: s.room,
			dist: s.dist,
			pave: 1,
		};
	}
	return {
		type: "hauler",
		body: repeat([CARRY, MOVE], 100, cap, n),
		k: s.k,
		i: s.i,
		room: s.room,
		dist: s.dist,
	};
}

function reservedRate(s, _home) {
	if (s.home) return 10;
	const ctrl = Game.rooms[s.room] && Game.rooms[s.room].controller;
	if (ctrl && ctrl.my) return 10;
	return ctrl &&
		ctrl.reservation &&
		ctrl.reservation.username === Game.spawns[Object.keys(Game.spawns)[0]].owner.username
		? 10
		: 5;
}

// The plan is followed by progress, not by the clock: plan time advances to the bucket whose planned
// cumulative harvest matches what we've really harvested, so the roster stays in proportion to the economy.
function planTime() {
	const got = Memory.harvested || 0;
	let b = 0;
	while (b + 1 < PLAN.length && PLAN[b + 1].hc <= got) b++;
	return b * 100;
}
const PLAN_ORDER = { hauler: 0, miner: 1, reserver: 2, upgrader: 3, builder: 4 };
const planAt = (t) => PLAN[Math.max(0, Math.min(PLAN.length - 1, Math.floor(t / 100)))];

// Spawn whatever job is furthest below the plan at the moment its creep would start work
// (now + spawn time + walk). Fillers and the wipe recovery still come first.
function planSpawn(room, by) {
	const home = room.name;
	const cap = room.energyCapacityAvailable;
	const srcs = sources(home);
	const homeSrcs = srcs.filter((s) => s.home);
	if (!(by.hauler || []).length) {
		if (!(by.miner || []).length)
			return {
				type: "miner",
				body: [WORK, WORK, MOVE],
				i: homeSrcs[0].i,
				k: homeSrcs[0].k,
				room: home,
				dist: homeSrcs[0].dist,
			};
		return {
			type: "hauler",
			body: repeat([CARRY, MOVE], 100, Math.max(room.energyAvailable, 100), 25),
			i: homeSrcs[0].i,
			k: homeSrcs[0].k,
			room: home,
			dist: homeSrcs[0].dist,
		};
	}
	const workingAt = (role, f, lead) =>
		(by[role] || []).filter((c) => f(c) && (c.spawning || c.ticksToLive > lead));
	for (let hi = 0; hi < HUBS.length; hi++) {
		if (!hubBox(room, HUBS[hi])) continue;
		for (let f = 0; f < 2; f++)
			if (!workingAt("hubFiller", (c) => c.memory.h === hi && c.memory.f === f, 15).length)
				return {
					type: "hubFiller",
					body: fillerBody(hi),
					h: hi,
					f,
					dir: hi === 0 && !SIN ? [f ? RIGHT : LEFT] : null,
				};
	}
	const T = K.planClock ? Game.time : planTime();
	const cands = [];
	// every job's shortfall relative to its plan; ties go to the earlier role in ORDER (haulers first)
	const consider = (spec, want, have, step) => {
		if (want - have >= step)
			cands.push({ spec, gap: (want - have) / Math.max(want, step), order: PLAN_ORDER[spec.type] });
	};
	for (const s of srcs) {
		const p = planAt(T);
		const rate = reservedRate(s, home);
		const w = Math.ceil(rate / 2) + (s.home ? 0 : rate === 5 ? K.minerExtra5 : K.minerExtra);
		const minerBody = s.home
			? [...Array(Math.min(w, Math.floor((cap - 100) / 100))).fill(WORK), CARRY, MOVE]
			: remoteMiner(w, cap);
		// one miner a tile: the plan says whether the source is worked at all
		const leadM = minerBody.length * 3 + (s.home ? 70 : 2 * s.dist);
		const wantW = planAt(T + leadM).W[s.k] || 0;
		if (wantW >= 1 && !workingAt("miner", (c) => c.memory.k === s.k, leadM).length)
			cands.push({
				spec: { type: "miner", body: minerBody, k: s.k, i: s.i, room: s.room, dist: s.dist },
				gap: 1,
				order: 1,
			});
		// haulers only for a source that has (or is getting) its miner
		const mined = (by.miner || []).some((c) => c.memory.k === s.k);
		const wantC = mined ? planAt(T + 45).C[s.k] || 0 : 0;
		const haveC = _.sum(
			workingAt("hauler", (c) => c.memory.k === s.k, 45),
			(c) => c.getActiveBodyparts(CARRY),
		);
		const n = Math.max(
			1,
			Math.min(
				25,
				Math.floor(cap / 100),
				K.haulMax || 25,
				Math.round(wantC - haveC),
			),
		);
		consider(
			{
				type: "hauler",
				body: repeat([CARRY, MOVE], 100, cap, n),
				k: s.k,
				i: s.i,
				room: s.room,
				dist: s.dist,
			},
			wantC,
			haveC,
			2,
		);
		// reservers: the plan says when a room is held; successors overlap by K.resLead so it never lapses
		if (
			!s.home &&
			cap >= 650 &&
			srcs.find((x) => x.room === s.room) === s &&
			(p.K[s.room] || 0) >= 0.5 &&
			!workingAt("reserver", (c) => c.memory.room === s.room, K.resLead + 6 + s.dist).length
		)
			cands.push({
				spec: {
					type: "reserver",
					body: repeat([CLAIM, MOVE], 650, cap, K.claims),
					room: s.room,
					dist: s.dist,
				},
				gap: 1,
				order: 2,
			});
	}
	// ring: the relay block feeds on 100-CARRY handoffs — two CARRY double the pass/pickup
	// bandwidth, paid for with one WORK so the body always fits the spawn budget
	const upW = Math.min(30, Math.floor((cap - (RING_HOME.v ? 150 : 100)) / 100));
	const upCarry = RING_HOME.v ? 2 : 1;
	const haveU = _.sum(
		workingAt("upgrader", () => true, 30),
		(c) => c.getActiveBodyparts(WORK),
	);
	const upgrader = {
		type: "upgrader",
		body: [...Array(upW).fill(WORK), ...Array(upCarry).fill(CARRY), MOVE],
	};
	// the plan's trickle of early upgrading (RCL2 gates the extensions) is less than one creep: still send one
	// upMul: scale the plan's WORK target — a high cap makes each upgrader carry more WORK than the plan, and
	// the plan gate would otherwise stop refills long before the slots are full
	const upTarget = planAt(T + 30).U * (K.upMul || 1);
	if (upTarget > 0 && !(by.upgrader || []).length)
		cands.push({ spec: upgrader, gap: 1, order: 1.2 });
	else if ((by.upgrader || []).length < SLOTS.length)
		consider(upgrader, upTarget, haveU, Math.max(1, upW / 2));
	// builders: the plan's WORK, but never less than the open sites need (the plan's early building is optimistic,
	// and extensions 6-7 gate the reservers)
	const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
	const left = _.sum(sites, (x) => x.progressTotal - x.progress);
	const haveB = _.sum(
		workingAt("builder", () => true, 20),
		(c) => c.getActiveBodyparts(WORK),
	);
	const nb = Math.max(1, Math.min(5, Math.floor(cap / 200)));
	const builder = { type: "builder", body: repeat([WORK, CARRY, MOVE], 200, cap, nb) };
	// behind the plan's extensions (the 7th gates the reservers): enough WORK to catch up within K.buildWithin ticks
	const exts = room.find(FIND_MY_STRUCTURES, {
		filter: (x) => x.structureType === STRUCTURE_EXTENSION,
	}).length;
	const catchUp =
		exts < Math.max(Math.floor(planAt(T).ext + 0.01), K.extBoost)
			? Math.min(K.buildMaxW, Math.ceil(left / (1.25 * K.buildWithin)))
			: 0;
	if (left) consider(builder, Math.max(planAt(T + 20).Bw, catchUp), haveB, 1);
	if (!cands.length) return null;
	cands.sort((a, b) => b.gap - a.gap || a.order - b.order);
	return cands[0].spec;
}

// Replay the LP's spawn schedule: per category the plan says how many parts are spawned by each bucket
// (PLAN[b].S, cumulative). Whatever has been due the longest goes next; miners (one per source) are due
// when the plan wants the source worked at arrival time and no miner covers it.

function dueAt(cat, done) {
	for (let b = 0; b < PLAN.length; b++) if ((PLAN[b].S[cat] || 0) >= done) return b * 100;
	return Infinity;
}
function replaySpawn(room, by) {
	const home = room.name;
	const cap = room.energyCapacityAvailable;
	const srcs = sources(home);
	const homeSrcs = srcs.filter((s) => s.home);
	const t = Game.time;
	const sp = (Memory.sp = Memory.sp || {});
	if (!(by.hauler || []).length) {
		if (!(by.miner || []).length)
			return {
				type: "miner",
				body: [WORK, WORK, MOVE],
				i: homeSrcs[0].i,
				k: homeSrcs[0].k,
				room: home,
				dist: homeSrcs[0].dist,
			};
		return {
			type: "hauler",
			body: repeat([CARRY, MOVE], 100, Math.max(room.energyAvailable, 100), 25),
			i: homeSrcs[0].i,
			k: homeSrcs[0].k,
			room: home,
			dist: homeSrcs[0].dist,
			cat: "C:" + homeSrcs[0].k,
			n: 1,
		};
	}
	for (let hi = 0; hi < HUBS.length; hi++) {
		if (!hubBox(room, HUBS[hi])) continue;
		for (let f = 0; f < 2; f++)
			if (
				!(by.hubFiller || []).some(
					(c) => c.memory.h === hi && c.memory.f === f && (c.spawning || c.ticksToLive > 15),
				)
			)
				return {
					type: "hubFiller",
					body: fillerBody(hi),
					h: hi,
					f,
					dir: hi === 0 && !SIN ? [f ? RIGHT : LEFT] : null,
				};
	}
	const cands = [];
	const late = (cat, chunk) => {
		const due = dueAt(cat, (sp[cat] || 0) + chunk / 2);
		return due <= t ? t - due : null;
	};
	for (const s of srcs) {
		// miner: due when the plan wants the source worked once a new miner would arrive
		const rate = reservedRate(s, home);
		const lead = 3 * 6 + (s.home ? 70 : 2 * s.dist);
		const w = Math.min(s.home ? 5 : 6, Math.ceil(planAt(t + lead).W[s.k] || 0));
		const cover = _.max(
			(by.miner || [])
				.filter((c) => c.memory.k === s.k)
				.map((c) => (c.spawning ? 1500 : c.ticksToLive))
				.concat([0]),
		);
		if (w >= 1 && cover <= lead) {
			let first = t; // when did the plan start wanting this source (for a fresh source) or the old miner run out
			if (cover > 0) first = t - (lead - cover);
			else
				for (let b = Math.floor(t / 100); b >= 0 && (planAt(b * 100 + lead).W[s.k] || 0) >= 1; b--)
					first = b * 100;
			const body = s.home
				? [
						...Array(
							Math.min(Math.max(w, Math.ceil(rate / 2)), Math.floor((cap - 100) / 100)),
						).fill(WORK),
						CARRY,
						MOVE,
					]
				: remoteMiner(Math.max(w, Math.ceil(rate / 2)), cap);
			cands.push({
				late: t - first,
				spec: { type: "miner", body, k: s.k, i: s.i, room: s.room, dist: s.dist },
			});
		}
		// haulers: the schedule's CARRY for this source, as big as the capacity allows
		const cat = "C:" + s.k;
		const maxC = Math.min(25, Math.floor(cap / 100));
		const owe = (PLAN[Math.min(PLAN.length - 1, Math.floor(t / 100))].S[cat] || 0) - (sp[cat] || 0);
		const n = Math.max(1, Math.min(maxC, Math.round(owe)));
		const lh = late(cat, n);
		if (lh !== null)
			cands.push({
				late: lh,
				spec: {
					type: "hauler",
					body: repeat([CARRY, MOVE], 100, cap, n),
					k: s.k,
					i: s.i,
					room: s.room,
					dist: s.dist,
					cat,
					n,
				},
			});
		if (!s.home && srcs.find((x) => x.room === s.room) === s && cap >= 650) {
			const kc = "K:" + s.room;
			const lk = late(kc, 1);
			if (lk !== null)
				cands.push({
					late: lk,
					spec: { type: "reserver", body: [CLAIM, MOVE], room: s.room, dist: s.dist, cat: kc, n: 1 },
				});
		}
	}
	const upW = Math.max(1, Math.min(30, Math.floor((cap - (RING_HOME.v ? 150 : 100)) / 100)));
	const upCarry = RING_HOME.v ? 2 : 1;
	const lu = late("U", upW);
	if (lu !== null && (by.upgrader || []).length < SLOTS.length)
		cands.push({
			late: lu,
			spec: {
				type: "upgrader",
				body: [...Array(upW).fill(WORK), ...Array(upCarry).fill(CARRY), MOVE],
				cat: "U",
				n: upW,
			},
		});
	const nb = Math.max(1, Math.min(5, Math.floor(cap / 200)));
	const lb = late("B", nb);
	if (lb !== null && room.find(FIND_MY_CONSTRUCTION_SITES).length)
		cands.push({
			late: lb,
			spec: { type: "builder", body: repeat([WORK, CARRY, MOVE], 200, cap, nb), cat: "B", n: nb },
		});
	if (!cands.length) return null;
	return _.max(cands, "late").spec;
}

// a hauler that renewal would pay for (big enough body, life used up past one renew) stops in a free bay,
// unloads into the hub (or the spawn) and waits until renewed, then carries on
export const renewable = (c, room) =>
	c.ticksToLive < 1500 - Math.floor(600 / c.body.length) - 20 &&
	bodyCost(c) >= K.renewHaul * room.energyCapacityAvailable;
// in a bay: the spawn and extensions first, then hub 1
export function bayUnload(c, room) {
	if (!c.store.energy) return;
	const t = c.pos.findInRange(FIND_MY_STRUCTURES, 1, {
		filter: (x) =>
			(x.structureType === STRUCTURE_EXTENSION || x.structureType === STRUCTURE_SPAWN) &&
			x.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	})[0];
	const hub = hubBox(room, HUBS[0]);
	const box = c.pos.findInRange(FIND_STRUCTURES, 1, {
		filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store.getFreeCapacity() > 0,
	})[0];
	if (t) c.transfer(t, RESOURCE_ENERGY);
	else if (hub && c.pos.isNearTo(hub) && hub.store.getFreeCapacity() > 0)
		c.transfer(hub, RESOURCE_ENERGY);
	else if (box) c.transfer(box, RESOURCE_ENERGY);
}
export function bayStop(c, room, home) {
	if (K.renewPass) return false; // pass mode: renewed only if it happens to stand by the spawn
	const at = BAY.find(([x, y]) => c.pos.isEqualTo(x, y));
	if (!renewable(c, room)) return false;
	if (at) {
		bayUnload(c, room);
		return true; // wait for the spawn
	}
	if (c.pos.getRangeTo(SPAWN.x, SPAWN.y) > 8) return false;
	// only when the load has somewhere to go: hub 1 with room for it
	const hub = hubBox(room, HUBS[0]);
	if (!S29B && (!hub || hub.store.getFreeCapacity() < Math.min(K.bayFree, c.store.energy)))
		return false;
	const free = BAY.filter(([x, y]) => !room.lookForAt(LOOK_CREEPS, x, y).length);
	if (!free.length) return false;
	c.moveTo(pos(free[0][0], free[0][1], home), { reusePath: 5 });
	return true;
}

// renew whichever adjacent upgrader/hauler is oldest, if its body is still worth keeping
function renew(spawn, room) {
	const cap = room.energyCapacityAvailable;
	const upW = Math.floor((cap - 100) / 100);
	const c = _.min(
		spawn.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: (o) =>
				!o.spawning &&
				o.ticksToLive < 1500 - Math.floor(600 / o.body.length) &&
				!o.getActiveBodyparts(CLAIM) &&
				room.controller.level >= K.renewRcl &&
				(o.memory.type === "hubFiller" ||
					o.memory.type === "spawnFiller" ||
					(o.memory.type === "upgrader" && o.getActiveBodyparts(WORK) >= Math.min(upW, K.renewUpW)) ||
					(o.memory.type === "hauler" && bodyCost(o) >= K.renewHaul * cap)),
		}),
		"ticksToLive",
	);
	if (c === Infinity || !c) return false;
	if (spawn.renewCreep(c) !== OK) return false;
	L("renew", 1);
	return true;
}

function renewLow(spawn) {
	const upW = Math.floor((spawn.room.energyCapacityAvailable - 100) / 100);
	const c = _.min(
		spawn.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: (o) =>
				!o.spawning &&
				o.memory.type === "upgrader" &&
				o.ticksToLive < K.upRenewAt &&
				o.getActiveBodyparts(WORK) >= Math.min(upW, K.renewUpW) &&
				spawn.room.controller.level >= K.renewRcl,
		}),
		"ticksToLive",
	);
	if (c === Infinity || !c || spawn.renewCreep(c) !== OK) return false;
	L("renew", 1);
	return true;
}

function nextSpawn(room, by) {
	if (K.usePlan === 2) return replaySpawn(room, by);
	if (K.usePlan) return planSpawn(room, by);
	const home = room.name;
	const cap = room.energyCapacityAvailable;
	const rcl = room.controller.level;
	// a successor must be out before its predecessor dies: spawn time plus the walk at the body's own speed
	// (a miner carries more WORK than MOVE: ~W/M ticks a tile)
	// ticks a tile on plain ground: each WORK makes 2 fatigue, each MOVE removes 2 a tick (empty CARRY weigh nothing)
	const pace = (c) =>
		Math.max(
			1,
			(K.walkCeil ? Math.ceil : (x) => x)(
				c.getActiveBodyparts(WORK) / Math.max(1, c.getActiveBodyparts(MOVE)),
			),
		);
	const walk = (c) =>
		c.memory.tow
			? K.towWait + (c.memory.dist || 0)
			: (c.memory.dist || 0) * (K.walkLead ? pace(c) : 1);
	// successors are queued early by K.minerLead more ticks (the spawn queue delays them): no vacant source
	const pre = (c) => (c.memory.type === "miner" ? K.minerLead : 0);
	const alive = (role, f) =>
		(by[role] || []).filter(
			(c) => (!f || f(c)) && (c.spawning || c.ticksToLive > c.body.length * 3 + walk(c) + pre(c)),
		);
	const srcs = sources(home);
	const homeSrcs = srcs.filter((s) => s.home);
	const remotes = srcs.filter((s) => !s.home).slice(0, REMOTES[rcl]);

	// a wipe (or the very first tick): whatever the spawn holds right now
	if (!(by.hauler || []).length) {
		if (!(by.miner || []).length)
			return {
				type: "miner",
				body: [WORK, WORK, MOVE],
				i: homeSrcs[0].i,
				k: homeSrcs[0].k,
				room: home,
				dist: homeSrcs[0].dist,
			};
		return {
			type: "hauler",
			body: repeat([CARRY, MOVE], 100, Math.max(room.energyAvailable, 100), 25),
			i: homeSrcs[0].i,
			k: homeSrcs[0].k,
			room: home,
			dist: homeSrcs[0].dist,
		};
	}
	// Claim external sources using available GCL. All creeps still come from the original spawn.
	// An unaffordable claim must not block replacement miners, haulers or hub fillers.
	if (
		K.claimRooms &&
		!Memory.claimDisabled &&
		cap >= 650 &&
		room.energyAvailable >= 650 &&
		NOW() >= (K.claimFrom || 3500)
	) {
		const owned = _.filter(Game.rooms, (r) => r.controller && r.controller.my).length;
		const pending = (by.claimer || []).filter((c) => !Game.rooms[c.memory.room]?.controller?.my);
		const targets = _.uniq(srcs.filter((s) => !s.home).map((s) => s.room)).slice(0, K.claimRooms);
		if (owned + pending.length < Game.gcl.level) {
			const target = targets.find(
				(rn) => !Game.rooms[rn]?.controller?.owner && !pending.some((c) => c.memory.room === rn),
			);
			if (target) return { type: "claimer", body: [CLAIM, MOVE], room: target };
		}
	}
	const work = (s) => {
		const rate = reservedRate(s, home);
		const out = [];
		const w = Math.ceil(rate / 2) + (s.home ? 0 : rate === 5 ? K.minerExtra5 : K.minerExtra);
		// Keep one MOVE for border crossings and walking when no towing unit is free.
		const towing = K.towMiner && rcl >= 2;
		// Drop miners hand their output to haulers via the ground, saving a CARRY part.
		const carry = K.dropMiners ? [] : [CARRY];
		const minerBody = towing
			? [
					...Array(
						Math.min(
							w + (s.home ? 0 : K.towExtraW),
							Math.floor((cap - 50 - 50 * carry.length) / 100),
						),
					).fill(WORK),
					...carry,
					MOVE,
				]
			: s.home
				? [...Array(Math.min(w, Math.floor((cap - 100) / 100))).fill(WORK), CARRY, MOVE]
				: remoteMiner(w, cap);
		if (!alive("miner", (c) => c.memory.k === s.k && !c.memory.alt).length) {
			// a source already vacant (or about to be) loses its whole output every tick: that request leads the queue
			const cover = _.max(
				(by.miner || [])
					.filter((c) => c.memory.k === s.k && !c.memory.alt)
					.map((c) => (c.spawning ? 1500 : c.ticksToLive))
					.concat([0]),
			);
			// Protect established nearby mines without spending the spawn queue on
			// distant harvest that the transport fleet cannot bring home.
			const established = cover > 0 || (K.recoverMiner && Memory.mined && Memory.mined[s.k]);
			const near = !K.urgentNear || s.home || s.dist <= K.urgentNear;
			const urgent = K.succFirst && established && near && cover < K.succFirst;
			out.push({
				type: "miner",
				body: minerBody,
				k: s.k,
				i: s.i,
				room: s.room,
				dist: s.dist,
				urgent,
				...(towing ? { tow: 1, dir: [TOP_LEFT, TOP_RIGHT] } : {}),
			});
		}
		// haul what the miner actually digs (small early miners make less than the source gives)
		const dug = Math.min(
			rate,
			2 *
				_.sum(
					alive("miner", (c) => c.memory.k === s.k),
					(c) => c.getActiveBodyparts(WORK),
				),
		);
		const hc = Math.min(25, K.hcap);
		const slack =
			rcl < K.slackRcl
				? K.slackEarly
				: s.home
					? K.slackHome || K.slack
					: rate >= 10
						? K.slackReserved || K.slack
						: K.slackUnreserved || K.slack;
		const needCarry = Math.ceil(
			(dug * (2 * s.dist + 6) * slack) / 50 + (K.mxfer ? hc * K.hwait : 0),
		);
		const haveCarry = _.sum(
			alive("hauler", (c) => c.memory.k === s.k),
			(c) => c.getActiveBodyparts(CARRY),
		);
		if (haveCarry < needCarry)
			out.push({
				...haulerSpec(s, cap, Math.min(hc, Math.max(needCarry - haveCarry, K.mxfer ? hc : 1))),
				ratio: haveCarry / needCarry,
			});
		// early on a home source gets a second small miner beside the first while one body can't empty it
		if (
			s.home &&
			rcl <= K.m2Rcl &&
			alive("miner", (c) => c.memory.k === s.k && !c.memory.alt).length
		) {
			const mainW = _.sum(
				alive("miner", (c) => c.memory.k === s.k && !c.memory.alt),
				(c) => c.getActiveBodyparts(WORK),
			);
			if (
				mainW < Math.ceil(rate / 2) &&
				!alive("miner", (c) => c.memory.k === s.k && c.memory.alt).length
			)
				out.push({
					type: "miner",
					alt: 1,
					body: [
						...Array(Math.min(Math.ceil(rate / 2) - mainW, Math.floor((cap - 100) / 100))).fill(
							WORK,
						),
						CARRY,
						MOVE,
					],
					k: s.k,
					i: s.i,
					room: s.room,
					dist: s.dist,
				});
		}
		// the successor leaves early enough to overlap: with one CLAIM a reservation only holds, the overlap is the buffer
		const resHolder =
			(K.resNear ? srcs.find((x) => x.room === s.room) === s : s.i === 0) &&
			resRooms(srcs).includes(s.room);
		if (
			!s.home &&
			cap >= 650 &&
			resHolder &&
			!alive(
				"reserver",
				(c) =>
					c.memory.room === s.room &&
					c.ticksToLive > K.resLead + c.body.length * 3 + (c.memory.dist || 0),
			).length
		) {
			const ctrl = Game.rooms[s.room] && Game.rooms[s.room].controller;
			if (
				(!ctrl || !ctrl.my) &&
				(!ctrl || !ctrl.reservation || ctrl.reservation.ticksToEnd < K.reserveBuffer)
			)
				out.push({
					type: "reserver",
					body: repeat([CLAIM, MOVE], 650, cap, K.claims),
					room: s.room,
					dist: s.dist,
				});
		}
		return out;
	};
	// spawn26: a free slot next to the spawn gets an upgrader born onto it, no MOVE
	const inPlace =
		S26 &&
		(() => {
			const taken = new Set(
				_.filter(Game.creeps, (o) => o.memory.type === "upgrader").map((o) => o.memory.slot),
			);
			const i = SLOTS.findIndex(
				([x, y], j) =>
					!taken.has(j) && Math.max(Math.abs(x - SPAWN.x), Math.abs(y - SPAWN.y)) === 1,
			);
			return i < 0
				? null
				: {
						type: "upgrader",
						body: [...Array(Math.min(30, Math.floor((cap - 50) / 100))).fill(WORK), CARRY],
						slot: i,
						dir: [room.getPositionAt(SPAWN.x, SPAWN.y).getDirectionTo(SLOTS[i][0], SLOTS[i][1])],
					};
		})();
	const upgrader = inPlace
		? inPlace
		: K.towUp
			? {
					type: "upgrader",
					body: [...Array(Math.min(30, Math.floor((cap - 50) / 100))).fill(WORK), CARRY],
					tow: 1,
					dir: [TOP_LEFT, TOP_RIGHT],
				}
			: {
					type: "upgrader",
					body: [...Array(Math.min(30, Math.floor((cap - 100) / 100))).fill(WORK), CARRY, MOVE],
				};
	const want = [];
	want.push(...work(homeSrcs[0]));
	if (alive("upgrader").length < K.minUp && NOW() >= K.upFrom) want.push(upgrader);
	want.push(...work(homeSrcs[1]));
	if (S26 && !(by.spawnFiller || []).length)
		want.unshift({
			type: "spawnFiller",
			body: [CARRY, CARRY, CARRY, CARRY],
			dir: [room.getPositionAt(SPAWN.x, SPAWN.y).getDirectionTo(SPF_POS[0], SPF_POS[1])],
		});
	// road crews: K.pavers per unfinished route once paving starts
	if (K.paved && K.crew && NOW() >= K.roadFrom && Memory.roads)
		for (const r of Memory.roads) {
			if ((Memory.roadDone || {})[r.k]) continue;
			const s = srcs.find((x) => x.k === r.k);
			if (s && alive("paver", (c) => c.memory.k === r.k).length < K.pavers) {
				const n = Math.max(1, Math.min(K.paverW, Math.floor(cap / 250)));
				want.push({
					type: "paver",
					body: [...Array(n).fill(WORK), ...Array(n).fill(CARRY), ...Array(n * 2).fill(MOVE)].slice(
						0,
						50,
					),
					k: s.k,
					i: s.i,
					room: s.room,
					dist: s.dist,
				});
			}
		}
	if (K.towMiner && rcl >= 2 && alive("tug").length < K.tugs)
		want.push({ type: "tug", body: Array(K.tugMove).fill(MOVE) });
	HUBS.forEach((h, hi) => {
		if (!hubBox(room, h)) return;
		for (let f = 0; f < 2; f++)
			if (!alive("hubFiller", (c) => c.memory.h === hi && c.memory.f === f).length)
				want.push({
					type: "hubFiller",
					body: fillerBody(hi),
					h: hi,
					f,
					dir: hi === 0 && !SIN ? [f ? RIGHT : LEFT] : null,
				});
	});
	const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
	const left = _.sum(sites, (x) => x.progressTotal - x.progress);
	if (
		left > 0 &&
		NOW() >= K.buildFrom &&
		alive("builder").length <
			Math.min(rcl <= 2 ? K.builders2 : K.builders, Math.ceil(left / K.buildPer))
	)
		want.push({ type: "builder", body: repeat([WORK, CARRY, MOVE], 200, cap, 5) });
	// energy is piling up at the controller: more upgraders beat more income
	// ...but only while the upgraders we have are fed (control/tick keeps up with their WORK)
	// ring: the relay block feeds upgraders through 100-CARRY handoffs, so its top duty is
	// ~75%, not the ~95% of a self-serve box side; hold it to its own shape's ceiling
	const fed =
		(Memory.upRate || 0) >=
		(RING_HOME.v ? 0.62 : K.fed) * _.sum(by.upgrader || [], (c) => c.getActiveBodyparts(WORK));
	// the planning model's steady state carries ~65 upgrader WORK; more than the energy feeds steals spawn time from haulers
	// ring: one 2000-cap box plus the lane pile holds what three boxes did, keep the legacy threshold
	const upWork = _.sum(by.upgrader || [], (c) => c.getActiveBodyparts(WORK));
	// extHold: while extension sites stand, keep the upgrade WORK at the old level so the surplus pays for
	// the extensions; the extra WORK resumes once they are up (a mid-build raise splits the energy and
	// delays every level threshold)
	const extLeft = _.sum(sites, (x) =>
		x.structureType === STRUCTURE_EXTENSION ? x.progressTotal - x.progress : 0,
	);
	const upCap = K.extHold && extLeft > 0 ? K.extHold : K.upMaxW;
	if (
		boxEnergy(room).energy >
			(rcl <= 2 ? K.upPerBox2 : K.upPerBox) * (RING_HOME.v ? 3 : BOXES.length) &&
		fed &&
		upWork < upCap &&
		(by.upgrader || []).length < SLOTS.length
	)
		want.push(upgrader);
	for (const s of remotes) want.push(...work(s));
	global.WANT = want;
	global.URGENT = want.some((w) => w.type === "miner" || w.type === "reserver" || w.type === "hubFiller");
	// a source without its miner loses its whole output: successors go before any hauler or upgrader
	if (K.minerFirst) {
		const rank = (w) =>
			w.type === "hubFiller" ? 0 : w.type === "miner" ? 1 : w.type === "reserver" ? 2 : 3;
		return _.sortBy(want, rank)[0] || null;
	}
	if (K.succFirst) {
		const u = want.find((w) => w.urgent);
		if (u) return u;
	}
	// fair hauling: among hauler requests the source with the smallest share of its need goes first
	if (K.fair) {
		const i = want.findIndex((w) => w.type === "hauler");
		if (i >= 0) {
			const best = _.min(
				want.filter((w) => w.type === "hauler"),
				"ratio",
			);
			const firstNonHauler = want.findIndex((w) => w.type !== "hauler" && w.type !== "miner");
			if (firstNonHauler < 0 || firstNonHauler > i) want.splice(i, 0, best);
		}
	}
	return want[0] || null;
}

// A new run (another spawn) starts from a clean Memory: what a previous run left (upCum, harvested, plans,
// another bot's keys) would otherwise steer this one. Creep memory and the sim's own keys stay.
function newRun(spawn) {
	if (Memory.boot && Memory.boot.id === spawn.id) return;
	// Nexus 子树是主代码内核的校准产物 (布局记录等), 与冲级 run 生命周期无关, 保留
	const keep = _.pick(Memory, ["creeps", "jitter", "debug", "Nexus"]);
	for (const k of Object.keys(Memory)) delete Memory[k];
	Object.assign(Memory, keep, { boot: { id: spawn.id, t: Game.time } });
}

function spawnIt(s) {
	const spawn = Object.values(Game.spawns)[0];
	const room = spawn.room;
	const { body, dir, cat, n, ...mem } = s;
	// extensions first: the spawn's own store is the one nobody stands next to refill (spawn27)
	const energyStructures = SIN
		? [
				...room.find(FIND_MY_STRUCTURES, {
					filter: (x) => x.structureType === STRUCTURE_EXTENSION,
				}),
				spawn,
			]
		: undefined;
	// 主代码统一命名 (中文体名 代号-HEX): 感知侧 unitCodeFromName 可解析回类型
	const name = generateCreepName(s.type, { random: Math.random, exists: (x) => x in Game.creeps });
	if (
		spawn.spawnCreep(body, name, {
			memory: mem,
			energyStructures,
			directions:
				dir ||
				(S27
					? [BOTTOM, BOTTOM_LEFT, BOTTOM_RIGHT]
					: S26
						? [BOTTOM]
						: S29B
							? [TOP]
							: S29
								? [BOTTOM]
								: BAYS && K.exits3
									? [TOP, TOP_LEFT, TOP_RIGHT]
									: [TOP]),
		}) === OK
	) {
		L(`spawn_${s.type}`, cost(body));
		if (cat) (Memory.sp = Memory.sp || {})[cat] = (Memory.sp[cat] || 0) + n;
	}
}

export { nextSpawn, newRun, spawnIt, renewLow, renew };
