// @ts-nocheck
/**
 * 工地放置域: RCL 过滤、占位判断、核心枢纽(storage/terminal)占位换位、按布局放量工地。
 * 原生调用经 intentQueue 提交 (api/17 命令边界): 返回值是"本pass提交的意图数"。
 */
import { decompress } from '@/utils/compress';
import { PLANNER_CONFIG } from '@/config/planner';
import { getLayoutRecord, skipBuildTypes, rampartMinRcl } from '../memory';
import { roomLevel, getCoreDepotPointFromLayout } from './roomContext';
import type { LayoutMemoryMap } from './types';
import { submitIntent } from '@/runtime/intentQueue';

/**
 * 根据房间等级（RCL）过滤某些结构类型的点位列表。
 * - road：低 RCL 限制道路数量（兼容部分静态布局的“分阶段修路”策略）
 * - rampart：低 RCL 不建 rampart
 * @param room 房间对象
 * @param structureType 结构类型
 * @param layoutArray 压缩点位数组（decompress 后为 XY）
 * @returns 对应 RCL 允许建造的点位子集（仍为压缩格式 number[]）
 */
export function getLayoutPointsForRcl(room: Room, structureType: string, layoutArray: number[]): number[] {
    const level = roomLevel(room);
    if (structureType === STRUCTURE_ROAD) {
        // 主干道 (spawn↔source↔controller) 是物流命脉——沼泽房无路网时
        // 搬运 10t/格, 交付速率封死 (bugs/P1-14 sim 实证 50k 零道路)。
        // RCL 门接 roadMinRcl (此前 buildMinLevels 为无消费方的死配置):
        // RCL3 起布局路网进场, RCL2 产能优先 ext 扩容
        if (level < PLANNER_CONFIG.roadMinRcl) return [];
        const layoutType = getLayoutRecord(room.name)?.type;
        switch (layoutType) {
            case 'tea':
                if (level == 3) return layoutArray.slice(0, 11);
                if (level == 4) return layoutArray.slice(0, 24);
                if (level == 5) return layoutArray.slice(0, 37);
                break;
            case 'hoho':
                if (level == 3) return layoutArray.slice(0, 7);
                if (level == 4) return layoutArray.slice(0, 13);
                if (level == 5) return layoutArray.slice(0, 21);
                break;
            default:
                break;
        }
        return layoutArray;
    }
    if (structureType === STRUCTURE_RAMPART) {
        // 冲级期工地与产能优先留给经济建筑, 城墙晚一档再铺
        // (引擎 RCL2 即允许, 起建节奏由 rampartMinRcl 控制)
        if (level < rampartMinRcl()) return [];
    }
    return layoutArray;
}

/**
 * 判断某个位置是否应跳过创建工地（用于避免把工地压在不允许覆盖的结构上）。
 * @param room 房间对象
 * @param structureType 目标建造结构类型
 * @param lookStruct 该位置已有结构列表
 * @param pos 房间坐标
 * @returns true 表示跳过；false 表示允许尝试创建工地
 */
export function shouldSkipBuildAtPos(
    room: Room,
    structureType: string,
    lookStruct: Structure<StructureConstant>[],
    pos: RoomPosition
): boolean {
    switch (structureType) {
        case STRUCTURE_RAMPART:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType == STRUCTURE_RAMPART || o.structureType == STRUCTURE_WALL)) return true;
            break;
        case STRUCTURE_ROAD:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_CONTAINER)) return true;
            break;
        case STRUCTURE_CONTAINER:
            if (lookStruct.length && lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_ROAD))
                return true;
            if (roomLevel(room) < 6) {
                const mineral = room.find(FIND_MINERALS)[0];
                if (mineral && pos.inRangeTo(mineral.pos, 1)) {
                    const sources = room.find(FIND_SOURCES);
                    const nearSource = sources.some((s) => s && pos.inRangeTo(s.pos, 1));
                    const nearController = !!room.controller && pos.inRangeTo(room.controller.pos, 1);
                    // 仅拦截“纯 mineral 容器位”；若同时贴 source/controller，则视作其容器位，不拦截
                    if (!nearSource && !nearController) return true;
                }
            }
            if (roomLevel(room) <= 7) return false;
            if (room.controller && pos.inRangeTo(room.controller.pos, 2)) return true;
            break;
        default:
            if (!lookStruct.length) return false;
            if (lookStruct.some(o => o.structureType != STRUCTURE_RAMPART && o.structureType != STRUCTURE_ROAD)) return true;
            break;
    }
    return false;
}

