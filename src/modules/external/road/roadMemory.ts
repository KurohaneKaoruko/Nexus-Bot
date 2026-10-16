
/**
 * 外矿道路内存管理: 路线数据的持久化存储与解码缓存, 按目标位置独立存取路径。
 */

import { compress, decompress } from '@/utils/compress';
import { getOutMineData } from '@/core/store/accessor';

export const RoadMemory = {
    groupPositionsCache: {} as {
        [key: string]: { lastUpdate: number; positions: RoomPosition[] };
    },
    /**
     * 已解码的路线缓存（key 为 `源房:目标房`）。
     *
     * @remarks
     * 路线在内存里存的是 `[房名, 压缩xy]`，读出来要逐点 `new RoomPosition`；
     * 引擎侧每次构造都要解析一遍房名，成本不低。而 `getAllPaths` 会被每个
     * 正在跨房的中转 creep、以及每 tick 的工地维护反复调用，调用方都只读，
     * 所以按 `RoadData.lastUpdate` 缓存整个解码结果。
     *
     * 注意：返回值是进程内共享对象，调用方**不得就地修改**其中的数组或 Map。
     */
    allPathsCache: {} as {
        [key: string]: { lastUpdate: number; paths: Map<string, RoomPosition[]> };
    },

    /**
     * 获取指定目标房间的路线组
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 路线组数据或 undefined
     */
    getRouteGroup(sourceRoom: string, targetRoom: string): OutMineRoadRouteGroup | undefined {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes) return undefined;
        return mem.routes[targetRoom] as OutMineRoadRouteGroup;
    },

    /**
     * 设置指定目标的路径数据
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @param positions 道路位置数组（按顺序）
     */
    setPath(sourceRoom: string, targetRoom: string, targetPos: string, positions: RoomPosition[]): void {
        this.ensureMemory(sourceRoom);
        const mem = getOutMineData(sourceRoom).RoadData!;
        
        if (!mem.routes[targetRoom]) {
            mem.routes[targetRoom] = {
                paths: {},
                createdAt: Game.time,
                status: 'pending',
            };
        }

        const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
        
        // 按顺序存储路径
        const path: Array<[string, number]> = positions.map(pos => [pos.roomName, compress(pos.x, pos.y)]);

        group.paths[targetPos] = {
            path,
            length: positions.length,
        };
        
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
    },

    /**
     * 批量设置多个目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param pathsMap 路径映射 { "x:y": positions[] }
     */
    setPaths(sourceRoom: string, targetRoom: string, pathsMap: Map<string, RoomPosition[]>): void {
        this.ensureMemory(sourceRoom);
        const mem = getOutMineData(sourceRoom).RoadData!;
        
        mem.routes[targetRoom] = {
            paths: {},
            createdAt: Game.time,
            status: 'pending',
        };

        const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;

        for (const [targetPos, positions] of pathsMap) {
            const path: Array<[string, number]> = positions.map(pos => [pos.roomName, compress(pos.x, pos.y)]);
            group.paths[targetPos] = {
                path,
                length: positions.length,
            };
        }
        
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
    },

    /**
     * 获取指定目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @param targetPos 目标位置 "x:y"
     * @returns RoomPosition 数组（按顺序）
     */
    getPath(sourceRoom: string, targetRoom: string, targetPos: string): RoomPosition[] | undefined {
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths?.[targetPos]) return undefined;

        const pathData = group.paths[targetPos];
        return pathData.path.map(([roomName, compressed]) => {
            const [x, y] = decompress(compressed);
            return new RoomPosition(x, y, roomName);
        });
    },

    /**
     * 读取某源房外矿路线数据的版本号（`RoadData.lastUpdate`）。
     *
     * @remarks
     * `setPath` / `setPaths` / `deleteRoute` 都会推进它。调用方若持有从
     * `getAllPaths` 派生出来的缓存（例如按房间切分的路线索引），可以用这个
     * 版本号做失效判断——比重新解码整条路线便宜得多。
     *
     * @param sourceRoom 源头房间名。
     * @returns 版本号；该源房还没有路线数据时返回 0。
     */
    getRouteVersion(sourceRoom: string): number {
        return this.getMemory(sourceRoom)?.lastUpdate ?? 0;
    },

    /**
     * 获取目标房间内所有目标的路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 路径映射 { "x:y": positions[] }
     * @remarks
     * 结果按 `RoadData.lastUpdate` 缓存，同 tick 内多次调用（多个 creep、
     * 多轮工地维护）只解压一次。**返回值为共享对象，调用方只读。**
     */
    getAllPaths(sourceRoom: string, targetRoom: string): Map<string, RoomPosition[]> {
        const mem = this.getMemory(sourceRoom);
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths) return new Map<string, RoomPosition[]>();

        const cacheKey = `${sourceRoom}:${targetRoom}`;
        const lastUpdate = mem?.lastUpdate;
        if (lastUpdate !== undefined) {
            const cached = this.allPathsCache[cacheKey];
            if (cached && cached.lastUpdate === lastUpdate) {
                return cached.paths;
            }
        }

        const result = new Map<string, RoomPosition[]>();
        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            const positions = pathData!.path.map! (([roomName, compressed]) => {
                const [x, y] = decompress(compressed);
                return new RoomPosition(x, y, roomName);
            });
            result.set(targetPos, positions);
        }

        if (lastUpdate !== undefined) {
            this.allPathsCache[cacheKey] = { lastUpdate, paths: result };
        }
        return result;
    },

    /**
     * 获取指定路线组的所有唯一道路位置
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 唯一道路位置数组
     */
    getGroupPositions(sourceRoom: string, targetRoom: string): RoomPosition[] {
        const mem = this.getMemory(sourceRoom);
        const group = this.getRouteGroup(sourceRoom, targetRoom);
        if (!group?.paths) return [];

        if (mem?.lastUpdate !== undefined) {
            const cacheKey = `${sourceRoom}:${targetRoom}`;
            const cached = this.groupPositionsCache[cacheKey];
            if (cached && cached.lastUpdate === mem.lastUpdate) {
                return cached.positions;
            }
        }

        const positions: RoomPosition[] = [];
        const seen = new Set<string>();

        for (const targetPos in group.paths) {
            const pathData = group.paths[targetPos];
            for (const [roomName, compressed] of pathData!.path!) {
                const key = `${roomName}:${compressed}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    const [x, y] = decompress(compressed);
                    positions.push(new RoomPosition(x, y, roomName));
                }
            }
        }
        if (mem?.lastUpdate !== undefined) {
            this.groupPositionsCache[`${sourceRoom}:${targetRoom}`] = {
                lastUpdate: mem.lastUpdate,
                positions,
            };
        }
        return positions;
    },

    /**
     * 删除指定路线
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     * @returns 是否删除成功
     */
    deleteRoute(sourceRoom: string, targetRoom: string): boolean {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes?.[targetRoom]) return false;
        delete mem.routes[targetRoom];
        mem.lastUpdate = Game.time;
        delete this.groupPositionsCache[`${sourceRoom}:${targetRoom}`];
        delete this.allPathsCache[`${sourceRoom}:${targetRoom}`];
        return true;
    },

    /**
     * 获取所有路线的目标房间列表
     * @param sourceRoom 源头房间名
     * @returns 目标房间名数组
     */
    getRouteTargets(sourceRoom: string): string[] {
        const mem = this.getMemory(sourceRoom);
        if (!mem?.routes) return [];
        return Object.keys(mem.routes);
    },

    /**
     * 获取统计信息
     * @param sourceRoom 源头房间名
     * @returns 统计信息
     */
    getStats(sourceRoom: string): {
        routeCount: number;
        pathCount: number;
        totalLength: number;
        roomCount: number;
    } {
        const mem = this.getMemory(sourceRoom);
        
        let totalLength = 0;
        let pathCount = 0;
        const roomSet = new Set<string>();
        
        if (mem?.routes) {
            for (const targetRoom in mem.routes) {
                const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
                if (group.paths) {
                    for (const targetPos in group.paths) {
                        const pathData = group.paths[targetPos];
                        pathCount++;
                        totalLength += pathData!.length!;
                        for (const [roomName] of pathData!.path!) {
                            roomSet.add(roomName);
                        }
                    }
                }
            }
        }

        return {
            routeCount: mem?.routes ? Object.keys(mem.routes).length : 0,
            pathCount,
            totalLength,
            roomCount: roomSet.size,
        };
    },

    /**
     * 验证数据完整性
     * @param sourceRoom 源头房间名
     * @returns 验证结果
     */
    validate(sourceRoom: string): {
        valid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        const mem = this.getMemory(sourceRoom);

        if (!mem) {
            return { valid: true, errors: [] };
        }

        if (!mem.routes) {
            errors.push('routes 对象不存在');
            return { valid: false, errors };
        }

        for (const targetRoom in mem.routes) {
            const group = mem.routes[targetRoom] as OutMineRoadRouteGroup;
            
            if (!group.paths || typeof group.paths !== 'object') {
                errors.push(`${targetRoom}: paths 无效`);
                continue;
            }

            for (const targetPos in group.paths) {
                const pathData = group.paths[targetPos];
                
                if (!Array.isArray(pathData!.path!)) {
                    errors.push(`${targetRoom}/${targetPos}: path 数组无效`);
                    continue;
                }

                if (pathData!.length!== pathData!.path.length!) {
                    errors.push(`${targetRoom}/${targetPos}: length 不匹配`);
                }

                for (const [roomName, compressed] of pathData!.path!) {
                    const [x, y] = decompress(compressed);
                    if (x < 0 || x > 49 || y < 0 || y > 49) {
                        errors.push(`${targetRoom}/${targetPos}/${roomName}: 坐标越界 (${x},${y})`);
                    }
                }
            }
        }

        return { valid: errors.length === 0, errors };
    },
    /**
     * 获取道路内存
     */
    getMemory(sourceRoom: string): OutMineRoadMemory | undefined {
        return getOutMineData()?.[sourceRoom]?.RoadData;
    },

    /**
     * 确保内存结构存在
     */
    ensureMemory(sourceRoom: string): void {
        const outMineData = getOutMineData();
        if (!outMineData[sourceRoom]) outMineData[sourceRoom] = {} as any;
        if (!outMineData[sourceRoom]?.RoadData) {
            outMineData[sourceRoom]!.RoadData = {
                routes: {},
            };
        }
    },
};
