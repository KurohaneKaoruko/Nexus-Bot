
import { log } from '@/utils/log';
import { AUTO_FACTORY_CONFIG, AUTO_FACTORY_FALLBACK, PRODUCTION_MIN, zipMap } from "@/constant/ResourceConstant";
import { getAutoFactoryData, getMissionPools, getStructData } from "@/core/store/accessor";
import { isRoomTickAligned } from "@/utils/roomPhase";
import { sanitizeMissionPoolMemory } from "@/core/store/accessor";

/** 自动工厂生产管理 (原 autoFactory 原型方法改写) */
export function runAutoFactory(room: Room): number | void {
        if (!isRoomTickAligned(room.name, AUTO_FACTORY_CONFIG.tickInterval)) return;
        if (!room.factory) return;
        const botmem = getStructData(room.name);
        if (!botmem) return;
        if (botmem.factory === undefined) botmem.factory = true;
        if (!botmem.factory) return;

        // 注意：getResAmount 只统计 storage+terminal；但 factory 原料会被搬进 factory.store。
        // 这里使用“可用总量”避免误判缺料导致频繁停工/换任务。
        const getAvail = (res: ResourceConstant) => {
            return room.getResAmount(res) + (room.factory?.store?.[res] || 0);
        };
        const flv = Number(room.factory.level || botmem.factoryLevel || 0);

        const autoFactoryMap = getAutoFactoryData(room.name);
        const hasAutoList = !!(autoFactoryMap && Object.keys(autoFactoryMap).length);

        // 产物
        const Product = botmem.factoryProduct;
        // 限额
        const amount = Number(botmem.factoryAmount) || 0;
        // 原料
        const components = COMMODITIES[Product as CommoditiesTypes]?.components;

        if (Product && amount > 0) {
            const cur = getAvail(Product as ResourceConstant);
            if (cur >= amount) {
                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete botmem.factoryWaitSince;
                log(`[${room.name}] 已自动结束factory生产任务(达到限额): ${Product}. 现库存: ${cur}`)
                return;
            }
        }

        if (Product) {
            const missReasons: string[] = [];
            if (!components) {
                missReasons.push('no_recipe');
            } else {
                const store = room.factory.store as unknown as Record<string, number | undefined>;
                const missing = Object.entries(components).filter(([c, need]) => (store[c] as number) < Number(need));
                if (missing.length === 0) {
                    delete botmem.factoryWaitSince;
                    return;
                }
                const roomPools = getMissionPools()[room.name];
                if (roomPools) sanitizeMissionPoolMemory(roomPools);
                const manageTasks = Array.isArray(roomPools?.transport) ? roomPools.transport as ManageTransportTask[] : [];
                // 收集当前正在向 factory 补料的资源类型
                const supplyingResources = new Set<string>();
                for (const t of manageTasks) {
                    if (t?.type !== 'manage') continue;
                    const d = t?.data;
                    if (!d || d.target !== 'factory') continue;
                    if (typeof d.amount !== 'number' || d.amount <= 0) continue;
                    const res = String(d.resourceType || '');
                    if (!res) continue;
                    const source = d.source;
                    const sourceObj = source ? room[source] : null;
                    const sourceStore = sourceObj && !Array.isArray(sourceObj) ? sourceObj.store : undefined;
                    const sourceAmount = sourceStore?.[res as ResourceConstant] || 0;
                    if (sourceAmount > 0) supplyingResources.add(res);
                }

                const missingDetails = missing.map(([c, need]) => {
                    const res = String(c);
                    const needTotal = Number(need) || 0;
                    const haveInFactory = Number(store[res as ResourceConstant] || 0);
                    const needRemain = Math.max(0, needTotal - haveInFactory);
                    return { res, needRemain };
                });

                const supplyPossible = missingDetails.every(({ res, needRemain }) => {
                    if (needRemain <= 0) return true;
                    if (supplyingResources.has(res)) return true;
                    return room.getResAmount(res) >= needRemain;
                });

                if (!supplyPossible) {
                    missReasons.push('no_supply');
                }
            }

            if (missReasons.length === 0) {
                delete botmem.factoryWaitSince;
                return;
            }

            if (missReasons.includes('no_supply')) {
                const hasAlternativeRunnable = hasAutoList && Object.keys(autoFactoryMap).some((p) => {
                    if (!p || p === Product) return false;
                    const info = COMMODITIES[p as CommoditiesTypes];
                    const level = Number(info?.level || 0);
                    if (!isFactoryLevelCompatible(flv, level)) return false;
                    return canStartTask(getAvail, p as ResourceConstant);
                });
                const waitLimit = hasAlternativeRunnable
                    ? AUTO_FACTORY_CONFIG.waitTimeoutTicksWhenAlternatives
                    : AUTO_FACTORY_CONFIG.waitTimeoutTicks;
                const since = botmem.factoryWaitSince ?? Game.time;
                botmem.factoryWaitSince = since;
                if (Game.time - since < waitLimit) return;

                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete botmem.factoryWaitSince;
                log(`[${room.name}] 已自动结束factory生产任务(超时缺料): ${Product}. 现库存: ${getAvail(Product as ResourceConstant)}`)
            } else {
                botmem.factoryProduct = null;
                botmem.factoryAmount = 0;
                delete botmem.factoryWaitSince;
                log(`[${room.name}] 已自动结束factory生产任务(无配方): ${Product}.`)
            }
        }

        // 查找未到达限额且原料足够的任务
        let task: ResourceConstant | null = null;
        let taskAmount = 0;

        const isBanned = (p: string) => {
            const until = botmem?.factoryBan?.[p];
            return typeof until === 'number' && Game.time < until;
        };

        if (hasAutoList) {
            task = getTask(room, getAvail, flv, autoFactoryMap, isBanned);
            taskAmount = task ? (autoFactoryMap[task] ?? 0) : 0;
        }

        if (!task) {
            const picked = getFallbackTask(room, botmem, flv, getAvail, isBanned);
            if (picked) {
                task = picked.product;
                taskAmount = picked.limit;
            }
        }

        if (!task) return;

        if (!canStartTask(getAvail, task)) return;

        botmem.factoryProduct = task;
        botmem.factoryAmount = taskAmount;

        log(`[${room.name}] 已自动分配factory生产任务: ${task}, 限额: ${taskAmount || '无'}`)
        return OK;
}

