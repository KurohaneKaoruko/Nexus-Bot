/**
 * Room 建筑与对象缓存 (structureCache)。
 *
 * 用法速查 (按字段取用, 不加 s)
 *
 * 多个实例 (返回数组, 可能为空):
 * - room.spawn / room.extension / room.tower / room.link / room.lab / room.container
 * - room.road / room.rampart / room.constructedWall / room.powerBank
 *
 * 单个实例 (返回对象或 undefined):
 * - room.nuker / room.factory / room.powerSpawn / room.observer / room.extractor / room.invaderCore
 * - room.mineral
 *
 * 非结构对象 (返回数组, 可能为空):
 * - room.source / room.deposit / room.constructionSite
 *
 * 聚合与统计:
 * - room.mass_stores：storage、terminal、factory、container 的数组（仅包含可见对象）
 * - room.mass_stores_all：同上，但不过滤己方 inactive
 * - room[RESOURCE_*]：mass_stores 中该资源的总量（按 tick 缓存）
 *
 * 状态字段：
 * - room.my：等同 room.controller?.my
 * - room.level：等同 room.controller?.level
 * - room.structures：本 tick 的 FIND_STRUCTURES 快照（按 tick 缓存）
 *
 * 便捷访问：
 * - room.getById(id)：仅对 24 位 hex 字符串 id 生效，返回 Game.getObjectById(id)（同 tick 缓存）
 *
 * 缓存说明：
 * - 索引缓存存放在堆内（跨 tick 存 id，唯一建筑存 id，多建筑存 id 集合），不用 Memory；
 *   全局重置后首次读取时重新扫描
 * - 拆除导致的失效 id 会在 getter 中自动剔除
 * - 新建筑/新对象需要调用 room.update() 刷新索引
 * - 己方建筑按 isActive() 过滤，结果缓存到下次 update
 */

/** 缓存依赖的游戏接口（构造注入，便于测试替身） */
interface StructureCacheGame {
	/** 当前 tick */
	time(): number;
	/** 按 id 取对象，消失了或看不见返回 null */
	get<T extends _HasId>(id: Id<T>): T | null;
	/** 当前房间的 find */
	find<K extends FindConstant>(type: K): FindTypes[K][];
}

/** 索引里除建筑以外的对象 */
type ExtraKind = "source" | "deposit" | "constructionSite";

/** 能单独刷新的类型 */
type CacheKind = StructureConstant | ExtraKind;

/** 每房最多一个的类型：存一个 id。其余建筑类型存集合 */
const SINGLE: ReadonlySet<string> = new Set<string>([
	STRUCTURE_OBSERVER,
	STRUCTURE_POWER_SPAWN,
	STRUCTURE_EXTRACTOR,
	STRUCTURE_NUKER,
	STRUCTURE_FACTORY,
	STRUCTURE_INVADER_CORE,
]);

/** 己方的建筑。中立结构没有 my，别人的是 false */
function isMine(s: Structure): boolean {
	return "my" in s && s.my === true;
}

/** 跨 tick 的 id 集合：解析时消失的就地删掉 */
class IdSet<T extends _HasId> {
	private readonly ids = new Set<Id<T>>();

	constructor(objects: Iterable<T>) {
		for (const o of objects) this.ids.add(o.id);
	}

	resolve(game: StructureCacheGame): T[] {
		const out: T[] = [];
		for (const id of this.ids) {
			const o = game.get(id);
			if (o) out.push(o);
			else this.ids.delete(id);
		}
		return out;
	}
}

/** 跨 tick 的索引 */
interface Index {
	single: Map<string, Id<Structure>>;
	multi: Map<string, IdSet<Structure>>;
	sources: IdSet<Source>;
	deposits: IdSet<Deposit>;
	sites: IdSet<ConstructionSite>;
	mineral: Id<Mineral> | undefined;
	/** 己方建筑的 isActive 结果 */
	active: Map<string, boolean>;
}

/** 同 tick 的对象缓存。单实例类型也按列表存，空或一个 */
interface TickState {
	tick: number;
	structures: Map<string, Structure[]>;
	sources?: Source[];
	deposits?: Deposit[];
	sites?: ConstructionSite[];
	mineral?: Mineral[];
}

/** 按房的结构 id 索引 + 同 tick 对象缓存 */
class StructureCache {
	private index: Index | undefined;
	private tickState: TickState = emptyTick(-1);

