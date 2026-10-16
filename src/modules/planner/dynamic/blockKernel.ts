// @ts-nocheck
/**
 * 分块地形分析内核: 并查集分块 + 可建筑面可达性统计 (纯数组运算, 无 RoomArray 依赖)。
 */
import { newNode, reclaimNode, PriorityQueue } from '@/utils/priorityQueue'
import { forEach4Index, forEach8Index, BORDER_INDEXES } from '../shared/plannerUtils'

type KernelResult = {
	parent: Int32Array
	size: Int16Array
}

/** 并查集查找 (带路径压缩) */
export const kernelFind = (parent: number[] | Int32Array, x: number): number => {
	let root = x;
	while (parent[root] !== root) root = parent[root];
	let cur = x;
	while (parent[cur] !== cur) {
		const next = parent[cur];
		parent[cur] = root;
		cur = next;
	}
	return root;
};

/** 并查集合并 (小根挂大根) */
export const kernelUnion = (parent: number[] | Int32Array, a: number, b: number): number => {
	const ra = kernelFind(parent, a);
	const rb = kernelFind(parent, b);
	if (ra === rb) return ra;
	if (ra > rb) {
		parent[ra] = rb;
		return rb;
	}
	parent[rb] = ra;
	return ra;
};

let fastVisitStamp = new Uint16Array(2500);
let fastManorStamp = new Uint16Array(2500);
let fastQueue = new Int16Array(2500);
let fastQueueDist = new Int16Array(2500);
let fastFrontierA = new Int16Array(2500);
let fastFrontierB = new Int16Array(2500);
let fastKernelManorMask = new Uint8Array(2500);
let fastMergeCellStamp = new Uint16Array(2500);
let fastMergeRootStamp = new Uint16Array(2500);
let fastMergeRootCount = new Int16Array(2500);
let fastMergeRootList = new Int16Array(2500);
let fastStampToken = 1;

/** 取下一个访问戳 (接近溢出时整体重置戳数组) */
export const nextFastStamp = (): number => {
	fastStampToken += 1;
	if (fastStampToken >= 65530) {
		fastStampToken = 1;
		fastVisitStamp.fill(0);
		fastManorStamp.fill(0);
	}
	return fastStampToken;
};

/** 重置 manor 戳 (跨块候选遍历前使用) */
export const resetManorStamp = (): void => {
	fastManorStamp.fill(0);
};

/** 构建指定块的 manor 掩码: 块成员标记 + 单格孤立剔除 + 贴边清零 */
export const buildKernelManorMask = (
	parent: number[] | Int32Array,
	root: number,
	walkable: ArrayLike<number>,
	manorMask: Uint8Array,
	memberList?: number[]
) => {
	manorMask.fill(0);
	if (memberList && memberList.length > 0) {
		for (let i = 0; i < memberList.length; i++) {
			manorMask[memberList[i]!] = 1;
		}
		for (let i = 0; i < memberList.length; i++) {
			const idx = memberList[i];
			if (!manorMask[idx!]) continue;
			let manorCnt = 0;
			let wallCnt = 0;
			forEach4Index(idx, (n) => {
				if (manorMask[n]) manorCnt += 1;
				if (!walkable[n]) wallCnt += 1;
			});
			if (manorCnt === 1 && wallCnt === 0) manorMask[idx!] = 0;
		}
	} else {
		const rootId = kernelFind(parent, root);
		for (let i = 0; i < 2500; i++) {
			if (kernelFind(parent, i) === rootId) manorMask[i] = 1;
		}
		for (let i = 0; i < 2500; i++) {
			if (!manorMask[i]) continue;
			let manorCnt = 0;
			let wallCnt = 0;
			forEach4Index(i, (n) => {
				if (manorMask[n]) manorCnt += 1;
				if (!walkable[n]) wallCnt += 1;
			});
			if (manorCnt === 1 && wallCnt === 0) manorMask[i] = 0;
		}
	}

	const stamp = nextFastStamp();
	let qHead = 0;
	let qTail = 0;
	for (let idx = 0; idx < 2500; idx++) {
		if (!manorMask[idx] && walkable[idx]) {
			fastVisitStamp[idx] = stamp;
			fastQueue[qTail++] = idx;
		}
	}
	while (qHead < qTail) {
		const idx = fastQueue[qHead++];
		fastVisitStamp[idx!] = 0;
		if (manorMask[idx!] || !walkable[idx!]) continue;
		let manorCnt = 0;
		let wallCnt = 0;
		forEach4Index(idx, (n) => {
			if (manorMask[n]) manorCnt += 1;
			if (!walkable[n]) wallCnt += 1;
		});
		if (manorCnt >= 2 || (manorCnt === 1 && wallCnt >= 2)) {
			manorMask[idx!] = 1;
			forEach4Index(idx, (n) => {
				if (!manorMask[n] && walkable[n] && fastVisitStamp[n] !== stamp) {
					fastVisitStamp[n] = stamp;
					fastQueue[qTail++] = n;
				}
			});
		}
	}

	for (let i = 0; i < BORDER_INDEXES.length; i++) {
		const b = BORDER_INDEXES[i];
		if (!walkable[b!]) continue;
		manorMask[b!] = 0;
		forEach8Index(b, (n) => {
			manorMask[n] = 0;
		});
	}
};