const getTask = (room: Room, getAvail: (res: ResourceConstant) => number, factoryLevel: number, autoFactoryMap: AutoFactoryRoomEntry, isBanned?: (p: string) => boolean) => {
    let task: ResourceConstant | null = null;
    let bestDef = 0;
    let bestLevel = -Infinity;
    for (const res in autoFactoryMap) {
        const info = commodityInfo(res);
        const level = Number(info?.level || 0);
        if (!isFactoryLevelCompatible(factoryLevel, level)) continue;
        if (isBanned && isBanned(res)) continue;
        const limit = Number(autoFactoryMap[res] || 0);
        const cur = getAvail(res as ResourceConstant);
        if (limit > 0) {
            if (cur >= limit * AUTO_FACTORY_CONFIG.taskDoneRatio) continue;
        }
        if (!canStartTask(getAvail, res as ResourceConstant)) continue;
        const output = getCraftableOutput(getAvail, res as ResourceConstant);
        const def = limit > 0 ? Math.max(0, limit - cur) : output;
        if (def > bestDef || (def === bestDef && level > bestLevel)) {
            bestDef = def;
            bestLevel = level;
            task = res as ResourceConstant;
        }
    }
    return task;
}

const isFactoryLevelCompatible = (factoryLevel: number, commodityLevel: number) => {
    if (!commodityLevel) return true;
    return Number(factoryLevel) === Number(commodityLevel);
};

/** AutoFactoryData 单房条目: 产物 → 数量限额 */
type AutoFactoryRoomEntry = { [product: string]: number };