	constructor(private readonly game: StructureCacheGame) {}

	/** 刷新。不传类型则全量重扫，也清 isActive 缓存；传类型只重找这一种（也清 isActive 缓存，id 可能变了） */
	update(type?: CacheKind): void {
		if (type === undefined || !this.index) {
			this.index = this.scan();
			this.tickState = emptyTick(this.game.time());
			return;
		}
		const index = this.index;
		index.active.clear();
		const tick = this.tick();
		if (type === "source") {
			index.sources = new IdSet(this.game.find(FIND_SOURCES));
			delete tick.sources;
		} else if (type === "deposit") {
			index.deposits = new IdSet(this.game.find(FIND_DEPOSITS));
			delete tick.deposits;
		} else if (type === "constructionSite") {
			index.sites = new IdSet(this.game.find(FIND_CONSTRUCTION_SITES));
			delete tick.sites;
		} else {
			const found = this.game.find(FIND_STRUCTURES).filter((s) => s.structureType === type);
			if (SINGLE.has(type)) {
				const first = found[0];
				if (first) index.single.set(type, first.id);
				else index.single.delete(type);
			} else {
				index.multi.set(type, new IdSet(found));
			}
			tick.structures.delete(type);
		}
	}

	/** 某类型的建筑（含别人的和中立的；己方的已按 isActive 过滤）。单实例类型返回空或一个 */
	structures(type: StructureConstant): readonly Structure[] {
		const tick = this.tick();
		let list = tick.structures.get(type);
		if (!list) {
			const index = this.ensure();
			list = SINGLE.has(type) ? this.resolveSingle(index, type) : this.resolveMulti(index, type);
			tick.structures.set(type, list);
		}
		return list;
	}

	sources(): readonly Source[] {
		const tick = this.tick();
		return (tick.sources ??= this.ensure().sources.resolve(this.game));
	}

	deposits(): readonly Deposit[] {
		const tick = this.tick();
		return (tick.deposits ??= this.ensure().deposits.resolve(this.game));
	}

	/** 全部工地（含别人的） */
	sites(): readonly ConstructionSite[] {
		const tick = this.tick();
		return (tick.sites ??= this.ensure().sites.resolve(this.game));
	}

	mineral(): Mineral | undefined {
		const tick = this.tick();
		if (!tick.mineral) {
			const index = this.ensure();
			const o = index.mineral === undefined ? null : this.game.get(index.mineral);
			if (!o) index.mineral = undefined;
			tick.mineral = o ? [o] : [];
		}
		return tick.mineral[0];
	}

	/** 同 tick 缓存，tick 变了换新的 */
	private tick(): TickState {
		const now = this.game.time();
		if (this.tickState.tick !== now) this.tickState = emptyTick(now);
		return this.tickState;
	}

	/** 第一次读时建索引 */
	private ensure(): Index {
		return (this.index ??= this.scan());
	}

	/** 全量扫描：一次 FIND_STRUCTURES 按类型分组，再找源、沉积物、工地和矿物 */
	private scan(): Index {
		const single = new Map<string, Id<Structure>>();
		const groups = new Map<string, Structure[]>();
		for (const s of this.game.find(FIND_STRUCTURES)) {
			if (SINGLE.has(s.structureType)) single.set(s.structureType, s.id);
			else {
				const group = groups.get(s.structureType);
				if (group) group.push(s);
				else groups.set(s.structureType, [s]);
			}
		}
		const multi = new Map<string, IdSet<Structure>>();
		for (const [type, group] of groups) multi.set(type, new IdSet(group));
		return {
			single,
			multi,
			sources: new IdSet(this.game.find(FIND_SOURCES)),
			deposits: new IdSet(this.game.find(FIND_DEPOSITS)),
			sites: new IdSet(this.game.find(FIND_CONSTRUCTION_SITES)),
			mineral: this.game.find(FIND_MINERALS)[0]?.id,
			active: new Map(),
		};
	}

	private resolveSingle(index: Index, type: string): Structure[] {
		const id = index.single.get(type);
		if (id === undefined) return [];
		const o = this.game.get(id);
		if (!o) {
			index.single.delete(type);
			return [];
		}
		return isMine(o) && !this.isActive(index, o) ? [] : [o];
	}

	private resolveMulti(index: Index, type: string): Structure[] {
		const set = index.multi.get(type);
		if (!set) return [];
		return set.resolve(this.game).filter((o) => !isMine(o) || this.isActive(index, o));
	}

