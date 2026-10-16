
/**
 * 外矿道路建造器: 道路与容器工地的创建、选址与重算。
 */

import { EXTERNAL_ROAD_CONFIG } from '@/constant/BaseConstant';
import { getLayoutData } from '@/core/store/accessor';
import { CostMatrixCache } from '@/modules/external/road/costMatrixCache';
import { RoadMemory } from '@/modules/external/road/roadMemory';
import { PathPlanner } from '@/modules/external/road/pathPlanner';

const hasLayoutMemory = (roomName: string): boolean => {
    const layout = getLayoutData();
    const roomLayout = layout?.[roomName];
    if (!roomLayout) return false;
    return Object.keys(roomLayout).length > 0;
};

export const RoadBuilder = {
    /**
     * 解析目标房间的外矿基础设施路径。
     * @description
     * - 优先复用已缓存的路径，避免重复寻路。
     * - 若还没有路径内存，则按 source/mineral 重新规划并写回内存。
     */
    resolveInfrastructurePaths(sourceRoomName: string, targetRoom: Room): Map<string, RoomPosition[]> {
        const targetRoomName = targetRoom.name;

        // 检查是否已有路线数据。
        const existingPaths = RoadMemory.getAllPaths(sourceRoomName, targetRoomName);
        if (existingPaths.size > 0) return existingPaths;

        if (!hasLayoutMemory(sourceRoomName)) return new Map<string, RoomPosition[]>();

        // 没有缓存时才重新规划路径。
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return new Map<string, RoomPosition[]>();

        const pathResults = PathPlanner.planPaths(sourceRoomName, targets);
        if (pathResults.size === 0) return new Map<string, RoomPosition[]>();

        // PathPlanner 输出 key 为 "roomName:x:y"，这里统一压缩回内存使用的 "x:y"。
        const pathsToSave = new Map<string, RoomPosition[]>();
        for (const [targetKey, positions] of pathResults) {
            const parts = targetKey.split(':');
            const posKey = `${parts[1]}:${parts[2]}`;
            pathsToSave.set(posKey, positions);
        }

        if (pathsToSave.size === 0) return new Map<string, RoomPosition[]>();

        RoadMemory.setPaths(sourceRoomName, targetRoomName, pathsToSave);
        return pathsToSave;
    },

    /**
     * 仅为目标房间补齐外矿 container 工地。
     * @description
     * container 不应该受道路 RCL 门槛影响，因此单独暴露一个轻量入口：
     * - 允许在低等级外矿阶段先把 container 工地落下；
     * - road 仍然由 `createRoadSites` 按等级与间隔控制。
     */
    ensureContainerSites(sourceRoom: Room, targetRoom: Room): number {
        const pathsToUse = this.resolveInfrastructurePaths(sourceRoom.name, targetRoom);
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToUse);
        return this.createContainerSites(targetRoom, containerAnchors);
    },

    /**
     * 控制器容器保活：
     * - RCL2-4 专用窗口：该阶段升级链完全依赖容器补给；RCL5 起 controller link
     *   接管供能，仅在控制器 3 格内无 link 时兜底保活（容器烂掉 → 静态升级工
     *   失去补给点、搬运工失去直供目标）。
     * - 选址评分 = 相邻可升级站位数×4 − 距 spawn 距离（参考口径）：
     *   站位 = 邻格内非墙、无结构/工地（road 不可站）、仍在控制器 range 3 的格子，
     *   保证静态升级工有驻位；次选靠近 spawn 缩短搬运。
     * - 幂等：控制器 3 格内已有容器或同类型工地则跳过。
     */
    ensureControllerContainer(sourceRoom: Room): void {
        const controller = sourceRoom.controller;
        if (!controller?.my) return;
        const rcl = controller.level;
        if (rcl < 2) return;
        // 无源房短路（能力闸）：cc 服务升级线的能量补给，无产出源的房间不需要
        if (!(sourceRoom.source || []).length) return;

        // 容器/工地判定走实时 find（不用 room.container 缓存）：工地建成瞬间缓存未刷新，
        // 读缓存会误判「无容器」而重复放量
        const existingContainers = sourceRoom.find(FIND_STRUCTURES, {
            filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, 3),
        }) as StructureContainer[];
        const sites = sourceRoom.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.pos.inRangeTo(controller.pos, 3),
        });

        // cc 圈生命周期唯一入口：选址 → 放量 → 纠偏 → 退役全在此收口，
        // 不与其他机制交叉管控（多机制各删各的会形成建→删→再建循环）

        // 链接期退役：升级供给已切 link，容器/工地清场收尾
        if (rcl >= 5 && (sourceRoom.link || []).some(l => l.pos.inRangeTo(controller.pos, 3))) {
            for (const container of existingContainers) container.destroy();
            for (const site of sites) site.remove();
            return;
        }

        // 已建成容器直接收编（唯一 cc 口径，低耐久走维修既有链路）。
        // 不挑位置——建成容器是既得产能，拆了重建是纯浪费；距离口径只约束「新放置」。
        // 容器既成，圈内工地皆过时残留，一并清掉
        if (existingContainers.length > 0) {
            for (const site of sites) site.remove();
            return;
        }

        const terrain = sourceRoom.getTerrain();
        const spawn = (sourceRoom.spawn || [])[0];
        const occupied = new Set<string>();
        for (const s of sourceRoom.find(FIND_STRUCTURES)) occupied.add(s.pos.x + ',' + s.pos.y);
        for (const s of sourceRoom.find(FIND_CONSTRUCTION_SITES)) occupied.add(s.pos.x + ',' + s.pos.y);
        // 选址距离口径：与 controller 隔开一格（切比雪夫距离 2）——贴脸放会占掉一个围位，
        // 隔一格时容器 8 邻全空，升级工最多围 8 个，剩余口子留给搬运工填充
        const inCtrl2Ring = (x: number, y: number): boolean =>
            Math.max(Math.abs(x - controller.pos.x), Math.abs(y - controller.pos.y)) === 2;
        const standable = (x: number, y: number): boolean =>
            x >= 1 && x <= 48 && y >= 1 && y <= 48
            && !occupied.has(x + ',' + y)
            && terrain.get(x, y) !== TERRAIN_MASK_WALL;
        // 选址评分 = 相邻可升级站位数×4 − 距 spawn 距离（与放置共用一套口径）
        const spotScore = (x: number, y: number): number => {
            let open = 0;
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    if (ox === 0 && oy === 0) continue;
                    if (standable(x + ox, y + oy)) open++;
                }
            }
            return open * 4 - (spawn ? Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y)) : 0);
        };

        // 选址只算一次并持久化：后续一律在既定坐标下单（无既定坐标或已不可用才重算），
        // 避免周期性重选址让工地位置漂移
        const memAny = sourceRoom.memory as any;
        let coord = memAny.controllerContainerCoord as { x: number; y: number } | undefined;
        const coordUsable = coord &&
            coord.x >= 1 && coord.x <= 48 && coord.y >= 1 && coord.y <= 48 &&
            terrain.get(coord.x, coord.y) !== TERRAIN_MASK_WALL && inCtrl2Ring(coord.x, coord.y);
        if (!coordUsable) {
            let best: { x: number; y: number; score: number } | null = null;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
                    const x = controller.pos.x + dx;
                    const y = controller.pos.y + dy;
                    if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                    if (occupied.has(x + ',' + y)) continue;
                    const score = spotScore(x, y);
                    if (!best || score > best.score) best = { x, y, score };
                }
            }
            if (!best) return;
            coord = { x: best.x, y: best.y };
            memAny.controllerContainerCoord = coord;
        }

        // 工地唯一口径：既定坐标上的工地保留，错位残留清除；既定坐标无工地才放量。
        // 此后每周期都会因「已有容器/已有既定坐标工地」短路，无反复放量空间
        const atCoord = sites.find(s => s.pos.x === coord!.x! && s.pos.y === coord!.y!);
        for (const site of sites) {
            if (site !== atCoord) site.remove();
        }
        if (!atCoord) sourceRoom.createConstructionSite(coord!.x!, coord!.y!, STRUCTURE_CONTAINER);
    },

    /**
     * 为目标房间创建道路建造工地
     * @param sourceRoom 源头房间
     * @param targetRoom 目标房间
     * @returns 创建的工地数量
     */
    createRoadSites(sourceRoom: Room, targetRoom: Room): number {
        const sourceRoomName = sourceRoom.name;
        const pathsToUse = this.resolveInfrastructurePaths(sourceRoomName, targetRoom);

        // 外矿基础设施统一由 externalRoad 模块管理：
        // 道路工地与 source/mineral 的 container 工地都在这里集中创建，
        // 避免再由外矿采集/挖矿在运行时临时落地工地。
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToUse);
        if (pathsToUse.size === 0) {
            // 路径完全失败时无法铺 road，但 container 仍可退化到“资源点邻接保底落点”。
            return this.createContainerSites(targetRoom, containerAnchors);
        }
        const roadSiteCount = this.createSitesFromPaths(
            sourceRoomName,
            pathsToUse,
            new Set(Array.from(containerAnchors.values()).map((pos) => `${pos.roomName}:${pos.x}:${pos.y}`))
        );
        const containerSiteCount = this.createContainerSites(targetRoom, containerAnchors);
        return roadSiteCount + containerSiteCount;
    },

    /**
     * 从多条路径创建建造工地
     * @param sourceRoomName 源头房间名
     * @param paths 路径映射
     * @returns 创建的工地数量
     */
    createSitesFromPaths(
        _sourceRoomName: string,
        paths: Map<string, RoomPosition[]>,
        skipPositions?: Set<string>
    ): number {
        let created = 0;
        const processedPositions = new Set<string>();

        for (const [, positions] of paths) {
            for (const pos of positions) {
                // 限制单路线最大工地数
                if (created >= EXTERNAL_ROAD_CONFIG.MAX_SITES_PER_ROUTE) break;

                // 跳过已处理的位置（去重）
                const posKey = `${pos.roomName}:${pos.x}:${pos.y}`;
                if (processedPositions.has(posKey)) continue;
                processedPositions.add(posKey);
                if (skipPositions?.has(posKey)) continue;

                // 跳过房间边缘位置
                if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) continue;

                // 检查是否已有道路或工地
                const room = Game.rooms[pos.roomName];
                // 没有视野的房间无法创建建造工地，跳过
                if (!room) continue;

                const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
                if (hasRoad) continue;

                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
                const hasSite = sites.some(s => s.structureType === STRUCTURE_ROAD);
                if (hasSite) continue;

                const result = pos.createConstructionSite(STRUCTURE_ROAD);
                if (result === OK) {
                    created++;
                }
            }
        }

        return created;
    },

    /**
     * 为每个 source / mineral 解析容器落点。
     * @description
     * - 若目标周围已存在 container 或 container 工地，则不再重复放置。
     * - 有路径时，优先取路径末端那个“贴着目标”的落脚格，保持与道路规划一致。
     * - 路径失败时，退化为从资源点 8 邻域里选一个最靠近发起房中心的可放置点位。
     */
    resolveContainerAnchors(
        sourceRoom: Room,
        targetRoom: Room,
        paths: Map<string, RoomPosition[]>
    ): Map<string, RoomPosition> {
        const anchors = new Map<string, RoomPosition>();

        for (const targetPos of this.getAnchorTargetPositions(targetRoom, paths)) {
            const targetPosKey = `${targetPos.x}:${targetPos.y}`;
            if (this.hasNearbyContainerInfrastructure(targetPos)) continue;

            const anchor =
                this.findContainerAnchorForTarget(targetPos, paths.get(targetPosKey) || []) ||
                this.findFallbackContainerAnchor(sourceRoom, targetPos);
            if (!anchor) continue;
            if (!this.canPlaceContainerAt(anchor)) continue;

            anchors.set(targetPosKey, anchor);
        }

        return anchors;
    },

    /**
     * 获取 container 锚点候选目标。
     * @description
     * 正常情况下直接以房间内真实 source/mineral 为准；
     * 若测试环境或极端场景下对象枚举为空，但路径内存里已经有目标 key，
     * 也要把这些 key 还原成目标坐标，避免已有路径却无法放 container。
     */
    getAnchorTargetPositions(
        targetRoom: Room,
        paths: Map<string, RoomPosition[]>
    ): RoomPosition[] {
        const positions = new Map<string, RoomPosition>();

        for (const targetPos of this.getTargetPositions(targetRoom)) {
            positions.set(`${targetPos.x}:${targetPos.y}`, targetPos);
        }

        for (const targetPosKey of paths.keys()) {
            const [xRaw, yRaw] = targetPosKey.split(':');
            const x = Number(xRaw);
            const y = Number(yRaw);
            if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
            positions.set(targetPosKey, new RoomPosition(x, y, targetRoom.name));
        }

        return Array.from(positions.values());
    },

    /**
     * 判断目标周围是否已经存在 container 或对应工地。
     */
    hasNearbyContainerInfrastructure(targetPos: RoomPosition): boolean {
        const hasContainer = targetPos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        }).length > 0;
        if (hasContainer) return true;

        const hasContainerSite = targetPos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER
        }).length > 0;
        return hasContainerSite;
    },

    /**
     * 从路径末端反推 source / mineral 的容器锚点。
     * @description 只接受目标房内、与目标距离 1 的落脚格。
     */
    findContainerAnchorForTarget(targetPos: RoomPosition, positions: RoomPosition[]): RoomPosition | null {
        for (let i = positions.length - 1; i >= 0; i--) {
            const pos = positions[i];
            if (pos!.roomName!== targetPos.roomName) continue;
            if (!pos!.inRangeTo! (targetPos, 1)) continue;
            if (pos!.x! <= 0 || pos!.x! >= 49 || pos!.y! <= 0 || pos!.y! >= 49) continue;
            return pos!;
        }
        return null;
    },

    /**
     * 路径规划失败时，为 source / mineral 选择一个保底的 container 落点。
     * @description
     * 规则：
     * - 只在资源点 8 邻域中挑选；
     * - 必须是可放置 container 的格子；
     * - 选取“全局坐标距离发起房中心最近”的那个点位，尽量贴近回程方向。
     */
    findFallbackContainerAnchor(sourceRoom: Room, targetPos: RoomPosition): RoomPosition | null {
        const candidates: RoomPosition[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = targetPos.x + dx;
                const y = targetPos.y + dy;
                if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
                const pos = new RoomPosition(x, y, targetPos.roomName);
                if (!this.canPlaceContainerAt(pos)) continue;
                candidates.push(pos);
            }
        }

        if (candidates.length <= 0) return null;

        const sourceCenter = sourceRoom.getCenter();
        const sourceWorld = this.toWorldCoord(sourceCenter);
        if (!sourceWorld) return candidates[0]!;

        candidates.sort((a, b) => {
            const aWorld = this.toWorldCoord(a);
            const bWorld = this.toWorldCoord(b);
            const aDistance = aWorld ? Math.max(Math.abs(aWorld.x - sourceWorld.x), Math.abs(aWorld.y - sourceWorld.y)) : Infinity;
            const bDistance = bWorld ? Math.max(Math.abs(bWorld.x - sourceWorld.x), Math.abs(bWorld.y - sourceWorld.y)) : Infinity;
            if (aDistance !== bDistance) return aDistance - bDistance;
            if (a.x !== b.x) return b.x - a.x;
            return b.y - a.y;
        });

        return candidates[0]!;
    },

    /**
     * 把房间坐标转换成跨房间可比较的“全局平面坐标”。
     * @description
     * 这里只用于比较“哪个资源邻格更接近发起房中心”，不参与真实寻路。
     */
    toWorldCoord(pos: RoomPosition): { x: number; y: number } | null {
        const parsed = this.parseRoomName(pos.roomName);
        if (!parsed) return null;
        return {
            x: parsed.x * 50 + pos.x,
            y: parsed.y * 50 + pos.y,
        };
    },

    /**
     * 解析 Screeps 房间名到跨房间坐标。
     * @example W0N0 -> (-1, -1), E0S0 -> (0, 0)
     */
    parseRoomName(roomName: string): { x: number; y: number } | null {
        const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
        if (!match) return null;

        const [, ew, ewNum, ns, nsNum] = match;
        return {
            x: ew === 'W' ? -Number(ewNum) - 1 : Number(ewNum),
            y: ns === 'N' ? Number(nsNum) : -Number(nsNum) - 1,
        };
    },

    /**
     * 检查容器锚点是否允许放置 container。
     * @description
     * - road / road 工地允许共址
     * - 其他阻塞结构或阻塞工地直接跳过
     */
    canPlaceContainerAt(pos: RoomPosition): boolean {
        const room = Game.rooms[pos.roomName];
        if (!room) return false;
        if (room.getTerrain().get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

        const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
        if (structures.some((s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
        )) {
            return false;
        }

        const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
        if (sites.some((s) =>
            s.structureType !== STRUCTURE_ROAD &&
            s.structureType !== STRUCTURE_CONTAINER &&
            s.structureType !== STRUCTURE_RAMPART
        )) {
            return false;
        }

        if (sites.some((s) => s.structureType === STRUCTURE_CONTAINER)) return false;
        if (structures.some((s) => s.structureType === STRUCTURE_CONTAINER)) return false;
        return true;
    },

    /**
     * 基于路径锚点创建外矿 container 工地。
     */
    createContainerSites(targetRoom: Room, anchors: Map<string, RoomPosition>): number {
        let created = 0;
        const processedPositions = new Set<string>();

        for (const [, pos] of anchors) {
            const posKey = `${pos.roomName}:${pos.x}:${pos.y}`;
            if (processedPositions.has(posKey)) continue;
            processedPositions.add(posKey);
            if (pos.roomName !== targetRoom.name) continue;
            if (!this.canPlaceContainerAt(pos)) continue;

            const result = pos.createConstructionSite(STRUCTURE_CONTAINER);
            if (result === OK) created++;
        }

        return created;
    },

    /**
     * 获取目标房间的采集目标位置
     * @param targetRoom 目标房间
     * @returns 目标位置数组
     */
    getTargetPositions(targetRoom: Room): RoomPosition[] {
        const targets: RoomPosition[] = [];
        
        // 判断是否为中央九房（SK房）
        const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom.name);
        
        // 添加能量源
        const sources = targetRoom.find(FIND_SOURCES);
        for (const source of sources) {
            targets.push(source.pos);
        }

        // 中央九房还需要添加矿物
        if (isCenterRoom) {
            const minerals = targetRoom.find(FIND_MINERALS);
            for (const mineral of minerals) {
                targets.push(mineral.pos);
            }
        }

        return targets;
    },

    /**
     * 重新计算指定路线
     * @param sourceRoomName 源头房间名
     * @param targetRoomName 目标房间名
     * @returns 是否成功
     */
    recalculateRoute(sourceRoomName: string, targetRoomName: string): boolean {
        const sourceRoom = Game.rooms[sourceRoomName];
        const targetRoom = Game.rooms[targetRoomName];
        
        if (!sourceRoom || !targetRoom) return false;

        // 删除旧路线
        RoadMemory.deleteRoute(sourceRoomName, targetRoomName);
        
        // 使缓存失效
        CostMatrixCache.clear();

        // 计算新路径
        const targets = this.getTargetPositions(targetRoom);
        if (targets.length === 0) return false;

        const pathResults = PathPlanner.planPaths(sourceRoomName, targets);
        if (pathResults.size === 0) return false;

        // 转换 key 格式：从 "roomName:x:y" 到 "x:y"
        const pathsToSave = new Map<string, RoomPosition[]>();
        for (const [targetKey, positions] of pathResults) {
            const parts = targetKey.split(':');
            const posKey = `${parts[1]}:${parts[2]}`;
            pathsToSave.set(posKey, positions);
        }

        if (pathsToSave.size === 0) return false;

        // 保存到内存
        RoadMemory.setPaths(sourceRoomName, targetRoomName, pathsToSave);

        // 重新计算路线后，road / container 两类基础设施都应该由 externalRoad 统一补齐。
        this.createSitesFromPaths(sourceRoomName, pathsToSave);
        const containerAnchors = this.resolveContainerAnchors(sourceRoom, targetRoom, pathsToSave);
        this.createContainerSites(targetRoom, containerAnchors);
        
        return true;
    },

    /**
     * 检查是否应该建造道路
     * @param sourceRoom 源头房间
     * @param targetRoomName 目标房间名
     * @returns 是否应该建造
     */
    shouldBuildRoad(sourceRoom: Room, targetRoomName: string): boolean {
        const level = sourceRoom.controller?.level || 0;
        const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoomName);

        if (isCenterRoom) {
            return level >= EXTERNAL_ROAD_CONFIG.CENTER_ROAD_MIN_LEVEL;
        } else {
            return level >= EXTERNAL_ROAD_CONFIG.ENERGY_ROAD_MIN_LEVEL;
        }
    },
};