/**
 * 统计 manor 掩码块的可建筑面:
 * - innerList: 内层可建筑格 (k = 距墙层数)
 * - allList: 含外扩负层的全部关联格
 * - 返回内层数量
 */
export const collectKernelManorReachability = (
	manorMask: Uint8Array,
	walkable: ArrayLike<number>,
	innerList?: { k: number; x?: number; y?: number }[],
	allList?: { k: number; x?: number; y?: number }[]
): number => {
	const stamp = nextFastStamp();
	let negativeLen = 0;
	let wallQueueLen = 0;

	for (let idx = 0; idx < 2500; idx++) {
		if (manorMask[idx]) continue;
		fastVisitStamp[idx] = stamp;
		if (walkable[idx]) {
			fastFrontierA[negativeLen++] = idx;
		} else {
			fastQueue[wallQueueLen] = idx;
			fastQueueDist[wallQueueLen++] = -1;
		}
	}

	let currentDist = -4;
	let currentFrontier = fastFrontierA;
	let nextFrontier = fastFrontierB;
	while (currentDist < -1 && negativeLen > 0) {
		let nextLen = 0;
		for (let i = 0; i < negativeLen; i++) {
			const idx = currentFrontier[i];
			forEach8Index(idx, (n) => {
				if (fastVisitStamp[n] === stamp) return;
				fastVisitStamp[n] = stamp;
				if (manorMask[n] && walkable[n] && allList) {
					allList.push(newNode(currentDist + 2, (n / 50) | 0, n % 50));
				}
				nextFrontier[nextLen++] = n;
			});
		}
		currentDist += 1;
		if (currentDist === -1) {
			for (let i = 0; i < nextLen; i++) {
				const idx = nextFrontier[i];
				fastQueue[wallQueueLen] = idx;
				fastQueueDist[wallQueueLen++] = -1;
			}
		}
		const swap = currentFrontier;
		currentFrontier = nextFrontier;
		nextFrontier = swap;
		negativeLen = nextLen;
	}

	let innerCnt = 0;
	let qHead = 0;
	while (qHead < wallQueueLen) {
		const idx = fastQueue[qHead];
		const dist = fastQueueDist[qHead++];
		forEach4Index(idx, (n) => {
			if (fastVisitStamp[n] === stamp) return;
			fastVisitStamp[n] = stamp;
			fastQueue[wallQueueLen] = n;
			fastQueueDist[wallQueueLen++] = dist! + 1;
			if (!manorMask[n] || !walkable[n]) return;
			const item = newNode(dist! + 2, (n / 50) | 0, n % 50);
			if (allList) allList.push(item);
			if (dist! + 1 >= 0) {
				innerCnt += 1;
				if (innerList) innerList.push(item);
			}
		});
	}

	return innerCnt;
};

