// @ts-nocheck
import { SRC, BOX, BOXES, FULL_BOXES, RING_BOXES, CTRL, SPAWN, SLOTS, LANE_Y, KEEP_CLEAR, HUBS, K, NOW, pos } from "./layout";
/**
 * 房间经济查询与建造: 源清单 (本房+邻房+对角, PathFinder 距离排序)、
 * 升级块箱体/巷道堆/hub 容器读写口、余量口径 (spare)、
 * 建造放站 (plan) 与道路网 (roadPlan/roads)。
 */

// the K.reserveN rooms whose nearest source is closest get a reserver; the rest are mined at 5 e/t
export const resRooms = (srcs) =>
	_.uniq(srcs.filter((s) => !s.home).map((s) => s.room)).slice(
		0,
		Memory.claimDisabled ? K.reserveN || 2 : K.reserveN,
	);

function sources(home) {
	if (Memory.srcs) return Memory.srcs;
	const box = pos(BOX.x, BOX.y, home);
	const list = [];
	const near = Object.values(Game.map.describeExits(home));
	// diagonal rooms: next to two of the neighbours
	const seen = _.countBy(near.flatMap((n) => Object.values(Game.map.describeExits(n))));
	const diag = K.diag
		? Object.keys(seen).filter((r) => seen[r] === 2 && r !== home && !near.includes(r))
		: [];
	const rooms = [home, ...near, ...diag];
	for (const room of rooms)
		SRC.forEach((s, i) => {
			const r = PathFinder.search(box, { pos: pos(s.mx, s.my, room), range: 1 }, { maxOps: 20000 });
			list.push({ k: `${room}:${i}`, room, i, dist: r.path.length, home: room === home });
		});
	list.sort((a, b) => b.home - a.home || a.dist - b.dist);
	return (Memory.srcs = list);
}

function plan(room) {
	const rcl = room.controller.level;
	const want = Math.min(
		rcl >= 4 ? K.extMax4 : K.extMax,
		CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl],
	);
	const ext = HUBS.flatMap((h) => h.ext);
	for (let i = 0; i < Math.min(want, ext.length); i++)
		room.createConstructionSite(ext[i][0], ext[i][1], STRUCTURE_EXTENSION);
	// hub 1's container from the start: until it stands, haulers would crowd the spawn's only exit
	HUBS.forEach((h, i) => {
		if (i === 0 || want > HUBS[0].ext.length)
			room.createConstructionSite(h.c[0], h.c[1], STRUCTURE_CONTAINER);
	});
	// boxEarly: build the full legacy triple from the start even while the ring shape runs
	// below K.ringTo — the shape switch then carries no build cost at the RCL boundary
	// box4: keep only the centre box below that RCL (legacy shape unchanged) — defers the
	// two wing boxes' 10k build into the richer RCL4 economy
	const boxSet = K.boxEarly
		? FULL_BOXES
		: K.box4 && rcl < K.box4
			? RING_BOXES
			: FULL_BOXES;
	if (rcl >= K.boxRcl)
		for (const b of boxSet) room.createConstructionSite(b.x, b.y, STRUCTURE_CONTAINER);
}

// ---------- roles ----------

// what sits on each box tile: the container, or (before it is built) the dropped pile

function boxes(room) {
	if (room._boxes) return room._boxes;
	return (room._boxes = BOXES.map((b) => {
		const c = room
			.lookForAt(LOOK_STRUCTURES, b.x, b.y)
			.find((s) => s.structureType === STRUCTURE_CONTAINER);
		if (c)
			return {
				x: b.x,
				y: b.y,
				c,
				energy: c.store.energy,
				free: c.store.getFreeCapacity(RESOURCE_ENERGY),
			};
		const pile = room
			.lookForAt(LOOK_RESOURCES, b.x, b.y)
			.find((r) => r.resourceType === RESOURCE_ENERGY);
		return {
			x: b.x,
			y: b.y,
			pile,
			energy: pile ? pile.amount : 0,
			free: 2000 - (pile ? pile.amount : 0),
		};
	}));
}
const laneEnergy = (room) =>
	K.chain
		? _.sum(
				room.lookForAtArea(LOOK_RESOURCES, LANE_Y, BOX.x - 3, LANE_Y, BOX.x + 3, true),
				(r) => r.resource.amount,
			)
		: 0;
