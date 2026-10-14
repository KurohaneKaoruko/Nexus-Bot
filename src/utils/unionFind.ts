/**
 * 并查集 (路径压缩): 纯算法, 零依赖。
 * 典型用途: 连通分量合并 (布局分块、区块归属)。
 */
export class UnionFind {
	private readonly parent: number[];

	constructor(size: number) {
		this.parent = Array.from({ length: size }, (_, i) => i);
	}

	/** 重置: 每个元素自成一族 */
	init(): void {
		for (let i = 0; i < this.parent.length; i += 1) {
			this.parent[i] = i;
		}
	}

	/** 查找根 (沿途全部挂到根上, 压缩路径) */
	find(x: number): number {
		let r = x;
		while (this.parent[r] !== r) {
			r = this.parent[r] ?? r;
		}
		while (this.parent[x] !== x) {
			const t = this.parent[x] ?? x;
			this.parent[x] = r;
			x = t;
		}
		return x;
	}

	/** 合并两族 (小根并大根, 保持根稳定) */
	union(a: number, b: number): void {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra > rb) {
			this.parent[ra] = rb;
		} else if (ra !== rb) {
			this.parent[rb] = ra;
		}
	}

	/** 是否同族 */
	same(a: number, b: number): boolean {
		return this.find(a) === this.find(b);
	}
}
