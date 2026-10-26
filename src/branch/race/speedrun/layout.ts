// @ts-nocheck
/**
 * 冲级服固定布局常量与旋钮 (race 分支专用)。
 * 坐标写死: spawn (17,31) / controller (17,25) / 双源 (21,13)(30,29), 矿工驻点 (22,14)(29,28)。
 * K 表为孵化时序/身体规格旋钮, 可经 globalThis.__K 整体覆盖 (sim 调参口径)。
 */

// ---------- 布局 (原始坐标) ----------

export const SRC = [
	{ x: 21, y: 13, mx: 22, my: 14, ax: 22, ay: 13 }, // source, miner tile (energy piles up under the miner), second miner tile
	{ x: 30, y: 29, mx: 29, my: 28, ax: 30, ay: 28 },
];
export const CTRL = { x: 17, y: 25 };

const K_SLOTS_LANE = globalThis.__K && "lane" in globalThis.__K ? globalThis.__K.lane : 1;
// spawn27: the spawn lands inside the upgrade block at (17,27), so the upgraders around it and the haulers
// unloading on the lane below it can be renewed (renew yields 600 part-ticks per spawn tick, spawning 500)
export const S27 = globalThis.__K && "spawn27" in globalThis.__K ? globalThis.__K.spawn27 : 0;
// spawn26: the spawn right under the controller at (17,26); all three boxes stay; the four upgrader slots around it
// (16|18,26), (16|18,27) are born in place without MOVE and renewed there; newborns leave over the box (17,27)
export const S26 =
	!S27 && globalThis.__K && "spawn26" in globalThis.__K ? globalThis.__K.spawn26 : 0;
// spawn29: the spawn lands right under the lane at (17,29); haulers unloading on (16..18,28) touch it
export const S29 =
	!S27 && globalThis.__K && "spawn29" in globalThis.__K ? globalThis.__K.spawn29 : 0;
export const SIN = S27 || S29 || S26; // spawn off (17,31): fed from the upgrade block / lane, renewing there
// spawn29 = 2: spawn (17,29) under the lane, newborns step up onto the lane (17,28) (crossed, never stood on);
// hub 1's container (17,30) under the spawn, fillers (16,30)/(18,30) touch spawn, container and the seven
// extensions on rows 30-31; row 29 stays a corridor, and a hauler unloading from (16|18,29) or (16..18,28) touches the spawn
export const S29B = S29 === 2;
// bays: spawn stays at (17,31); (16,30) and (18,30) touch both the spawn and hub 1's container, so a hauler
// unloading there gets renewed; the extensions move to the fillers' other free neighbours
export const BAYS = !SIN && (globalThis.__K && "bays" in globalThis.__K ? globalThis.__K.bays : 1);
export const BAY = S29B
	? [
			[16, 28],
			[18, 28],
			[16, 29],
			[18, 29],
		]
	: [
			[16, 30],
			[18, 30],
		];
export const RBAY = BAYS || S29B; // haulers due for renewal stop on a BAY tile next to the spawn

// upgrade block, rows 26..28 (all in range 3 of the controller): three containers on row 27, upgraders on
// every other tile, haulers unload from (15|17|19, 28) coming up from row 29. Slots fill far side first.
export const BOXES = S27
	? [
			{ x: 15, y: 27 },
			{ x: 19, y: 27 },
		]
	: [
			{ x: 15, y: 27 },
			{ x: 17, y: 27 },
			{ x: 19, y: 27 },
		];
export const BOX = { x: 17, y: 27 }; // centre of the block, for distances
// row 28 stays a drive-through lane: every tile on it touches a box, haulers never have to back out
export const SLOTS = K_SLOTS_LANE
	? S26
		? [
				[16, 27],
				[16, 26],
				[18, 26],
				[14, 27],
				[20, 27],
				[15, 26],
				[19, 26],
				[14, 26],
				[20, 26],
			]
		: [
				[16, 27],
				[18, 27],
				[14, 27],
				[20, 27],
				[15, 26],
				[17, 26],
				[19, 26],
				[16, 26],
				[18, 26],
				[14, 26],
				[20, 26],
			] // lane side first: the chain grows inwards
	: [
			[14, 26],
			[15, 26],
			[16, 26],
			[17, 26],
			[18, 26],
			[19, 26],
			[20, 26],
			[16, 27],
			[18, 27],
			[14, 27],
			[20, 27],
			[16, 28],
			[18, 28],
			[14, 28],
			[20, 28],
		];

export const SPAWN = S27
	? { x: 17, y: 27 }
	: S26
		? { x: 17, y: 26 }
		: S29
			? { x: 17, y: 29 }
			: { x: 17, y: 31 };
