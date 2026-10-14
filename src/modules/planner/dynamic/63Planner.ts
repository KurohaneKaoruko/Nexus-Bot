// @ts-nocheck

import { PriorityQueue, newNode as NewNode } from '@/utils/priorityQueue'
import { UnionFind } from '@/utils/unionFind'
import { RoomArray } from '@/utils/roomArray'
import LayoutVisual from '@/modules/planner/layoutVisual'

const minPlaneCnt = 140;

// 惰性初始化：这些结构含 WASM 实例化与 2500 格数组，模块加载即建会在 CPU 有限的服务器上
// 触发「上传代码 → 初始化超时 → 丢弃 → 重来」的启动死循环。改为首次使用时构建。
let visited: any = null;
let roomWalkable: any = null;
let nearWall: any = null;
let routeDistance: any = null;
let roomObjectCache: any = null;

let nearWallWithInterpolation: any = null;
let interpolation: any = null;

let queMin: any = null;
let queMin2: any = null;
let startPoint: any = null;

let unionFind: any = null;

export function ensurePlannerState() {
    if (visited) return;
    visited = new RoomArray();
    roomWalkable = new RoomArray();
    nearWall = new RoomArray();
    routeDistance = new RoomArray();
    roomObjectCache = new RoomArray();
    nearWallWithInterpolation = new RoomArray();
    interpolation = new RoomArray();
    queMin = new PriorityQueue(true);
    queMin2 = new PriorityQueue(true);
    startPoint = new PriorityQueue(true);
    unionFind = new UnionFind(50 * 50);
}

/**
 * controller mineral source posList
 */
let objects: any = [];