export function isCoreDepotStructure(structureType: string): structureType is 'storage' | 'terminal' {
    return structureType === STRUCTURE_STORAGE || structureType === STRUCTURE_TERMINAL;
}

// —— 占位 container 排空换位参数 ——
/** 残余能量不超过该值即视为「已排空」，可拆除（残余随拆掉落，carrier 会优先捡起） */
const CORE_DEPOT_SWAP_DRAIN_LIMIT = 200;
/** 排空等待上限：超过该 tick 数强制拆除（饱和房可能长期无人取用，真建筑不能无限延期） */
const CORE_DEPOT_SWAP_FORCE_TICKS = 3000;

export function handleCoreDepotSite(
    room: Room,
    layoutMemory: LayoutMemoryMap,
    structureType: 'storage' | 'terminal'
): number {
    const point = getCoreDepotPointFromLayout(layoutMemory, room.name, structureType);
    if (!point) return 0;

    const buildMax = (CONTROLLER_STRUCTURES as any)?.[structureType]?.[roomLevel(room)] ?? 0;
    const existingStructure = structureType === 'storage' ? room.storage : room.terminal;
    const allSites = room.find(FIND_CONSTRUCTION_SITES);
    const hasRealSite = allSites.some((site) => site && site.structureType === structureType);
    const record = getLayoutRecord(room.name);
    if (existingStructure || hasRealSite || !record) {
        // 真建筑已建成/在建——占位必然已拆除，清掉排空计时残留
        if (record?.coreDepotSwapSince) delete record.coreDepotSwapSince[structureType];
        return 0;
    }

    const pos = new RoomPosition(point.x, point.y, room.name);
    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES) as ConstructionSite[];
    const structures = pos.lookFor(LOOK_STRUCTURES) as Structure<StructureConstant>[];

    if (buildMax > 0) {        const containerSite = sites.find((site) => site.structureType === STRUCTURE_CONTAINER);
        if (containerSite) submitIntent(Game.time, {
            actorName: room.name, kind: 'removeSite', pipeline: 'construction', priority: 30,
            targetId: containerSite.id, dedupeKey: `core-depot-remove-site:${containerSite.id}`,
        });

        const placeholder = structures.find((structure) => structure.structureType === STRUCTURE_CONTAINER) as StructureContainer | undefined;
        if (placeholder) {
            // 排空后再拆：存入侧已停，存量被 spawn/塔填充等自然取用耗尽；
            // 残余 ≤ 阈值才拆，避免整箱能量砸地上腐烂、以及「先拆后建」期间枢纽缓冲断档
            const energy = placeholder.store[RESOURCE_ENERGY] || 0;
            record.coreDepotSwapSince ??= {};
            if (typeof record.coreDepotSwapSince[structureType] !== 'number') {
                record.coreDepotSwapSince[structureType] = Game.time;
            }
            const waited = Game.time - record.coreDepotSwapSince[structureType];
            if (energy > CORE_DEPOT_SWAP_DRAIN_LIMIT && waited < CORE_DEPOT_SWAP_FORCE_TICKS) {
                return 0;
            }
            submitIntent(Game.time, {
                actorName: room.name, kind: 'destroyStructure', pipeline: 'construction', priority: 30,
                targetId: placeholder.id, dedupeKey: `core-depot-destroy:${placeholder.id}`,
            });
            delete record.coreDepotSwapSince[structureType];
        } else {
            delete record.coreDepotSwapSince?.[structureType];
        }

        const nextSites = pos.lookFor(LOOK_CONSTRUCTION_SITES) as ConstructionSite[];
        const nextStructures = pos.lookFor(LOOK_STRUCTURES) as Structure<StructureConstant>[];
        if (nextSites.length > 0) return 0;
        if (shouldSkipBuildAtPos(room, structureType, nextStructures, pos)) return 0;

        submitIntent(Game.time, {
            actorName: room.name, kind: 'createSite', pipeline: 'construction', priority: 30,
            targetPos: { x: point.x, y: point.y, roomName: room.name },
            payload: { structureType },
            dedupeKey: `core-depot-site:${room.name}:${point.x}:${point.y}:${structureType}`,
        });
        return 1;
    }

    if (sites.some((site) => site.structureType === STRUCTURE_CONTAINER)) return 0;
    if (structures.some((structure) => structure.structureType === STRUCTURE_CONTAINER)) return 0;
    if (shouldSkipBuildAtPos(room, STRUCTURE_CONTAINER, structures, pos)) return 0;
    // cc 圈冲突守卫：核心库点位贴着 controller 时，占位容器会和 cc 叠进同一个升级缓冲圈
    // （历史实录：hub 点位 roll 到 controller 旁 2 格，占位×2 + cc 反复放量 = 控制器边一圈容器）。
    // 此时不放占位——缓冲职责由 cc 承担（物流/升级取能本就认 controller 旁 3 格内的容器）
    if (room.controller && pos.inRangeTo(room.controller.pos, 3)) return 0;
    // 占位 RCL 门 (bugs/P2-20): 占位贴着起建门槛才放 (storage RCL4 / terminal RCL6)。
    // RCL2 就放 5000 占位 = 死积压卡槽位 40k tick, 拆换又是三轮吞吐
    // (sim 实锤 2 占位 + ext/源容器塞满 10 槽, road 永无预算 → 沼泽 50k 零道路)。
    if (roomLevel(room) < PLANNER_CONFIG.coreDepotPlaceholderMinRcl) return 0;

    submitIntent(Game.time, {
        actorName: room.name, kind: 'createSite', pipeline: 'construction', priority: 30,
        targetPos: { x: point.x, y: point.y, roomName: room.name },
        payload: { structureType: STRUCTURE_CONTAINER },
        dedupeKey: `core-depot-placeholder:${room.name}:${point.x}:${point.y}`,
    });
    return 1;
}

