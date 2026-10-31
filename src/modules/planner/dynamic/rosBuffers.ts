/**
 * rosPlanner 可复用缓冲池: 地形数组/优先队列/并查集的模块级共享实例,
 * init 重建、dismiss 释放、createObjects 惰性补建, 供分块与布局流程复用。
 */
import { PriorityQueue } from '@/utils/priorityQueue'
import { UnionFind } from '@/utils/unionFind'
import { RoomArray } from '@/utils/roomArray'

export let visited: RoomArray | null = new RoomArray();
export let roomWalkable: RoomArray | null = new RoomArray();
export let nearWall: RoomArray | null = new RoomArray();
export let routeDistance: RoomArray | null = new RoomArray();
export let roomObjectCache: RoomArray | null = new RoomArray();

export let nearWallWithInterpolation: RoomArray | null = new RoomArray();
export let interpolation: RoomArray | null = new RoomArray();

export let queMin: PriorityQueue | null = new PriorityQueue(true);
export let queMin2: PriorityQueue | null = new PriorityQueue(true);
export let startPoint: PriorityQueue | null = new PriorityQueue(true);

export let unionFind: UnionFind | null = new UnionFind(50 * 50);

export const setRoomObjectCache = (v: RoomArray | null): void => { roomObjectCache = v; };
export const setQueMin = (v: PriorityQueue | null): void => { queMin = v; };
export const setQueMin2 = (v: PriorityQueue | null): void => { queMin2 = v; };
export const setStartPoint = (v: PriorityQueue | null): void => { startPoint = v; };

/** 重建全部缓冲 (每次布局计算入口调用) */
export const resetBuffers = (): void => {
	visited = new RoomArray();
	roomWalkable = new RoomArray();
	nearWall = new RoomArray();
	routeDistance = new RoomArray();

	nearWallWithInterpolation = new RoomArray();
	interpolation = new RoomArray();
	roomObjectCache = new RoomArray();

	queMin = new PriorityQueue(true);
	queMin2 = new PriorityQueue(true);
	startPoint = new PriorityQueue(true);

	unionFind = new UnionFind(50 * 50);
};

/** 释放全部缓冲 (布局计算出口调用, 防内存泄漏) */
export const releaseBuffers = (): void => {
	visited = null;
	roomWalkable = null;
	nearWall = null;
	routeDistance = null;
	roomObjectCache = null;

	nearWallWithInterpolation = null;
	interpolation = null;

	queMin = null;
	queMin2 = null;
	startPoint = null;

	unionFind = null;
};

/** 惰性补建缺失缓冲 (dismiss 后复用时调用) */
export const ensureBuffers = (): void => {
	if (!visited) visited = new RoomArray();
	if (!roomWalkable) roomWalkable = new RoomArray();
	if (!nearWall) nearWall = new RoomArray();
	if (!routeDistance) routeDistance = new RoomArray();
	if (!roomObjectCache) roomObjectCache = new RoomArray();
	if (!nearWallWithInterpolation) nearWallWithInterpolation = new RoomArray();
	if (!interpolation) interpolation = new RoomArray();
	if (!queMin) queMin = new PriorityQueue(true);
	if (!queMin2) queMin2 = new PriorityQueue(true);
	if (!startPoint) startPoint = new PriorityQueue(true);
	if (!unionFind) unionFind = new UnionFind(50 * 50);
};
