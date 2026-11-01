/**
 * 接力搬运判据 (specs/接力搬运):
 * 相向对穿整仓交接的全部条件——相位相反 (供方满载/受方空载)、意图格互指
 * (对方本 Tick 要踏入的格恰为己方所在格)、单件容量相等、供方 TTL 余量足够、
 * 双方本 Tick 未接力过 (防往复摆振)。意图格取「朝任务锚点 sign 一步」的
 * 几何推算 (agents 阶段 BetterMove 意图尚未登记)。
 */

export interface RelayCreepView {
	x: number;
	y: number;
	/** 满载 (无余量且有货) = 供方相位; 空载 = 受方相位 */
	supplying: boolean;
	/** CARRY 部件数 (容量相等判据) */
	bodyCarry: number;
	ticksToLive: number;
	/** 本 Tick 已接力过 (防同 Tick 二次交接) */
	relayedThisTick: boolean;
	/** 任务锚点 (供方 = 交付目的地, 受方 = 货源), 缺省视为不可接力 */
	anchor: { x: number; y: number } | undefined;
}

/** 朝锚点的几何步进: 每轴取 sign(delta) 一步 */
function stepToward(x: number, y: number, anchor: { x: number; y: number }): { x: number; y: number } {
	return {
		x: x + Math.sign(anchor.x - x),
		y: y + Math.sign(anchor.y - y),
	};
}

/** 意图格互指: a 要踏入的格 = b 所在格, 且 b 要踏入的格 = a 所在格 */
export function intentsInterlocked(a: RelayCreepView, b: RelayCreepView): boolean {
	if (!a.anchor || !b.anchor) {
		return false;
	}
	const stepA = stepToward(a.x, a.y, a.anchor);
	const stepB = stepToward(b.x, b.y, b.anchor);
	return stepA.x === b.x && stepA.y === b.y && stepB.x === a.x && stepB.y === a.y;
}

/**
 * 相向对穿交接判据: 全部条件满足才允许整仓移交。
 * 容量不等/相位同向 (双空或双满)/TTL 不足/锚点缺失/任一方本 Tick 已接力 → 不交接。
 */
export function relayHandoffAllowed(
	supplier: RelayCreepView,
	receiver: RelayCreepView,
	minSupplierTtl: number,
): boolean {
	if (supplier.relayedThisTick || receiver.relayedThisTick) {
		return false;
	}
	if (!supplier.supplying || receiver.supplying) {
		return false;
	}
	if (supplier.bodyCarry !== receiver.bodyCarry) {
		return false;
	}
	if (supplier.ticksToLive <= minSupplierTtl) {
		return false;
	}
	return intentsInterlocked(supplier, receiver);
}