/** COMMODITIES 安全查询（键不命中返回 undefined） */
const commodityInfo = (p: string): CommodityEntry | undefined => COMMODITIES[p as CommoditiesTypes];

// 判定某产物是否值得开工：房间内原料足够至少达到“最小生产额度”
const canStartTask = (getAvail: (res: ResourceConstant) => number, product: ResourceConstant) => {
    const info = commodityInfo(product);
    const level = Number(info?.level || 0);
    const minQuota = PRODUCTION_MIN.commodityByLevel[level] ?? PRODUCTION_MIN.commodityByLevel[0] ?? 0;
    return getCraftableOutput(getAvail, product) >= minQuota;
};

const getCraftableOutput = (getAvail: (res: ResourceConstant) => number, product: ResourceConstant) => {
    const info = commodityInfo(product);
    const per = Number(info?.amount || 1);
    const comps = info?.components as Record<string, number> | undefined;
    if (!comps) return 0;
    let crafts = Infinity;
    for (const [c, need] of Object.entries(comps)) {
        const n = Number(need) || 0;
        if (n <= 0) continue;
        crafts = Math.min(crafts, Math.floor(getAvail(c as ResourceConstant) / n));
    }
    if (!Number.isFinite(crafts)) crafts = 0;
    return crafts * per;
};

const getMinQuota = (product: ResourceConstant) => {
    const info = commodityInfo(product);
    const level = Number(info?.level || 0);
    return PRODUCTION_MIN.commodityByLevel[level] ?? PRODUCTION_MIN.commodityByLevel[0] ?? 0;
};

const getCraftsNeedForOutput = (product: ResourceConstant, targetOutput: number) => {
    const info = commodityInfo(product);
    const per = Math.max(1, Number(info?.amount || 1));
    return Math.max(1, Math.ceil(targetOutput / per));
};

type FallbackPick = { product: ResourceConstant; limit: number };

