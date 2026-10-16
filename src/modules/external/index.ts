
/**
 * 外矿/扩张域入口: 外矿采集 + 外环道路 + 跨 shard 扩张。
 */
export { default as OutMine, registerOutMineIncomeProvider } from '@/modules/external/outMine';
export { ExternalMineAnalysis, type ExternalMineSourceStat } from '@/modules/external/externalMine';
export {
	CostMatrixCache,
	PathPlanner,
	RoadBuilder,
	RoadMemory,
	RoadVisual,
	getBuiltRoadCoverage,
} from '@/modules/external/externalRoad';
export { Expansion } from '@/modules/external/expand';
