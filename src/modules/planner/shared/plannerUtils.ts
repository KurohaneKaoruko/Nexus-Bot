/**
 * 规划器域共享类型与坐标工具: 三代规划器与布局入口共用的类型定义和纯函数工具。
 */

/** 布局点 (含所属房间名) */
export type PlannerPoint = { x: number; y: number; roomName: string }

/** 平面坐标 */
export type XY = { x: number; y: number }

/** 平面坐标对 (结构点位格式) */
export type XYTuple = [number, number]

/** 结构点位映射: structureType -> 坐标列表 */
export type StructMap = Record<string, XYTuple[]>

/** 从 number|string 混排数组取数值 (非数字视为 0) */
export const numAt = (arr: number[] | string[], idx: number): number => {
	const v = arr[idx];
	return typeof v === 'number' ? v : 0;
};

/** 4 邻域方向 */
export const DIR4 = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];

/** 两点距离平方 */
export const squareDistance = (x1: number, y1: number, x2: number, y2: number): number => {
	const dx = x1 - x2;
	const dy = y1 - y2;
	return dx * dx + dy * dy;
};

/** 遍历索引的 4 邻域 (越界跳过) */
export const forEach4Index = (idx: number, fn: (nidx: number) => void) => {
	const x = (idx / 50) | 0;
	const y = idx % 50;
	for (let i = 0; i < 4; i++) {
		const nx = x + DIR4[i]![0]!;
		const ny = y + DIR4[i]![1]!;
		if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
		fn(nx * 50 + ny);
	}
};

/** 遍历索引的 8 邻域 (不含自身, 越界跳过) */
export const forEach8Index = (idx: number, fn: (nidx: number) => void) => {
	const x = (idx / 50) | 0;
	const y = idx % 50;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (!dx && !dy) continue;
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
			fn(nx * 50 + ny);
		}
	}
};

/** 全房间边缘索引 (按 x*50+y 编码) */
export const BORDER_INDEXES = (() => {
	const out: number[] = [];
	for (let y = 0; y < 50; y++) {
		out.push(y);
		out.push(49 * 50 + y);
	}
	for (let x = 1; x < 49; x++) {
		out.push(x * 50);
		out.push(x * 50 + 49);
	}
	return out;
})();
