// @ts-nocheck
/**
 * rosPlanner 可复用缓冲池: 地形数组/优先队列/并查集的模块级共享实例,
 * init 重建、dismiss 释放、createObjects 惰性补建, 供分块与布局流程复用。
 */
import { PriorityQueue } from '@/utils/priorityQueue'
import { UnionFind } from '@/utils/unionFind'
import { RoomArray } from '@/utils/roomArray'

export let visited = new RoomArray();
export let roomWalkable = new RoomArray();
export let nearWall = new RoomArray();
export let routeDistance = new RoomArray();
export let roomObjectCache = new RoomArray();

export let nearWallWithInterpolation = new RoomArray();
export let interpolation = new RoomArray();

export let queMin = new PriorityQueue(true);
export let queMin2 = new PriorityQueue(true);
export let startPoint = new PriorityQueue(true);

export let unionFind = new UnionFind(50 * 50);

export const setRoomObjectCache = (v) => { roomObjectCache = v; };
export const setQueMin = (v) => { queMin = v; };
export const setQueMin2 = (v) => { queMin2 = v; };
export const setStartPoint = (v) => { startPoint = v; };

/** 重建全部缓冲 (每次布局计算入口调用) */
export const resetBuffers = () => {
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

	visited.init();
	nearWall.init();
	routeDistance.init();
	roomWalkable.init();

	nearWallWithInterpolation.init();
	interpolation.init();
	roomObjectCache.init();
	unionFind.init();

	queMin.clear();
	queMin2.clear();
	startPoint.clear();
};

/** 释放全部缓冲 (布局计算出口调用, 防内存泄漏) */
export const releaseBuffers = () => {
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
export const ensureBuffers = () => {
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
