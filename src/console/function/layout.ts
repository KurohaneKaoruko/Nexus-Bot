/**
 * 布局控制台: 设置/构建/可视化/维护房间布局 (主线 planner schema 为唯一真相源)。
 */
import { compress, decompressBatch } from '@/utils/compress';
import { LayoutVisual } from '@/modules/planner';
import { LayoutPlanner } from '@/modules/planner';
import { layoutRoot, ensureLayoutRecord } from '@/modules/planner';
import type { LayoutRoomRecord } from '@/core/store/memorySchema';
import { getRoomData } from '@/core/store/accessor';
import { resolveRoomName } from '@/console/argUtils';

const botLog = (msg: string): void => {
	(globalThis as { log?: (m: string) => void }).log?.(msg);
};

/** 己方房且已入控制列表才可操作布局 */
function ownedRoomOrError(roomName: string): Error | null {
	const room = Game.rooms[roomName];
	if (!room || !room.my || !getRoomData()[roomName]) {
		return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
	}
	return null;
}

/** 从中心旗帜 (centerPos) 或参数解析布局中心 */
function centerFromFlagsOrArgs(roomName: string, x?: number, y?: number): { x: number; y: number } | Error {
	let cx = typeof x === 'number' ? x : undefined;
	let cy = typeof y === 'number' ? y : undefined;
	if (cx == null || cy == null) {
		const flag = Game.flags.centerPos;
		if (flag?.pos?.roomName === roomName) {
			cx = flag.pos.x;
			cy = flag.pos.y;
		}
	}
	if (cx == null || cy == null || cx < 0 || cx > 49 || cy < 0 || cy > 49) {
		return Error(`需要输入正确的布局中心坐标（x,y）或在房间内放置 centerPos 旗帜。`);
	}
	return { x: cx, y: cy };
}

/** RoomData 的 layout/center 镜像写入 */
function mirrorToRoomData(roomName: string, layout: string, center: { x: number; y: number }): void {
	const roomData = getRoomData(roomName) as Record<string, unknown> | undefined;
	if (roomData) {
		roomData['layout'] = layout;
		roomData['center'] = { x: center.x, y: center.y };
	}
}

/** BFS 泛洪: 从起点向四邻扩散, 对每个未访问邻格回调其结构列表 */
function floodWalk(roomName: string, seeds: Array<[number, number]>, visit: (x: number, y: number, structs: Structure[]) => void): void {
	const queue = [...seeds];
	const done = new Set<string>();
	while (queue.length > 0) {
		const [x, y] = queue.shift()!;
		if (x < 0 || x > 49 || y < 0 || y > 49) continue;
		for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
			const px = x + dx, py = y + dy;
			if (px < 0 || px > 49 || py < 0 || py > 49) continue;
			const key = `${px}:${py}`;
			if (done.has(key)) continue;
			const structs = new RoomPosition(px, py, roomName).lookFor(LOOK_STRUCTURES);
			visit(px, py, structs);
			queue.push([px, py]);
		}
		done.add(`${x}:${y}`);
	}
}

/** 旗帜起点泛洪选取与旗帜处同类结构的连通块; 旗帜无匹配结构返回 null */
function floodPick(flag: Flag, match: (s: Structure) => boolean): number[] | null {
	const onFlag = flag.pos.lookFor(LOOK_STRUCTURES);
	if (!onFlag.some(match)) return null;
	const picked: number[] = [compress(flag.pos.x, flag.pos.y)];
	floodWalk(flag.pos.roomName, [[flag.pos.x, flag.pos.y]], (x, y, structs) => {
		if (structs.some(match)) picked.push(compress(x, y));
	});
	return picked;
}

/** 布局数组按操作方向合并/移除选取集, 返回实际变动数 */
function applyPick(list: number[], picked: number[], operate: number): number {
	let count = 0;
	if (operate === 1) {
		for (const p of picked) {
			if (!list.includes(p)) {
				list.push(p);
				count++;
			}
		}
	} else {
		for (const p of picked) {
			const i = list.indexOf(p);
			if (i >= 0) {
				list.splice(i, 1);
				count++;
			}
		}
	}
	return count;
}

function recordDataOf(roomName: string): Record<string, number[]> {
	return ensureLayoutRecord(roomName).data;
}

