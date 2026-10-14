/**
 * 布局可视化: 按 structMap 在目标房间渲染结构图形/字符贴图, 并自动连通道路连线。
 */

type XY = [number, number];
type StructMap = Record<string, XY[]>;

const structuresShape: Record<string, string> = {
	spawn: '◎',
	extension: 'ⓔ',
	link: '◈',
	road: '•',
	constructedWall: '▓',
	rampart: '⊙',
	storage: '▤',
	tower: '🔫',
	observer: '👀',
	powerSpawn: '❂',
	extractor: '⇌',
	terminal: '✡',
	lab: '☢',
	container: '□',
	nuker: '▲',
	factory: '☭'
};
const structuresColor: Record<string, string> = {
	spawn: 'cyan',
	extension: '#0bb118',
	link: 'yellow',
	road: '#fa6f6f',
	constructedWall: '#003fff',
	rampart: '#003fff',
	storage: 'yellow',
	tower: 'cyan',
	observer: 'yellow',
	powerSpawn: 'cyan',
	extractor: 'cyan',
	terminal: 'yellow',
	lab: '#d500ff',
	container: 'yellow',
	nuker: 'cyan',
	factory: 'yellow'
};

const LayoutVisual = {
	/** 线性同余随机数 */
	rnd(seed: number): number {
		return (seed * 9301 + 49297) % 233280;
	},
	/** seed 的随机颜色 */
	randomColor(s: string): string {
		let seed = Number.parseInt(s, 10);
		const str = '12334567890ABCDEF';
		let out = '#';
		for (let i = 0; i < 6; i++) {
			seed = this.rnd(seed + (Game.time % 103));
			out += str[seed % str.length] ?? '0';
		}
		return out;
	},
	/** 大概消耗 1 CPU, 慎用 */
	showRoomStructures(roomName: string, structMap: StructMap): void {
		if (!structMap) return;
		const visual = new RoomVisual(roomName);
		if (!structMap['road']) structMap['road'] = [];

		// 规划器结构 key → Screeps 结构常量; 优先 RoomVisual.structure() 画结构图形
		const structToConstant: Record<string, StructureConstant | null> = {
			spawn: STRUCTURE_SPAWN,
			extension: STRUCTURE_EXTENSION,
			link: STRUCTURE_LINK,
			road: STRUCTURE_ROAD,
			constructedWall: STRUCTURE_WALL,
			rampart: STRUCTURE_RAMPART,
			storage: STRUCTURE_STORAGE,
			tower: STRUCTURE_TOWER,
			observer: STRUCTURE_OBSERVER,
			powerSpawn: STRUCTURE_POWER_SPAWN,
			// structure() 未提供 extractor 专门绘制, 走文本回退
			extractor: null,
			terminal: STRUCTURE_TERMINAL,
			lab: STRUCTURE_LAB,
			container: STRUCTURE_CONTAINER,
			nuker: STRUCTURE_NUKER,
			factory: STRUCTURE_FACTORY,
		};

		// 透明度策略: 道路/墙体淡, 主体建筑清晰
		const baseOpacity = 0.8;
		const roadOpacity = 0.4;
		const wallOpacity = 0.6;
		const rampartOpacity = 0.6;

		// 先喂 road 点, 扩展内部缓存后一次性连线
		const terrain = new Room.Terrain(roomName);
		const roadSet = new Set<string>();
		const roadList = structMap['road'] ?? [];
		for (const e of roadList) {
			const x = e[0];
			const y = e[1];
			if (x < 0 || x > 49 || y < 0 || y > 49) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			roadSet.add(`${x}:${y}`);
			visual.structure(x, y, STRUCTURE_ROAD, { opacity: roadOpacity });
		}

		const buildable = Object.keys(CONTROLLER_STRUCTURES) as Array<keyof typeof CONTROLLER_STRUCTURES>;
		for (const struct of buildable) {
			if (struct === 'road') continue;
			const key = struct as string;
			if (!structMap[key]) structMap[key] = [];
			for (const e of structMap[key]) {
				const x = e[0];
				const y = e[1];
				const constant = structToConstant[key];
				if (constant) {
					const opacity =
						key === 'constructedWall' ? wallOpacity : key === 'rampart' ? rampartOpacity : baseOpacity;
					visual.structure(x, y, constant, { opacity });
					continue;
				}
				// 文本回退: 未适配 structure() 的类型用字符贴图
				visual.text(structuresShape[key] ?? key, x, y + 0.25, {
					color: structuresColor[key] ?? 'white',
					opacity: 0.75,
					font: 0.7
				});
			}
		}

		// 自动连通道路 (替代邻域判断连线)
		const lineDirs: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
		const lineStyle = { color: '#666', width: 0.35, opacity: roadOpacity };
		roadSet.forEach((key) => {
			const [xs, ys] = key.split(':');
			const x = Number(xs);
			const y = Number(ys);
			for (const [dx, dy] of lineDirs) {
				const nx = x + dx;
				const ny = y + dy;
				if (!roadSet.has(`${nx}:${ny}`)) continue;
				if (dx !== 0 && dy !== 0) {
					const sideWallA = terrain.get(x + dx, y) === TERRAIN_MASK_WALL;
					const sideWallB = terrain.get(x, y + dy) === TERRAIN_MASK_WALL;
					if (sideWallA && sideWallB) continue;
				}
				visual.line(x, y, nx, ny, lineStyle);
			}
		});
	}
};

export default LayoutVisual;
