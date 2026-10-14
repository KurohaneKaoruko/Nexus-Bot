/**
 * 50×50 房间网格封装: 纯数据结构, 除引擎地形查询外零依赖。
 * 典型用途: 布局规划的分块/掩码/距离场; 格值可为数字或字符串标记 (规划算法用标记区分区块)。
 * POI 缓存槽 (extractor/container/link) 供规划算法挂载兴趣点位置, 随实例存活。
 */
export type GridValue = number | string;

export type GridVisitor = (x: number, y: number, value: GridValue) => void;

/** POI 位置缓存槽 */
export interface PointCache {
	extractor?: Array<{ x: number; y: number }>;
	container?: Array<{ x: number; y: number }>;
	link?: Array<{ x: number; y: number }>;
}

export class RoomArray implements PointCache {
	private readonly arr: GridValue[];
	extractor?: Array<{ x: number; y: number }>;
	container?: Array<{ x: number; y: number }>;
	link?: Array<{ x: number; y: number }>;

	constructor() {
		this.arr = Array.from({ length: 2500 }, () => 0 as GridValue);
	}

	/** 读取后写入, 返回旧值 */
	exec(x: number, y: number, val: GridValue): GridValue {
		const idx = x * 50 + y;
		const tmp = this.arr[idx] ?? 0;
		this.arr[idx] = val;
		return tmp;
	}

	get(x: number, y: number): GridValue {
		return this.arr[x * 50 + y] ?? 0;
	}

	set(x: number, y: number, value: GridValue): void {
		this.arr[x * 50 + y] = value;
	}

	/** 全部清零 */
	init(): this {
		this.arr.fill(0);
		return this;
	}

	/** 按行遍历 (y 外层 x 内层) */
	forEach(func: GridVisitor): void {
		for (let y = 0; y < 50; y += 1) {
			for (let x = 0; x < 50; x += 1) {
				func(x, y, this.get(x, y));
			}
		}
	}

	/** 四邻域遍历 */
	for4Direction(func: GridVisitor, x: number, y: number): void {
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const) {
			const xt = x + dx;
			const yt = y + dy;
			if (xt >= 0 && yt >= 0 && xt <= 49 && yt <= 49) {
				func(xt, yt, this.get(xt, yt));
			}
		}
	}

	/** 切比雪夫范围邻域遍历 (不含自身) */
	forNear(func: GridVisitor, x: number, y: number, range = 1): void {
		for (let i = -range; i <= range; i += 1) {
			for (let j = -range; j <= range; j += 1) {
				const xt = x + i;
				const yt = y + j;
				if ((i !== 0 || j !== 0) && xt >= 0 && yt >= 0 && xt <= 49 && yt <= 49) {
					func(xt, yt, this.get(xt, yt));
				}
			}
		}
	}

	/** 边界格遍历 */
	forBorder(func: GridVisitor): void {
		for (let y = 0; y < 50; y += 1) {
			func(0, y, this.get(0, y));
			func(49, y, this.get(49, y));
		}
		for (let x = 1; x < 49; x += 1) {
			func(x, 0, this.get(x, 0));
			func(x, 49, this.get(x, 49));
		}
	}

	/** 地形可走性初始化: 平地 1 / 墙 0 / 沼泽 2 (引擎地形查询为唯一外部触点) */
	initRoomTerrainWalkAble(roomName: string): void {
		const terrain = new Room.Terrain(roomName);
		this.forEach((x, y) => {
			const t = terrain.get(x, y);
			this.set(x, y, t === 1 ? 0 : t === 0 ? 1 : 2);
		});
	}
}
