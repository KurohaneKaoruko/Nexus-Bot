/**
 * 外矿/扩张域入口: 跨 shard 扩张 (expand/)。
 * 外矿路网旧链 (externalRoad / road/*) 已随 external-legacy-retire 退役;
 * 现行路网事实源是 Nexus.layout.roads (modules/planner/roadPlanner)。
 */
export { Expansion } from '@/modules/external/expand';
