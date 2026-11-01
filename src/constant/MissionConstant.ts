/**
 * 任务池词表（单一来源，spawn 池驻留）。
 * 六池 (transport/build/repair/terminal/mine/boost) 已随域 3.4 退役——语义在
 * planning 阶段任务板 (specs/mission-pool-retirement); spawn 池是孵化队列
 * 基建 (warSpawn/external 去重计数消费), 与 MissionPools 共栖保留。
 */
export const MISSION_POOL_NAMES = [
    'spawn',
] as const satisfies readonly MissionPoolName[];

export type MissionPoolId = (typeof MISSION_POOL_NAMES)[number];

/** 池名常量表：MISSION_POOLS.spawn 代替字面量 'spawn'（值类型为键字面量） */
export const MISSION_POOLS = Object.freeze(
    Object.fromEntries(MISSION_POOL_NAMES.map((name) => [name, name])),
) as { readonly [K in MissionPoolId]: K };
