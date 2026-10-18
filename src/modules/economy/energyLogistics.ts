

const STANDARD_RESERVE_BY_LEVEL: Record<number, number> = {
    1: 10000,
    2: 10000,
    3: 10000,
    4: 20000,
    5: 40000,
    6: 80000,
    7: 160000,
    8: 320000,
};

const FUNNEL_SURPLUS_STEP = 1500;

/** 本级标准储量 */
export const getStandardReserve = (level: number): number => STANDARD_RESERVE_BY_LEVEL[level] ?? 10000;

/** 计算房间能量等级（storage + terminal 能量口径） */
export const getEnergyLevel = (room: Room): number => {
    const standard = getStandardReserve(room.level);
    const total = (room.storage?.store[RESOURCE_ENERGY] || 0) + (room.terminal?.store[RESOURCE_ENERGY] || 0);
    if (total < standard) return Math.floor((100 * total) / standard);
    return 100 + Math.round((total - standard) / FUNNEL_SURPLUS_STEP);
};
