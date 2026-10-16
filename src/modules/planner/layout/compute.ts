// @ts-nocheck
/**
 * 布局计算域: 静态/动态布局计算（含三级缓存命中）与重算后的残留工地清理。
 */
import { decompress } from '@/utils/compress';
import { rosPlanner } from '../rosPlanner';
import { autoPlanner63 } from '../dynamic/63Planner';
import { plannerLog as log, dynamicBucketFloor } from '../memory';
import { normalizeDynamicPlannerResult } from './roomContext';
import type {
	CachedLayout,
	LayoutCenter,
} from './types';
import {
	CACHE_TTL,
	makeCacheKey,
	makeDynamicSigKey,
	cloneStructMap,
	cloneLayoutMemory,
	getCachedLayout,
	setCachedLayout,
	getLastCachedByRoomLayout,
	getCachedDynamicBySig,
} from './layoutCache';
import {
	applyStaticBuildings,
	addStaticRampartRing,
	planHarvestInfra,
	reorderLinkBuildOrder,
	toLayoutMemory,
} from './staticLayout';

export { toLayoutMemory };

/**
 * 计算静态布局（含缓存）。
 * @param roomName 房间名
 * @param layoutType 静态模板名
 * @param center 布局中心点
 * @returns 计算结果；失败返回 null（并输出日志）
 */
