// @ts-nocheck
/**
 * 布局入口域共享类型: 坐标/结构映射/缓存条目的公共定义。
 */

/** 房间内的坐标对。 */
export type XY = [number, number];

/** 布局结构点位映射：structureType -> 坐标列表。 */
export type LayoutStructMap = {
	[structureType: string]: XY[];
};

/** 布局写入 Memory 的压缩格式：structureType -> 压缩后的 number[]。 */
export type LayoutMemoryMap = {
	[structureType: string]: number[];
};

/** 布局中心点（房间坐标）。 */
export type LayoutCenter = { x: number; y: number };

/** 一次布局计算结果（用于缓存/可视化/落盘）。 */
export type CachedLayout = {
	key: string;
	roomName: string;
	layoutType: string;
	center: LayoutCenter;
	createdAt: number;
	expiresAt: number;
	structMap: LayoutStructMap;
	layoutMemory: LayoutMemoryMap;
};

/** 动态规划器 computeManor 的可能返回结构。 */
export type DynamicPlannerRawResult = {
	roomName?: string
	structMap?: LayoutStructMap
	centerPos?: { x: number; y: number }
	labPos?: { labX: number; labY: number }
	storageStructPos?: { x: number; y: number }
};