const boxEnergy = (room) => ({ energy: _.sum(boxes(room), "energy") + laneEnergy(room) });
const hubBox = (room, h) =>
	room
		.lookForAt(LOOK_STRUCTURES, h.c[0], h.c[1])
		.find((s) => s.structureType === STRUCTURE_CONTAINER);
const hubBoxes = (room) =>
	room._hubs || (room._hubs = HUBS.map((h) => hubBox(room, h)).filter(Boolean));
const takeBox = (c, b) => (b.c ? c.withdraw(b.c, RESOURCE_ENERGY) : c.pickup(b.pile));
// the spawn eats first: leave enough in the boxes for the filler to top it up
function spare(room) {
	const deficit = room.energyCapacityAvailable - room.energyAvailable;
	const hub = _.sum(hubBoxes(room), (b) => b.store.energy);
	return boxEnergy(room).energy - (deficit > hub ? deficit - hub + K.keep : 0);
}

// carry energy to the closest spawn/extension that wants it; false when all are full
function fill(c, room) {
	if (room.energyAvailable === room.energyCapacityAvailable) return false;
	const t = c.pos.findClosestByRange(FIND_MY_STRUCTURES, {
		filter: (s) =>
			(s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) &&
			s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
	});
	if (!t) return false;
	if (c.pos.isNearTo(t)) c.transfer(t, RESOURCE_ENERGY);
	else c.moveTo(t, { reusePath: 5 });
	return true;
}

function roadPlan(home) {
	if (Memory.roads) return Memory.roads;
	const planned = {};
	const out = [];
	const from = pos(BOX.x, LANE_Y, home);
	// K.paveReserved: the home sources and the reserved rooms' (10 e/t each); else the K.paved nearest
	const all = sources(home);
	const pick = K.paveReserved
		? all.filter((s) => s.home || resRooms(all).includes(s.room))
		: all.slice(0, K.paved);
	for (const s of pick) {
		const r = PathFinder.search(
			from,
			{ pos: pos(SRC[s.i].mx, SRC[s.i].my, s.room), range: 1 },
			{
				plainCost: 2,
				swampCost: 10,
				maxOps: 40000,
				roomCallback: (rn) => {
					const m = new PathFinder.CostMatrix();
					for (const k in planned) {
						const [rr, x, y] = k.split(",");
						if (rr === rn) m.set(+x, +y, 1);
					}
					if (K.roadSafe) {
						m.set(CTRL.x, CTRL.y, 255);
						m.set(34, 6, 255);
						for (const source of SRC) {
							m.set(source.x, source.y, 255);
							m.set(source.mx, source.my, 255);
						}
						if (rn === home) {
							m.set(SPAWN.x, SPAWN.y, 255);
							for (const [x, y] of [
								...SLOTS,
								...KEEP_CLEAR,
								...HUBS.flatMap((h) => h.ext).slice(0, Math.max(K.extMax, K.extMax4)),
							])
								m.set(x, y, 255);
						}
					}
					return m;
				},
			},
		);
		const tiles = r.path
			.filter((p) => p.x > 0 && p.x < 49 && p.y > 0 && p.y < 49)
			.map((p) => `${p.roomName},${p.x},${p.y}`);
		for (const t of tiles) planned[t] = 1;
		out.push({ k: s.k, tiles });
	}
	return (Memory.roads = out);
}

function roads(home) {
	if (!K.paved || NOW() < K.roadFrom || Game.time % 50) return;
	const plan = roadPlan(home);
	const done = (Memory.roadDone = Memory.roadDone || {});
	let open = Object.keys(Game.constructionSites).length;
	for (const r of plan) {
		if (done[r.k]) continue;
		let all = true;
		for (const t of r.tiles) {
			const [rn, x, y] = t.split(",");
			const room = Game.rooms[rn];
			if (!room) {
				all = false;
				continue;
			}
			if (room.lookForAt(LOOK_STRUCTURES, +x, +y).some((s) => s.structureType === STRUCTURE_ROAD))
				continue;
			all = false;
			if (room.lookForAt(LOOK_CONSTRUCTION_SITES, +x, +y).length) continue;
			if (open < K.siteCap && room.createConstructionSite(+x, +y, STRUCTURE_ROAD) === OK) open++;
		}
		if (all) done[r.k] = Game.time;
		if (open >= K.siteCap) break;
	}
}

export { sources, plan, boxes, boxEnergy, hubBox, hubBoxes, takeBox, spare, fill, roadPlan, roads };
