// @ts-nocheck
/**
 * ros 动态布局主流程: 候选块评估 (spawn 锚定限幅/槽位锚定/墙圈阈值) +
 * 枢纽/lab/道路/spawn/extension 落位与 POI 道路连通。
 * 经 layoutPlanner 的 'auto' 布局类型激活 (自动布局主线)。
 */
import { newNode } from '@/utils/priorityQueue'
import { RoomArray } from '@/utils/roomArray'
import { squareDistance } from '../shared/plannerUtils'
import type { PlannerPoint, XY, StructMap } from '../shared/plannerUtils'
import { findLabAnchorByTs } from './labAnchor'
import {
	ManagerPlanner,
	objects,
	setObjects,
} from './rosBlock'
import {
	routeDistance as routeDistanceLocal,
	roomObjectCache,
	interpolation,
	nearWallWithInterpolation,
	visited,
	queMin as queMinBuf,
	setRoomObjectCache,
} from './rosBuffers'

declare const Game: {
	flags?: Record<string, { pos: { x: number; y: number; roomName: string } }>
}
declare const RoomPosition: new (x: number, y: number, roomName: string) => XY & { roomName: string }
declare const PathFinder: {
	search: (
		origin: XY & { roomName?: string },
		goal: { pos: XY & { roomName?: string }; range: number } | Array<{ pos: XY & { roomName?: string }; range: number }>,
		opts: { roomCallback: () => any; maxRooms: number; plainCost?: number; swampCost?: number }
	) => { path: XY[]; incomplete?: boolean }
	CostMatrix: new () => { set: (x: number, y: number, cost: number) => void; get: (x: number, y: number) => number }
}
declare const CONTROLLER_STRUCTURES: Record<string, number[]>
declare const OBSTACLE_OBJECT_TYPES: string[]
declare const TERRAIN_MASK_WALL: number
declare const TERRAIN_MASK_SWAMP: number

/** 可放建筑平面最小面积门槛 */
const minPlaneCnt = 160;
/** 锚定模式下布局以 spawn 为中心的最大切比雪夫半径：防止墙圈/manor 沿开阔地单向突出长条 */
export const MANOR_SPAWN_CHEBYSHEV = 10;
/** spawn 槽位环（相对布局中心的偶数 manhattan-4 偏移）：落地 spawn 吸附到其中一槽，中心随之定于 spawn-槽位 */
const SPAWN_SLOT_OFFSETS = [[0, 4], [2, 2], [4, 0], [2, -2], [0, -4], [-2, -2], [-4, 0], [-2, 2]];

let fastVisitStamp = new Uint16Array(2500);
let fastManorStamp = new Uint16Array(2500);
let fastStampToken = 1;
let nearMinCostCache = new Uint16Array(2500);

/**
 * 计算 manor 分布图并生成 structMap。
 * @param roomName 房间名
 * @param points [controller, mineral, sourceA, sourceB] 关键点位
 * @param fixedCenter 手动钉死的中心 (旗帜模式)
 * @param blocked 阻挡掩码
 * @param existSpawnPos 落地手置 spawn 坐标 (锚定限幅与收编)
 * @param spawnRadius 锚定切比雪夫半径 (0 = 不限幅)
 * @param spawnMinPlaneCnt 锚定模式平面门槛 (降级阶梯逐级放低)
 */