export const HUBS = [
	S29B
		? {
				c: [17, 30],
				fill: [
					[16, 30],
					[18, 30],
				],
				ext: [
					[15, 30],
					[19, 30],
					[15, 31],
					[19, 31],
					[16, 31],
					[18, 31],
					[17, 31],
				],
			}
		: S29 // fillers touch the hub container and the spawn above it; the old filler tiles hold extensions
			? {
					c: [17, 30],
					fill: [
						[16, 30],
						[18, 30],
					],
					ext: [
						[17, 31],
						[16, 31],
						[18, 31],
						[15, 31],
						[19, 31],
						[15, 30],
						[19, 30],
						[16, 32],
						[18, 32],
						[17, 32],
						[15, 32],
						[19, 32],
					],
				}
			: BAYS
				? {
						c: [17, 30],
						fill: [
							[16, 31],
							[18, 31],
						],
						ext: [
							[15, 31],
							[16, 32],
							[18, 32],
							[19, 31],
							[17, 32],
							[15, 30],
							[19, 30],
							[15, 32],
							[19, 32],
							[16, 30],
						],
					}
				: {
						c: [17, 30],
						fill: [
							[16, 31],
							[18, 31],
						],
						ext: [
							...(SIN ? [[17, 31]] : []),
							[15, 31],
							[16, 32],
							[18, 32],
							[19, 31],
							[17, 32],
							[15, 30],
							[16, 30],
							[18, 30],
							[19, 30],
							[15, 32],
							[19, 32],
						],
					},
	{
		c: [23, 30],
		fill: [
			[22, 31],
			[24, 31],
		],
		ext: [
			[21, 31],
			[22, 32],
			[24, 32],
			[25, 31],
			[23, 31],
			[21, 30],
			[22, 30],
			[24, 30],
			[25, 30],
			[21, 32],
			[23, 32],
			[25, 32],
		],
	},
];

const SITE_ORDER = { extension: 0, container: 1 }; // build order
// hub containers go before everything: until one stands its extensions can't be refilled, the spawn
// can't afford full-size bodies and idles (and hub 1's is the spawn's exit)
export const siteOrder = (x) =>
	HUBS.some((h) => x.pos.x === h.c[0] && x.pos.y === h.c[1])
		? -1
		: SITE_ORDER[x.structureType] || 0;

// timing and sizing knobs; tune.mjs searches them against the sim (one line, so it can be swapped)
const K_DEFAULT = {
	remotes2: 16,
	remotes3: 16,
	boxRcl: 1,
	minerBoxRcl: 9,
	slack: 0.81,
	slackEarly: 0.998,
	slackRcl: 3,
	claims: 2,
	reserveBuffer: 500,
	keep: 150,
	minerExtra: 1,
	builders: 2,
	buildPer: 6000,
	upPerBox: 400,
	fed: 0.85,
	hubLow: 1000,
	extMax: 8,
	remotes1: 4,
	minUp: 1,
	upPerBox2: 400,
	builders2: 5,
	resLead: 300,
	resNear: 1,
	usePlan: 0,
	planClock: 0,
	buildWithin: 400,
	buildMaxW: 30,
	upMaxW: 60,
	diag: 1,
	reserveN: 2,
	mxfer: 0,
	hcap: 25,
	hwait: 1,
	bfeed: 0,
	upKeep: 1000,
	parkX: 21,
	parkY: 27,
	fillClaim: 1,
	swap: 0,
	minerExtra5: 0,
	chain: 1,
	lanePileMax: 3000,
	shove: 1,
	paved: 0,
	roadFrom: 4000,
	siteCap: 80,
	renew: 0,
	renewUpW: 5,
	renewHaul: 0.5,
	bayWait: 30,
	bayFree: 300,
	walkLead: 1,
	towUp: 0,
	towMiner: 0,
	towWait: 40,
	tugs: 2,
	tugMove: 6,
	tugX: 21,
	tugY: 30,
	towExtraW: 0,
	rec: 0,
	minerLead: 0,
	walkCeil: 0,
	minerFirst: 0,
	renewPass: 0,
	upRenewAt: 300,
	renewRcl: 3,
	boxHomeOnly: 0,
	m2Rcl: 1,
	exits3: 0,
	jamTicks: 0,
	fair: 0,
	succFirst: 0,
	upFrom: 700,
	buildFrom: 600,
	extMax4: 8,
	fillerJump: 0,
};
// sim/tune.mjs may override knobs by prepending `globalThis.__K = {...}` to the bundle
export const K = Object.assign({}, K_DEFAULT, globalThis.__K || {});
// The private server disables claimController; use reservation instead of room claims.
// Keep the original profile for lower-GCL accounts. An explicit __K experiment overrides automatic profile selection.
const PRIVATE_PROFILE = {
	claimRooms: 0,
	upMaxW: 90,
	extMax: 7,
	extMax4: 7,
	fillerJump: 1,
	exits3: 1,
	minerExtra: 0,
	towMiner: 1,
	towUp: 1,
	tugs: 1,
	tugMove: 5,
	reserveN: 3,
	repath: 2,
	escapeAfter: 8,
	upFrom: 500,
	renew: 1,
	renewPass: 2,
	bayWait: 1,
	fixedFill: 1,
	openEast: 1,
	dropMiners: 1,
	recoverAlt: 1,
	slackReserved: 0.9,
	slackUnreserved: 0.77,
	slackHome: 0.9,
	towRoom: 1,
	towHome: 1,
	walkToTow: 1,
	succFirst: 100,
	recoverMiner: 1,
	urgentNear: 60,
	chainFetch: 1,
};
// Seven extensions provide 650 energy: six WORK plus CARRY for an upgrader.
// Build the lower corners first, keeping (15,30) and (19,30) open for traffic.
export const profileReady = { v: false };
// SPEEDRUN_PROFILE 由构建期 define 注入: 私服 GCL<6 账号强制启用 PRIVATE_PROFILE。
declare const SPEEDRUN_PROFILE: boolean | undefined;
const bakedProfile = typeof SPEEDRUN_PROFILE !== "undefined" && !!SPEEDRUN_PROFILE;
export function configure() {
	if (profileReady.v) return;
	if (bakedProfile || (!globalThis.__K && Game.gcl.level >= 6)) Object.assign(K, PRIVATE_PROFILE);
	if (K.openEast && BAYS && !SIN)
		HUBS[0].ext = [
			[15, 31],
			[16, 32],
			[18, 32],
			[19, 31],
			[17, 32],
			[15, 32],
			[19, 32],
			[15, 30],
			[19, 30],
			[16, 30],
		];
	profileReady.v = true;
}
// sim only: Memory.jitter nudges one threshold so a single layout yields several different games to average
export const jitterK = () =>
	Memory.jitter && !K.jittered && ((K.upPerBox += Memory.jitter), (K.jittered = true));
