/**
 * Screeps 沙盒提供但 @types/screeps 未覆盖的全局 (游戏侧运行时事实)。
 * 只声明沙盒真实存在的成员, 不引入 DOM/Node 类型 (docs/api/01 §1.3)。
 */

declare var console: {
	log(...data: unknown[]): void;
	error(...data: unknown[]): void;
};

declare function require(moduleName: string): unknown;

/** 项目侧 CreepMemory 约定字段 (declaration merging) */
interface CreepMemory {
	/** 当前持有的任务租约 (TaskBoard 分配) */
	taskId?: string;
	/** 角色代号 (生产时写入) */
	unit?: string;
	homeRoom?: string;
}
