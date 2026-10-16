
/**
 * 外矿道路可视化: 房间内路段着色、世界地图路线绘制与图例。
 */

import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';
import { RoomArray } from '@/utils/roomArray';
import { getOutMineData } from '@/core/store/accessor';
import { RoadMemory } from '@/modules/external/road/roadMemory';

export const RoadVisual = {
    /** 可视化颜色配置 */
    COLORS: {
        /** 计划道路（未建造） */
        PLANNED: '#ffff00',     // 黄色
        /** 已建道路 */
        BUILT: '#00ff00',       // 绿色
        /** 共享路段 */
        SHARED: '#00ffff',      // 青色
        /** 损坏道路 */
        DAMAGED: '#ff0000',     // 红色
        /** 建造工地 */
        SITE: '#ffa500',        // 橙色
    },

    /** 可视化开关状态 */
    enabled: {} as { [sourceRoom: string]: boolean },

    DRAW_INTERVAL: 1,
    MAP_DRAW_INTERVAL: 1,
    MAX_ROOM_POSITIONS_FOR_LINES: 220,

    lastDrawTickBySource: {} as { [sourceRoom: string]: number },
    lastMapDrawTickBySource: {} as { [sourceRoom: string]: number },

    perfTick: -1,
    perfDrawInterval: 1,
    perfMapDrawInterval: 1,
    perfAllowLines: true,
    perfEnabled: true,

    roomStateCache: {} as {
        [roomName: string]: {
            tick: number;
            roadsByXy: Map<string, StructureRoad>;
            roadSiteXy: Set<string>;
        };
    },

    /**
     * 可视化指定路线
     * @param sourceRoom 源头房间名
     * @param targetRoom 目标房间名
     */
    visualize(sourceRoom: string, targetRoom: string, allowLines = true): void {
        const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
        if (positions.length === 0) return;

        this.drawPositions(positions, sourceRoom, undefined, allowLines);
    },

    /**
     * 可视化所有路线
     * @param sourceRoom 源头房间名
     */
    visualizeAll(sourceRoom: string, allowLines = true): void {
        const targets = RoadMemory.getRouteTargets(sourceRoom);
        if (targets.length === 0) return;

        const sharedCount: { [key: string]: number } = {};
        const byRoom: { [roomName: string]: RoomPosition[] } = {};
        const seenByRoom: { [roomName: string]: Set<string> } = {};

        for (const targetRoom of targets) {
            const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
            if (positions.length === 0) continue;

            for (const pos of positions) {
                const sharedKey = `${pos.roomName}:${pos.x}:${pos.y}`;
                sharedCount[sharedKey] = (sharedCount[sharedKey] || 0) + 1;

                if (!byRoom[pos.roomName]) byRoom[pos.roomName] = [];
                const seenSet = (seenByRoom[pos.roomName] ??= new Set());
                const xyKey = `${pos.x}:${pos.y}`;
                if (seenSet.has(xyKey)) continue;
                seenSet.add(xyKey);
                (byRoom[pos.roomName] ??= []).push(pos);
            }
        }

        for (const roomName in byRoom) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            this.drawRoomPositions(room, byRoom[roomName] ?? [], sharedCount, allowLines);
        }
    },

    drawPositions(
        positions: RoomPosition[],
        sourceRoom: string,
        sharedCount?: { [key: string]: number },
        allowLines = true
    ): void {
        const byRoom: { [roomName: string]: RoomPosition[] } = {};
        const seenByRoom: { [roomName: string]: Set<string> } = {};

        for (const pos of positions) {
            if (!byRoom[pos.roomName]) byRoom[pos.roomName] = [];
            const seenSet = (seenByRoom[pos.roomName] ??= new Set());
            const xyKey = `${pos.x}:${pos.y}`;
            if (seenSet.has(xyKey)) continue;
            seenSet.add(xyKey);
            (byRoom[pos.roomName] ??= []).push(pos);
        }

        for (const roomName in byRoom) {
            const room = Game.rooms[roomName];
            if (!room) continue;
            this.drawRoomPositions(room, byRoom[roomName] ?? [], sharedCount, allowLines);
        }
    },

    drawRoomPositions(
        room: Room,
        roomPositions: RoomPosition[],
        sharedCount?: { [key: string]: number },
        allowLines = true
    ): void {
        const visual = room.visual;
        const roadIndex = new RoomArray().init();
        for (const pos of roomPositions) roadIndex.set(pos.x, pos.y, 'road');

        const cache = this.roomStateCache[room.name];
        const state =
            cache && cache.tick === Game.time
                ? cache
                : (() => {
                      const roadsByXy = new Map<string, StructureRoad>();
                      const roads = room.find(FIND_STRUCTURES, {
                          filter: (s) => s.structureType === STRUCTURE_ROAD
                      }) as StructureRoad[];
                      for (const road of roads) {
                          const xyKey = `${road.pos.x}:${road.pos.y}`;
                          roadsByXy.set(xyKey, road);
                      }

                      const roadSiteXy = new Set<string>();
                      const roadSites = room.find(FIND_CONSTRUCTION_SITES, {
                          filter: (s) => s.structureType === STRUCTURE_ROAD
                      });
                      for (const site of roadSites) {
                          const xyKey = `${site.pos.x}:${site.pos.y}`;
                          roadSiteXy.add(xyKey);
                      }

                      const next = { tick: Game.time, roadsByXy, roadSiteXy };
                      this.roomStateCache[room.name] = next;
                      return next;
                  })();

        const colorByXy = new Map<string, string>();
        const priorityByXy = new Map<string, number>();

        for (const pos of roomPositions) {
            const sharedKey = `${pos.roomName}:${pos.x}:${pos.y}`;
            const isShared = !!sharedCount && sharedCount[sharedKey]! > 1;

            const xyKey = `${pos.x}:${pos.y}`;
            const road = state.roadsByXy.get(xyKey);
            const hasSite = state.roadSiteXy.has(xyKey);

            let color: string;
            let priority: number;

            if (road) {
                if (road.hits < road.hitsMax * EXTERNAL_ROAD_CONFIG.REPAIR_THRESHOLD) {
                    color = this.COLORS.DAMAGED;
                    priority = 5;
                } else if (isShared) {
                    color = this.COLORS.SHARED;
                    priority = 2;
                } else {
                    color = this.COLORS.BUILT;
                    priority = 1;
                }
            } else if (hasSite) {
                color = this.COLORS.SITE;
                priority = 3;
            } else {
                color = this.COLORS.PLANNED;
                priority = 4;
            }

            colorByXy.set(xyKey, color);
            priorityByXy.set(xyKey, priority);

            visual.text('•', pos.x, pos.y + 0.25, {
                color,
                opacity: 0.75,
                font: 0.7
            });
        }

        if (!allowLines || roomPositions.length <= 1 || roomPositions.length > this.MAX_ROOM_POSITIONS_FOR_LINES) return;

        for (const pos of roomPositions) {
            roadIndex.forNear((x: number, y: number, val: number | string) => {
                if (val !== 'road') return;
                if ((pos.x >= x && pos.y >= y) || (pos.x > x && pos.y < y)) {
                    const fromKey = `${pos.x}:${pos.y}`;
                    const toKey = `${x}:${y}`;
                    const fromPriority = priorityByXy.get(fromKey) ?? 0;
                    const toPriority = priorityByXy.get(toKey) ?? 0;
                    const useKey = fromPriority >= toPriority ? fromKey : toKey;
                    const color = colorByXy.get(useKey) ?? '#ffffff';
                    visual.line(x, y, pos.x, pos.y, { color });
                }
            }, pos.x, pos.y);
        }
    },



    /**
     * 启用可视化
     * @param sourceRoom 源头房间名
     */
    enable(sourceRoom: string): void {
        this.enabled[sourceRoom] = true;
    },

    /**
     * 禁用可视化
     * @param sourceRoom 源头房间名
     */
    disable(sourceRoom: string): void {
        this.enabled[sourceRoom] = false;
    },

    /**
     * 切换可视化状态
     * @param sourceRoom 源头房间名
     * @returns 新状态
     */
    toggle(sourceRoom: string): boolean {
        this.enabled[sourceRoom] = !this.enabled[sourceRoom];
        return this.enabled[sourceRoom];
    },

    /**
     * 检查是否启用可视化
     * @param sourceRoom 源头房间名
     * @returns 是否启用
     */
    isEnabled(sourceRoom: string): boolean {
        return this.enabled[sourceRoom] || false;
    },

    /**
     * 运行可视化（每 tick 调用）
     * @description 检查 Flag 触发和启用状态，自动绘制房间内和世界地图可视化
     */
    run(): void {
        this.refreshPerfProfile();
        if (!this.perfEnabled) return;
        const sourceRoomsToDraw = new Set<string>();

        if (Game.flags['ALL/roadVisual']) {
            const outMineData = getOutMineData();
            for (const sourceRoom in outMineData) {
                const data = outMineData[sourceRoom];
                if ((data!.energy! && data!.energy.length! > 0) || (data!.centerRoom! && data!.centerRoom.length! > 0)) {
                    sourceRoomsToDraw.add(sourceRoom);
                }
            }
        }

        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/roadVisual$/);
            if (match) sourceRoomsToDraw.add(match[1]!);
        }

        // 检查启用状态
        for (const sourceRoom in this.enabled) {
            if (this.enabled[sourceRoom]) sourceRoomsToDraw.add(sourceRoom);
        }

        const drawInterval = this.perfDrawInterval;
        const mapInterval = this.perfMapDrawInterval;
        const allowLines = this.perfAllowLines;

        for (const sourceRoom of sourceRoomsToDraw) {
            const lastDraw = this.lastDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastDraw >= drawInterval) {
                this.lastDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeAll(sourceRoom, allowLines);
            }

            const lastMap = this.lastMapDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastMap >= mapInterval) {
                this.lastMapDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeOnMap(sourceRoom);
            }
        }
    },

    refreshPerfProfile(): void {
        if (this.perfTick === Game.time) return;
        this.perfTick = Game.time;

        const qosLevel =
            (globalThis as any).qos?.getQoS?.()?.level ||
            (globalThis as any).QoS?.level ||
            'normal';
        const bucket = Number(Game.cpu.bucket || 0);
        if (qosLevel === 'emergency' || bucket < 1000) {
            this.perfEnabled = false;
            return;
        }

        this.perfEnabled = true;
        const constrained = qosLevel === 'constrained' || bucket < 5000;
        this.perfDrawInterval = constrained ? Math.max(5, this.DRAW_INTERVAL) : this.DRAW_INTERVAL;
        this.perfMapDrawInterval = constrained ? Math.max(5, this.MAP_DRAW_INTERVAL) : this.MAP_DRAW_INTERVAL;
        this.perfAllowLines = !constrained && bucket >= 5000;
    },

    /**
     * 绘制图例
     * @param roomName 房间名
     */
    drawLegend(roomName: string): void {
        const room = Game.rooms[roomName];
        if (!room) return;

        const visual = room.visual;
        const startX = 1;
        const startY = 1;
        const spacing = 1.5;

        const legends = [
            { color: this.COLORS.PLANNED, label: '计划' },
            { color: this.COLORS.BUILT, label: '已建' },
            { color: this.COLORS.SHARED, label: '共享' },
            { color: this.COLORS.DAMAGED, label: '损坏' },
            { color: this.COLORS.SITE, label: '工地' },
        ];

        for (let i = 0; i < legends.length; i++) {
            const { color, label } = legends[i]!;
            const y = startY + i * spacing;
            
            visual.circle(startX, y, {
                radius: 0.3,
                fill: color,
                opacity: 0.8,
            });
            
            visual.text(label, startX + 0.8, y + 0.2, {
                color: '#ffffff',
                font: 0.6,
                align: 'left',
            });
        }
    },

    /** 世界地图可视化颜色 */
    MAP_COLORS: [
        '#ff6b6b',  // 红
        '#4ecdc4',  // 青
        '#45b7d1',  // 蓝
        '#96ceb4',  // 绿
        '#ffeaa7',  // 黄
        '#dfe6e9',  // 灰白
        '#fd79a8',  // 粉
        '#a29bfe',  // 紫
        '#00b894',  // 深绿
        '#e17055',  // 橙
    ],

    /**
     * 在世界地图上可视化道路路径
     * @param sourceRoom 源头房间名
     * @param targetRoom 可选，指定目标房间
     */
    visualizeOnMap(sourceRoom: string, targetRoom?: string): void {
        const targets = targetRoom ? [targetRoom] : RoadMemory.getRouteTargets(sourceRoom);
        
        if (targets.length === 0) {
            return;
        }

        let colorIndex = 0;
        for (const target of targets) {
            const paths = RoadMemory.getAllPaths(sourceRoom, target);
            
            if (paths.size === 0) continue;

            // 同一目标房间使用相同颜色
            const color = this.MAP_COLORS[colorIndex % this.MAP_COLORS.length];
            colorIndex++;

            for (const [, positions] of paths) {
                if (positions.length < 2) continue;

                // 路径已经是按顺序存储的，直接绘制
                this.drawMapPath(positions, color!);

                // 在终点标注
                const endpoint = positions[positions.length - 1];
                Game.map.visual.circle(endpoint!, {
                    radius: 1.2,
                    fill: color,
                    opacity: 0.8,
                    stroke: '#ffffff',
                    strokeWidth: 0.3,
                });
            }
        }
    },

    /**
     * 在世界地图上绘制路径
     * @param positions 位置数组（应已按路径顺序排序）
     * @param color 线条颜色
     */
    drawMapPath(positions: RoomPosition[], color: string): void {
        if (positions.length < 2) return;

        const validPath = positions.map((p: any) => (p instanceof RoomPosition ? p : new RoomPosition(p.x, p.y, p.roomName)));

        // 使用 poly() API 绘制整条路径，获得连续的线条效果
        Game.map.visual.poly(validPath, {
            stroke: color,
            strokeWidth: 0.7,
            opacity: 0.7,
            lineStyle: 'solid',
        });

        // 在起点绘制标记
        const start = validPath[0];
        Game.map.visual.circle(start!, {
            radius: 1,
            fill: color,
            opacity: 0.6,
        });
    },
};

/**
 * 外矿搬运路程的道路覆盖率：已建路格 / 规划路格（仅有视野房间计入）。
 *
 * 覆盖率判据：覆盖率 >= 1/3（`constructedDistance / totalDistance >= 1/3`）
 * 视为 `enoughRoad`，搬运工孵化才切换 2:1 路面体型；无路由数据或无视野时返回 0（保持 1:1 越野体）。
 */
export function getBuiltRoadCoverage(sourceRoom: string): number {
    let built = 0;
    let total = 0;
    for (const targetRoom of RoadMemory.getRouteTargets(sourceRoom)) {
        for (const pos of RoadMemory.getGroupPositions(sourceRoom, targetRoom)) {
            const room = Game.rooms[pos.roomName];
            if (!room) continue;
            total += 1;
            const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y) as Structure[];
            if (structures.some(s => s.structureType === STRUCTURE_ROAD)) built += 1;
        }
    }
    return total > 0 ? built / total : 0;
}