	/** 己方建筑的 isActive，结果一直缓存到 update */
	private isActive(index: Index, s: Structure): boolean {
		let active = index.active.get(s.id);
		if (active === undefined) {
			active = s.isActive();
			index.active.set(s.id, active);
		}
		return active;
	}
}

function emptyTick(tick: number): TickState {
	return { tick, structures: new Map() };
}

/** 各房的结构缓存实例（堆内） */
const caches = new Map<string, StructureCache>();

/** 某房的缓存索引；没视野返回 undefined */
function cacheFor(roomName: string): StructureCache | undefined {
	const room = Game.rooms[roomName];
	if (!room) return undefined;
	let cache = caches.get(roomName);
	if (!cache) {
		caches.set(
			roomName,
			(cache = new StructureCache({
				time: () => Game.time,
				get: (id) => Game.getObjectById(id),
				find: (type) => room.find(type),
			})),
		);
	}
	return cache;
}

// ── Room.prototype 属性 API ───────────────────────────────────────────────────

/** 多实例结构类型：room[type] 返回数组 */
const multipleList: readonly string[] = [
	STRUCTURE_SPAWN,
	STRUCTURE_EXTENSION,
	STRUCTURE_ROAD,
	STRUCTURE_WALL,
	STRUCTURE_RAMPART,
	STRUCTURE_KEEPER_LAIR,
	STRUCTURE_PORTAL,
	STRUCTURE_LINK,
	STRUCTURE_TOWER,
	STRUCTURE_LAB,
	STRUCTURE_CONTAINER,
	STRUCTURE_POWER_BANK,
];

/** 单实例结构类型：room[type] 返回对象或 undefined */
const singleList: readonly string[] = [
	STRUCTURE_OBSERVER,
	STRUCTURE_POWER_SPAWN,
	STRUCTURE_EXTRACTOR,
	STRUCTURE_NUKER,
	STRUCTURE_FACTORY,
	STRUCTURE_INVADER_CORE,
];

/** mass_stores 收录的结构类型 */
const STORE_TYPES: ReadonlySet<string> = new Set([
	STRUCTURE_STORAGE,
	STRUCTURE_TERMINAL,
	STRUCTURE_FACTORY,
	STRUCTURE_CONTAINER,
]);

/** 某类型建筑列表（缺失视野返回空）。口径与旧实现一致：中立与别人的照收，己方按 isActive 过滤 */
function structuresOf(roomName: string, type: string): Structure[] {
	return [...(cacheFor(roomName)?.structures(type as StructureConstant) ?? [])];
}

/** 同 tick 只算一次的非结构对象缓存 */
function tickCached<T>(room: Room, key: string, compute: () => T): T {
	const cacheKey = `_${key}_at`;
	const valueKey = `_${key}`;
	const r = room as never as Record<string, unknown>;
	if (r[cacheKey] !== Game.time) {
		r[cacheKey] = Game.time;
		r[valueKey] = compute();
	}
	return r[valueKey] as T;
}

/** mass_stores / mass_stores_all 的聚合：storage/terminal 走引擎原生属性（即时可见），
 * factory/container 走索引（跨 tick 随 update 刷新），口径与旧实现一致 */
function collectStores(room: Room, includeInactive: boolean): Structure[] {
	return tickCached(room, includeInactive ? "mass_stores_all" : "mass_stores", () => {
		const cache = cacheFor(room.name);
		if (!cache) return [];
		const out: Structure[] = [];
		const push = (s: Structure | undefined): void => {
			if (s && (includeInactive || !isMine(s) || s.isActive())) out.push(s);
		};
		push(room.storage);
		push(room.terminal);
		for (const type of [STRUCTURE_FACTORY, STRUCTURE_CONTAINER]) {
			for (const s of cache.structures(type)) push(s);
		}
		return out;
	});
}

function clearTickCaches(room: Room): void {
	const r = room as never as Record<string, unknown>;
	for (const key of ["structures", "deposits", "sites", "mass_stores", "mass_stores_all"]) {
		delete r[`_${key}`];
		delete r[`_${key}_at`];
	}
	delete r._resAllTime;
	delete r._resAllMap;
	for (const type of RESOURCES_ALL) {
		delete r[`_res_t_${type}`];
		delete r[`_res_${type}`];
	}
}