/** 单类结构 (rampart/wall) 的旗帜泛洪编辑 */
function editLayoutRect(roomName: string, structureType: StructureConstant, operate: number): number {
	const flagKey = structureType === STRUCTURE_RAMPART ? 'layout-rampart' : 'layout-wall';
	const label = structureType === STRUCTURE_RAMPART ? 'rampart' : 'wall';
	const flag = Game.flags[flagKey];
	if (!flag) {
		console.log(`未找到\`${flagKey}\`旗帜标记`);
		return -1;
	}
	const picked = floodPick(flag, s => s.structureType === structureType);
	if (!picked) {
		console.log(`\`${flagKey}\`旗帜没有放置到${label}上`);
		return -1;
	}
	flag.remove();
	const dataKey = structureType === STRUCTURE_RAMPART ? 'rampart' : 'constructedWall';
	const list = (recordDataOf(roomName)[dataKey] ??= []);
	const count = applyPick(list, picked, operate);
	console.log(`已${operate === 1 ? '添加' : '从布局删除'}${count}个${label}到布局memory`);
	return OK;
}

/** 旗帜泛洪同时编辑 wall 与 rampart */
function editLayoutRamwall(roomName: string, operate: number): number {
	const flag = Game.flags['layout-ramwall'];
	if (!flag) {
		console.log('未找到`layout-ramwall`旗帜标记');
		return -1;
	}
	const onFlag = flag.pos.lookFor(LOOK_STRUCTURES);
	if (onFlag.every(s => s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)) {
		console.log('`layout-ramwall`旗帜没有放置到wall或rampart上');
		return -1;
	}
	const walls: number[] = [];
	const ramparts: number[] = [];
	if (onFlag.some(s => s.structureType === STRUCTURE_WALL)) walls.push(compress(flag.pos.x, flag.pos.y));
	else ramparts.push(compress(flag.pos.x, flag.pos.y));
	floodWalk(flag.pos.roomName, [[flag.pos.x, flag.pos.y]], (x, y, structs) => {
		if (structs.some(s => s.structureType === STRUCTURE_WALL)) walls.push(compress(x, y));
		else if (structs.some(s => s.structureType === STRUCTURE_RAMPART)) ramparts.push(compress(x, y));
	});
	flag.remove();
	const data = recordDataOf(roomName);
	const wallCount = applyPick((data['constructedWall'] ??= []), walls, operate);
	const rampCount = applyPick((data['rampart'] ??= []), ramparts, operate);
	console.log(`已${operate === 1 ? '添加' : '从布局删除'}${wallCount}个wall和${rampCount}个rampart到布局memory`);
	return OK;
}

/** 两旗框选区域内的 rampart 编辑 */
function editLayoutArea(roomName: string, operate: number): number {
	const flagA = Game.flags['layout-ramA'];
	const flagB = Game.flags['layout-ramB'];
	if (!flagA || !flagB) {
		console.log('未找到flag');
		return ERR_INVALID_ARGS;
	}
	const room = Game.rooms[roomName];
	if (!room) return ERR_INVALID_ARGS;
	const minX = Math.min(flagA.pos.x, flagB.pos.x);
	const maxX = Math.max(flagA.pos.x, flagB.pos.x);
	const minY = Math.min(flagA.pos.y, flagB.pos.y);
	const maxY = Math.max(flagA.pos.y, flagB.pos.y);
	const rampart = room.lookForAtArea(LOOK_STRUCTURES, minY, minX, maxY, maxX, true)
		.filter(s => s.structure.structureType === STRUCTURE_RAMPART)
		.map(s => compress(s.x, s.y));
	const count = applyPick((recordDataOf(roomName)['rampart'] ??= []), rampart, operate);
	console.log(`已${operate === 1 ? '添加' : '从布局删除'}${count}个rampart到布局memory`);
	flagA.remove();
	flagB.remove();
	return OK;
}

