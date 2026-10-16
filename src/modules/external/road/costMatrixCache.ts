
/**
 * CostMatrix 缓存: 外矿道路寻路的房间代价矩阵缓存, 带 TTL 与增量更新。
 */

import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';

const OutMineRoadCache: { costMatrix: Record<string, any> } = { costMatrix: {} };

// ============================================================
// CostMatrix 缓存管理器
// ============================================================

/**
 * CostMatrix 缓存管理器
 * @description 提供带 TTL 的 CostMatrix 缓存管理，支持增量更新和自动清理
 */
export class CostMatrixCache {
    /**
     * 获取缓存的 CostMatrix
     * @param roomName 房间名
     * @returns CostMatrix 或 undefined（如果不存在或已过期）
     */
    static get(roomName: string): CostMatrix | undefined {
        this.ensureCache();
        const cache = OutMineRoadCache!.costMatrix[roomName];
        if (!cache) return undefined;
        if (this.isExpired(roomName)) {
            this.invalidate(roomName);
            return undefined;
        }
        return cache.matrix;
    }

    /**
     * 设置 CostMatrix 缓存
     * @param roomName 房间名
     * @param matrix CostMatrix 实例
     * @param ttl 过期时间（ticks），默认使用配置值
     */
    static set(roomName: string, matrix: CostMatrix, ttl?: number): void {
        this.ensureCache();
        OutMineRoadCache!.costMatrix[roomName] = {
            matrix,
            createdAt: Game.time,
            ttl: ttl ?? EXTERNAL_ROAD_CONFIG.COST_MATRIX_TTL,
        };
    }

    /**
     * 增量更新 CostMatrix 中的单个位置
     * @param roomName 房间名
     * @param x X 坐标
     * @param y Y 坐标
     * @param cost 代价值
     * @returns 是否更新成功（缓存存在时返回 true）
     */
    static updatePosition(roomName: string, x: number, y: number, cost: number): boolean {
        const matrix = this.get(roomName);
        if (!matrix) return false;
        matrix.set(x, y, cost);
        return true;
    }

    /**
     * 检查缓存是否过期
     * @param roomName 房间名
     * @returns 是否过期
     */
    static isExpired(roomName: string): boolean {
        this.ensureCache();
        const cache = OutMineRoadCache!.costMatrix[roomName];
        if (!cache) return true;
        return Game.time - cache.createdAt > cache.ttl;
    }

    /**
     * 清理所有过期缓存
     * @returns 清理的缓存数量
     */
    static cleanup(): number {
        this.ensureCache();
        let count = 0;
        const costMatrix = OutMineRoadCache!.costMatrix;
        for (const roomName in costMatrix) {
            if (this.isExpired(roomName)) {
                delete costMatrix[roomName];
                count++;
            }
        }
        return count;
    }

    /**
     * 使指定房间的缓存失效
     * @param roomName 房间名
     */
    static invalidate(roomName: string): void {
        this.ensureCache();
        delete OutMineRoadCache!.costMatrix[roomName];
    }

    /**
     * 清除所有缓存
     */
    static clear(): void {
        this.ensureCache();
        OutMineRoadCache!.costMatrix = {};
    }

    /**
     * 获取缓存统计信息
     * @returns 缓存统计
     */
    static getStats(): { total: number; expired: number; rooms: string[] } {
        this.ensureCache();
        const costMatrix = OutMineRoadCache!.costMatrix;
        const rooms = Object.keys(costMatrix);
        let expired = 0;
        for (const roomName of rooms) {
            if (this.isExpired(roomName)) expired++;
        }
        return { total: rooms.length, expired, rooms };
    }

    /**
     * 确保全局缓存对象存在
     */
    private static ensureCache(): void {
        // 缓存为模块级常量（OutMineRoadCache），无需懒初始化
    }
}
