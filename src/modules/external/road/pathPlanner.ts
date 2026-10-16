
/**
 * 外矿道路路径规划器: PathFinder 寻路封装, 支持道路复用与 CPU 保护。
 */

import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';
import { compress, decompress } from '@/utils/compress';
import { getLayoutData } from '@/core/store/accessor';
import { CostMatrixCache } from '@/modules/external/road/costMatrixCache';

export const PathPlanner = {
    /** 当前 tick 已计算的路径数 */
    pathsThisTick: 0,
    /** 上次重置的 tick */
    lastResetTick: 0,

    /**
     * 计算单个目标的路径
     * @param sourceRoom 源头房间名
     * @param target 目标位置
     * @returns 路径位置数组，或 undefined（如果计算失败或 CPU 不足）
     */
    planPath(sourceRoom: string, target: RoomPosition): RoomPosition[] | undefined {
        // CPU 保护检查
        if (!this.canPlanPath()) {
            return undefined;
        }

        const room = Game.rooms[sourceRoom];
        if (!room) return undefined;

        const startPos = room.getCenter();

        const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
            plainCost: EXTERNAL_ROAD_CONFIG.PLAIN_COST,
            swampCost: EXTERNAL_ROAD_CONFIG.SWAMP_COST,
            maxOps: EXTERNAL_ROAD_CONFIG.MAX_OPS,
            roomCallback: (roomName) => this.buildCostMatrix(roomName),
        });

        this.pathsThisTick++;

        if (result.incomplete) {
            return undefined;
        }

        return result.path;
    },

    /**
     * 批量计算多个目标的路径（按距离排序，复用已计算路径）
     * @param sourceRoom 源头房间名
     * @param targets 目标位置数组
     * @returns 路径结果映射 { targetKey: positions[] }，targetKey 格式为 "roomName:x:y"
     */
    planPaths(sourceRoom: string, targets: RoomPosition[]): Map<string, RoomPosition[]> {
        const results = new Map<string, RoomPosition[]>();
        
        if (targets.length === 0) return results;

        const room = Game.rooms[sourceRoom];
        if (!room) return results;

        const startPos = room.getCenter();

        // 按距离排序（近的先计算）
        const sortedTargets = [...targets].sort((a, b) => {
            const distA = Game.map.getRoomLinearDistance(sourceRoom, a.roomName);
            const distB = Game.map.getRoomLinearDistance(sourceRoom, b.roomName);
            return distA - distB;
        });

        const reusedRoadCoordsByRoom = new Map<string, Set<number>>();

        for (const target of sortedTargets) {
            // CPU 保护检查
            if (!this.canPlanPath()) {
                break;
            }

            const perSearchMatrixCache = new Map<string, CostMatrix | false>();
            const result = PathFinder.search(startPos, { pos: target, range: 1 }, {
                plainCost: EXTERNAL_ROAD_CONFIG.PLAIN_COST,
                swampCost: EXTERNAL_ROAD_CONFIG.SWAMP_COST,
                maxOps: EXTERNAL_ROAD_CONFIG.MAX_OPS,
                roomCallback: (roomName) => {
                    const cachedMatrix = perSearchMatrixCache.get(roomName);
                    if (cachedMatrix !== undefined) return cachedMatrix;

                    const baseMatrix = this.buildCostMatrix(roomName);
                    if (!baseMatrix) {
                        perSearchMatrixCache.set(roomName, false);
                        return false;
                    }

                    const matrix = baseMatrix.clone();
                    const reused = reusedRoadCoordsByRoom.get(roomName);
                    if (reused) {
                        for (const compressed of reused) {
                            const [x, y] = decompress(compressed);
                            matrix.set(x, y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                        }
                    }

                    perSearchMatrixCache.set(roomName, matrix);
                    return matrix;
                },
            });

            this.pathsThisTick++;

            if (!result.incomplete && result.path.length > 0) {
                // 使用 "roomName:x:y" 作为 key，确保同一房间的多个目标不会互相覆盖
                const targetKey = `${target.roomName}:${target.x}:${target.y}`;
                results.set(targetKey, result.path);

                // 将新路径加入已计算集合
                for (const pos of result.path) {
                    let roomCoords = reusedRoadCoordsByRoom.get(pos.roomName);
                    if (!roomCoords) {
                        roomCoords = new Set<number>();
                        reusedRoadCoordsByRoom.set(pos.roomName, roomCoords);
                    }
                    roomCoords.add(compress(pos.x, pos.y));
                    // 更新 CostMatrix 缓存
                    CostMatrixCache.updatePosition(pos.roomName, pos.x, pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                }
            }
        }

        return results;
    },

    /**
     * 构建房间的 CostMatrix
     * @param roomName 房间名
     * @returns CostMatrix 或 false（不可通行）
     */
    buildCostMatrix(roomName: string): CostMatrix | false {
        // 尝试从缓存获取
        const cached = CostMatrixCache.get(roomName);
        if (cached) return cached;

        const room = Game.rooms[roomName];
        const costs = new PathFinder.CostMatrix();

        // 将布局中的道路位置设置为 ROAD_COST
        const layoutData = getLayoutData()?.[roomName];
        if (layoutData) {
            for (const structType in layoutData) {
                const positions = layoutData[structType];
                if (!Array.isArray(positions) || positions.length === 0) continue;
                const isRoadLike = structType === STRUCTURE_ROAD || structType === STRUCTURE_CONTAINER || structType === STRUCTURE_RAMPART;
                const isObstacle = (OBSTACLE_OBJECT_TYPES as string[]).includes(structType) || structType === STRUCTURE_WALL;
                for (const compressed of positions) {
                    const [x, y] = decompress(compressed);
                    if (isRoadLike) {
                        costs.set(x, y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                    } else if (isObstacle) {
                        costs.set(x, y, 255);
                    }
                }
            }
        }

        if (room) {
            // 有视野的房间：添加建筑和 creep 代价
            const structures = room.find(FIND_STRUCTURES);
            for (const struct of structures) {
                if (struct.structureType === STRUCTURE_ROAD) {
                    costs.set(struct.pos.x, struct.pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                } else if (
                    struct.structureType !== STRUCTURE_CONTAINER &&
                    struct.structureType !== STRUCTURE_RAMPART
                ) {
                    // 不可通行建筑
                    costs.set(struct.pos.x, struct.pos.y, 255);
                } else if (
                    struct.structureType === STRUCTURE_RAMPART &&
                    !(struct as StructureRampart).my &&
                    !((struct as StructureRampart).isPublic)
                ) {
                    // 敌方 rampart
                    costs.set(struct.pos.x, struct.pos.y, 255);
                }
            }

            // 建造工地
            const sites = room.find(FIND_CONSTRUCTION_SITES);
            for (const site of sites) {
                if (site.structureType === STRUCTURE_ROAD) {
                    costs.set(site.pos.x, site.pos.y, EXTERNAL_ROAD_CONFIG.ROAD_COST);
                }
            }
        }

        // 缓存结果
        CostMatrixCache.set(roomName, costs);
        return costs;
    },

    /**
     * 检查是否可以继续计算路径（CPU 保护）
     * @returns 是否可以继续
     */
    canPlanPath(): boolean {
        // 重置计数器
        if (Game.time !== this.lastResetTick) {
            this.pathsThisTick = 0;
            this.lastResetTick = Game.time;
        }

        const maxPathsPerTick = EXTERNAL_ROAD_CONFIG.MAX_PATHS_PER_TICK;
        if (maxPathsPerTick && this.pathsThisTick >= maxPathsPerTick) return false;

        // 检查 CPU 使用率（基于 tickLimit）
        const cpuUsed = Game.cpu.getUsed();
        const cpuLimit = Game.cpu.tickLimit || 500;
        if (cpuUsed / cpuLimit > EXTERNAL_ROAD_CONFIG.CPU_THRESHOLD) {
            return false;
        }

        return true;
    },

    /**
     * 获取当前 tick 的路径计算统计
     */
    getStats(): { pathsThisTick: number; canPlan: boolean; cpuUsage: number } {
        const cpuLimit = Game.cpu.tickLimit || 500;
        return {
            pathsThisTick: this.pathsThisTick,
            canPlan: this.canPlanPath(),
            cpuUsage: Game.cpu.getUsed() / cpuLimit,
        };
    },

    /**
     * 重置路径计算计数器（用于测试）
     */
    reset(): void {
        this.pathsThisTick = 0;
        this.lastResetTick = Game.time;
    },
};