export const computeManor = (roomName: string, points: PlannerPoint[], fixedCenter?: XY, blocked?: RoomArray, existSpawnPos?: XY, spawnRadius?: number, spawnMinPlaneCnt?: number) => {
	ManagerPlanner.init();
	// 每次布局计算重置 POI 缓存：降级阶梯会连续多次运行本函数，失败路径 early-return
	// 不经过 dismiss，objects 与 link/container 缓存都会按尝试次数翻倍累积（「link 围满枢纽」的根因）
	setRoomObjectCache(new RoomArray().init());
	setObjects([]);
	const planeGate = spawnMinPlaneCnt ?? minPlaneCnt;
	for (const p of points) {
		if (p && p.roomName == roomName) setObjects([...objects, p]);
	}
	const blockArray = ManagerPlanner.computeBlock(roomName, blocked);
	const unionFind = blockArray[0];
	const sizeMap = blockArray[1];
	const wallMap = {};
	const rootMembers = {};
	for (let i = 0; i < 2500; i++) {
		const root = unionFind.find(i);
		if (sizeMap[root]! > 0) {
			if (!(rootMembers as any)[root]) (rootMembers as any)[root] = [];
			rootMembers[root].push(i);
		}
	}
	const roomWalkable = blockArray[2];
	const nearWall = blockArray[3];
	const putAbleCacheMap = blockArray[4];
	const allCacheMap = blockArray[5];

	const roomManor = interpolation;
	const roomStructs = nearWallWithInterpolation;

	roomManor.init();
	roomStructs.init();

	// let closeToWall = new RoomArray()
	nearWall.init();

	// let queMin = new PriorityQueue(true)
	queMinBuf.clear();
	// let visited = new RoomArray()

	let finalPos = undefined;
	let wallCnt = 1e9;
	let innerPutAbleList = [];
	// 兜底方案：记录不检查阈值的备选
	let fallbackPos = undefined;
	let fallbackWallCnt = 1e9;
	let fallbackWalls = null;

	let centerX = undefined;
	let centerY = undefined;
	let slotCenter = null;

	let centerPos = fixedCenter;
	const storageFlag = Game.flags?.storagePos;
	if (!centerPos && storageFlag && storageFlag.pos.roomName === roomName) {
		centerPos = { x: storageFlag.pos.x, y: storageFlag.pos.y };
	}
	const centerRoot = centerPos ? unionFind.find(centerPos.x * 50 + centerPos.y) : undefined;
	const candidateRoots = centerRoot != null && sizeMap[centerRoot]! > 0 ? [centerRoot] : Object.keys(sizeMap);

	const manorRadius = spawnRadius === undefined ? MANOR_SPAWN_CHEBYSHEV : spawnRadius;
	for (let i = 0; i < candidateRoots.length; i++) {
		const posNum = Number(candidateRoots[i]);
		// if(sizeMap[pos]<150)return
		if (sizeMap[posNum]! < planeGate) continue;
		// 注：不做「spawn 与锚点同连通块」强约束——引擎按近墙脊线切平面，
		// spawn 常落在锚点旁的小口袋块里，强同块会把锚定全部误杀（诊断日志实证）

		ManagerPlanner.getBlockPutAbleCnt(
			roomWalkable,
			visited,
			queMinBuf,
			unionFind,
			posNum,
			putAbleCacheMap,
			allCacheMap,
			rootMembers
		);
		const currentPutAbleListCached = putAbleCacheMap[posNum];
		const allListCached = allCacheMap[posNum];
		// 锚定模式：以 spawn 为中心限幅（切比雪夫半径，降级阶梯逐级放宽），防止墙圈/manor
		// 沿开阔地单向突出长条。只过滤本地副本，不动跨候选共享的缓存数组。
		// 远离 spawn 的块经限幅后 putable 不足 minPlaneCnt 自然出局，块选择隐式偏向 spawn 侧
		let currentPutAbleList = currentPutAbleListCached;
		let allList = allListCached;
		if (existSpawnPos && manorRadius > 0) {
			const sx = existSpawnPos.x;
			const sy = existSpawnPos.y;
			const withinSpawnRadius = (e: { x: number; y: number }, radius: number) =>
				Math.max(Math.abs(e.x - sx), Math.abs(e.y - sy)) <= radius;
			// 结构/路网限幅 R；墙圈边界外扩 3 格（R+3）——敌方远程射程 3，
			// 贴墙站立时到墙内最近建筑 ≥ 4 格，打不到
			currentPutAbleList = currentPutAbleListCached!.filter!((e) => withinSpawnRadius(e, manorRadius));
			allList = allListCached!.filter!((e) => withinSpawnRadius(e, manorRadius + 3));
		}
		const currentPutAbleLen = currentPutAbleList!.length!;
		if (currentPutAbleLen < planeGate) {
			continue;
		}

		// spawn 槽位锚定：spawn 周边偶数环 8 点为候选布局中心，
		// 取本块内评分最高（k 最大）的可建筑者为本块中心；无可用槽位中心则整块出局（他块/自然流程兜底）
		slotCenter = null;
		if (!centerPos && existSpawnPos) {
			const putK = new Map();
			for (let pi = 0; pi < currentPutAbleLen; pi++) {
				const e = currentPutAbleList![pi]!;
				putK.set(e.x * 50 + e.y, e.k);
			}
			let bestK = -1;
			for (const [dx, dy] of SPAWN_SLOT_OFFSETS) {
				const cx = existSpawnPos.x + dx!;
				const cy = existSpawnPos.y + dy!;
				const k = putK.get(cx * 50 + cy);
				if (k !== undefined && k > bestK) {
					bestK = k;
					slotCenter = { x: cx, y: cy };
				}
			}
			if (!slotCenter) {
				continue;
			}
		}

		let sumX = 0;
		let sumY = 0;
		let gt1Cnt = 0;
		const gt2List = [];
		for (let pi = 0; pi < currentPutAbleLen; pi++) {
			const e = currentPutAbleList![pi]!;
			const ex = e.x;
			const ey = e.y;
			sumX += ex;
			sumY += ey;
			if (e.k > 1) gt1Cnt += 1;
			if (e.k > 2) gt2List.push(e);
		}

		const currentInnerPutAbleList = currentPutAbleList;

		let maxDist = 0;
		if (gt2List.length < 30) {
			for (let pi = 0; pi < gt2List.length; pi++) {
				const a = gt2List[pi];
				for (let j = pi + 1; j < gt2List.length; j++) {
					const b = gt2List[j];
					const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
					if (dist > maxDist) maxDist = dist;
				}
			}
		}

		let currentWallCnt = 0;
		let currentWalls = null;
		const walls = [];
		if (gt1Cnt > 30 || maxDist > 5) {
			// 高频路径改为索引队列/数组标记，避免 PriorityQueue + callback 额外开销
			fastStampToken += 1;
			if (fastStampToken >= 65530) {
				fastStampToken = 1;
				fastVisitStamp.fill(0);
				fastManorStamp.fill(0);
			}
			const stamp = fastStampToken;
			const walkArr = roomWalkable.arr as number[];
			for (let pi = 0; pi < allList!.length!; pi++) {
				const e = allList![pi]!;
				fastManorStamp[e.x * 50 + e.y] = stamp;
			}
			// 直接扫描 manor 边界，避免整图 flood-fill
			for (let pi = 0; pi < allList!.length!; pi++) {
				const e = allList![pi]!;
				const x = e.x;
				const y = e.y;
				const idx = x * 50 + y;
				if (!walkArr[idx]) continue;
				let isBoundary = false;
				for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						const nidx = nx * 50 + ny;
						if (walkArr[nidx] && fastManorStamp[nidx] !== stamp) {
							isBoundary = true;
							break;
						}
					}
				}
				if (isBoundary && fastVisitStamp[idx] !== stamp) {
					fastVisitStamp[idx] = stamp;
					walls.push(newNode(0, x, y));
				}
			}
			currentWallCnt = walls.length;
			currentWalls = walls;
			// 阈值检查：墙体数量过少或比例过高时跳过造墙方案。
			// 锚定紧凑基地的墙圈/可建筑比天然偏高，阈值放宽到 0.5（非锚定维持 0.3）
			const MIN_WALL_CNT = 12;
			const MAX_WALL_RATIO = existSpawnPos ? 0.5 : 0.3;
			const wallRatio = currentWallCnt / currentPutAbleLen;
			if (currentWallCnt < MIN_WALL_CNT || wallRatio > MAX_WALL_RATIO) {
				currentWalls = null;
			}
		}
		if (planeGate < currentPutAbleLen && wallCnt > currentWallCnt && currentWalls) {
			// putAbleList = currentPutAbleList;
			innerPutAbleList = currentInnerPutAbleList;
			wallCnt = currentWallCnt;
			finalPos = posNum;
			(wallMap as any)[posNum] = currentWalls;
			if (centerPos) {
				centerX = centerPos.x;
				centerY = centerPos.y;
			} else if (slotCenter) {
				centerX = slotCenter.x;
				centerY = slotCenter.y;
			} else {
				centerX = sumX / currentPutAbleLen;
				centerY = sumY / currentPutAbleLen;
			}
		}
		// 兜底方案：记录墙体最少的方案（不检查阈值）
		if (minPlaneCnt < currentPutAbleList!.length! && walls && fallbackWallCnt > walls.length) {
			fallbackPos = posNum;
			fallbackWallCnt = walls.length;
			fallbackWalls = walls;
		}
	}

	// 兜底：如果没有满足阈值的方案，使用备选方案
	if (!finalPos && fallbackPos) {
		finalPos = fallbackPos;
		wallCnt = fallbackWallCnt;
		(wallMap as any)[finalPos] = fallbackWalls;
		// 重新计算 innerPutAbleList
		ManagerPlanner.getBlockPutAbleCnt(
			roomWalkable,
			visited,
			queMinBuf,
			unionFind,
			finalPos,
			putAbleCacheMap,
			allCacheMap,
			rootMembers
		);
		innerPutAbleList = putAbleCacheMap[finalPos];
		// 锚定模式下与主路径同口径限幅（fallback 重读的缓存数组同样过滤）
		if (centerPos && existSpawnPos && manorRadius > 0) {
			const sx = existSpawnPos.x;
			const sy = existSpawnPos.y;
			innerPutAbleList = innerPutAbleList.filter((e: { x: number; y: number }) =>
				Math.max(Math.abs(e.x - sx), Math.abs(e.y - sy)) <= manorRadius);
		}
		if (centerPos) {
			centerX = centerPos.x;
			centerY = centerPos.y;
		} else if (innerPutAbleList && innerPutAbleList.length) {
			let sumX = 0;
			let sumY = 0;
			for (let i = 0; i < innerPutAbleList.length; i++) {
				const e = innerPutAbleList[i];
				sumX += e.x;
				sumY += e.y;
			}
			centerX = sumX / innerPutAbleList.length;
			centerY = sumY / innerPutAbleList.length;
		}
	}

	if (!finalPos || !putAbleCacheMap[finalPos]) return;

	const walls = (wallMap as any)[finalPos];

	roomManor.init();
	const finalAllCache = allCacheMap[finalPos];
	// 锚定模式下与 innerPutAbleList 同口径限幅（-1 背景区域同样收缩，墙圈带 +3 同步）
	let boundedAllCache = finalAllCache;
	if (centerPos && existSpawnPos && manorRadius > 0) {
		const sx = existSpawnPos.x;
		const sy = existSpawnPos.y;
		boundedAllCache = finalAllCache!.filter!((e: { x: number; y: number }) =>
			Math.max(Math.abs(e.x - sx), Math.abs(e.y - sy)) <= manorRadius + 3);
	}
	for (let i = 0; i < boundedAllCache!.length!; i++) {
		const e = boundedAllCache![i]!;
		roomManor.set(e.x, e.y, -1);
	}
	for (let i = 0; i < innerPutAbleList.length; i++) {
		const e = innerPutAbleList[i];
		roomManor.set(e.x, e.y, e.k);
	}

	let storageX = 0;
	let storageY = 0;
	let storageDistance = Number.POSITIVE_INFINITY;

	for (let i = 0; i < innerPutAbleList.length; i++) {
		const e = innerPutAbleList[i];
		if (e.k <= 2) continue;
		const x = e.x;
		const y = e.y;
		const distance = squareDistance(centerX, centerY, x, y);
		if (storageDistance > distance) {
			storageDistance = distance;
			storageX = x;
			storageY = y;
		}
	}

	if (centerPos) {
		storageX = centerPos.x;
		storageY = centerPos.y;
	}
	// 槽位模式：枢纽直接落定槽位中心——spawn 恰好位于中心环槽位上，
	// storage/terminal/factory/link 围合仍以该点为中心
	if (!centerPos && slotCenter) {
		storageX = centerX;
		storageY = centerY;
	}

	const manorArr = roomManor.arr as (number | string)[];
	const labAnchor = findLabAnchorByTs(manorArr, storageX, storageY);
	const labX = labAnchor.x;
	const labY = labAnchor.y;

	// 这里开始计算布局！
	const structMap: StructMap = {};
	for (const e in CONTROLLER_STRUCTURES) structMap[e] = [];
	if (!structMap['road']) structMap['road'] = [];
	const walkableArr = roomWalkable.arr as number[];
	const roadSet = new Uint8Array(2500);
	const pushRoad = (x: number, y: number) => {
		if (x < 0 || x > 49 || y < 0 || y > 49) return;
		const idx = x * 50 + y;
		if (!walkableArr[idx]) return;
		if (roadSet[idx]) return;
		roadSet[idx] = 1;
		structMap['road'].push!([x, y]);
	};

	// 落地手置 spawn 占位：本体计入 spawn 编制首位；roadSet 标记使 POI 道路规划绕行该格
	const existSpawn = existSpawnPos;
	if (existSpawn) {
		roadSet[existSpawn.x * 50 + existSpawn.y] = 1;
		structMap['spawn'].push!([existSpawn.x, existSpawn.y]);
	}

	// 资源点布局
	structMap['link'] = roomObjectCache.link;
	structMap['container'] = roomObjectCache.container;
	structMap['extractor'] = roomObjectCache.extractor;
	//中心布局
	structMap['storage'].push!([storageX - 1, storageY]);
	structMap['terminal'].push!([storageX, storageY + 1]);
	structMap['factory'].push!([storageX + 1, storageY]);
	structMap['link'].push!([storageX, storageY - 1]);
	for (let i = -1; i <= 1; i++) {
		for (let j = -1; j <= 1; j++) {
			pushRoad(storageX + i + j, storageY + i - j); //仿射变换 [sin,cos,cos,-sin]
		}
	}
	// 这里修改lab布局
	const labs = ['☢☢-☢', '☢-☢-', '-☢-☢', '☢-☢☢'];
	let labChangeDirection = false;
	if ((storageX - labX) * (storageY - labY) < 0) {
		labChangeDirection = true;
	}

	const vis = {};
	for (let i = 0; i < 2; i++) {
		for (let j = 0; j < 2; j++) {
			(vis as any)[i + '_' + j] = 1; // 优先放置中间的label
			const jj = labChangeDirection ? j : 1 - j;
			const structs = labs[i + 1].charAt!(j + 1);
			if (structs == '☢') structMap['lab'].push!([labX + i, labY + jj]);
			else pushRoad(labX + i, labY + jj);
		}
	}

	for (let i = -1; i < 3; i++) {
		for (let j = -1; j < 3; j++) {
			if ((vis as any)[i + '_' + j]) continue;
			const jj = labChangeDirection ? j : 1 - j;
			const structs = labs[i + 1].charAt!(j + 1);
			if (structs == '☢') structMap['lab'].push!([labX + i, labY + jj]);
			else pushRoad(labX + i, labY + jj);
		}
	}

	for (let i = 0; i < walls.length; i++) {
		const e = walls[i];
		structMap['rampart'].push!([e.x, e.y]);
	}

	for (const struct in CONTROLLER_STRUCTURES) {
		const arr = structMap[struct];
		for (let i = 0; i < arr!.length!; i++) {
			const e = arr![i]!;
			roomStructs.set(e[0]!, e[1]!, struct);
		}
	}

	const roads = structMap['road'];
	for (let i = 0; i < roads.length; i++) {
		const e = roads[i];
		roomStructs.set(e![0]!, e![1]!, 1);
	}
	//设置权值，bfs联通路径！
	const roomManorArrForModel = roomManor.arr as (number | string)[];
	const roomStructsArrForModel = roomStructs.arr as (number | string)[];
	const setModel = function (xx: any, yy: any) {
		const checkAble = (x: any, y: any) => {
			if (x < 0 || y < 0 || x > 49 || y > 49) return false;
			const idx = x * 50 + y;
			const manorVal = roomManorArrForModel[idx];
			return typeof manorVal === 'number' && manorVal > 0 && !roomStructsArrForModel[idx];
		};
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				const x = xx + i + j;
				const y = yy + i - j;
				if (!checkAble(x, y)) continue;
				// structMap["extension"] .push([x,y])
				roomStructsArrForModel[x * 50 + y] = 8;
			}
		}
	};

	for (let i = 0; i < 50; i += 4) {
		for (let j = 0; j < 50; j += 4) {
			const x = (storageX % 4) + i;
			const y = (storageY % 4) + j;
			setModel(x, y);
			setModel(x + 2, y + 2);
		}
	}
	visited.init();
	const visitedArrForPath = visited.arr as number[];
	visitedArrForPath[storageX * 50 + storageY] = 1;

	queMinBuf.push(newNode(1, storageX, storageY));
	const costRoad = routeDistanceLocal; //重复使用
	costRoad.init();
	const roomStructArrForPath = roomStructs.arr as (number | string)[];
	const costRoadArrForPath = costRoad.arr as number[];
	queMinBuf.whileNoEmpty((nd) => {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const x = nd!.x! + dx;
				const y = nd!.y! + dy;
				if (x < 0 || x > 49 || y < 0 || y > 49) continue;
				const nidx = x * 50 + y;
				const nValRaw = roomStructArrForPath[nidx];
				const nVal = typeof nValRaw === 'number' ? nValRaw : 0;
				if (!visitedArrForPath[nidx] && nVal > 0) {
					visitedArrForPath[nidx] = 1;
					queMinBuf.push(newNode(nd!.k! + nVal, x, y));
				}
			}
		}
		costRoadArrForPath[nd!.x! * 50 + nd!.y!] = nd!.k!;
	});

	for (let i = 0; i < structMap['road'].length; i++) {
		const e = structMap['road'][i];
		roomStructs.set(e![0]!, e![1]!, 'road'); //这里把之前的road覆盖上去防止放在之前里road上了
	}
	const costArr = costRoad.arr as number[];
	const roomStructArr = roomStructs.arr as (number | string)[];
	nearMinCostCache.fill(65535);
	const getNearMinCost = (x: any, y: any, idx: any) => {
		const cached = nearMinCostCache[idx];
		if (cached !== 65535) return cached;
		let minVal = 65535;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				const nVal = costArr[nx * 50 + ny];
				if (nVal! > 0 && minVal > nVal!) minVal = nVal!;
			}
		}
		const res = minVal === 65535 ? 0 : minVal;
		nearMinCostCache[idx] = res;
		return res;
	};

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			const idx = x * 50 + y;
			const val = costArr[idx];
			if (!val) continue;
			const minVal = getNearMinCost(x, y, idx);
			if (!minVal) continue;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					if (costArr[nx * 50 + ny] === minVal) {
						roomStructArr[nx * 50 + ny] = 'road';
					}
				}
			}
		}
	}

	let spawnPos = [];
	let extensionPos = [];
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			const idx = x * 50 + y;
			const val = roomStructArr[idx];
			if (typeof val !== 'number' || val <= 0) continue;
			const dist = getNearMinCost(x, y, idx) || 100;
			// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
			if (val == 12) {
				// 8 && 12 上面有写，注意！！！
				spawnPos.push([x, y, dist]);
			} else {
				extensionPos.push([x, y, dist]);
			}
		}
	}
	const cmpFunc = (a: any, b: any) => (a[2] == b[2] ? (a[1] == b[1] ? a[0] - b[0] : a[1] - b[1]) : a[2] - b[2]);
	spawnPos = spawnPos.sort(cmpFunc);
	extensionPos = extensionPos.sort(cmpFunc);
	const putList = [];
	const structOrder = ['spawn', 'nuker', 'powerSpawn', 'tower', 'observer'];
	// 落地手置 spawn 收编：本体已在上方占位为 spawn 首位，这里把该格从其余结构规划中剔除
	// （撞上 lab/tower 等已规划位则移除原条目，下工地阶段按已有结构自然跳过）
	if (existSpawn) {
		const sx = existSpawn.x;
		const sy = existSpawn.y;
		for (const st in structMap) {
			if (st === 'road' || st === 'spawn') continue;
			const arr = structMap[st];
			for (let i = (arr?.length ?? 0) - 1; i >= 0; i--) {
				if (arr?.[i]?.[0] === sx && arr?.[i]?.[1] === sy) arr?.splice(i, 1);
			}
		}
		// 计划 spawn 与本体保持切比雪夫 ≥2（相邻格可、贴脸不可）
		spawnPos = spawnPos.filter((e) => Math.max(Math.abs(e[0]! - sx), Math.abs(e[1]! - sy)) >= 2);
		extensionPos = extensionPos.filter((e) => !(e[0] === sx && e[1] === sy));
		putList.push([sx, sy, 'spawn']);
	}
	// 计划 spawn 相互之间、以及与本体之间均保距 ≥2（贪心：距离序先到先得，贴脸候选让位）
	const spacedSpawnPos: any = [];
	for (const cand of spawnPos) {
		const clash = structMap['spawn'].some!((s) => Math.max(Math.abs(s[0] - cand[0]!), Math.abs(s[1] - cand[1]!)) < 2)
			|| spacedSpawnPos.some((s) => Math.max(Math.abs(s[0] - cand[0]!), Math.abs(s[1] - cand[1]!)) < 2);
		if (!clash) spacedSpawnPos.push(cand);
	}
	spawnPos = spacedSpawnPos;
	let spawnIdx = 0;
	let extIdx = 0;
	for (let si = 0; si < structOrder.length; si++) {
		const struct = structOrder[si];
		const cnt = CONTROLLER_STRUCTURES[struct!][8] - (struct === 'spawn' && existSpawn ? 1 : 0);
		for (let i = 0; i < cnt; i++) {
			const e = spawnIdx < spawnPos.length ? spawnPos[spawnIdx++] : extensionPos[extIdx++];
			if (!e) continue;
			structMap[struct!].push([e[0], e[1]]);
			putList.push([e[0], e[1], struct]);
		}
	}
	const remainPos = extensionPos.slice(extIdx);
	for (let i = spawnIdx; i < spawnPos.length; i++) remainPos.push(spawnPos[i]);
	extensionPos = remainPos.sort(cmpFunc);
	let extCnt = 60;
	for (let i = 0; i < extensionPos.length; i++) {
		const e = extensionPos[i];
		if (extCnt > 0) {
			structMap['extension'].push!([e![0]!, e![1]!]);
			putList.push([e![0]!, e![1]!, 'extension']);
			extCnt -= 1;
		}
	}

	// 更新roads
	roomStructs.init();
	for (const struct in CONTROLLER_STRUCTURES) {
		const arr = structMap[struct];
		for (let i = 0; i < arr!.length!; i++) {
			const e = arr![i]!;
			roomStructs.set(e[0]!, e[1]!, struct);
		}
	}
	visited.init();
	const visitedRoadArr = visited.arr as number[];
	const costRoadArr = costRoad.arr as number[];
	const roomStructsArrForRoad = roomStructs.arr as (number | string)[];
	for (let i = 0; i < structMap['road'].length; i++) {
		const e = structMap['road'][i];
		visitedRoadArr[e![0]! * 50 + e![1]!] = 1;
	}
	for (let i = 0; i < putList.length; i++) {
		const e = putList[i];
		const x = e![0]!;
		const y = e![1]!;
		let minVal = 50;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				const val = costRoadArr[nx * 50 + ny];
				if (val! > 0 && minVal > val!) minVal = val!;
			}
		}
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				if (costRoadArr[nx * 50 + ny] === minVal && minVal > 0) {
					roomStructsArrForRoad[nx * 50 + ny] = 'road';
				}
			}
		}
	}
	for (let idx = 0; idx < 2500; idx++) {
		const val = roomStructsArrForRoad[idx];
		if (val == 'link' || val == 'container') continue;
		if (typeof val === 'number' && val > -1) continue;
		const x = (idx / 50) | 0;
		const y = idx % 50;
		let minVal = 50;
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				const nVal = costRoadArr[nx * 50 + ny];
				if (nVal! > 0 && minVal > nVal!) minVal = nVal!;
			}
		}
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!dx && !dy) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				if (costRoadArr[nx * 50 + ny] === minVal && minVal > 0) {
					const nidx = nx * 50 + ny;
					if (!visitedRoadArr[nidx]) {
						visitedRoadArr[nidx] = 1;
						pushRoad(nx, ny);
					}
				}
			}
		}
	}

	const costs = new PathFinder.CostMatrix();
	const terrain = new Room.Terrain(roomName);
	for (let i = 0; i < 50; i++) {
		for (let j = 0; j < 50; j++) {
			const te = terrain.get(i, j);
			costs.set(i, j, te == TERRAIN_MASK_WALL ? 255 : te == TERRAIN_MASK_SWAMP ? 4 : 2);
		}
	}
	for (const struct of OBSTACLE_OBJECT_TYPES) {
		if (structMap[struct]) {
			const arr = structMap[struct];
			for (let i = 0; i < arr.length; i++) {
				const e = arr[i];
				costs.set(e![0]!, e![1]!, 255);
			}
		}
	}
	for (let i = 0; i < structMap['road'].length; i++) {
		const e = structMap['road'][i];
		costs.set(e![0]!, e![1]!, 1);
	}
	structMap['container'].sort!((a, b) => {
		const adx = a[0] - storageX;
		const ady = a[1] - storageY;
		const bdx = b[0] - storageX;
		const bdy = b[1] - storageY;
		return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
	});
	for (let i = 0; i < structMap['container'].length!; i++) {
		const e = structMap['container'][i]!;
		const result = PathFinder.search(
			new RoomPosition(centerX, centerY, roomName),
			{ pos: new RoomPosition(e[0]!, e[1]!, roomName), range: 1 },
			{
				roomCallback: () => costs,
				maxRooms: 1
			}
		);
		const path = result.path || [];
		for (let j = 0; j < path.length; j++) {
			const pos = path[j];
			if (costs.get(pos!.x!, pos!.y!) != 1) {
				pushRoad(pos!.x!, pos!.y!);
				costs.set(pos!.x!, pos!.y!, 1);
			}
		}
	}
	ManagerPlanner.dismiss();

	return {
		roomName: roomName,
		structMap: structMap,
		centerPos: { x: storageX, y: storageY },
		labPos: { labX, labY },
	};
};
