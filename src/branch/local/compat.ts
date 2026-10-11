/**
 * 必须在 main.ts 里最前 import（先于任何可能引用这些全局的模块）。
 * 没有这些占位，打包产物在模块加载阶段就会 ReferenceError 导致整个循环崩溃。
 *
 */

const ensureGlobalClass = (name: string): void => {
	if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
		(globalThis as Record<string, unknown>)[name] = class Placeholder { };
	}
};

// race 服未实现的 Screeps 全局类（按字母序）
const RACE_MISSING_GLOBALS = [
	'ConstructionSite',
	'Creep',
	'Deposit',
	'Flag',
	'Mineral',
	'Nuke',
	'OwnedStructure',
	'PathFinder',
	'PowerCreep',
	'RawMemory',
	'Resource',
	'RoomObject',
	'RoomPosition',
	'RoomVisual',
	'Ruin',
	'Source',
	'Store',
	'Structure',
	'StructureContainer',
	'StructureController',
	'StructureExtension',
	'StructureExtractor',
	'StructureFactory',
	'StructureInvaderCore',
	'StructureKeeperLair',
	'StructureLab',
	'StructureLink',
	'StructureNuker',
	'StructureObserver',
	'StructurePortal',
	'StructurePowerBank',
	'StructurePowerSpawn',
	'StructureRampart',
	'StructureRoad',
	'StructureSpawn',
	'StructureStorage',
	'StructureTerminal',
	'StructureTower',
	'StructureWall',
] as const;

for (const name of RACE_MISSING_GLOBALS) {
	ensureGlobalClass(name);
}