export default {
	layout: {
		// 设置房间布局（roomName 可省略）
		set(roomName: string, layout: string, x?: number, y?: number): number | Error {
			const resolvedSet = resolveRoomName(roomName);
			if (!resolvedSet.roomName) return resolvedSet.error ?? Error('无法推断房间名');
			roomName = resolvedSet.roomName;
			const err = ownedRoomOrError(roomName);
			if (err) return err;
			if (!layout) {
				const record = layoutRoot().rooms[roomName];
				if (record) {
					record.type = 'auto';
					delete record.center;
				}
				botLog(`已清除 ${roomName} 的布局设置。`);
				return OK;
			}
			const center = centerFromFlagsOrArgs(roomName, x, y);
			if (center instanceof Error) return center;
			const record = ensureLayoutRecord(roomName);
			record.type = layout as LayoutRoomRecord['type'];
			record.center = { x: center.x, y: center.y };
			mirrorToRoomData(roomName, layout, center);
			botLog(`已设置 ${roomName} 的布局为 ${layout}, 布局中心为 (${center.x},${center.y})`);
			return OK;
		},
		// 开关自动建筑（roomName 可省略；enable 不传则按当前状态切换）
		auto(roomName?: string, enable?: boolean, opts?: { quiet?: boolean }): number | Error {
			const resolvedArg = resolveRoomName(roomName);
			if (!resolvedArg.roomName) return resolvedArg.error ?? Error('无法推断房间名');
			roomName = resolvedArg.roomName;
			const err = ownedRoomOrError(roomName);
			if (err) return err;
			const record = layoutRoot().rooms[roomName];
			if (!record || !Object.keys(record.data ?? {}).length) {
				return Error(`房间 ${roomName} 未生成布局，请先 layout.build('${roomName}')。`);
			}
			record.autobuild = enable ?? !record.autobuild;
			if (!opts?.quiet) botLog(`已${record.autobuild ? '开启' : '关闭'} ${roomName} 的自动建筑.`);
			return OK;
		},
		// 根据布局一键放置工地（放满到结构上限/工地上限为止）
		// structType: 可选，仅放置某一种结构的工地；roomName 可省略
		site(roomName?: string, structType?: string): number | Error {
			const resolvedArg = resolveRoomName(roomName);
			if (!resolvedArg.roomName) return resolvedArg.error ?? Error('无法推断房间名');
			roomName = resolvedArg.roomName;
			const err = ownedRoomOrError(roomName);
			if (err) return err;
			const record = layoutRoot().rooms[roomName];
			if (!record || !Object.keys(record.data).length) {
				console.log(`房间 ${roomName} 的布局不存在，请先执行 layout.build('${roomName}') 或 layout.build('${roomName}', 'auto'|'63auto'|静态布局名)`);
				return Error('布局不存在');
			}
			if (structType && (!record.data[structType] || !record.data[structType].length)) {
				return Error(`房间 ${roomName} 的布局中不存在 ${structType}。`);
			}
			const room = Game.rooms[roomName];
			if (!room) return Error(`房间 ${roomName} 不可见。`);
			const created = LayoutPlanner.plannerCreateSite(room, record.data, structType ? { structType } : undefined);
			console.log(`房间 ${roomName} 已放置 ${created} 个工地。`);
			return OK;
		},
		// 清除房间布局
		remove(roomName: string): number {
			delete layoutRoot().rooms[roomName];
			botLog(`已清除 ${roomName} 的布局。`);
			return OK;
		},
		// 构建布局（roomName 可省略，推断规则见 console/argUtils）
		// layoutType: 可选，指定布局类型（传入则覆盖当前设置并重建；不传则用当前设置且已有布局时不覆盖）
		// opts.quiet: 静默模式（供 start 流程复用，只保留错误输出）
		build(roomName?: string, layoutType?: string, opts?: { quiet?: boolean }): number | Error {
			const resolvedArg = resolveRoomName(roomName);
			if (!resolvedArg.roomName) return resolvedArg.error ?? Error('无法推断房间名');
			roomName = resolvedArg.roomName;
			if (!getRoomData()[roomName]) {
				return Error(`房间 ${roomName} 未添加到控制列表。`);
			}
			const record = layoutRoot().rooms[roomName];
			if ((!layoutType || layoutType === '') && record && Object.keys(record.data).length) {
				if (!opts?.quiet) console.log(`房间 ${roomName} 的布局已存在，未指定布局类型，本次不覆盖。`);
				return OK;
			}

			if (layoutType) {
				const setCode = this.set(roomName, layoutType);
				if (setCode !== OK) return setCode;
			}

			const currentLayout = layoutType ?? record?.type ?? 'auto';
			let code: number;
			if (!currentLayout || currentLayout === 'auto') {
				code = LayoutPlanner.buildDynamic(roomName, opts);
			} else if (currentLayout === '63auto') {
				code = LayoutPlanner.buildDynamic63(roomName, opts);
			} else if (currentLayout === 'mini') {
				code = LayoutPlanner.buildMini(roomName, opts);
			} else {
				code = LayoutPlanner.buildStatic(roomName, currentLayout, opts);
			}
			if (code === OK) {
				const built = layoutRoot().rooms[roomName];
				if (built?.center) mirrorToRoomData(roomName, built.type, built.center);
			}
			return code;
		},
		// 查看布局可视化（全空参时：有规划旗帜则按旗帜预览，否则预览唯一可推断的房间）
		visual(roomName?: string, layout?: string): number | Error {
			const startCpu = Game.cpu.getUsed();
			let result: number | Error;
			if (!roomName) {
				// 无房间名：有 pc/pm/pa/pb/centerPos 规划旗帜时保持旗帜预览流程
				const hasPlanFlags = Object.keys(Game.flags).some(name =>
					name === 'centerPos' || name === 'storagePos' ||
					name === 'pc' || name === 'pm' || name === 'pa' || name === 'pb');
				if (!hasPlanFlags) {
					const resolvedArg = resolveRoomName(roomName);
					if (resolvedArg.roomName) roomName = resolvedArg.roomName;
				}
			}
			if (roomName && layout) {
				if (layout === 'auto') {
					result = LayoutPlanner.visualDynamic(roomName);
				} else if (layout === '63auto') {
					result = LayoutPlanner.visualDynamic63(roomName);
				} else {
					result = LayoutPlanner.visualStatic(roomName, layout);
				}
			} else if (roomName) {
				const record = layoutRoot().rooms[roomName];
				if (!record || Object.keys(record?.data ?? {}).length === 0) {
					console.log(`房间 ${roomName} 的布局不存在，将根据自动布局可视化...`)
					const layoutType = (getRoomData()[roomName] as { layout?: string } | undefined)?.layout;
					if (layoutType === '63auto') result = LayoutPlanner.visualDynamic63(roomName);
					else result = LayoutPlanner.visualDynamic(roomName);
				} else {
					console.log(`将根据房间${roomName}的布局进行可视化...`)
					const structMap: Record<string, Array<[number, number]>> = {};
					for (const s in record.data) {
						structMap[s] = decompressBatch(record.data[s] ?? []) as Array<[number, number]>;
					}
					LayoutVisual.showRoomStructures(roomName, structMap);
					result = OK;
				}
			} else {
				result = LayoutPlanner.visualDynamicByFlags();
			}
			const cpu = Game.cpu.getUsed() - startCpu;
			if (result === OK) {
				console.log(`构建并可视化完成，总消耗CPU ${cpu.toFixed(2)}。`)
				return OK;
			}
			console.log(`构建或可视化失败，总消耗CPU ${cpu.toFixed(2)}。`)
			return result;
		},
		// 将房间建筑加入布局
		save(roomName: string, struct?: string): number | Error {
			if (!getRoomData()[roomName]) {
				return Error(`房间 ${roomName} 未添加到控制列表。`);
			}
			const room = Game.rooms[roomName];
			if (!room) return Error(`房间 ${roomName} 不可见。`);
			const supported = ['spawn', 'extension', 'link', 'tower', 'road', 'storage', 'terminal', 'factory', 'lab',
				'nuker', 'observer', 'powerSpawn', 'container', 'extractor', 'rampart', 'constructedWall'];
			if (struct && !supported.includes(struct)) {
				return Error(`不支持的struct类型 ${struct}。`);
			}
			const structList = struct ? [struct] : supported.slice(0, 14);
			const data = recordDataOf(roomName);
			for (const s of structList) {
				const found = room.find(FIND_STRUCTURES, { filter: o => o.structureType === s });
				data[s] = found.map(st => compress(st.pos.x, st.pos.y));
			}
			console.log(`房间 ${roomName} 的布局已更新（${structList.join(',')}）。`);
			return OK;
		},
		// 查看rampart最小血量, 只考虑布局中的
		ramhits(roomName: string): string | Error {
			const record = layoutRoot().rooms[roomName];
			if (!record || Object.keys(record.data).length === 0) {
				return Error(`房间 ${roomName} 的布局不存在。`);
			}
			let rampartMem: number[] = record.data['rampart'] ?? [];
			const structRampart: number[] = [];
			for (const s of ['spawn', 'tower', 'storage', 'terminal', 'factory', 'lab', 'nuker', 'powerSpawn']) {
				structRampart.push(...(record.data[s] ?? []));
			}
			rampartMem = [...new Set(rampartMem.concat(structRampart))];
			const ramparts = (Game.rooms[roomName]?.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART }) ?? [])
				.filter(r => rampartMem.includes(compress(r.pos.x, r.pos.y)));
			if (!ramparts.length) return Error(`房间 ${roomName} 布局内没有 rampart。`);
			const fmt = (hits: number): string => hits < 1e6 ? `${(hits / 1000).toFixed(2)}K` : `${(hits / 1e6).toFixed(2)}M`;
			const minR = ramparts.reduce((r, c) => r.hits < c.hits ? r : c);
			const maxR = ramparts.reduce((r, c) => r.hits > c.hits ? r : c);
			return `[Min] ${fmt(minR.hits)}  (${minR.pos.x}, ${minR.pos.y})\n` +
				`[Max] ${fmt(maxR.hits)}  (${maxR.pos.x}, ${maxR.pos.y})`;
		},
		// 从布局添加或删除所选rampart/wall (旗帜泛洪选取)
		rampart(roomName: string, operate = 1): number {
			return editLayoutRect(roomName, STRUCTURE_RAMPART, operate);
		},
		wall(roomName: string, operate = 1): number {
			return editLayoutRect(roomName, STRUCTURE_WALL, operate);
		},
		ramwall(roomName: string, operate = 1): number {
			return editLayoutRamwall(roomName, operate);
		},
		ramarea(roomName: string, operate = 1): number {
			return editLayoutArea(roomName, operate);
		}
	}
}
