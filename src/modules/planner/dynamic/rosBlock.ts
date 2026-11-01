/**
 * ros 分块地形预处理: 山体距离/出口距离 BFS、近墙插值、POI 容器位选址,
 * 以及基于并查集的平面分块与小块合并 (优先走 kernel 快速路径)。
 */
import { PriorityQueue, newNode, reclaimNode } from '@/utils/priorityQueue'
import { UnionFind } from '@/utils/unionFind'
import { RoomArray } from '@/utils/roomArray'
import { numAt, DIR4_AT } from '../shared/plannerUtils'
import type { ReachNode } from './blockKernel'
import {
	visited,
	roomWalkable,
	nearWall,
	routeDistance,
	roomObjectCache,
	nearWallWithInterpolation,
	interpolation,
	queMin,
	startPoint,
	unionFind,
	resetBuffers,
	releaseBuffers,
	ensureBuffers,
} from './rosBuffers'

/** 可放建筑平面最小面积门槛 */
const minPlaneCnt = 160;

/** POI (controller/mineral/source) 列表, 由 computeManor 写入 */
export let objects: { x: number; y: number; roomName: string }[] = [];

export const setObjects = (v: { x: number; y: number; roomName: string }[]): void => { objects = v; };

let fastQueue = new Int16Array(2500);
let fastKernelManorMask = new Uint8Array(2500);

import {
	buildKernelManorMask,
	collectKernelManorReachability,
	blockPutAbleCountKernel,
	computeBlockKernel,
} from './blockKernel'

/**
 * 分块地形管理: 缓冲生命周期 + 分块计算 + 块可建筑面统计。
 */
