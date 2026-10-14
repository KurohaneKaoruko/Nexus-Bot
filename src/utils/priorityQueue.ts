/**
 * 优先队列 (二叉堆, 纯 TS 实现): 纯算法, 零依赖。
 * - push/pop/top/whileNoEmpty; isMin=true 时 pop() 得到 k 最小的节点;
 * - newNode/reclaimNode 节点对象池, 规划类算法高频 push/pop 时降低 GC 压力;
 * - 节点只需携带 k (优先级) 与可选 x/y/v 载荷。
 */
export interface QueueNode<T = unknown> {
	k: number;
	x?: number | undefined;
	y?: number | undefined;
	v?: T | undefined;
}

const NODE_POOL_LIMIT = 10000;
const nodeCache: QueueNode[] = [];

/** 取一个池化节点 (池空时新建) */
export function newNode<T = unknown>(k = 0, x?: number, y?: number, v?: T): QueueNode<T> {
	const node = (nodeCache.pop() ?? {}) as QueueNode<T>;
	node.k = k;
	node.x = x;
	node.y = y;
	node.v = v;
	return node;
}

/** 归还节点入池 (超过池上限丢弃, 交还 GC) */
export function reclaimNode(node?: QueueNode): void {
	if (!node) return;
	node.k = 0;
	node.x = undefined;
	node.y = undefined;
	node.v = undefined;
	if (nodeCache.length < NODE_POOL_LIMIT) {
		nodeCache.push(node);
	}
}

export class PriorityQueue {
	private readonly heap: QueueNode[] = [];
	private readonly isMin: boolean;

	declare push: (node: QueueNode) => void;
	declare pop: () => QueueNode | undefined;
	declare whileNoEmpty: (func: (node: QueueNode | undefined) => void) => void;

	/** @param isMin true 则 pop() 得到 k 最小的, 否则 k 最大的 */
	constructor(isMin = false) {
		this.isMin = isMin;
		const heap = this.heap;
		const higher = (a: QueueNode, b: QueueNode): boolean =>
			this.isMin ? a.k < b.k : a.k > b.k;

		const siftUp = (i: number): void => {
			while (i > 0) {
				const p = (i - 1) >> 1;
				const parent = heap[p];
				const child = heap[i];
				if (!parent || !child || higher(parent, child)) break;
				heap[p] = child;
				heap[i] = parent;
				i = p;
			}
		};

		const siftDownRoot = (): void => {
			let i = 0;
			for (;;) {
				let best = i;
				const l = i * 2 + 1;
				const r = l + 1;
				if (l < heap.length) {
					const lv = heap[l];
					const bv = heap[best];
					if (lv && bv && higher(lv, bv)) best = l;
				}
				if (r < heap.length) {
					const rv = heap[r];
					const bv = heap[best];
					if (rv && bv && higher(rv, bv)) best = r;
				}
				if (best === i) break;
				const t = heap[i];
				const b = heap[best];
				if (t === undefined || b === undefined) break;
				heap[i] = b;
				heap[best] = t;
				i = best;
			}
		};

		this.push = (node: QueueNode): void => {
			heap.push(node);
			siftUp(heap.length - 1);
		};
		this.pop = (): QueueNode | undefined => {
			if (heap.length === 0) return undefined;
			const root = heap[0];
			const last = heap.pop();
			if (heap.length > 0 && last !== undefined) {
				heap[0] = last;
				siftDownRoot();
			}
			return root;
		};
		this.whileNoEmpty = (func: (node: QueueNode | undefined) => void): void => {
			while (!this.isEmpty()) {
				const node = this.pop();
				func(node);
				if (node) reclaimNode(node);
			}
		};
	}

	/** 查看顶端节点, 空队列返回 undefined */
	top(): QueueNode | undefined {
		return this.heap[0];
	}
	size(): number {
		return this.heap.length;
	}
	clear(): void {
		this.heap.length = 0;
	}
	isEmpty(): boolean {
		return this.heap.length === 0;
	}
}