Room.prototype.getById = function (id: string) {
	if (typeof id !== "string") return undefined;
	if (!/^[0-9a-f]{24}$/.test(id)) return undefined;
	const r = this as never as Record<string, unknown>;
	if (r._idObjCacheTime !== Game.time) {
		r._idObjCacheTime = Game.time;
		r._idObjCache = Object.create(null);
	}
	const cache = r._idObjCache as Record<string, unknown>;
	if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
	const o = Game.getObjectById(id as never);
	cache[id] = o;
	return o;
};

for (const type of multipleList) {
	Object.defineProperty(Room.prototype, type, {
		get() {
			return structuresOf(this.name, type);
		},
		set() {},
		enumerable: false,
		configurable: true,
	});
}

for (const type of singleList) {
	Object.defineProperty(Room.prototype, type, {
		get() {
			return structuresOf(this.name, type)[0];
		},
		set() {},
		enumerable: false,
		configurable: true,
	});
}

Object.defineProperty(Room.prototype, LOOK_MINERALS, {
	get() {
		return cacheFor(this.name)?.mineral();
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, LOOK_SOURCES, {
	get() {
		return (cacheFor(this.name)?.sources() ?? []) as Source[];
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, LOOK_DEPOSITS, {
	get() {
		return (cacheFor(this.name)?.deposits() ?? []) as Deposit[];
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, LOOK_CONSTRUCTION_SITES, {
	get() {
		return (cacheFor(this.name)?.sites() ?? []) as ConstructionSite[];
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, "structures", {
	get() {
		return tickCached(this, "structures", () => this.find(FIND_STRUCTURES));
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, "mass_stores", {
	get() {
		return collectStores(this, false);
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, "mass_stores_all", {
	get() {
		return collectStores(this, true);
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, "my", {
	get() {
		return this.controller && this.controller.my;
	},
	set() {},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, "level", {
	get() {
		return this.controller && this.controller.level;
	},
	set() {},
	enumerable: false,
	configurable: true,
});

/** 资源总量统计的本 tick 预聚合缓存：同 tick 内按不同资源只遍历一次 mass_stores */
function getResourceTotalMap(room: Room): Record<string, number> {
	const r = room as never as Record<string, unknown>;
	if (r._resAllTime !== Game.time) {
		r._resAllTime = Game.time;
		const sumMap: Record<string, number> = Object.create(null);
		for (const s of room.mass_stores) {
			for (const key in s.store) {
				const amount = (s.store as unknown as Record<string, number>)[key] || 0;
				if (amount) sumMap[key] = (sumMap[key] || 0) + amount;
			}
		}
		r._resAllMap = sumMap;
	}
	return (r._resAllMap as Record<string, number>) || Object.create(null);
}

for (const type of RESOURCES_ALL) {
	Object.defineProperty(Room.prototype, type, {
		get() {
			const timeKey = `_res_t_${type}`;
			const cacheKey = `_res_${type}`;
			const r = this as never as Record<string, unknown>;
			if (r[timeKey] !== Game.time) {
				r[timeKey] = Game.time;
				r[cacheKey] = getResourceTotalMap(this)[type] || 0;
			}
			return r[cacheKey] as number;
		},
		set(amount) {
			const timeKey = `_res_t_${type}`;
			const cacheKey = `_res_${type}`;
			const r = this as never as Record<string, unknown>;
			r[cacheKey] = amount;
			r[timeKey] = Game.time;
			r._resAllTime = Game.time;
			if (!r._resAllMap) r._resAllMap = Object.create(null);
			(r._resAllMap as Record<string, number>)[type] = amount as number;
		},
		enumerable: false,
		configurable: true,
	});
}

/**
 * 更新房间索引缓存。
 * - 不传 type：重建整个房间的索引
 * - 传入 type：只更新单一类型索引（'mineral'/'mass_stores' 按旧口径处理）
 * - 同步清理对应的同 tick 缓存字段
 */
Room.prototype.update = function (type: string) {
	const cache = cacheFor(this.name);
	if (!cache) {
		clearTickCaches(this);
		return;
	}
	if (!type) {
		cache.update();
	} else if (type === LOOK_MINERALS) {
		cache.update();
	} else if (type === "mass_stores") {
		for (const t of STORE_TYPES) cache.update(t as StructureConstant);
	} else if (type !== "structures") {
		cache.update(type as CacheKind);
	}
	clearTickCaches(this);
};
