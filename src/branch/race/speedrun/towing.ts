// @ts-nocheck
import { SRC, BOX, SLOTS, K, pos, L } from "./layout";
/**
 * 拖拽体系: 少 MOVE 蠕虫由 hauler/tug 拉到岗 (pull), 房界单独穿行;
 * 头对换载 (swapLoad): 满载与空载相向而行时在途中交接货物, 各自原路返回。
 */

export const edgeP = (p) => p.x === 0 || p.x === 49 || p.y === 0 || p.y === 49;
export const INWARD = (p) => (p.y === 0 ? BOTTOM : p.y === 49 ? TOP : p.x === 0 ? RIGHT : LEFT);
function slotOf(c) {
	if (c.memory.slot === undefined) {
		const taken = new Set(
			_.filter(Game.creeps, (o) => o.memory.r === "upgrader" && o !== c).map((o) => o.memory.slot),
		);
		c.memory.slot = SLOTS.findIndex((_s, i) => !taken.has(i));
	}
	return SLOTS[c.memory.slot] || [BOX.x, BOX.y - 1];
}
function towDest(c, home) {
	if (c.memory.r === "upgrader") {
		const [x, y] = slotOf(c);
		return pos(x, y, home);
	}
	const s = SRC[c.memory.i];
	return pos(s.mx, s.my, c.memory.room);
}
function towAssign(home) {
	for (const c of Object.values(Game.creeps)) {
		if (!c.memory.tow || c.memory.arrived || c.spawning) continue;
		const t = c.memory.tug && Game.creeps[c.memory.tug];
		if (t && t.memory.towing === c.name) continue;
		const tugs = _.filter(
			Game.creeps,
			(h) =>
				h.memory.r === "tug" &&
				!h.memory.towing &&
				!h.spawning &&
				h.room.name === c.room.name &&
				h.ticksToLive > 2 * (c.memory.dist || 10) + 20,
		);
		const free = tugs.length
			? tugs
			: c.room.find(FIND_MY_CREEPS, {
					filter: (h) =>
						h.memory.r === "hauler" &&
						!h.memory.towing &&
						!h.memory.full &&
						!h.spawning &&
						h.ticksToLive > 150 &&
						(c.memory.r === "upgrader" ||
							h.memory.k === c.memory.k ||
							(K.towRoom && h.memory.room === c.memory.room) ||
							(K.towHome && c.memory.room === home)),
				});
		const h = c.pos.findClosestByRange(free);
		if (!h) continue;
		h.memory.towing = c.name;
		c.memory.tug = h.name;
	}
}
function tow(t, c, home) {
	const d = towDest(c, home);
	if (c.pos.isEqualTo(d)) {
		c.memory.arrived = 1;
		delete t.memory.towing;
		return;
	}
	if (t.room.name !== c.room.name) {
		if (edgeP(t.pos)) t.move(INWARD(t.pos));
		return;
	}
	if (!t.pos.isNearTo(c)) return t.moveTo(c, { reusePath: 3 });
	const pullTo = (dir) => {
		t.move(dir);
		t.pull(c);
		c.move(t);
	};
	if (t.pos.isEqualTo(d)) return pullTo(t.pos.getDirectionTo(c));
	const r = PathFinder.search(
		t.pos,
		{ pos: d, range: 0 },
		{
			plainCost: 2,
			swampCost: 10,
			maxOps: 20000,
			roomCallback: (rn) => {
				const room = Game.rooms[rn];
				const m = new PathFinder.CostMatrix();
				if (room) {
					for (const s of room.find(FIND_STRUCTURES)) {
						if (s.structureType === STRUCTURE_ROAD) m.set(s.pos.x, s.pos.y, 1);
						else if (
							s.structureType !== STRUCTURE_CONTAINER &&
							s.structureType !== STRUCTURE_RAMPART
						)
							m.set(s.pos.x, s.pos.y, 255);
					}
					for (const o of room.find(FIND_CREEPS)) m.set(o.pos.x, o.pos.y, 255); // the cargo too: go round it, never swap back
				}
				return m;
			},
		},
	);
	const p0 = r.path[0];
	if (!p0) {
		t.moveTo(d, { reusePath: 0 });
		t.pull(c);
		c.move(t);
		return;
	}
	if (p0.roomName !== t.room.name || edgeP(p0)) {
		if (edgeP(c.pos)) return pullTo(t.pos.getDirectionTo(p0)); // just arrived on the edge: pull it in
		return t.move(t.pos.getDirectionTo(p0)); // cross alone; the cargo steps over itself
	}
	pullTo(t.pos.getDirectionTo(p0));
}

// Flag's head-on pass: a loaded hauler next to an empty one that is nearer home hands over its load and
// both turn around (each keeps its own source), so nobody has to squeeze past anybody.
const EXIT_CENTER = { [TOP]: [24, 0], [BOTTOM]: [24, 49], [LEFT]: [0, 24], [RIGHT]: [49, 24] };
function homeward(room, home) {
	if (room.name === home) return [BOX.x, BOX.y];
	const g = (global.HW = global.HW || {});
	if (!g[room.name]) g[room.name] = EXIT_CENTER[room.findExitTo(home)] || [24, 24];
	return g[room.name];
}
function swapLoad(c, home) {
	const [hx, hy] = homeward(c.room, home);
	const mine = c.pos.getRangeTo(hx, hy);
	const o = c.pos.findInRange(FIND_MY_CREEPS, 1, {
		filter: (o) =>
			o.memory.r === "hauler" &&
			!o.memory.full &&
			!o.memory.swapped &&
			o.store.energy === 0 &&
			o.store.getFreeCapacity() >= 0.8 * c.store.energy &&
			o.pos.getRangeTo(hx, hy) < mine &&
			o.ticksToLive > 50,
	})[0];
	if (!o) return false;
	if (c.transfer(o, RESOURCE_ENERGY, Math.min(c.store.energy, o.store.getFreeCapacity())) !== OK)
		return false;
	// energy is fungible: each keeps its own source, only the load jumps forward
	Object.assign(c.memory, { full: false, swapped: Game.time });
	Object.assign(o.memory, { full: true, swapped: Game.time });
	L("swaps", 1);
	return true;
}

export { towAssign, tow, towDest, slotOf, swapLoad };
