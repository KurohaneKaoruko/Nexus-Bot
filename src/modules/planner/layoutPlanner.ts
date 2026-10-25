// @ts-nocheck
/*
 * 布局计算与落盘核心（组合壳）:
 * - 静态布局: 模板平移 + rampart 外环 + 采集基建 (source/mineral/controller 容器、link、道路) + link 建造排序;
 * - 动态布局 (auto): rosPlanner 分块规划, spawn 锚定限幅降级阶梯, 全败退无锚兜底;
 * - plannerCreateSite: 按布局 + RCL 结构上限逐级放工地 (自动建造的消费口);
 * - 缓存: 50t TTL 三级缓存 (参数精确 key / 动态最近一次 / 动态输入签名)。
 * 持久化经 memory.ts 适配层写 Memory.Nexus.layout; 结构快查用 room.find, 不依赖原型扩展。
 * 具体实现按域拆分至 layout/ 子模块: types/layoutCache/roomContext/staticLayout/sitePlacement/compute。
 */
import { compress } from '@/utils/compress';
import { submitIntent } from '@/runtime/intentQueue';
import { rosPlanner } from './rosPlanner';
import { autoPlanner63 } from './dynamic/63Planner';
import LayoutVisual from './layoutVisual';
import {
	ensureLayoutRecord,
	writeLayoutData,
	plannerLog as log,
} from './memory';
import { cpuNow, cpuDelta, cpuFmt, roomLevel, resolveCenter } from './layout/roomContext';
import { computeStatic, computeDynamic, removeStaleSites } from './layout/compute';
import { plannerCreateSite } from './layout/sitePlacement';
import type { XY } from './layout/types';
export { plannerCreateSite } from './layout/sitePlacement';
export { computeStatic, computeDynamic } from './layout/compute';
export { CACHE_TTL } from './layout/layoutCache';
export type { XY, LayoutMemoryMap, LayoutStructMap, CachedLayout, LayoutCenter } from './layout/types';
/**
 * LayoutPlanner：静态/动态布局的统一入口。
 * - build*：计算布局并写入 Memory.Nexus.layout，供自动建造流程消费
 * - plannerCreateSite：按布局 + RCL 结构上限逐级放工地
 * @public
 */