export const ManagerPlanner = {
	/** 重建全部缓冲 (布局计算入口) */
	init() {
		resetBuffers();
	},
	/** 释放全部缓冲 (布局计算出口, 防内存泄漏) */
	dismiss() {
		releaseBuffers();
		objects = [];
	},

	/** 惰性补建缺失缓冲 */
	createObjects() {
		ensureBuffers();
	},
	/**
	 * 统计块的可用建筑面积 (带缓存), 返回 [内层格列表, 全部关联格列表]。
	 * 性能消耗的大头!
	 */
	getBlockPutAbleCnt(
		walkable: RoomArray,
		unionFind: UnionFind,
		tarRoot: number,
		putAbleCacheMap: Record<number, ReachNode[]>,
		AllCacheMap: Record<number, ReachNode[]>,
		rootMembers?: Record<number, number[]>
		) {
			if (putAbleCacheMap[tarRoot]) return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
			const innerPutAbleList: any = [];
			const AllCacheList: any = [];
			const walkArr = walkable.arr;
			const memberList = rootMembers ? rootMembers[tarRoot] : undefined;
			buildKernelManorMask(unionFind.parent, tarRoot, walkArr, fastKernelManorMask, memberList);
			collectKernelManorReachability(fastKernelManorMask, walkArr, innerPutAbleList, AllCacheList);

		putAbleCacheMap[tarRoot] = innerPutAbleList;
		AllCacheMap[tarRoot] = AllCacheList;
		return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
	},
	/** 统计块的可用建筑面积 (仅数量, 带缓存) */
	getBlockPutAbleCntCount(
		walkable: RoomArray,
		unionFind: UnionFind,
		tarRoot: number,
		putAbleCacheMap: Record<number, any[]>,
		allCacheMap: Record<number, any[]>,
		putAbleCntCacheMap: Record<number, number>,
		rootMembers?: Record<number, number[]>
		) {
			const root = Number(tarRoot);
			if (putAbleCntCacheMap[root] != null) return putAbleCntCacheMap[root];
			const walkArr = walkable.arr;
			const cntCache = new Int16Array(2500);
			cntCache.fill(-1);
			const cnt = blockPutAbleCountKernel(
				unionFind.parent,
				root,
				walkArr,
				cntCache,
				rootMembers ? rootMembers[root] : undefined
			);
			putAbleCntCacheMap[root] = cnt;
			return cnt;
		},
	/**
	 * 地形分块: 山体距离/出口距离/近墙插值预处理 + 并查集分块与合并。
	 * @param roomName 房间名
	 * @param blocked 阻挡掩码 (可选)
	 * @returns [并查集, 块大小表, 可行走数组, 近墙数组, 内层缓存表, 全量缓存表]
	 */
	computeBlock(
		roomName: string,
		blocked?: RoomArray
	): [UnionFind, Record<number, number>, RoomArray, RoomArray, Record<number, any[]>, Record<number, any[]>] {
		ManagerPlanner.createObjects();

		// 缓冲由 createObjects(ensureBuffers) 保证非空, 函数内以局部别名固定非空视图
		const walkBuf = roomWalkable ?? new RoomArray();
		const visitedBuf = visited ?? new RoomArray();
		const nearWallBuf = nearWall ?? new RoomArray();
		const routeBuf = routeDistance ?? new RoomArray();
		const objCache = roomObjectCache ?? new RoomArray();
		const interBuf = interpolation ?? new RoomArray();
		const nearWallInterBuf = nearWallWithInterpolation ?? new RoomArray();
		const queMinBuf2 = queMin ?? new PriorityQueue(true);
		const startPointBuf2 = startPoint ?? new PriorityQueue(true);
		const unionFindLocal = unionFind ?? new UnionFind(2500);

		walkBuf.initRoomTerrainWalkAble(roomName);
		const walkArr = walkBuf.arr;
		const blockedArr = blocked?.arr;

		// 计算距离山体要多远（均匀权重 BFS 用数组队列，避免堆开销）
		visitedBuf.init();
		nearWallBuf.init();
		const visitedArr = visitedBuf.arr;
		const nearWallArr = nearWallBuf.arr;
		let qHead = 0;
		let qTail = 0;
		for (let idx = 0; idx < 2500; idx++) {
			if (!walkArr[idx]) {
				visitedArr[idx] = 1;
				nearWallArr[idx] = 0;
				fastQueue[qTail++] = idx;
			}
		}
		while (qHead < qTail) {
			const idx = numAt(fastQueue, qHead);
			qHead += 1;
			const x = (idx / 50) | 0;
			const y = idx % 50;
			const ndk = numAt(nearWallArr, idx);
			for (let i = 0; i < 4; i++) {
				const dir = DIR4_AT[i];
				if (!dir) continue;
				const nx = x + dir[0];
				const ny = y + dir[1];
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				const nidx = nx * 50 + ny;
				if (walkArr[nidx] && !visitedArr[nidx]) {
					visitedArr[nidx] = 1;
					nearWallArr[nidx] = ndk + 1;
					fastQueue[qTail++] = nidx;
				}
			}
		}

		// 距离出口一格不能放墙
		const pushBorderSeed = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (!walkArr[nidx]) continue;
					nearWallArr[nidx] = 50;
					queMinBuf2.push(newNode(0, nx, ny));
				}
			}
			nearWallArr[idx] = 50;
			queMinBuf2.push(newNode(0, x, y));
		};
		for (let y = 0; y < 50; y++) {
			pushBorderSeed(0, y);
			pushBorderSeed(49, y);
		}
		for (let x = 1; x < 49; x++) {
			pushBorderSeed(x, 0);
			pushBorderSeed(x, 49);
		}

		const roomPutAble = routeBuf;
		roomPutAble.initRoomTerrainWalkAble(roomName);
		const roomPutAbleArr = roomPutAble.arr;
		const clearPutAbleNearBorder = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!roomPutAbleArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (!roomPutAbleArr[nidx]) continue;
					roomPutAbleArr[nidx] = 0;
				}
			}
			roomPutAbleArr[idx] = 0;
		};
		for (let y = 0; y < 50; y++) {
			clearPutAbleNearBorder(0, y);
			clearPutAbleNearBorder(49, y);
		}
		for (let x = 1; x < 49; x++) {
			clearPutAbleNearBorder(x, 0);
			clearPutAbleNearBorder(x, 49);
		}

		// POI 容器/link/extractor 位选址 (controller 旁只放容器, mineral 上放 extractor)
		const getObjectPos = function (x: number, y: number, struct: string): [number, number] | null {
			let picked: [number, number] | null = null;
			const tryPick = (nx: number, ny: number, requirePutAble: boolean): boolean => {
				if (picked) return true;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) return false;
				const idx = nx * 50 + ny;
				if (!walkArr[idx]) return false;
				if (requirePutAble && !roomPutAbleArr[idx]) return false;
				if (objCache.get(nx, ny)) return false;
				picked = [nx, ny];
				return true;
			};

			for (let i = 0; i < 4; i++) {
				const dir = DIR4_AT[i];
				if (!dir) continue;
				tryPick(x + dir[0], y + dir[1], true);
				if (picked) break;
			}
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					tryPick(x + dx, y + dy, true);
					if (picked) break;
				}
				if (picked) break;
			}

			// border/地形极端场景兜底：允许使用可行走但不在 putAble 集合内的位置，避免回落到 (0,0)
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					tryPick(x + dx, y + dy, false);
					if (picked) break;
				}
				if (picked) break;
			}
			for (let radius = 2; radius <= 4; radius++) {
				for (let dx = -radius; dx <= radius; dx++) {
					for (let dy = -radius; dy <= radius; dy++) {
						if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
						tryPick(x + dx, y + dy, false);
						if (picked) break;
					}
					if (picked) break;
				}
				if (picked) break;
			}

			if (!picked) return null;
			objCache.set(picked[0], picked[1], struct);
			return picked;
		};
		for (let i = 0; i < objects.length; i++) {
			const pos = objects[i];
			//container 位置
			const p = getObjectPos(pos!.x!, pos!.y!, 'container');
			if (!p) continue;

			// link 位置
			if (i != 1) {
				const linkPos = getObjectPos(p[0], p[1], 'link');
				if (linkPos) {
					objCache.link = objCache.link || [];
					objCache.link.push(linkPos);
				} // link controller 然后是  source
			} else {
				objCache.extractor = [[pos!.x!, pos!.y!]];
			}
			objCache.container = objCache.container || [];
			if (i != 1) objCache.container.unshift(p); //如果是 mineral 最后一个
			else objCache.container.push(p);
		}

		// 插值：热点路径改为数组直访，减少 forEach/for4Direction 回调开销
		const interpolationArr = interBuf.arr;
		const nearWallWithInterpolationArr = nearWallInterBuf.arr;
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = numAt(nearWallArr, idx);
				let value = -4 * val;
				for (let i = 0; i < 4; i++) {
					const dir = DIR4_AT[i];
					if (!dir) continue;
					const nx = x + dir[0];
					const ny = y + dir[1];
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					value += numAt(nearWallArr, nx * 50 + ny);
				}
				interpolationArr[idx] = value;
				if (value > 0) value = 0;
				nearWallWithInterpolationArr[idx] = val && walkArr[idx] ? val + value * 0.1 : 0;
			}
		}

		if (blockedArr) {
			for (let idx = 0; idx < 2500; idx++) {
				if (blockedArr[idx]) nearWallWithInterpolationArr[idx] = 0;
			}
		}

		// 计算距离出口多远
		visitedBuf.init();
		routeBuf.init();
		const routeArr = routeBuf.arr;
		const routeVisitArr = visitedBuf.arr;
		let routeHead = 0;
		let routeTail = 0;
		// border 阶段已经写入 queMin，这里转成数组队列做统一权重 BFS
		while (!queMinBuf2.isEmpty()) {
			const seed = (queMinBuf2.pop() as unknown) as { k: number; x: number; y: number; v?: number } | undefined;
			if (!seed) break;
			const idx = seed.x * 50 + seed.y;
			if (!routeVisitArr[idx]) {
				routeVisitArr[idx] = 1;
				routeArr[idx] = 0;
				fastQueue[routeTail++] = idx;
			}
			reclaimNode(seed);
		}
		queMinBuf2.clear();
		while (routeHead < routeTail) {
			const idx = numAt(fastQueue, routeHead);
			routeHead += 1;
			const x = (idx / 50) | 0;
			const y = idx % 50;
			const base = numAt(routeArr, idx);
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (walkArr[nidx] && !routeVisitArr[nidx]) {
						routeVisitArr[nidx] = 1;
						routeArr[nidx] = base + 1;
						fastQueue[routeTail++] = nidx;
					}
				}
			}
		}

		const putAbleCacheMap: Record<number, ReachNode[]> = {};
		const allCacheMap: Record<number, ReachNode[]> = {};
		const putAbleCntCacheMap: Record<number, number> = {};
		const sizeMap: Record<number, number> = {};
		const walkableU8 = new Uint8Array(2500);
		const scoreF32 = new Float32Array(2500);
		const routeI16 = new Int16Array(2500);
		const blockedU8 = blockedArr ? new Uint8Array(2500) : undefined;
		const scoreArr = nearWallInterBuf.arr;
		for (let i = 0; i < 2500; i++) {
			walkableU8[i] = walkArr[i] ? 1 : 0;
			scoreF32[i] = numAt(scoreArr, i);
			routeI16[i] = numAt(routeArr, i);
			if (blockedU8) blockedU8[i] = blockedArr && numAt(blockedArr, i) ? 1 : 0;
		}
		const kernelResult = computeBlockKernel(walkableU8, scoreF32, routeI16, blockedU8);
		if (kernelResult) {
			unionFindLocal.loadFrom(kernelResult.parent);
			for (let i = 0; i < 2500; i++) {
				const blockSize = numAt(kernelResult.size, i);
				if (blockSize > 0) sizeMap[i] = blockSize;
			}
			return [unionFindLocal, sizeMap, walkBuf, nearWallBuf, putAbleCacheMap, allCacheMap];
		}
		// 对距离的格子插入到队列 ， 作为分开的顺序
		for (let idx = 0; idx < 2500; idx++) {
			if (!walkArr[idx]) continue;
			const nVal = numAt(routeArr, idx);
			if (nVal) {
				const x = (idx / 50) | 0;
				const y = idx % 50;
				startPointBuf2.push(newNode(-nVal, x, y));
			}
		}
		const posSeqMap: Record<number, number[]> = {};

		// 分块，将地图分成一小块一小块
		visitedBuf.init();
		for (let i = 0; i < 2500; i++) {
			if (startPointBuf2.isEmpty()) break;
			let cnt = 0;
			const nd = (startPointBuf2.pop() as unknown) as { k: number; x: number; y: number; v?: number } | undefined;
			if (!nd) break;
			const currentPos = nd.x * 50 + nd.y;
			if (blockedArr && blockedArr[currentPos]) {
				unionFindLocal.union(currentPos, 0);
				continue;
			}
			const posSeq: number[] = [];

			// 迭代版 DFS：mode 0=up, 1=down; phase 0=pre, 1=post
			const stack: Array<[number, number, number, number]> = [[nd.x, nd.y, 0, 0]];
			while (stack.length) {
				const frame = stack.pop();
				if (!frame) continue;
				const x = frame[0];
				const y = frame[1];
				const mode = frame[2];
				const phase = frame[3];
				if (!phase) {
					if (visitedBuf.exec(x, y, 1)) continue;
					const currentValue = numAt(nearWallInterBuf.arr, x * 50 + y);
					stack.push([x, y, mode, 1]);
					if (!mode) {
						for (let dx = -1; dx <= 1; dx++) {
							for (let dy = -1; dy <= 1; dy++) {
								if (!dx && !dy) continue;
								const x1 = x + dx;
								const y1 = y + dy;
								if (x1 < 0 || x1 > 49 || y1 < 0 || y1 > 49) continue;
								const v = numAt(nearWallWithInterpolationArr, x1 * 50 + y1);
								if (v > currentValue && currentValue < 6) {
									//加了一点优化，小于时分裂更多
									stack.push([x1, y1, 0, 0]);
								} else if (v && v < currentValue) {
									stack.push([x1, y1, 1, 0]);
								}
							}
						}
					} else {
						for (let di = 0; di < 4; di++) {
							const dir = DIR4_AT[di];
							if (!dir) continue;
							const x1 = x + dir[0];
							const y1 = y + dir[1];
							if (x1 < 0 || x1 > 49 || y1 < 0 || y1 > 49) continue;
							const v = numAt(nearWallWithInterpolationArr, x1 * 50 + y1);
							if (v && v < currentValue) stack.push([x1, y1, 1, 0]);
						}
					}
					continue;
				}

				// post-order 阶段，保持与递归版一致的合并时机
				const pos = x * 50 + y;
				const posRoot = unionFindLocal.find(pos);
				if (posRoot && (!blockedArr || !blockedArr[pos])) {
					unionFindLocal.union(currentPos, pos);
					posSeq.push(pos);
					cnt++;
				} else if (blockedArr) {
					unionFindLocal.union(pos, 0);
				}
			}

			//记录每一块的位置和大小 以 并查集的根节点 作为记录点
			if (cnt > 0) {
				const pos = unionFindLocal.find(currentPos);
				queMinBuf2.push(newNode(cnt, 0, 0, pos));
				sizeMap[pos] = cnt;
				posSeqMap[pos] = posSeq;
			}
		}

		// 将出口附近的块删掉（改为数组邻域扫描）
		const unionFindAlias = unionFindLocal;
		const pruneBorderNear = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (!walkArr[nidx]) continue;
					const pos = unionFindAlias.find(nidx);
					if (sizeMap[pos]) delete sizeMap[pos];
				}
			}
		};
		for (let y = 0; y < 50; y++) {
			pruneBorderNear(0, y);
			pruneBorderNear(49, y);
		}
		for (let x = 1; x < 49; x++) {
			pruneBorderNear(x, 0);
			pruneBorderNear(x, 49);
		}
		delete sizeMap[0];

		// 合并小块成大块的
		queMinBuf2.whileNoEmpty((nd) => {
			if (!nd || typeof nd.v !== 'number') return;
			const pos = nd.v;
			if (nd.k != sizeMap[pos]) return; // 已经被合并了

			visitedBuf.init();
			const nearCntMap: Record<number, number> = {};

			// 搜索附近的块（改为数组邻域扫描）
			const mergeVisitedArr = visitedBuf.arr;
			const seq = posSeqMap[pos];
			for (let si = 0; si < seq!.length!; si++) {
				const e = seq![si]!;
				const x = (e! / 50) | 0;
				const y = e! % 50;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						const nidx = nx * 50 + ny;
						if (!walkArr[nidx] || mergeVisitedArr[nidx]) continue;
						mergeVisitedArr[nidx] = 1;
						const currentPos = unionFindLocal.find(nidx);
						if (currentPos == pos) continue;
						const currentSize = sizeMap[currentPos];
						if (currentSize !== undefined && currentSize < 300) {
							nearCntMap[currentPos] = (nearCntMap[currentPos] || 0) + 1;
						}
					}
				}
			}

			let targetPos = undefined;
			let nearCnt = 0;
			let maxRatio = 0;

			// 找出合并附近最优的块
			for (const currentPos in nearCntMap) {
				const currentPosNum = Number(currentPos);
				const near = nearCntMap[currentPosNum] ?? 0;
				const size = sizeMap[currentPosNum] ?? 0;
				const currentRatio = near / Math.sqrt(Math.min(size, nd.k)); //实际/期望
				if (
					targetPos === undefined ||
					(currentRatio == maxRatio ? size < (sizeMap[targetPos] ?? 0) : currentRatio > maxRatio)
				) {
					targetPos = currentPosNum;
					maxRatio = currentRatio;
					nearCnt = near;
				}
			}
			for (const currentPos in nearCntMap) {
				const near = nearCntMap[currentPos] ?? 0;
				if (nearCnt < near) {
					targetPos = Number(currentPos);
					nearCnt = near;
				}
			}
			if (targetPos === undefined) return;
			const minSize = sizeMap[targetPos] ?? 0;
			const cnt = nd.k + minSize;
			// let nearRatio =nearCntMap[targetPos]/allNearCnt;

			let targetBlockPutAbleCnt = 0;
			let ndkBlockPutAbleCnt = 0;
			if (minSize > minPlaneCnt)
				targetBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCntCount(
					walkBuf,
					unionFindAlias,
					targetPos,
					putAbleCacheMap,
					allCacheMap,
					putAbleCntCacheMap,
					posSeqMap
				);
			if (nd.k > minPlaneCnt)
				ndkBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCntCount(
					walkBuf,
					unionFindAlias,
					pos,
					putAbleCacheMap,
					allCacheMap,
					putAbleCntCacheMap,
				posSeqMap
			);

			// 合并
			if (Math.max(targetBlockPutAbleCnt, ndkBlockPutAbleCnt) < minPlaneCnt) {
				unionFindLocal.union(pos, targetPos);
				const mergedRoot = unionFindLocal.find(pos);
				nd.v = mergedRoot;

				if (pos != mergedRoot) delete sizeMap[pos];
				else delete sizeMap[targetPos];

				nd.k = cnt;
				sizeMap[mergedRoot] = cnt;
				const targetSeq = posSeqMap[targetPos];
				const currentSeq = posSeqMap[pos];
				const mergedSeq: number[] = Array.from({ length: (targetSeq?.length ?? 0) + (currentSeq?.length ?? 0) });
				let mergedIdx = 0;
				for (let i = 0; i < (targetSeq?.length ?? 0); i++) mergedSeq[mergedIdx++] = targetSeq?.[i] ?? 0;
				for (let i = 0; i < (currentSeq?.length ?? 0); i++) mergedSeq[mergedIdx++] = currentSeq?.[i] ?? 0;
				posSeqMap[mergedRoot] = mergedSeq;
				delete putAbleCacheMap[mergedRoot];
				delete putAbleCacheMap[targetPos];
				delete putAbleCntCacheMap[mergedRoot];
				delete putAbleCntCacheMap[targetPos];
				delete putAbleCntCacheMap[pos];
				if (pos != mergedRoot) delete posSeqMap[pos];
				else delete posSeqMap[targetPos];
				queMinBuf2.push(newNode(nd.k, nd.x, nd.y, mergedRoot));
			}
		});
		return [unionFindLocal, sizeMap, walkBuf, nearWallBuf, putAbleCacheMap, allCacheMap];
	},
};

