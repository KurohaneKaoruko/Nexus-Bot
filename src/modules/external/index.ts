
/**
 * 外矿/扩张域入口: 外环道路 + 跨 shard 扩张。
 * (外矿原型采集链 mine/* + outMine/externalMine/externalScheduler 已随
 *  legacy-consolidation-b C 波退役; 活链是 economy/remoteMining 任务板,
 *  人操簿记面是 console mine.ts + Memory.OutMineData。)
 */
export {
	CostMatrixCache,
	PathPlanner,
	RoadBuilder,
	RoadMemory,
	RoadVisual,
	getBuiltRoadCoverage,
} from '@/modules/external/externalRoad';
export { Expansion } from '@/modules/external/expand';