/**
 * 根据 layoutMemory 在房间内创建工地（自动建造的消费口）。
 * @param room 目标房间
 * @param layoutMemory 压缩布局数据 (structType → 压缩坐标数组)
 * @param options 可选：只创建某一种结构、限制最大工地数量
 * @returns 本次创建的工地数量（不是 Screeps 错误码）
 */
export function plannerCreateSite(
    room: Room,
    layoutMemory: LayoutMemoryMap,
    options?: { structType?: string; maxSites?: number; rushMode?: boolean }
): number {
    const only = options?.structType;
    const allSite = room.find(FIND_CONSTRUCTION_SITES);
    const level = roomLevel(room);

    // 建造放置优先级 (bugs/P2-20 配置化): 顺序表进 PLANNER_CONFIG.placementOrder——
    // 沼泽房路网是建造吞吐的命脉, road 压过 container (占位/源容器/cc 独立放量不经此序)
    // 冲级期产业让位 (任务 6.5): rush 档产业类 (lab/factory/powerSpawn/nuker/extractor)
    // 顺序统一压到尾部——冲级火力是主要目的, 产业能量锁不挤占升级链
    const rush = options?.rushMode === true;
    const rushDeprioritize = PLANNER_CONFIG.rushIndustrialTypes;
    const PLACEMENT_ORDER = PLANNER_CONFIG.placementOrder;
    const orderOf = (structureType: string): number => {
        const base = PLACEMENT_ORDER[structureType] ?? 7;
        return rush && rushDeprioritize.includes(structureType) ? base + 100 : base;
    };

    const maxSites = options?.maxSites;
    const cap = typeof maxSites === 'number' ? maxSites : (typeof MAX_CONSTRUCTION_SITES === 'number' ? MAX_CONSTRUCTION_SITES : 100);
    // 能力闸：配置跳过的结构类型不放置（布局不受影响，已放工地自然消化）
    const skipBuild = skipBuildTypes();
    if (skipBuild.includes('all')) return 0;
    const skipSet = skipBuild.length ? new Set(skipBuild) : null;
    const keys = only ? [only] : Object.keys(layoutMemory);
    const coreDepotKeys = keys.filter((structureType) => isCoreDepotStructure(structureType));
    const regularKeys = keys.filter((structureType) => !isCoreDepotStructure(structureType) && !skipSet?.has(structureType));
    regularKeys.sort((a, b) => orderOf(a) - orderOf(b));
    let budget = Math.max(0, cap - allSite.length);

    let created = 0;
    for (const s of coreDepotKeys) {
        created += handleCoreDepotSite(room, layoutMemory, s);
    }

    let regularCreated = 0;
    for (const s of regularKeys) {
        if (regularCreated >= budget) break;
        const layoutArray = layoutMemory[s];
        if (!layoutArray || layoutArray.length == 0) continue;
        const buildMax = (CONTROLLER_STRUCTURES as any)?.[s]?.[level] ?? 0;
        if (buildMax <= 0) continue;

        let structures = room.find(FIND_STRUCTURES, { filter: (o) => o.structureType == s });
        if (!Array.isArray(structures)) structures = [structures];
        let count = structures.length;
        if (count >= buildMax) continue;

        const sites = allSite.filter(o => o.structureType == s);
        count += sites.length;
        if (count >= buildMax) continue;

        // RCL<6 容器每源限一个（源容器存量+在途工地计数，见下方放置过滤）
        const placedContainerPerSource = new Map<string, number>();
        if (s === STRUCTURE_CONTAINER) {
            const roomSources = room.find(FIND_SOURCES);
            // 计数含在途工地 (bugs/P2-20): 只数建成会让未完工工地每 pass 在同源旁
            // 再放一个, 槽位被同源多容器挤占 (sim 实锤双源房 5 容器工地)
            const nearCounter = (list: Array<Source | Structure | ConstructionSite>) => {
                for (const src of roomSources) {
                    const near = list.filter((c: any) => c.pos.inRangeTo(src.pos, 2)).length;
                    if (near > 0) placedContainerPerSource.set(src.id, near);
                }
            };
            nearCounter(room.find(FIND_STRUCTURES, { filter: (o) => o.structureType == STRUCTURE_CONTAINER }));
            nearCounter(allSite.filter((o) => o.structureType == STRUCTURE_CONTAINER));
        }

        const points = getLayoutPointsForRcl(room, s, layoutArray);
        if (!points || points.length == 0) continue;
        for (const p of points) {
            if (regularCreated >= budget) break;
            if (count >= buildMax) break;
            const [x, y] = decompress(p);
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            const Pos = new RoomPosition(x, y, room.name);
            // 容器选址（容器集合 = 源容器×N + cc×1）：
            // - 源容器：每源限一，任意等级
            // - 控制器旁 cc 圈：选址权归控制器缓冲决策 (避免布局放量与它各管一点,
            //   形成建→删→再建循环)
            // - 其余点位（矿物旁等）：RCL6+ 采集器时代才放
            if (s === STRUCTURE_CONTAINER) {
                const nearSource = room.find(FIND_SOURCES).find((src: Source) => src.pos.inRangeTo(Pos, 2));
                if (nearSource) {
                    if ((placedContainerPerSource.get(nearSource.id) || 0) >= 1) continue;
                    placedContainerPerSource.set(nearSource.id, 1);
                } else if (room.controller && Pos.inRangeTo(room.controller.pos, 3)) {
                    continue;
                } else if (level < 6) {
                    continue;
                }
            }
            if (Pos.lookFor(LOOK_CONSTRUCTION_SITES).length) continue;
            const S = Pos.lookFor(LOOK_STRUCTURES);
            if (shouldSkipBuildAtPos(room, s, S, Pos)) continue;
            submitIntent(Game.time, {
                actorName: room.name, kind: 'createSite', pipeline: 'construction', priority: 30,
                targetPos: { x, y, roomName: room.name },
                payload: { structureType: s },
                dedupeKey: `layout-site:${room.name}:${x}:${y}:${s}`,
            });
            // 意图提交即计入本 pass 预算 (broker 同 Tick 执行; ERR_FULL 由下一 pass 的工地水位兜底)
            created++;
            regularCreated++;
            count++;
        }
    }
    return created;
}
