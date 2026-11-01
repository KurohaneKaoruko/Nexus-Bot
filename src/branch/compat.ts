/**
 * 必须在 main.ts 里最前 import（先于任何可能引用这些全局的模块）。
 * 没有这些占位，打包产物在模块加载阶段就会 ReferenceError 导致整个循环崩溃。
 *
 */

const ensureGlobalClass = (name: string): void => {
	if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
		(globalThis as Record<string, unknown>)[name] = class Placeholder {};
	}
};

// race 服未实现的 Screeps 全局类（按字母序）
const RACE_MISSING_GLOBALS = [
	"ConstructionSite",
	"Creep",
	"Deposit",
	"Flag",
	"Mineral",
	"Nuke",
	"OwnedStructure",
	"PathFinder",
	"PowerCreep",
	"Resource",
	"RoomObject",
	"RoomPosition",
	"RoomVisual",
	"Ruin",
	"Source",
	"Store",
	"Structure",
	"StructureContainer",
	"StructureController",
	"StructureExtension",
	"StructureExtractor",
	"StructureFactory",
	"StructureInvaderCore",
	"StructureKeeperLair",
	"StructureLab",
	"StructureLink",
	"StructureNuker",
	"StructureObserver",
	"StructurePortal",
	"StructurePowerBank",
	"StructurePowerSpawn",
	"StructureRampart",
	"StructureRoad",
	"StructureSpawn",
	"StructureStorage",
	"StructureTerminal",
	"StructureTower",
	"StructureWall",
] as const;

for (const name of RACE_MISSING_GLOBALS) {
	ensureGlobalClass(name);
}

// 部分私服不存在 global 别名 (代码内 globalThis.x 引用会 ReferenceError), 补占位
ensureGlobalClass("global");

// 私服未实现 Market 玩法时的一次性补桩: 查询返回空、操作返回失败码,
// 市场侧按「无订单市场」降级, 不再逐个抛 ReferenceError/TypeError
const compatGlobal = globalThis as Record<string, unknown>;
const compatMarket = (compatGlobal.Game as { market?: Record<string, unknown> } | undefined)?.market;
if (compatMarket) {
	if (typeof compatMarket.getHistory !== "function") {
		compatMarket.getHistory = () => [];
	}
	const marketStubs: Array<[string, (...args: unknown[]) => unknown]> = [
		["getAllOrders", () => []],
		["getOrderById", () => undefined],
		["calcTransactionCost", () => 1],
		["cancelOrder", () => -1],
		["changeOrderPrice", () => -1],
		["extendOrder", () => -1],
		["createOrder", () => -1],
		["deal", () => -6],
	];
	for (const [name, fn] of marketStubs) {
		if (typeof compatMarket[name] !== "function") compatMarket[name] = fn;
	}
}