export const LayoutPlanner = {
    /**
     * 根据 layoutMemory 在房间内创建工地。
     * @param room 目标房间
     * @param layoutMemory 压缩布局数据 (structType → 压缩坐标数组)
     * @param options 可选：只创建某一种结构、限制最大工地数量
     * @returns 本次创建的工地数量（不是 Screeps 错误码）
     */
    plannerCreateSite,

    /**
     * 静态布局构建：写入布局记录并清理旧布局残留工地。
     * @param roomName 房间名
     * @param layoutType 静态模板名
     * @returns Screeps 错误码：OK/ERR_INVALID_ARGS/ERR_NOT_FOUND
     */
    buildStatic(roomName: string, layoutType: string, opts?: { quiet?: boolean }): number {
        const center = resolveCenter(roomName);
        if (!center) {
            log(`静态布局构建失败: ${roomName} 缺少中心点(布局 center 或 storagePos/centerPos 旗帜)`);
            return ERR_INVALID_ARGS;
        }
        const totalStart = cpuNow();
        const computeStart = cpuNow();
        const computed = computeStatic(roomName, layoutType, center);
        const computeCpu = cpuDelta(computeStart);
        if (!computed) return ERR_NOT_FOUND;
        const writeStart = cpuNow();
        const record = ensureLayoutRecord(roomName);
        const previousData = record.data;
        writeLayoutData(record, layoutType as any, computed.center, computed.layoutMemory);
        removeStaleSites(roomName, computed, previousData);
        const writeCpu = cpuDelta(writeStart);
        const totalCpu = cpuDelta(totalStart);
        if (!opts?.quiet) {
            log(`静态布局构建成功: ${roomName} layout=${layoutType} center(${center.x},${center.y}) computeCpu=${cpuFmt(computeCpu)} writeCpu=${cpuFmt(writeCpu)} totalCpu=${cpuFmt(totalCpu)}`);
        }
        return OK;
    },
    /**
     * 动态布局(auto)构建：写入布局记录并清理旧布局残留工地。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    buildDynamic(roomName: string, opts?: { quiet?: boolean }): number {
        const totalStart = cpuNow();
        const computeStart = cpuNow();
        const computed = computeDynamic(roomName, 'auto');
        const computeCpu = cpuDelta(computeStart);
        if (!computed) return ERR_NOT_FOUND;
        const writeStart = cpuNow();
        const record = ensureLayoutRecord(roomName);
        const previousData = record.data;
        writeLayoutData(record, 'auto', computed.center, computed.layoutMemory);
        removeStaleSites(roomName, computed, previousData);
        const writeCpu = cpuDelta(writeStart);
        const totalCpu = cpuDelta(totalStart);
        if (!opts?.quiet) {
            log(`动态布局构建成功: ${roomName} layout=auto center(${computed.center.x},${computed.center.y}) computeCpu=${cpuFmt(computeCpu)} writeCpu=${cpuFmt(writeCpu)} totalCpu=${cpuFmt(totalCpu)}`);
        }
        return OK;
    },
    /**
     * 动态布局(63auto)构建：写入布局记录并清理旧布局残留工地。
     * @param roomName 房间名
     * @returns Screeps 错误码：OK/ERR_NOT_FOUND
     */
    buildDynamic63(roomName: string, opts?: { quiet?: boolean }): number {
        const totalStart = cpuNow();
        const computeStart = cpuNow();
        const computed = computeDynamic(roomName, '63auto');
        const computeCpu = cpuDelta(computeStart);
        if (!computed) return ERR_NOT_FOUND;
        const writeStart = cpuNow();
        const record = ensureLayoutRecord(roomName);
        const previousData = record.data;
        writeLayoutData(record, '63auto' as any, computed.center, computed.layoutMemory);
        removeStaleSites(roomName, computed, previousData);
        const writeCpu = cpuDelta(writeStart);
        const totalCpu = cpuDelta(totalStart);
        if (!opts?.quiet) {
            log(`动态布局构建成功: ${roomName} layout=63auto center(${computed.center.x},${computed.center.y}) computeCpu=${cpuFmt(computeCpu)} writeCpu=${cpuFmt(writeCpu)} totalCpu=${cpuFmt(totalCpu)}`);
        }
        return OK;
    },
    /**
     * 静态布局可视化（不落盘）。
     */
    visualStatic(roomName: string, layoutType: string): number {
        const center = resolveCenter(roomName);
        if (!center) {
            log(`静态布局可视化失败: ${roomName} 缺少中心点(布局 center 或 storagePos/centerPos 旗帜)`);
            return ERR_INVALID_ARGS;
        }
        const computed = computeStatic(roomName, layoutType, center);
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap as any);
        log(`静态布局可视化成功: ${roomName} layout=${layoutType} center(${center.x},${center.y})`);
        return OK;
    },
    /**
     * 动态布局(auto/63auto)可视化（不落盘）。
     */
    visualDynamic(roomName: string): number {
        const computed = computeDynamic(roomName, 'auto');
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap as any);
        log(`动态布局可视化成功: ${roomName} layout=auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },
    visualDynamic63(roomName: string): number {
        const computed = computeDynamic(roomName, '63auto');
        if (!computed) return ERR_NOT_FOUND;
        LayoutVisual.showRoomStructures(roomName, computed.structMap as any);
        log(`动态布局可视化成功: ${roomName} layout=63auto center(${computed.center.x},${computed.center.y})`);
        return OK;
    },
    /**
     * 动态布局可视化（pa/pb/pc/pm 旗帜输入, 不落盘不缓存）。
     */
    visualDynamicByFlags(): number {
        return visualByFlags('auto');
    },
    visualDynamic63ByFlags(): number {
        return visualByFlags('63auto');
    },
    /**
     * 迷你房布局构建（mini 模式）: spawn 锚点最小据点, 塔优先贴控制器一侧, RCL6+ 补 terminal。
     */
    buildMini(roomName: string, opts?: { quiet?: boolean }): number {
        const room = Game.rooms[roomName];
        if (!room) return ERR_NOT_FOUND;
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn) return ERR_NOT_FOUND;

        const candidates: Array<{ x: number; y: number; d: number }> = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) continue;
                if (room.lookForAt(LOOK_STRUCTURES, x, y).some(s => s.structureType !== STRUCTURE_ROAD)) continue;
                if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
                const pos = new RoomPosition(x, y, room.name);
                const d = room.controller ? pos.getRangeTo(room.controller.pos) : 99;
                candidates.push({ x, y, d });
            }
        }
        candidates.sort((a, b) => a.d - b.d);

        const level = roomLevel(room);
        const towerQuota = (CONTROLLER_STRUCTURES as any)?.[STRUCTURE_TOWER]?.[level] ?? 0;
        const towers: XY[] = candidates.slice(0, Math.max(0, towerQuota)).map(c => [c.x, c.y] as XY);
        const used = new Set(towers.map(t => `${t[0]}:${t[1]}`));
        const terminal: XY[] = [];
        if (level >= 6) {
            const spot = candidates.find(c => !used.has(`${c.x}:${c.y}`));
            if (spot) terminal.push([spot.x, spot.y] as XY);
        }

        const layoutMemory: Record<string, number[]> = {};
        if (towers.length) layoutMemory[STRUCTURE_TOWER] = towers.map(([x, y]) => compress(x, y));
        if (terminal.length) layoutMemory[STRUCTURE_TERMINAL] = terminal.map(([x, y]) => compress(x, y));
        const record = ensureLayoutRecord(roomName);
        writeLayoutData(record, 'mini' as any, { x: spawn.pos.x, y: spawn.pos.y }, layoutMemory as any);
        if (!opts?.quiet) {
            log(`迷你房布局构建成功: ${roomName} towers=${towers.length}/${towerQuota} terminal=${terminal.length}（ext 由特殊冲级优先落位负责）`);
        }
        return OK;
    },
};

/**
 * 旗帜输入的动态布局可视化骨架 (pa/pb/pc/pm 四旗指定枢纽点, 不落盘不缓存)。
 */
function visualByFlags(layoutType: 'auto' | '63auto'): number {
    if (Game.cpu.bucket < 100) {
        log(`动态布局可视化失败: CPU bucket 不足 bucket=${Game.cpu.bucket}`);
        return ERR_TIRED;
    }
    const pa = Game.flags.pa?.pos;
    const pb = Game.flags.pb?.pos;
    const pc = Game.flags.pc?.pos;
    const pm = Game.flags.pm?.pos;
    if (!pa || !pb || !pc || !pm) {
        log(`动态布局可视化失败: 缺少 pa/pb/pc/pm 旗帜`);
        return ERR_INVALID_ARGS;
    }
    if (pa.roomName != pb.roomName || pa.roomName != pc.roomName || pa.roomName != pm.roomName) {
        log(`动态布局可视化失败: pa/pb/pc/pm 不在同一房间`);
        return ERR_INVALID_ARGS;
    }
    const roomName = pa.roomName;

    const storagePos = Game.flags.storagePos || Game.flags.centerPos;
    if (storagePos && storagePos.pos.roomName !== roomName) {
        submitIntent(Game.time, {
            actorName: roomName,
            kind: 'removeFlag',
            pipeline: 'flag',
            priority: 30,
            payload: { flagName: storagePos.name },
            dedupeKey: `layout-storageflag-remove:${storagePos.name}`,
        });
    }

    const planner = layoutType === '63auto' ? autoPlanner63 : rosPlanner;
    const computeManor = planner.ManagerPlanner.computeManor;
    const roomStructsData = computeManor(roomName, [pc, pm, pa, pb]);
    if (!roomStructsData) {
        log(`动态布局可视化失败: planner 返回空 room=${roomName} layout=${layoutType}(flags)`);
        return ERR_NOT_FOUND;
    }
    LayoutVisual.showRoomStructures(roomName, roomStructsData.structMap);
    log(`动态布局可视化成功: ${roomName} layout=${layoutType}(flags)`);
    return OK;
}

export default LayoutPlanner;
