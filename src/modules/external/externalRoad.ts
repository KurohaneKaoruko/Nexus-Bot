
/**
 * 外矿道路模块入口: 汇出缓存、内存、寻路、建造与可视化各子模块。
 * 实现按职责拆分在 road/ 目录下。
 */

export { CostMatrixCache } from '@/modules/external/road/costMatrixCache';
export { RoadMemory } from '@/modules/external/road/roadMemory';
export { PathPlanner } from '@/modules/external/road/pathPlanner';
export { RoadBuilder } from '@/modules/external/road/roadBuilder';
export { RoadVisual, getBuiltRoadCoverage } from '@/modules/external/road/roadVisual';