// remote sources worked, by RCL
export const REMOTES = [
	0,
	K.remotes1,
	K.remotes2,
	K.remotes3,
	K.remotes3,
	K.remotes3,
	K.remotes3,
	K.remotes3,
	K.remotes3,
];

export const pos = (x, y, room) => new RoomPosition(x, y, room);
// ticks since this run's spawn landed (the server's Game.time is in the millions; the sim starts at 0)
export const NOW = () => Game.time - ((Memory.boot && Memory.boot.t) || 0);
// sim only: Memory.jitter nudges path reuse so one layout yields several different games to average
export const RP = () => 30 + (Memory.jitter || 0);
export const go = (c, p, range = 1) =>
	c.pos.inRangeTo(p, range) || c.moveTo(p, { range, reusePath: RP() });

// only its filler may stand on a filler tile, and hub 1's container (the spawn's only exit) stays free
// (spawn29=2 keeps the lane open: its exit tile (17,28) may be crossed, only not stood on)
export const KEEP_CLEAR = [...(S27 || S26 ? [] : [HUBS[0].c]), ...HUBS.flatMap((h) => h.fill)];
export const EXIT = S29B ? [17, 28] : S26 ? [17, 27] : S27 ? null : HUBS[0].c; // the tile newborns step onto (spawn27: the lane, kept free below)
export const SPF_POS: [number, number] = [18, 27]; // spawn26: the spawn's own filler, between the spawn and boxes (17,27)/(19,27)

// ---------- 方向表 ----------

export const DXY = {
	[TOP]: [0, -1],
	[TOP_RIGHT]: [1, -1],
	[RIGHT]: [1, 0],
	[BOTTOM_RIGHT]: [1, 1],
	[BOTTOM]: [0, 1],
	[BOTTOM_LEFT]: [-1, 1],
	[LEFT]: [-1, 0],
	[TOP_LEFT]: [-1, -1],
};
export const BACK = {
	[TOP]: BOTTOM,
	[TOP_RIGHT]: BOTTOM_LEFT,
	[RIGHT]: LEFT,
	[BOTTOM_RIGHT]: TOP_LEFT,
	[BOTTOM]: TOP,
	[BOTTOM_LEFT]: TOP_RIGHT,
	[LEFT]: RIGHT,
	[TOP_LEFT]: BOTTOM_RIGHT,
};

export const L = (k, n) => Memory.L && (Memory.L[k] = (Memory.L[k] || 0) + n); // sim-only energy ledger

export const cost = (body) => _.sum(body, (p) => BODYPART_COST[p]);
export const bodyCost = (creep) => _.sum(creep.body, (p) => BODYPART_COST[p.type]);
