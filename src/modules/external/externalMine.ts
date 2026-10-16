
/**
 * 外矿原型链模块入口（休眠态：活链是 economy/remoteMining 任务板的 planRemoteHarvest）。
 * 汇出分析、状态、定编、孵化与运行时各子模块；实现按职责拆分在 mine/ 目录下。
 */

export { ExternalMineAnalysis, type ExternalMineSourceStat, type ExternalMineCarryPlan } from '@/modules/external/mine/analysis';
export { ExternalMineState, type OutMineTargetListKey, type ExternalMineTiming } from '@/modules/external/mine/state';
export { ExternalMineMath } from '@/modules/external/mine/math';
export { ExternalMineSpawner } from '@/modules/external/mine/spawner';
export { ExternalMine } from '@/modules/external/mine/runtime';
export { getOutmineSourceKey } from '@/modules/external/mine/shared';
