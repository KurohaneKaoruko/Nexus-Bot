/**
 * movement 共享状态命名空间。
 *
 * 只保存进程内状态，不读写 Memory/global；所有算法模块通过 movementState 读写，
 * 避免 ES module 导入绑定跨模块只读导致无法搬移函数。
 */

import type { PosLike } from "./movementGeometry";

type CpuStat = { sum: number; calls: number; moveCount?: number };

/** 缓存路径对象 (creepPathCache 条目 / scratch.path 流转态) */
export type MyPath = {
	start?: { x: number; y: number };
	end?: { x: number; y: number };
	dst?: { x: number; y: number; roomName?: string };
	posArray: RoomPosition[];
	idx?: number;
	lastTime?: number;
	directionArray?: (DirectionConstant | number | undefined)[];
	ignoreRoads?: boolean;
	ignoreStructures?: boolean;
	ignoreSwamps?: boolean;
};

/** 每房代价矩阵缓存条目 (键 "false"/"true" 对应 findPathIgnoreCondition) */
export type RoomCostEntry = {
	roomName?: string;
	my?: boolean;
	"false"?: CostMatrix;
	"true"?: CostMatrix;
	squad?: { "false"?: CostMatrix; "true"?: CostMatrix };
	edgeArray?: Uint16Array;
};

/** 单爬移动缓存条目 (dst 保存 moveTo 目标原引用, isEqual 需 roomName) */
export type CreepMoveCache = {
	dst?: { x: number; y: number; roomName?: string } | undefined;
	path?: MyPath | undefined;
	idx: number;
};

/** moveTo 参数集 (betterMoveTo/squadMoveTo 原样透传) */
export type MoveOps = {
	range?: number;
	bypassRange?: number;
	ignoreRoads?: boolean;
	ignoreSwamps?: boolean;
	ignoreDestructibleStructures?: boolean;
	bypassMyCreeps?: boolean;
	maxRooms?: number;
	maxCost?: number;
	maxOps?: number;
	heuristicWeight?: number;
	plainCost?: number;
	swampCost?: number;
	visualizePathStyle?: PolyStyle;
	costCallback?: (roomName: string, costMatrix: CostMatrix) => boolean | void;
	avoidRooms?: Set<string>;
	avoidExits?: Map<string, Set<string>>;
	bypassHostileCreeps?: boolean;
	enableAutoPull?: boolean;
	priority?: number;
};

const defaultIsWorkTile = (_creep: unknown, _pos: unknown): boolean => true;

const defaultVisualizePathStyle = {
	fill: "transparent",
	stroke: "#fff",
	lineStyle: "dashed",
	strokeWidth: 0.15,
	opacity: 0.1,
} as const;

export const movementConstants = {
	unWalkableCost: 255,
	halfWorldSize: 255 >> 1,
	activeMoveScore: 32,
	ultraMoveScore: 32 << 2,
	passiveMoveScore: -4,
	badMoveScore: -32,
	obstacles: new Set<string>(OBSTACLE_OBJECT_TYPES),
	defaultIsWorkTile,
	defaultVisualizePathStyle,
};

const intentTileCount = Math.max(Object.keys(Game.rooms).length * 128, 2048);

export const movementState = {
	config: {
		pathClearDelay: 5000,
		hostileCostMatrixClearDelay: 500,
		avoidRooms: new Set<string>(["W99N99", "E99S99"]),
		avoidExits: new Map<string, Set<string>>([
			["W99N99", new Set(["E99S99"])],
			["E99S99", new Set(["W99N99"])],
		]),
		isWorkTile: defaultIsWorkTile as (creep: Creep, pos: RoomPosition) => boolean,
	},

	cache: {
		globalPathCache: {} as Record<string, Record<string, MyPath[]>>,
		pathCacheTimer: {} as Record<string, MyPath[]>,
		creepPathCache: {} as Record<string, CreepMoveCache>,
		creepMoveCache: {} as Record<string, number>,
		emptyCostMatrix: new PathFinder.CostMatrix(),
		/** 每房: { false/true: CostMatrix, squad: {false/true: CostMatrix}, edgeArray: Uint16Array } */
		costMatrixCache: {} as Record<string, RoomCostEntry>,
		costMatrixCacheTimer: {} as Record<string, { roomName: string; avoids: string[] }[]>,
		autoClearTick: Game.time,
		roomNameCache: new Map<string, { ew: 'W' | 'E'; ewNum: number; ns: 'N' | 'S'; nsNum: number; baseX: number; baseY: number } | null>(),
		tile2PosCache: new Map<number, RoomPosition>,
	},

	tick: {
		intentTiles: new Uint32Array(intentTileCount),
		priorities: new Uint8Array(intentTileCount),
		cachedMoveIntents: new Map<string, number>(),
		creepToSquad: new Map<string, number>(),
		squadToCreeps: new Map<number, string[]>(),
		squadNextTile: new Set<number>(),
		rerouteSquad: new Set<string>(),
		squadIdx: 1,
		creepIdx: 1,
		checkedTiles: new Map<number, string>(),
		nameToIntentIdx: new Map<string, number>(),
		pullPair: new Map<string, string>(),
	},

	scratch: {
		startTime: undefined as number | undefined,
		startCacheSearch: undefined as number | undefined,
		temporalAvoidFrom: "",
		temporalAvoidTo: "",
		curAvoidRooms: undefined as Set<string> | undefined,
		curAvoidExits: undefined as Map<string, Set<string>> | undefined,
		findPathIgnoreCondition: false,
		bypassRoomName: "",
		bypassCostMat: undefined as CostMatrix | undefined,
		userCostCallback: undefined as MoveOps["costCallback"],
		costMat: undefined as CostMatrix | undefined,
		route: undefined as { room: string; exit: ExitConstant }[] | undefined,
		routeSet: undefined as Record<string, number> | undefined,
		combinedX: 0,
		combinedY: 0,
		minX: 0,
		maxX: 0,
		minY: 0,
		maxY: 0,
		startRoomName: undefined as string | undefined,
		endRoomName: undefined as string | undefined,
		tempArray: [] as unknown[],
		ops: undefined as MoveOps | undefined,
		toPos: undefined as PosLike | undefined,
		creepCache: undefined as CreepMoveCache | undefined,
		path: undefined as MyPath | undefined,
		idx: 0,
		posArray: undefined as RoomPosition[] | undefined,
		found: false,
	},

	stats: {
		analyzeCPU: {
			move: { sum: 0, calls: 0 },
			moveTo: { sum: 0, calls: 0 },
			findClosestByPath: { sum: 0, calls: 0 },
			endTickResolve: { sum: 0, calls: 0, moveCount: 0 },
		} as Record<string, CpuStat>,
		pathCounter: 0,
		testCacheHits: 0,
		testCacheMiss: 0,
		cacheHitCost: 0,
		cacheMissCost: 0,
	},

	proto: {
		originMove: Creep.prototype.move,
		originPull: Creep.prototype.pull,
		originCancelOrder: Creep.prototype.cancelOrder,
	},
};

/** 清空每 tick 意图状态；不触碰持久缓存、统计、配置与原型引用。 */
export function resetTickState(): void {
	const tick = movementState.tick;
	tick.cachedMoveIntents.clear();
	tick.creepToSquad.clear();
	tick.squadToCreeps.clear();
	tick.squadNextTile.clear();
	tick.rerouteSquad.clear();
	tick.checkedTiles.clear();
	tick.nameToIntentIdx.clear();
	tick.pullPair.clear();
	tick.creepIdx = 1;
	tick.squadIdx = 1;
}
