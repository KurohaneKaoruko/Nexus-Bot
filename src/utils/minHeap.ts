/**
 * 二叉最小堆 (哨兵占位式): 纯算法, 零依赖。
 * 按映射值排序, heap[0] 为哨兵; 典型用途: Top-N 筛选。
 */
export class MinHeap<T> {
	private readonly heap: Array<T | null>;
	private readonly valueOf: (item: T) => number;

	constructor(valueOf?: (item: T) => number, initial?: T[]) {
		this.heap = initial ? ([null, ...initial] as Array<T | null>) : [null];
		this.valueOf = valueOf ?? ((item: T) => item as unknown as number);
	}

	/** 是否包含该元素 (引用相等) */
	has(element: T): boolean {
		return this.heap.some((item) => item === element);
	}

	/** 最小值 (空堆返回 null) */
	getMin(): T | null {
		return this.heap[1] ?? null;
	}

	getMinValue(): number {
		const min = this.getMin();
		return min === null ? Infinity : this.valueOf(min);
	}

	getSize(): number {
		return this.heap.length - 1;
	}

	isEmpty(): boolean {
		return this.heap.length < 2;
	}

	/** 导出为普通数组 (不含哨兵) */
	toArray(): T[] {
		return this.heap.slice(1).filter((item): item is T => item !== null);
	}

	insert(node: T): void {
		const value = this.valueOf(node);
		if (value === Infinity) {
			return;
		}
		let current = this.heap.length;
		while (current > 1) {
			const parent = Math.floor(current / 2);
			const pv = this.heap[parent];
			if (pv === null || pv === undefined || this.valueOf(pv) <= value) break;
			this.heap[current] = pv;
			current = parent;
		}
		this.heap[current] = node;
	}

	/** 弹出最小元素并返回 (空堆返回 null) */
	remove(): T | null {
		const min = this.heap[1];
		if (min === null || min === undefined) {
			return null;
		}
		if (this.heap.length > 2) {
			const last = this.heap[this.heap.length - 1];
			this.heap.length -= 1;
			this.heap[1] = last ?? null;
			let current = 1;
			for (;;) {
				const left = current * 2;
				const right = left + 1;
				const lv = this.heap[left];
				const rv = this.heap[right];
				if (lv === null || lv === undefined) break;
				let child = left;
				if (rv !== null && rv !== undefined && this.valueOf(rv) < this.valueOf(lv)) {
					child = right;
				}
				const cv = this.heap[child];
				const cur = this.heap[current];
				if (cv === null || cv === undefined || cur === null || cur === undefined) break;
				if (this.valueOf(cur) > this.valueOf(cv)) {
					this.heap[current] = cv;
					this.heap[child] = cur;
					current = child;
				} else {
					break;
				}
			}
		} else if (this.heap.length === 2) {
			this.heap.length = 1;
		} else {
			return null;
		}
		return min;
	}
}
