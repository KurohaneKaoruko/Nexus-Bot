/**
 * 动态内存契约:
 * Screeps 的 RoomMemory/FlagMemory/CreepMemory 是空的 declaration-merging 接口,
 * 运行期按动态键读写 (room.memory.floodFill / flag.memory.rooms / ...)。
 * 统一开放索引签名, 各域完成正式 schema 化后逐域收窄。
 */
declare global {
	interface RoomMemory {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 动态内存通道
		[key: string]: any;
	}

	interface FlagMemory {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 动态内存通道
		[key: string]: any;
	}

	interface Room {
		/** structureCache 挂载的房间结构缓存 (quantity 型聚合) */
		_mass_stores?: Record<string, number>;
		/** structureCache 挂载的房间结构缓存 (按类型分组) */
		_structures?: Record<string, Structure[]>;
		/** structureCache 缓存写入 tick */
		_structures_fetch_time?: number;
	}

	interface StructureTower {
		/** 塔控制的本 tick 行为标志 (避免重复动作计数) */
		attacked?: boolean;
		healed?: boolean;
		repaired?: boolean;
	}

	interface Room {
		/** 原型扩展: 敌对单位/建筑查询 (无参调用口径) */
		findEnemyCreeps(): Creep[];
		findEnemyStructures(): AnyOwnedStructure[];
	}

	/** console 挂载的全局命令入口 (globalThis.room / globalThis.layout 等) */
	var room: any;
	var layout: any;
	/** console 挂载的全局日志口 (globalThis.log) */
	var log: (message: string, ...args: unknown[]) => void;
}

/** 动态内存通道的显式导出（保持本文件模块身份，使 declare global 生效） */
export type DynamicMemoryChannel = {
	room: typeof room;
	layout: typeof layout;
	log: typeof log;
};