const ManagerPlanner = {
	/**
	 * https://www.bookstack.cn/read/node-in-debugging/2.2heapdump.md
	 * 防止内存泄漏！！！！
	 */
	init() {
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
	},
	/**
	 * 防止内存泄漏！！！！
	 */
	dismiss() {
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
		objects = [];
	},

	createObjects() {
        ensurePlannerState();
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
	},
	/**
	 * 计算区块的最大性能指标 ，性能消耗的大头！
	 * 优化不动了
	 */
	getBlockPutAbleCnt(roomWalkable: any, visited: any, queMin: any, unionFind: any, tarRoot: any, putAbleCacheMap: any, AllCacheMap: any) {
        ensurePlannerState();
		if (putAbleCacheMap[tarRoot]) return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
		// let t = Game.cpu.getUsed() //这很吃性能，但是是必须的
		const roomManor = routeDistance;
		if (!roomManor) return;
		roomManor.init();
		roomManor.forEach((x: any, y: any) => {
			if (tarRoot == unionFind.find(x * 50 + y)) {
				roomManor.set(x, y, 1);
			}
		});
		roomManor.forEach((x: any, y: any, val: any) => {
			if (val) {
				let manorCnt = 0;
				let wallCnt = 0;
				roomManor.for4Direction(
					(x1: any, y1: any, val1: any) => {
						if (val1) manorCnt += 1;
						if (!roomWalkable.get(x1, y1)) wallCnt += 1;
					},
					x,
					y
				);
				if (manorCnt == 1 && wallCnt == 0) roomManor.set(x, y, 0);
			}
		});
		const dfsMoreManor = function (x: any, y: any, val: any) {
			if (!val && roomWalkable.get(x, y)) {
				let manorCnt = 0;
				let wallCnt = 0;
				roomManor.for4Direction(
					(x1: any, y1: any, val1: any) => {
						if (val1) manorCnt += 1;
						if (!roomWalkable.get(x1, y1)) wallCnt += 1;
					},
					x,
					y
				);
				if (manorCnt >= 2 || (manorCnt == 1 && wallCnt >= 2)) {
					roomManor.set(x, y, 1);
					roomManor.for4Direction(
						(x1: any, y1: any, val1: any) => {
							dfsMoreManor(x1, y1, val1);
						},
						x,
						y
					);
				}
			}
		};
		roomManor.forEach((x: any, y: any, val: any) => {
			dfsMoreManor(x, y, val);
		});
		roomWalkable.forBorder((x: any, y: any, val: any) => {
			if (val) {
				roomManor.forNear(
					(x: any, y: any) => {
						roomManor.set(x, y, 0);
					},
					x,
					y
				);
				roomManor.set(x, y, 0);
			}
		});

		const innerPutAbleList: any = [];
		const AllCacheList: any = [];

		visited.init();

		roomWalkable.forEach((x: any, y: any, val: any) => {
			if (!roomManor.get(x, y)) {
				queMin.push(NewNode(val ? -4 : -1, x, y));
				// visited.set(x,y,1) 这里不能设置visited 因为 -4 和-1 优先级不同 如果 -4距离和-1比较，-1会抢走-4 导致 rangeAttack打得到
			}
		});

		// let t = Game.cpu.getUsed() //这很吃性能，真的优化不动了

		queMin.whileNoEmpty((nd: any) => {
			const func = function (x: any, y: any, val: any) {
				const item = NewNode(nd.k + 2, x, y);
				if (!visited.exec(x, y, 1)) {
					queMin.push(NewNode(nd.k + 1, x, y));
					if (roomManor.get(x, y)) {
						if (nd.k + 1 >= 0 && val) {
							innerPutAbleList.push(item);
							// visual.text(nd.k+2, x,y+0.25, {color: 'red',opacity:0.99,font: 7})
						}
						if (val) AllCacheList.push(item);
					}
				}
			};
			visited.set(nd.x, nd.y, 1);
			if (nd.k >= -1) roomWalkable.for4Direction(func, nd.x, nd.y);
			else roomWalkable.forNear(func, nd.x, nd.y);
		});

		// console.log(Game.cpu.getUsed()-t)

		putAbleCacheMap[tarRoot] = innerPutAbleList;
		AllCacheMap[tarRoot] = AllCacheList;
		return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
	},
	/**
	 * 插值，计算区块的预处理和合并需求
	 * @param roomName
	 */
	computeBlock(roomName: any, blocked?: any) {
        ensurePlannerState();
		ManagerPlanner.createObjects();
		const visual = new RoomVisual(roomName);

		roomWalkable.initRoomTerrainWalkAble(roomName);

		//计算距离山体要多远
		roomWalkable.forEach((x: any, y: any, val: any) => {
			if (!val) {
				queMin.push(NewNode(0, x, y));
				visited.set(x, y, 1);
			}
		});
		queMin.whileNoEmpty((nd: any) => {
			roomWalkable.for4Direction(
				(x: any, y: any, val: any) => {
					if (!visited.exec(x, y, 1) && val) {
						queMin.push(NewNode(nd.k + 1, x, y));
					}
				},
				nd.x,
				nd.y
			);
			nearWall.exec(nd.x, nd.y, nd.k);
		});

		//距离出口一格不能放墙
		roomWalkable.forBorder((x: any, y: any, val: any) => {
			if (val) {
				roomWalkable.forNear(
					(x: any, y: any, val: any) => {
						if (val) {
							// roomWalkable.set(x,y,0);
							nearWall.set(x, y, 50);
							queMin.push(NewNode(0, x, y));
							// visited.set(x,y,1)
						}
					},
					x,
					y
				);
				// roomWalkable.set(x,y,0);
				queMin.push(NewNode(0, x, y));
				nearWall.set(x, y, 50);
				// visited.set(x,y,1)
			}
		});

		const roomPutAble = routeDistance;
		roomPutAble.initRoomTerrainWalkAble(roomName);
		roomWalkable.forBorder((x: any, y: any, val: any) => {
			if (val) {
				roomWalkable.forNear(
					(x: any, y: any, val: any) => {
						if (val) {
							roomPutAble.set(x, y, 0);
						}
					},
					x,
					y
				);
				roomPutAble.set(x, y, 0);
			}
		});
		// 计算 控制器，矿物的位置
		const getObjectPos = function (x: any, y: any, struct: any) {
			let put = false;
			let finalX = 0;
			let finalY = 0;
			roomPutAble.for4Direction(
				(x: any, y: any, val: any) => {
					if (val && !put && !roomObjectCache.get(x, y)) {
						finalX = x;
						finalY = y;
						put = true;
					}
				},
				x,
				y
			);
			roomPutAble.forNear(
				(x: any, y: any, val: any) => {
					if (val && !put && !roomObjectCache.get(x, y)) {
						finalX = x;
						finalY = y;
						put = true;
					}
				},
				x,
				y
			);
			roomObjectCache.set(finalX, finalY, struct);
			return [finalX, finalY];
		};
		for (let i = 0; i < objects.length; i++) {
			const pos = objects[i];
			//container 位置
			const p = getObjectPos(pos.x, pos.y, 'container');

			// link 位置
			if (i != 1) {
				const linkPos = getObjectPos(p[0], p[1], 'link');
				roomObjectCache.link = roomObjectCache.link || [];
				roomObjectCache.link.push(linkPos); // link controller 然后是  source
			} else {
				roomObjectCache.extractor = [[pos.x, pos.y]];
			}
			roomObjectCache.container = roomObjectCache.container || [];
			if (i != 1) roomObjectCache.container.unshift(p); //如果是 mineral 最后一个
			else roomObjectCache.container.push(p);
		}

		//插值，这里用拉普拉斯矩阵，对nearWall 插值 成 nearWallWithInterpolation
		nearWall.forEach((x: any, y: any, val: any) => {
			let value = -4 * val;
			nearWall.for4Direction(
				(x: any, y: any, val: any) => {
					value += val;
				},
				x,
				y
			);
			interpolation.set(x, y, value);
			if (value > 0) value = 0;
			if (val && roomWalkable.get(x, y)) nearWallWithInterpolation.set(x, y, val + value * 0.1);
		});

		if (blocked) {
			blocked.forEach((x: any, y: any, val: any) => {
				if (val) nearWallWithInterpolation.set(x, y, 0);
			});
		}

		// 计算距离出口多远
		visited.init();
		routeDistance.init();
		queMin.whileNoEmpty((nd: any) => {
			roomWalkable.forNear(
				(x: any, y: any, val: any) => {
					if (!visited.exec(x, y, 1) && val) {
						queMin.push(NewNode(nd.k + 1, x, y));
					}
				},
				nd.x,
				nd.y
			);
			routeDistance.set(nd.x, nd.y, nd.k);
		});

		// 对距离的格子插入到队列 ，作为分开的顺序
		routeDistance.forEach((x: any, y: any, val: any) => {
			if (!roomWalkable.get(x, y)) return;
			if (val) startPoint.push(NewNode(-val, x, y));
		});

		const sizeMap = {};
		const posSeqMap = {};

		// 分块，将地图分成一小块一小块
		visited.init();
		for (let i = 0; i < 2500; i++) {
			if (startPoint.isEmpty()) break;
			let cnt = 0;
			// let color = randomColor(i)
			const nd = startPoint.pop();
			const currentPos = nd.x * 50 + nd.y;
			if (blocked && blocked.get(nd.x, nd.y)) {
				unionFind.union(currentPos, 0);
				continue;
			}
			const posSeq: any = [];

			//搜索分块
			const dfsFindDown = function (roomArray: any, x: any, y: any) {
				const currentValue = roomArray.get(x, y);
				if (!visited.exec(x, y, 1)) {
					roomArray.for4Direction(
						(x1: any, y1: any, val: any) => {
							if (val && (x1 == x || y1 == y) && val < currentValue) {
								dfsFindDown(roomArray, x1, y1);
							}
						},
						x,
						y
					);
					// visual.circle(x,y, {fill: color, radius: 0.5 ,opacity : 0.5})
					const pos = x * 50 + y;
					if (unionFind.find(pos) && unionFind.find(currentPos) && (!blocked || !blocked.get(x, y))) {
						unionFind.union(currentPos, pos);
						posSeq.push(pos);
						cnt++;
					} else if (blocked) unionFind.union(pos, 0);
				}
			};

			// 跑到最高点
			const dfsFindUp = function (roomArray: any, x: any, y: any) {
				const currentValue = roomArray.get(x, y);
				if (!visited.exec(x, y, 1)) {
					roomArray.forNear(
						(x1: any, y1: any, val: any) => {
							if (val > currentValue && currentValue < 6) {
								//加了一点优化，小于时分裂更过
								dfsFindUp(roomArray, x1, y1);
							} else if (val && val < currentValue) {
								dfsFindDown(roomArray, x1, y1);
							}
						},
						x,
						y
					);
					// visual.circle(x,y, {fill: color, radius: 0.5 ,opacity : 0.5})
					const pos = x * 50 + y;
					if (unionFind.find(pos) && unionFind.find(currentPos) && (!blocked || !blocked.get(x, y))) {
						unionFind.union(currentPos, pos);
						posSeq.push(pos);
						cnt++;
					} else if (blocked) unionFind.union(pos, 0);
				}
			};
			dfsFindUp(nearWallWithInterpolation, nd.x, nd.y);

			//记录每一块的位置和大小 以 并查集的根节点 作为记录点
			if (cnt > 0) {
				const pos = unionFind.find(currentPos);
				// queMin.push({k:cnt,v:pos})
				queMin.push(NewNode(cnt, 0, 0, pos));
				(sizeMap as any) [pos] = cnt;
				(posSeqMap as any) [pos] = posSeq;
			}
		}

		// 将出口附近的块删掉
		roomWalkable.forBorder((x: any, y: any, val: any) => {
			if (val) {
				roomWalkable.forNear(
					(x: any, y: any, val: any) => {
						if (val) {
							const pos = unionFind.find(x * 50 + y);
							if ((sizeMap as any) [pos]) delete (sizeMap as any) [pos];
						}
					},
					x,
					y
				);
				const pos = unionFind.find(x * 50 + y);
				if ((sizeMap as any) [pos]) delete (sizeMap as any) [pos];
			}
		});
		delete (sizeMap as any) [0];

		const putAbleCacheMap = {};
		const allCacheMap = {};
		// let i = 0
		// 合并小块成大块的
		queMin.whileNoEmpty((nd: any) => {
			const pos = nd.v;
			if (nd.k != (sizeMap as any) [pos]) return; // 已经被合并了
			// i++;

			visited.init();
			const nearCntMap = {};

			//搜索附近的块
			posSeqMap[pos].forEach((e: any) => {
				const y = e % 50;
				const x = (e - y) / 50; //Math.round
				roomWalkable.forNear(
					(x: any, y: any, val: any) => {
						if (val && !visited.exec(x, y, 1)) {
							const currentPos = unionFind.find(x * 50 + y);
							if (currentPos == pos) return;
							// if(i==104)
							// visual.text(parseInt(1*10)/10, x,y+0.25, {color: "cyan",opacity:0.99,font: 7})
							const currentSize = (sizeMap as any) [currentPos];
							if (currentSize < 300) {
								(nearCntMap as any) [currentPos] = ((nearCntMap as any) [currentPos] || 0) + 1;
							}
						}
					},
					x,
					y
				);
			});

			let targetPos: any = undefined;
			let nearCnt = 0;
			let maxRatio = 0;

			// 找出合并附近最优的块
			_.keys(nearCntMap).forEach((currentPos) => {
				const currentRatio = (nearCntMap as any) [currentPos] / Math.sqrt(Math.min((sizeMap as any) [currentPos], nd.k)); //实际/期望
				if (currentRatio == maxRatio ? (sizeMap as any) [currentPos] < (sizeMap as any) [targetPos] : currentRatio > maxRatio) {
					targetPos = currentPos;
					maxRatio = currentRatio;
					nearCnt = (nearCntMap as any) [currentPos];
				}
			});
			_.keys(nearCntMap).forEach((currentPos) => {
				if (nearCnt < (nearCntMap as any) [currentPos]) {
					targetPos = currentPos;
					nearCnt = (nearCntMap as any) [currentPos];
				}
			});
			const minSize = (sizeMap as any) [targetPos];
			const cnt = nd.k + minSize;
			// let nearRatio =nearCntMap[targetPos]/allNearCnt;

			let targetBlockPutAbleCnt = 0;
			let ndkBlockPutAbleCnt = 0;
			if (minSize > minPlaneCnt)
				targetBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCnt! (
					roomWalkable,
					visited,
					queMin2,
					unionFind,
					targetPos,
					putAbleCacheMap,
					allCacheMap
				)[0].length!;
			if (nd.k > minPlaneCnt)
				ndkBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCnt! (
					roomWalkable,
					visited,
					queMin2,
					unionFind,
					nd.v,
					putAbleCacheMap,
					allCacheMap
				)[0].length!;

			// 合并
			if (targetPos && Math.max(targetBlockPutAbleCnt, ndkBlockPutAbleCnt) < minPlaneCnt) {
				unionFind.union(pos, targetPos);
				nd.v = unionFind.find(pos);

				if (pos != nd.v) delete (sizeMap as any) [pos];
				else delete (sizeMap as any) [targetPos];

				nd.k = cnt;
				(sizeMap as any) [nd.v] = cnt;
				(posSeqMap as any) [nd.v] = posSeqMap[targetPos].concat((posSeqMap as any) [pos]);
				delete (putAbleCacheMap as any) [nd.v];
				delete (putAbleCacheMap as any) [targetPos];
				if (pos != nd.v) delete (posSeqMap as any) [pos];
				else delete (posSeqMap as any) [targetPos];
				queMin.push(NewNode(nd.k, nd.x, nd.y, nd.v));
			}
		});
		// 打印结果

		roomWalkable.forEach((x: any, y: any, val: any) => {
			if (typeof val === 'number' && val > 0 && (sizeMap as any) [unionFind.find(x * 50 + y)] > 0)
				visual.circle(x, y, {
					fill: LayoutVisual.randomColor(unionFind.find(x * 50 + y).toString()),
					radius: 0.5,
					opacity: 0.15
				});
		});

		// 打印中间变量
		return [unionFind, sizeMap, roomWalkable, nearWall, putAbleCacheMap, allCacheMap];
	},
	/**
	 * 计算 分布图
	 * 计算建筑的位置
	 * @param roomName,
	 * @param points [flagController,flagMineral,flagSourceA,flagSourceB]
	 * @return result { roomName:roomName,storagePos:{x,y},labPos:{x,y},structMap:{ "rampart" : [[x1,y1],[x2,y2] ...] ...} }
	 */
	computeManor(roomName: any, points: any, fixedCenter?: any, blocked?: any) {
        ensurePlannerState();
		ManagerPlanner.init();
		for (const p of points) {
			if (p && p.roomName == roomName) objects.push(p);
		}
		// const visual = new RoomVisual(roomName);
		const blockArray = ManagerPlanner.computeBlock(roomName, blocked);
		const unionFind = blockArray[0];
		const sizeMap = blockArray[1];
		const wallMap = {};
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
		queMin.clear();
		// let visited = new RoomArray()

		let finalPos = undefined;
		let wallCnt = 1e9;
		let innerPutAbleList: any = [];

		let centerX: any = undefined;
		let centerY: any = undefined;

		let centerPos = fixedCenter;
		if (!centerPos && Game.flags.storagePos && Game.flags.storagePos.pos.roomName == roomName) {
			centerPos = { x: Game.flags.storagePos.pos.x, y: Game.flags.storagePos.pos.y };
		}

		_.keys(sizeMap).forEach((pos) => {
			// if(sizeMap[pos]<150)return

			ManagerPlanner.getBlockPutAbleCnt(roomWalkable, visited, queMin, unionFind, pos, putAbleCacheMap, allCacheMap);
			const currentPutAbleList = putAbleCacheMap[pos];
			const allList = allCacheMap[pos];
			if (currentPutAbleList.length < minPlaneCnt) return;
			if (
				centerPos &&
				!currentPutAbleList.find((e: any) => e.x == centerPos.x && e.y == centerPos.y)
			)
				return;

			(wallMap as any) [pos] = [];

			visited.init();
			roomWalkable.forBorder((x: any, y: any, val: any) => {
				if (val) {
					queMin.push(NewNode(0, x, y));
					visited.set(x, y, 1);
				}
			});

			const roomManor = routeDistance; //当前的Manor
			roomManor.init();
			allList.forEach((e: any) => {
				roomManor.set(e.x, e.y, 1);
			});
			// currentPutAbleList.forEach(e=>visual.text(e.k, e.x,e.y+0.25, {color: 'red',opacity:0.99,font: 1}))

			queMin.whileNoEmpty((nd: any) => {
				if (!roomManor.get(nd.x, nd.y))
					roomWalkable.forNear(
						(x: any, y: any, val: any) => {
							if (!visited.exec(x, y, 1) && val) {
								if (!roomManor.get(x, y)) queMin.push(NewNode(nd.k + 1, x, y));
								else {
									wallMap[pos].push(NewNode(0, x, y));
									// visual.text('X', x,y+0.25, {color: 'red',opacity:0.99,font: 7})
								}
							}
						},
						nd.x,
						nd.y
					);
			});

			// wallMap[pos].forEach(xy=>queMin.push(NewNode(0,xy.x,xy.y)))

			const currentInnerPutAbleList = currentPutAbleList;

			let maxDist = 0;
			const filter2 = currentInnerPutAbleList.filter((e: any) => e.k > 2);
			if (filter2.length < 30) {
				filter2.forEach((a: any) => {
					filter2.forEach((b: any) => {
						maxDist = Math.max(maxDist, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
					});
				});
			}

			const currentWallCnt = wallMap[pos].length;
			// {
			//     let y = pos%50
			//     let x = ((pos-y)/50)//Math.round
			//     visual.text(parseInt((allList.length)*10)/10, x,y, {color: "yellow",opacity:0.99,font: 7})
			//     visual.text(parseInt((currentPutAbleList.length)*10)/10, x,y+0.5, {color: "red",opacity:0.99,font: 7})
			//     visual.text(parseInt((currentInnerPutAbleList.length)*10)/10, x,y+1, {color: "red",opacity:0.99,font: 7})
			// }
			if (
				minPlaneCnt < currentPutAbleList.length &&
				wallCnt > currentWallCnt &&
				(currentInnerPutAbleList.filter((e: any) => e.k > 1).length > 30 || maxDist > 5)
			) {
				// putAbleList = currentPutAbleList;
				innerPutAbleList = currentInnerPutAbleList;
				wallCnt = currentWallCnt;
				finalPos = pos;
				if (centerPos) {
					centerX = centerPos.x;
					centerY = centerPos.y;
				} else {
					centerX = currentPutAbleList.map((e: any) => e.x).reduce((a: any, b: any) => a + b) / currentPutAbleList.length;
					centerY = currentPutAbleList.map((e: any) => e.y).reduce((a: any, b: any) => a + b) / currentPutAbleList.length;
				}
			}

			// allCacheMap[pos].forEach(t=>{
			//     visual.circle(t.x, t.y, {fill: randomColor(pos), radius: 0.5 ,opacity : 0.15})
			// })
		});

		if (!finalPos || !putAbleCacheMap[finalPos]) return;

		const walls = wallMap[finalPos];

		roomManor.init();
		allCacheMap[finalPos].forEach((e: any) => {
			roomManor.set(e.x, e.y, -1);
		});
		innerPutAbleList.forEach((e) => {
			roomManor.set(e.x, e.y, e.k);
		});

		// visited.init()
		// roomWalkable.forEach((x: number, y: number, val: number | string)=>{if(!roomManor.get(x,y)){queMin.push(NewNode(val?-3:-1,x,y));visited.set(x,y,1)}})

		let storageX = 0;
		let storageY = 0;
		let storageDistance = 100;

		// innerPutAbleList.forEach(e=>visual.text(e.k, e.x,e.y+0.25, {color: 'red',opacity:0.99,font: 7}))
		innerPutAbleList
			.filter((e) => e.k > 2)
			.forEach((e) => {
				const x = e.x;
				const y = e.y;
				const detX = centerX - x;
				const detY = centerY - y;
				const distance = Math.sqrt(detX * detX + detY * detY);
				if (storageDistance > distance) {
					storageDistance = distance;
					storageX = x;
					storageY = y;
				}
			});

		if (centerPos) {
			storageX = centerPos.x;
			storageY = centerPos.y;
		}

		let labX = 0;
		let labY = 0;
		let labDistance = 1e5;
		// innerPutAbleList.filter(e=>e.k>4).forEach(e=>{
		//     let x =e.x
		//     let y =e.y
		//     let detX= centerX-x
		//     let detY= centerY-y
		//     let distance = Math.sqrt(detX*detX+detY*detY)
		//
		//     if(labDistance>distance&&Math.abs(x-storageX)+Math.abs(y-storageY)>5){
		//         labDistance = distance
		//         labX = x
		//         labY = y
		//     }
		// })

		roomManor.forEach((x: any, y: any, val: any) => {
			// LayoutVisual.showText(roomName,val,{x:x,y:y},"cyan",0.75)
			if (typeof val === 'number' && val >= 2) {
				// if(roomManor.get(x,y)>0&&Math.abs(x-storageX)+Math.abs(y-storageY)>2)
				// visual.text(val, x,y+0.25, {color: 'cyan',opacity:0.99,font: 7})
				const distance = Math.sqrt(Math.pow(storageX - x - 1.5, 2) + Math.pow(storageY - y - 1.5, 2));
				if (labDistance <= distance) return;
				let checkCnt = 0;
				const check = function (x: any, y: any) {
					if ((roomManor.get(x, y)) > 0 && Math.abs(x - storageX) + Math.abs(y - storageY) > 2) {
						checkCnt += 1;
					}
				};
				for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) check(x + i, y + j);
				if (checkCnt == 16) {
					// LayoutVisual.showText(roomName,parseInt(distance*10),{x:x+1.5,y:y+1.5},"cyan",0.75)
					labDistance = distance;
					labX = x;
					labY = y;
				}
			}
		});
		labX += 1;
		labY += 1;

		// visual.text("C", centerX,centerY+0.25, {color: 'green',opacity:0.99,font: 7})
		// visual.text("S", storageX,storageY+0.25, {color: 'blue',opacity:0.99,font: 7})
		// visual.text("L", labX+0.5,labY+0.75, {color: 'blue',opacity:0.99,font: 7})
		// clog(roomName)

		// clog(roomName,storageX,storageY,labX,labY,innerPutAbleList.length,wallCnt,finalPos)
		// clog(innerPutAbleList.filter(e=>e.k==1).length)

		// _.keys(sizeMap).forEach(e=>{
		//     let y = e%50
		//     let x = ((e-y)/50)//Math.round
		//     let color = "red"
		//     if(sizeMap[e]>0)visual.text(parseInt(sizeMap[e]*10)/10, x,y+1+0.25, {color: color,opacity:0.99,font: 7})
		// })

		// CONTROLLER_STRUCTURES: {
		//     "spawn": {0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3},
		//     "extension": {0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60},
		//     "link": {1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6},
		//     "road": {0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "constructedWall": {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "rampart": {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "storage": {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1},
		//     "tower": {1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6},
		//     "observer": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "powerSpawn": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "extractor": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
		//     "terminal": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
		//     "lab": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10},
		//     "container": {0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5},
		//     "nuker": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "factory": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1}
		// }

		// nearWall.forEach((x: number, y: number, val: number | string)=>{if(val>2&&finalPos==unionFind.find(x*50+y))visual.text(nearWall.get(x,y),x, y+0.5, {color: "red",opacity:0.99,font: 7})})

		/**
		 * 这里开始计算布局！
		 * @type {{}}
		 */
		const structMap = {};
		_.keys(CONTROLLER_STRUCTURES).forEach((e) => ((structMap as any) [e] = []));

		// 资源点布局
		(structMap as any) ['link'] = roomObjectCache.link;
		(structMap as any) ['container'] = roomObjectCache.container;
		(structMap as any) ['extractor'] = roomObjectCache.extractor;
		//中心布局
		structMap['storage'].push([storageX - 1, storageY]);
		structMap['terminal'].push([storageX, storageY + 1]);
		structMap['factory'].push([storageX + 1, storageY]);
		structMap['link'].push([storageX, storageY - 1]);
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				structMap['road'].push([storageX + i + j, storageY + i - j]); //仿射变换 [sin,cos,cos,-sin]
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
				(vis as any) [i + '_' + j] = 1; // 优先放置中间的label
				const jj = labChangeDirection ? j : 1 - j;
				const structs = labs[i + 1].charAt! (j + 1);
				if (structs == '☢') structMap['lab'].push([labX + i, labY + jj]);
				else structMap['road'].push([labX + i, labY + jj]);
			}
		}

		for (let i = -1; i < 3; i++) {
			for (let j = -1; j < 3; j++) {
				if ((vis as any) [i + '_' + j]) continue;
				const jj = labChangeDirection ? j : 1 - j;
				const structs = labs[i + 1].charAt! (j + 1);
				if (structs == '☢') structMap['lab'].push([labX + i, labY + jj]);
				else structMap['road'].push([labX + i, labY + jj]);
			}
		}

		walls.forEach((e: any) => structMap['rampart'].push([e.x, e.y]));

		_.keys(CONTROLLER_STRUCTURES).forEach((struct) =>
			structMap[struct].forEach((e: any) => roomStructs.set(e[0], e[1], struct))
		);

		structMap['road'].forEach((e: any) => roomStructs.set(e[0], e[1], 1));
		//设置权值，bfs联通路径！
		const setModel = function (xx: any, yy: any) {
			const checkAble = (x: any, y: any) =>
				x >= 0 && y >= 0 && x <= 49 && y <= 49 && (roomManor.get(x, y)) > 0 && !roomStructs.get(x, y);
			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					const x = xx + i + j;
					const y = yy + i - j;
					if (checkAble(x, y)) {
						if (i || j) {
							// structMap["road"] .push([x,y]) //仿射变换 [sin,cos,cos,-sin]
							roomStructs.set(x, y, 1);
						} else {
							// structMap["spawn"] .push([x,y])
							roomStructs.set(x, y, 12);
						}
					}
				}
			}
			for (const e of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			]) {
				const x = xx + e[0];
				const y = yy + e[1];
				if (checkAble(x, y)) {
					// structMap["extension"] .push([x,y])
					roomStructs.set(x, y, 8);
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
		visited.set(storageX, storageY, 1);

		queMin.push(NewNode(1, storageX, storageY));
		const costRoad = routeDistance; //重复使用
		costRoad.init();
		queMin.whileNoEmpty((nd: any) => {
			roomStructs.forNear(
				(x: any, y: any, val: any) => {
					if (!visited.exec(x, y, 1) && val > 0) {
						queMin.push(NewNode(nd.k + val, x, y));
					}
				},
				nd.x,
				nd.y
			);
			costRoad.set(nd.x, nd.y, nd.k);
			// visual.text(nd.k,nd.x,nd.y+0.25, {color: "pink",opacity:0.99,font: 7})
		});

		structMap['road'].forEach((e: any) => roomStructs.set(e[0], e[1], 'road')); //这里把之前的road覆盖上去防止放在之前里road上了

		costRoad.forEach((x: any, y: any, val: any) => {
			if (!val) return;
			let minVal = 50;
			// let finalX = 0;
			// let finalY = 0;
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal > val && val > 0) {
						minVal = val;
						// finalX = x1
						// finalY = y1
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal == val && val > 0) {
						// structMap["road"].push([x1,y1])
						roomStructs.set(x1, y1, 'road');
					}
				},
				x,
				y
			);
			// 方案1 密集
			// structMap["road"].push([finalX,finalY])
			// roomStructs.set(finalX,finalY,"road")
		});

		let spawnPos: any = [];
		let extensionPos: any = [];
		roomStructs.forEach((x: any, y: any, val: any) => {
			if (val > 0) {
				let dist = 100;
				costRoad.forNear(
					(x: any, y: any, val: any) => {
						if (val) dist = Math.min(dist, val);
					},
					x,
					y
				);
				// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
				if (val == 12) {
					// 8 && 12 上面有写，注意！！！
					spawnPos.push([x, y, dist]);
				} else {
					extensionPos.push([x, y, dist]);
					// visual.text(dist,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
				}
			}
		});
		const cmpFunc = (a: any, b: any) => (a[2] == b[2] ? (a[1] == b[1] ? a[0] - b[0] : a[1] - b[1]) : a[2] - b[2]);
		spawnPos = spawnPos.sort(cmpFunc);
		extensionPos = extensionPos.sort(cmpFunc);
		const oriStruct: any = [];
		const putList: any = [];
		['spawn', 'nuker', 'powerSpawn', 'tower', 'observer'].forEach((struct) => {
			for (let i = 0; i < ((CONTROLLER_STRUCTURES as any) [struct] as any) [8]; i++) {
				oriStruct.push(struct);
			}
		});
		oriStruct.forEach((struct) => {
			let e = spawnPos.shift();
			if (!e) e = extensionPos.shift();
			structMap[struct].push([e[0], e[1]]);
			putList.push([e[0], e[1], struct]);
		});
		extensionPos.push(...spawnPos);
		extensionPos = extensionPos.sort(cmpFunc);
		let extCnt = 60;
		extensionPos.forEach((e) => {
			if (extCnt > 0) {
				structMap['extension'].push([e[0], e[1]]);
				putList.push([e[0], e[1], 'extension']);
				extCnt -= 1;
			}
		});

		// 更新roads
		roomStructs.init();
		_.keys(CONTROLLER_STRUCTURES).forEach((struct) =>
			structMap[struct].forEach((e: any) => roomStructs.set(e[0], e[1], struct))
		);
		visited.init();
		structMap['road'].forEach((e: any) => visited.set(e[0], e[1], 1));
		/**
		 * 更新最近的roads 但是可能有残缺
		 */
		putList.forEach((e) => {
			const x = e[0];
			const y = e[1];
			let minVal = 50;
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal > val && val > 0) {
						minVal = val;
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal == val && val > 0) {
						// 找到建筑最近的那个road
						roomStructs.set(x1, y1, 'road');
					}
				},
				x,
				y
			);
		});
		/**
		 * 再roads的基础上，对roads进行补全，将残缺的连起来
		 */
		roomStructs.forEach((x: any, y: any, val: any) => {
			if (val == 'link' || val == 'container') return; // 资源点的不要 放路
			if (typeof val === 'number' && val > -1) return; // 附近有建筑 ，并且不是road
			// visual.text(val,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
			let minVal = 50;
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal > val && val > 0) {
						minVal = val;
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1: any, y1: any, val: any) => {
					if (minVal == val && val > 0) {
						// 找到建筑最近的那个road
						if (!visited.exec(x1, y1, 1)) structMap['road'].push([x1, y1]);
					}
				},
				x,
				y
			);
		});

		//#region 新的连接外矿方式
		const costs = new PathFinder.CostMatrix();
		const terrain = new Room.Terrain(roomName);
		for (let i = 0; i < 50; i++) {
			for (let j = 0; j < 50; j++) {
				const te = terrain.get(i, j);
				costs.set(i, j, te == TERRAIN_MASK_WALL ? 255 : te == TERRAIN_MASK_SWAMP ? 4 : 2);
			}
		}
		for (const struct of OBSTACLE_OBJECT_TYPES) {
			if ((structMap as any) [struct]) {
				structMap[struct].forEach((e: any) => {
					costs.set(e[0], e[1], 255);
				});
			}
		}
		structMap['road'].forEach((e: any) => {
			costs.set(e[0], e[1], 1);
		});
		structMap['container'].sort((e: any) =>
			Math.sqrt((e[0] - storageX) * (e[0] - storageX) + (e[1] - storageY) * (e[1] - storageY))
		);
		structMap['container'].forEach((e: any) => {
			PathFinder.search(
				new RoomPosition(centerX, centerY, roomName),
				{ pos: new RoomPosition(e[0], e[1], roomName), range: 1 },
				{
					roomCallback: () => {
						return costs;
					},
					maxRooms: 1
				}
			).path.forEach(pos=>{
                if(costs.get(pos.x,pos.y) != 1){
                    structMap['road'].push([pos.x,pos.y])
                    costs.set(pos.x,pos.y,1)
                }
            })
		});
		ManagerPlanner.dismiss();

		return {
			roomName: roomName,
			structMap: structMap,
			centerPos: {x: storageX, y: storageY},
			labPos: {labX, labY},
		};
	}
};

export const autoPlanner63 = {
	name: '63auto',
	ManagerPlanner: ManagerPlanner
};