export function computeStatic(roomName: string, layoutType: string, center: LayoutCenter): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) {
        log(`静态布局失败: ${roomName} 房间不可见`);
        return null;
    }

    const cached = getCachedLayout(roomName, layoutType, center);
    if (cached) {
        log(`命中缓存: static ${roomName} ${layoutType} center(${center.x},${center.y})`);
        return {
            ...cached,
            structMap: cloneStructMap(cached.structMap),
            layoutMemory: cloneLayoutMemory(cached.layoutMemory)
        };
    }

    const base = applyStaticBuildings(roomName, layoutType, center);
    if (!base) {
        log(`静态布局失败: ${roomName} layout=${layoutType} 模板不存在或无有效建筑点`);
        return null;
    }
    const { structMap, minX, maxX, minY, maxY } = base;
    addStaticRampartRing(roomName, structMap, { minX, maxX, minY, maxY });
    planHarvestInfra(room, center, structMap);
    reorderLinkBuildOrder(room, center, structMap);
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, layoutType, center);
    setCachedLayout({ key, roomName, layoutType, center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) });

    return { key, roomName, layoutType, center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

/**
 * 计算动态布局（含缓存）。
 * - 优先命中“最近一次缓存”（用于预览后立即 build）
 * - 其次命中“输入签名缓存”（用于批量/重复调用）
 * @param roomName 房间名
 * @param layoutType 动态布局类型 ('auto' | '63auto')
 * @returns 计算结果；失败返回 null（并输出日志）
 */
export function computeDynamic(roomName: string, layoutType: string): CachedLayout | null {
    const room = Game.rooms[roomName];
    if (!room) {
        log(`动态布局失败: ${roomName} 房间不可见 layout=${layoutType}`);
        return null;
    }

    // Detect flag center
    const PosFlag = Game.flags.storagePos || Game.flags.centerPos;
    let flagCenter: LayoutCenter | null = null;
    if (PosFlag && PosFlag.pos.roomName === roomName) {
        flagCenter = { x: PosFlag.pos.x, y: PosFlag.pos.y };
    }
    // 落地手置 spawn：提取坐标供布局限幅与收编（computeManor 内以 spawn 为中心限幅并收编 spawn 位）。
    // 中心不定死：不给 fixedCenter，枢纽点由规划器自然选址（可建筑质心 + storage 取最近 k>2 格），
    // 仅通过限幅半径保证布局够得着 spawn 附近
    let existSpawnPos: { x: number; y: number } | undefined;
    // 63 布局无 spawn 锚定语义, 不参与限幅阶梯
    if (layoutType !== '63auto') {
        const landingSpawn = room.find(FIND_MY_SPAWNS)[0];
        if (landingSpawn) existSpawnPos = { x: landingSpawn.pos.x, y: landingSpawn.pos.y };
    }

    const cached = getLastCachedByRoomLayout(roomName, layoutType);
    if (cached) {
        let valid = true;
        if (flagCenter && (cached.center.x !== flagCenter.x || cached.center.y !== flagCenter.y)) {
            valid = false;
        }

        if (valid) {
            log(`命中缓存: dynamic ${roomName} ${layoutType} center(${cached.center.x},${cached.center.y})`);
            return {
                ...cached,
                structMap: cloneStructMap(cached.structMap),
                layoutMemory: cloneLayoutMemory(cached.layoutMemory)
            };
        } else {
             log(`缓存失效: dynamic ${roomName} ${layoutType} center mismatch (flag: ${flagCenter?.x},${flagCenter?.y} vs cache: ${cached.center.x},${cached.center.y})`);
        }
    }

    if (Game.cpu.bucket < dynamicBucketFloor()) {
        log(`动态布局跳过: CPU bucket 不足 bucket=${Game.cpu.bucket} room=${roomName} layout=${layoutType}`);
        return null;
    }

    const sources = room.find(FIND_SOURCES);
    const pa = sources[0]?.pos;
    const pb = sources[1]?.pos || pa;
    // mineral 可缺席: extractor 是 RCL6 解锁物, 布局键点只作枢纽选址参考——
    // 缺席以控制器坐标代位 (仅选址权重参考, 不落任何矿石结构)。缺席锁死布局
    // 会让 ext 永不放量, 容量锁 300, 采集面锁死最小体 (sim 场景实锤)
    const pc = room.controller?.pos;
    const pm = room.find(FIND_MINERALS)[0]?.pos ?? pc;
    if (!pa || !pb || !pc) {
        log(`动态布局失败: 缺少关键对象 room=${roomName} layout=${layoutType} (controller/source)`);
        return null;
    }

    const pointsSig = `${pc.x},${pc.y}|${pm.x},${pm.y}|${pa.x},${pa.y}|${pb.x},${pb.y}`;
    let sigKey = makeDynamicSigKey(roomName, layoutType, pointsSig, flagCenter);
    const sigCached = getCachedDynamicBySig(sigKey);
    if (sigCached) {
        log(`命中缓存: dynamic(sig) ${roomName} ${layoutType} center(${sigCached.center.x},${sigCached.center.y})`);
        return {
            ...sigCached,
            structMap: cloneStructMap(sigCached.structMap),
            layoutMemory: cloneLayoutMemory(sigCached.layoutMemory)
        };
    }

    const storagePos = Game.flags.storagePos;
    if (storagePos && storagePos.pos.roomName !== roomName) storagePos.remove();

    const planner = layoutType === '63auto' ? autoPlanner63 : rosPlanner;
    const computeManor = planner.ManagerPlanner.computeManor;
    // 锚定降级阶梯：紧凑 10 → 放宽 14 → 不限幅，逐级放宽仍保持 spawn 锚定；
    // 全部失败才退回无锚流程（布局远离 spawn 的最后兜底），杜绝「稍偏即崩」的二值脆弱性
    let roomStructsData = null;
    if (flagCenter) {
        // 旗模式：手动指定中心，精确钉死（不参与降级阶梯，失败按用户指定报错）
        roomStructsData = computeManor(pa.roomName, [pc, pm, pa, pb], flagCenter);
        if (!roomStructsData) log(`[锚定诊断] 旗指定中心无解 room=${roomName} center=${flagCenter.x},${flagCenter.y}`);
    } else {
        // spawn 锚定限幅降级阶梯：紧凑 10 → 放宽 14 → 不限幅，门槛 160 → 120 → 100 → 80 → 40 逐级放低
        // 每级保持 spawn 收编；全阶梯无解才退回无锚流程（最后兜底），杜绝「稍偏即崩」的二值脆弱性
        for (const [radius, gate] of [[10, 160], [10, 120], [14, 120], [0, 120], [0, 100], [0, 80], [0, 40]] as [number, number][]) {
            roomStructsData = computeManor(pa.roomName, [pc, pm, pa, pb], undefined, undefined, existSpawnPos, radius, gate);
            if (roomStructsData) {
                log(`[锚定诊断] 成功 room=${roomName} radius=${radius === 0 ? '无限' : radius} gate=${gate}`);
                break;
            }
            log(`[锚定诊断] 半径 ${radius === 0 ? '无限' : radius} 门槛 ${gate} 无解，降级重试 room=${roomName}`);
        }
        if (!roomStructsData) {
            // 全阶梯无解：无锚无限幅兜底（门槛同步降级，直至必有产出）
            log(`[锚定诊断] 锚定失败，退回无锚流程 room=${roomName}`);
            sigKey = makeDynamicSigKey(roomName, layoutType, pointsSig, null);
            const fallbackCached = getCachedDynamicBySig(sigKey);
            if (fallbackCached) {
                return {
                    ...fallbackCached,
                    structMap: cloneStructMap(fallbackCached.structMap),
                    layoutMemory: cloneLayoutMemory(fallbackCached.layoutMemory)
                };
            }
            for (const gate of [160, 120, 80, 40] as number[]) {
                roomStructsData = computeManor(pa.roomName, [pc, pm, pa, pb], undefined, undefined, undefined, undefined, gate);
                if (roomStructsData) break;
            }
        }
    }
    const normalized = normalizeDynamicPlannerResult(roomName, layoutType, roomStructsData);
    if (!normalized) return null;

    const center = normalized.center;
    const structMap = normalized.structMap;
    reorderLinkBuildOrder(room, center, structMap);
    const layoutMemory = toLayoutMemory(structMap);

    const key = makeCacheKey(roomName, layoutType, center);
    setCachedLayout(
        { key, roomName, layoutType, center, structMap: cloneStructMap(structMap), layoutMemory: cloneLayoutMemory(layoutMemory) },
        { dynamicSigKey: sigKey }
    );

    return { key, roomName, layoutType, center, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL, structMap, layoutMemory };
}

/**
 * 布局重算后清理不属于新布局的残留工地:
 * 只清「旧布局内有、新布局没有」的工地, 不碰功能性外部工地 (外矿容器/道路等不在布局内)。
 * @param previousData 重算前的旧布局数据 (已被替换, 由调用方先行快照)
 */
export function removeStaleSites(roomName: string, computed: CachedLayout, previousData: Record<string, number[]>): void {
    const staleKeys = new Set<string>();
    for (const [type, pts] of Object.entries(previousData)) {
        if (!Array.isArray(pts)) continue;
        for (const p of pts as number[]) {
            const [x, y] = decompress(p);
            staleKeys.add(`${type}:${x},${y}`);
        }
    }
    const room = Game.rooms[roomName];
    if (!room) return;
    const layoutKeys = new Set<string>();
    for (const [type, pts] of Object.entries(computed.structMap)) {
        for (const [x, y] of pts as [number, number][]) layoutKeys.add(`${type}:${x},${y}`);
    }
    for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        const staleKey = `${site.structureType}:${site.pos.x},${site.pos.y}`;
        if (staleKeys.has(staleKey) && !layoutKeys.has(staleKey)) site.remove();
    }
}