/** 统计指定块内层数 (带缓存) */
export const blockPutAbleCountKernel = (
	parent: number[] | Int32Array,
	root: number,
	walkable: ArrayLike<number>,
	cache: Int16Array,
	memberList?: number[]
): number => {
	const rootId = kernelFind(parent, root);
	if (cache[rootId]! >= 0) return cache[rootId];

	buildKernelManorMask(parent, rootId, walkable, fastKernelManorMask, memberList);
	const innerCnt = collectKernelManorReachability(fastKernelManorMask, walkable);
	cache[rootId] = innerCnt;
	return innerCnt;
};

/**
 * 快速分块: 按山脊得分与出口距离切平面, 合并小块直至块内可建筑面达标。
 * 返回并查集父数组与块大小表。
 */
export const computeBlockKernel = (
	walkable: Uint8Array,
	score: Float32Array,
	routeDist: Int16Array,
	blocked?: Uint8Array
): KernelResult => {
	const parent = new Int32Array(2500);
	for (let i = 0; i < 2500; i++) parent[i] = i;
	const sizeMap = new Int16Array(2500);
	const visited = new Uint8Array(2500);
	const posSeqMap: Array<number[] | undefined> = Array.from({ length: 2500 });

	const startPoints: number[] = [];
	for (let i = 0; i < 2500; i++) {
		if (walkable[i] && routeDist[i]! > 0) startPoints.push(i);
	}
	startPoints.sort((a, b) => routeDist[b]! - routeDist[a]!);

	for (let si = 0; si < startPoints.length; si++) {
		const currentPos = startPoints[si];
		if (blocked && blocked[currentPos!]) {
			kernelUnion(parent, currentPos, 0);
			continue;
		}
		if (visited[currentPos!]) continue;

		let cnt = 0;
		const posSeq: number[] = [];
		const stack: number[] = [currentPos, 0, 0];

		while (stack.length) {
			const mode = stack.pop() as number;
			const phase = stack.pop() as number;
			const idx = stack.pop() as number;
			if (phase === 0) {
				if (visited[idx]) continue;
				visited[idx] = 1;
				stack.push(idx, 1, mode);
				const currentValue = score[idx];
				if (mode === 0) {
					forEach8Index(idx, (n) => {
						const v = score[n];
						if (v! > currentValue! && currentValue! < 6) stack.push(n, 0, 0);
						else if (v! > 0 && v! < currentValue!) stack.push(n, 0, 1);
					});
				} else {
					forEach4Index(idx, (n) => {
						const v = score[n];
						if (v! > 0 && v! < currentValue!) stack.push(n, 0, 1);
					});
				}
				continue;
			}

			const blockedHere = blocked ? !!blocked[idx] : false;
			const fi = kernelFind(parent, idx);
			const fc = kernelFind(parent, currentPos);
			if (fi !== 0 && fc !== 0 && !blockedHere) {
				kernelUnion(parent, currentPos, idx);
				posSeq.push(idx);
				cnt += 1;
			} else if (blocked) {
				kernelUnion(parent, idx, 0);
			}
		}

		if (cnt > 0) {
			const root = kernelFind(parent, currentPos);
			sizeMap[root] = cnt;
			posSeqMap[root] = posSeq;
		}
	}

	for (let i = 0; i < BORDER_INDEXES.length; i++) {
		const b = BORDER_INDEXES[i];
		if (!walkable[b!]) continue;
		const p = kernelFind(parent, b);
		sizeMap[p] = 0;
		forEach8Index(b, (n) => {
			if (!walkable[n]) return;
			const pn = kernelFind(parent, n);
			sizeMap[pn] = 0;
		});
	}
	sizeMap[0] = 0;

	const queue = new PriorityQueue(true);
	for (let p = 0; p < 2500; p++) {
		if (sizeMap[p]! > 0) queue.push(newNode(sizeMap[p], 0, 0, p));
	}
	const putAbleCache = new Int16Array(2500);
	putAbleCache.fill(-1);

	while (!queue.isEmpty()) {
		const nd = (queue.pop() as unknown) as { k: number; v: number } | undefined;
		if (!nd) break;
		const k = nd.k;
		const pos = nd.v;
		if (sizeMap[pos] !== k) {
			reclaimNode(nd);
			continue;
		}

		const seq = posSeqMap[pos];
		if (!seq || seq.length === 0) {
			reclaimNode(nd);
			continue;
		}

		const stamp = nextFastStamp();
		let nearRootLen = 0;
		for (let i = 0; i < seq.length; i++) {
			const e = seq[i];
			forEach8Index(e, (n) => {
				if (!walkable[n] || fastMergeCellStamp[n] === stamp) return;
				fastMergeCellStamp[n] = stamp;
				const cp = kernelFind(parent, n);
				if (cp === pos) return;
				const cs = sizeMap[cp];
				if (cs! <= 0 || cs! >= 300) return;
				if (fastMergeRootStamp[cp] !== stamp) {
					fastMergeRootStamp[cp] = stamp;
					fastMergeRootCount[cp] = 1;
					fastMergeRootList[nearRootLen++] = cp;
					return;
				}
				fastMergeRootCount[cp] = (fastMergeRootCount[cp] ?? 0) + 1;
			});
		}

		let targetPos = -1;
		let nearCnt = 0;
		let maxRatio = 0;
		for (let i = 0; i < nearRootLen; i++) {
			const currentPos = fastMergeRootList[i];
			const near = fastMergeRootCount[currentPos!];
			if (near <= 0) continue;
			const currentSize = sizeMap[currentPos!];
			if (currentSize <= 0) continue;
			const ratio = near / Math.sqrt(Math.min(currentSize, k));
			const better = ratio === maxRatio ? targetPos < 0 || currentSize < sizeMap[targetPos]! : ratio > maxRatio;
			if (better) {
				targetPos = currentPos;
				maxRatio = ratio;
				nearCnt = near;
			}
		}
		for (let i = 0; i < nearRootLen; i++) {
			const currentPos = fastMergeRootList[i];
			const near = fastMergeRootCount[currentPos!];
			if (near > nearCnt) {
				targetPos = currentPos;
				nearCnt = near;
			}
		}
		if (targetPos < 0) {
			reclaimNode(nd);
			continue;
		}

		const minSize = sizeMap[targetPos];
		if (minSize! <= 0) {
			reclaimNode(nd);
			continue;
		}

		const targetPutAble = minSize! > 140 ? blockPutAbleCountKernel(parent, targetPos, walkable, putAbleCache, posSeqMap[targetPos]) : 0;
		const posPutAble = k > 140 ? blockPutAbleCountKernel(parent, pos, walkable, putAbleCache, posSeqMap[pos]) : 0;
		if (Math.max(targetPutAble, posPutAble) < 140) {
			const mergedRoot = kernelUnion(parent, pos, targetPos);
			const cnt = (k + minSize!) | 0;
			if (pos !== mergedRoot) sizeMap[pos] = 0;
			else sizeMap[targetPos] = 0;
			sizeMap[mergedRoot] = cnt;
			const targetSeq = posSeqMap[targetPos] || [];
			const currentSeq = posSeqMap[pos] || [];
			const merged = Array.from({ length: targetSeq.length + currentSeq.length });
			let mergedIdx = 0;
			for (let i = 0; i < targetSeq.length; i++) merged[mergedIdx++] = targetSeq[i];
			for (let i = 0; i < currentSeq.length; i++) merged[mergedIdx++] = currentSeq[i];
			posSeqMap[mergedRoot] = merged;
			if (pos !== mergedRoot) posSeqMap[pos] = [];
			else posSeqMap[targetPos] = [];
			putAbleCache[mergedRoot] = -1;
			putAbleCache[targetPos] = -1;
			putAbleCache[pos] = -1;
			queue.push(newNode(cnt, 0, 0, mergedRoot));
		}

		reclaimNode(nd);
	}

	for (let i = 0; i < 2500; i++) {
		parent[i] = kernelFind(parent, i);
	}
	return { parent, size: sizeMap };
};