// 兜底策略：当计划为空/计划不可做时，按阈值驱动“压缩/白色根/基础中间件/四色链条”自动补链
const getFallbackTask = (room: Room, botmem: StructControlMemory, factoryLevel: number, getAvail: (res: ResourceConstant) => number, isBanned?: (p: string) => boolean): FallbackPick | null => {
    if (!AUTO_FACTORY_FALLBACK.enabled) return null;
    if (!room.factory) return null;

    const keepInRoom = AUTO_FACTORY_FALLBACK.keepInRoom as unknown as Record<string, number>;
    const keepByLevelInRoom = AUTO_FACTORY_FALLBACK.keepByLevelInRoom as unknown as Record<number, number>;
    const zipRawSurplusMin = AUTO_FACTORY_FALLBACK.zipRawSurplusMin as unknown as Record<string, number>;

    const effectiveLevel = Number(factoryLevel || 0);

    const classCache = Object.create(null) as Record<string, { colored: boolean; white: boolean; rootsMask: number }>;
    const WHITE_ROOTS = new Set<string>([RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]);
    const COLOR_ROOTS = new Set<string>([RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_MIST]);
    const ROOT_BIT: Record<string, number> = {
        [RESOURCE_METAL]: 1,
        [RESOURCE_BIOMASS]: 2,
        [RESOURCE_SILICON]: 4,
        [RESOURCE_MIST]: 8,
    };
    const classify = (res: string): { colored: boolean; white: boolean; rootsMask: number } => {
        const hit = classCache[res];
        if (hit) return hit;
        const base = { colored: COLOR_ROOTS.has(res), white: WHITE_ROOTS.has(res), rootsMask: ROOT_BIT[res] || 0 };
        classCache[res] = base;
        const recipe = commodityInfo(res);
        const components = recipe?.components;
        if (!components) return base;
        for (const comp of Object.keys(components)) {
            const child = classify(comp);
            base.colored ||= child.colored;
            base.white ||= child.white;
            base.rootsMask |= child.rootsMask;
        }
        return base;
    };

    const availableMask =
        (getAvail(RESOURCE_METAL) > 0 ? 1 : 0) |
        (getAvail(RESOURCE_BIOMASS) > 0 ? 2 : 0) |
        (getAvail(RESOURCE_SILICON) > 0 ? 4 : 0) |
        (getAvail(RESOURCE_MIST) > 0 ? 8 : 0);

    const visited = new Set<string>();
    const resolveProducible = (product: string, depth: number, targetOutput: number): { product: ResourceConstant; needOutput: number } | null => {
        if (depth > AUTO_FACTORY_FALLBACK.maxResolveDepth) return null;
        if (visited.has(product)) return null;
        visited.add(product);

        const productLevel = Number(commodityInfo(product)?.level ?? 0);
        if (!isFactoryLevelCompatible(effectiveLevel, productLevel)) return null;

        const minQuota = getMinQuota(product as ResourceConstant);
        const desired = Math.max(minQuota, Math.floor(targetOutput) || 0);

        if (canStartTask(getAvail, product as ResourceConstant)) return { product: product as ResourceConstant, needOutput: desired };

        const info = commodityInfo(product);
        const components = info?.components;
        if (!components) return null;

        const craftsNeed = getCraftsNeedForOutput(product as ResourceConstant, desired);
        const missingList: { comp: string; missing: number }[] = [];
        for (const [comp, needRaw] of Object.entries(components)) {
            const needPerCraft = Number(needRaw) || 0;
            if (needPerCraft <= 0) continue;
            const needTotal = needPerCraft * craftsNeed;
            const cur = getAvail(comp as ResourceConstant);
            const missing = needTotal - cur;
            if (missing > 0) missingList.push({ comp, missing });
        }

        missingList.sort((a, b) => b.missing - a.missing || a.comp.localeCompare(b.comp));

        for (const { comp, missing } of missingList) {
            if (!commodityInfo(comp)) continue;
            const compLevel = Number(commodityInfo(comp)?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, compLevel)) continue;
            const compMinQuota = getMinQuota(comp as ResourceConstant);
            const compDesired = Math.max(compMinQuota, missing);
            const resolved = resolveProducible(comp, depth + 1, compDesired);
            if (resolved) return resolved;
        }

        return null;
    };

    const pickKeeped = (product: string) => {
        if (isBanned && isBanned(product)) return null;
        const keep = Number(keepInRoom[product] || 0);
        if (keep <= 0) return null;
        if (getAvail(product as ResourceConstant) >= keep) return null;
        const level = Number(commodityInfo(product)?.level ?? 0);
        if (!isFactoryLevelCompatible(effectiveLevel, level)) return null;
        const resolved = resolveProducible(product, 0, getMinQuota(product as ResourceConstant));
        if (!resolved) return null;
        if (resolved.product === (product as ResourceConstant)) return { product: resolved.product, limit: keep };
        const cur = getAvail(resolved.product);
        return { product: resolved.product, limit: cur + resolved.needOutput };
    };

    // 1) 压缩：zipMap 全量（不局限 mineralType），但需要底物明显富余
    for (const [raw, zip] of Object.entries(zipMap)) {
        const rawKeep = zipRawSurplusMin[raw];
        if (rawKeep && getAvail(raw as ResourceConstant) < rawKeep) continue;
        const picked = pickKeeped(String(zip));
        if (picked) return picked;
    }

    // 2) 白色根商品（作为高阶商品/后续链条底物）
    for (const product of [RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]) {
        const picked = pickKeeped(product);
        if (picked) return picked;
    }

    // 3) 基础四色中间件（wire/cell/alloy/condensate）
    for (const product of [RESOURCE_WIRE, RESOURCE_CELL, RESOURCE_ALLOY, RESOURCE_CONDENSATE]) {
        const picked = pickKeeped(product);
        if (picked) return picked;
    }

    // 4) 四色链条兜底：按工厂有效等级，挑“最缺的可生产项”
    if (Number.isFinite(effectiveLevel) && effectiveLevel >= 0) {
        const keep = Number(keepByLevelInRoom[effectiveLevel] || 0);
        if (keep > 0) {
            let best: FallbackPick | null = null;
            let bestHave = Infinity;
            for (const product of Object.keys(COMMODITIES)) {
                const info = commodityInfo(product);
                const level = Number(info?.level ?? 0);
                if (level !== effectiveLevel) continue;
                const tags = classify(product);
                if (!tags.colored) continue;
                if ((tags.rootsMask & ~availableMask) !== 0) continue;
                const have = getAvail(product as ResourceConstant);
                if (have >= keep) continue;
                const resolved = resolveProducible(product, 0, getMinQuota(product as ResourceConstant));
                if (!resolved) continue;
                const resolvedHave = getAvail(resolved.product);
                if (resolvedHave < bestHave) {
                    bestHave = resolvedHave;
                    const limit = resolved.product === (product as ResourceConstant)
                        ? keep
                        : getAvail(resolved.product) + resolved.needOutput;
                    best = { product: resolved.product, limit };
                }
            }
            if (best) return best;
        }
    }

    // 5) 降级策略：当所有任务都达到目标库存时，降低阈值重新尝试
    const degradeRatio = 0.5;
    let degradeAttempt = 0;
    const getReducedThreshold = (targetKeep: number, attempt: number) => Math.max(targetKeep * Math.pow(degradeRatio, attempt), 100);

    while (degradeAttempt < 3) {
        for (const product of [RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]) {
            if (isBanned && isBanned(product)) continue;
            const keep = Number(keepInRoom[product] || 0);
            if (keep <= 0) continue;
            const level = Number(commodityInfo(product)?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, level)) continue;
            const reducedKeep = getReducedThreshold(keep, degradeAttempt);
            if (getAvail(product as ResourceConstant) >= keep) {
                if (getAvail(product as ResourceConstant) < reducedKeep) {
                    const resolved = resolveProducible(product, 0, getMinQuota(product as ResourceConstant));
                    if (resolved && resolved.product === (product as ResourceConstant)) {
                        return { product: resolved.product, limit: reducedKeep };
                    }
                }
            }
        }

        for (const product of [RESOURCE_WIRE, RESOURCE_CELL, RESOURCE_ALLOY, RESOURCE_CONDENSATE]) {
            if (isBanned && isBanned(product)) continue;
            const keep = Number(keepInRoom[product] || 0);
            if (keep <= 0) continue;
            const level = Number(commodityInfo(product)?.level ?? 0);
            if (!isFactoryLevelCompatible(effectiveLevel, level)) continue;
            const reducedKeep = getReducedThreshold(keep, degradeAttempt);
            if (getAvail(product as ResourceConstant) >= keep) {
                if (getAvail(product as ResourceConstant) < reducedKeep) {
                    const resolved = resolveProducible(product, 0, getMinQuota(product as ResourceConstant));
                    if (resolved && resolved.product === (product as ResourceConstant)) {
                        return { product: resolved.product, limit: reducedKeep };
                    }
                }
            }
        }

        if (Number.isFinite(effectiveLevel) && effectiveLevel >= 0) {
            const keep = Number(keepByLevelInRoom[effectiveLevel] || 0);
            if (keep > 0) {
                for (const product of Object.keys(COMMODITIES)) {
                    const info = commodityInfo(product);
                    const level = Number(info?.level ?? 0);
                    if (level !== effectiveLevel) continue;
                    const tags = classify(product);
                    if (!tags.colored) continue;
                    if ((tags.rootsMask & ~availableMask) !== 0) continue;
                    const have = getAvail(product as ResourceConstant);
                    if (have >= keep) {
                        const reducedKeep = getReducedThreshold(keep, degradeAttempt);
                        if (have < reducedKeep) {
                            const resolved = resolveProducible(product, 0, getMinQuota(product as ResourceConstant));
                            if (resolved && resolved.product === (product as ResourceConstant)) {
                                return { product: resolved.product, limit: reducedKeep };
                            }
                        }
                    }
                }
            }
        }

        degradeAttempt++;
    }

    return null;
};
