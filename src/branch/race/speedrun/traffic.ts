// @ts-nocheck
import { K, DXY, BACK, L, KEEP_CLEAR } from "./layout";
/**
 * 移动基础设施: moveTo 覆写 (本房 KEEP_CLEAR 保持格计入寻路代价)、
 * move 采样 (global.MV 记录每 tick 移动意图)、unjam (卡死脱困) 与 shove (对穿让位)。
 */

const moveTo = Creep.prototype.moveTo;
Creep.prototype.moveTo = function (a, b, c) {
	const xy = typeof a === "number";
	const opts = Object.assign({}, xy ? c : b);
	// Cached paths can keep retrying an occupied tile. Recompute after consecutive blocked attempts.
	if (K.repath && !this.fatigue) {
		const key = `${this.pos.roomName}:${this.pos.x},${this.pos.y}`;
		const nav = this.memory.nav;
		const stuck = nav && nav.t === Game.time - 1 && nav.p === key ? nav.n + 1 : 0;
		this.memory.nav = { t: Game.time, p: key, n: stuck };
		if (stuck >= K.repath) {
			delete this.memory._move;
			opts.reusePath = 0;
		}
	}
	if (this.memory.type !== "hubFiller" && !opts.costCallback)
		opts.costCallback = (rn, m) => {
			if (rn === global.HOME)
				for (const [x, y] of KEEP_CLEAR) if (!this.pos.isEqualTo(x, y)) m.set(x, y, 255);
		};
	const result = xy ? moveTo.call(this, a, b, opts) : moveTo.call(this, a, opts);
	// Recomputing cannot help when every path is blocked by other creeps. Step
	// aside after repeated failures so a jam cannot stop the spawn for hundreds of ticks.
	// Leave fixed workers and active towing pairs in place.
	if (
		K.escapeAfter &&
		result === ERR_NO_PATH &&
		this.memory.nav &&
		this.memory.nav.n >= K.escapeAfter &&
		this.getActiveBodyparts(MOVE) &&
		!this.memory.towing &&
		!(this.memory.tow && !this.memory.arrived)
	) {
		const free = Object.keys(DXY)
			.map(Number)
			.filter((d) => {
				const [dx, dy] = DXY[d];
				const x = this.pos.x + dx,
					y = this.pos.y + dy;
				return (
					x > 0 &&
					x < 49 &&
					y > 0 &&
					y < 49 &&
					this.room.getTerrain().get(x, y) !== TERRAIN_MASK_WALL &&
					!this.room.lookForAt(LOOK_CREEPS, x, y).length &&
					!this.room
						.lookForAt(LOOK_STRUCTURES, x, y)
						.some((s) => OBSTACLE_OBJECT_TYPES.includes(s.structureType)) &&
					!(this.room.name === global.HOME && KEEP_CLEAR.some(([kx, ky]) => kx === x && ky === y))
				);
			});
		if (free.length) {
			delete this.memory._move;
			return this.move(free[(Game.time + this.name.length) % free.length]);
		}
	}
	return result;
};
// Shove: remember who moves where this tick; afterwards a hauler or builder standing still on a tile someone
// wants steps into that someone's tile (a swap), so idle creeps never wall off a corridor.
const rawMove = Creep.prototype.move;
Creep.prototype.move = function (d) {
	if (typeof d === "number") (global.MV || (global.MV = {}))[this.name] = d;
	return rawMove.call(this, d);
};

// unjam: a creep that wanted to move but has stood on the same tile for K.jamTicks steps to any free neighbour
function unjam() {
	const mv = global.MV || {};
	const J = (global.JAM = global.JAM || {});
	for (const name in mv) {
		const a = Game.creeps[name];
		if (!a || a.fatigue || a.spawning) continue;
		const key = a.pos.roomName + a.pos.x + "," + a.pos.y;
		const j = J[name];
		if (!j || j.key !== key) {
			J[name] = { key, n: 0 };
			continue;
		}
		if (++j.n < K.jamTicks) continue;
		const terrain = a.room.getTerrain();
		const free = Object.keys(DXY)
			.map(Number)
			.filter((d) => {
				const [dx, dy] = DXY[d];
				const x = a.pos.x + dx,
					y = a.pos.y + dy;
				if (x < 1 || x > 48 || y < 1 || y > 48 || terrain.get(x, y) === TERRAIN_MASK_WALL)
					return false;
				if (a.room.lookForAt(LOOK_CREEPS, x, y).length) return false;
				return !a.room
					.lookForAt(LOOK_STRUCTURES, x, y)
					.some((s) => OBSTACLE_OBJECT_TYPES.includes(s.structureType));
			});
		if (free.length) {
			rawMove.call(a, free[(Game.time + j.n) % free.length]);
			j.n = 0;
			L("unjam", 1);
		}
	}
	for (const n in J) if (!Game.creeps[n]) delete J[n];
}
function shove() {
	const mv = global.MV || {};
	for (const name in mv) {
		const a = Game.creeps[name];
		if (!a || a.fatigue) continue;
		const [dx, dy] = DXY[mv[name]];
		const x = a.pos.x + dx,
			y = a.pos.y + dy;
		if (x < 1 || x > 48 || y < 1 || y > 48) continue;
		const b = a.room.lookForAt(LOOK_CREEPS, x, y)[0];
		if (!b || !b.my || b.spawning || mv[b.name] !== undefined || b.fatigue) continue;
		if (b.memory.type !== "hauler" && b.memory.type !== "builder") continue;
		mv[b.name] = BACK[mv[name]];
		rawMove.call(b, BACK[mv[name]]);
	}
	global.MV = {};
}

export { unjam, shove };
