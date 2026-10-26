/**
 * race 变体冲级赛直通入口: 整个 tick 委托给 src/branch/race/speedrun 固定布局 bot。
 * 仅当构建开关 SPEEDRUN_MODE=1 时由 rolldown 选为本变体入口 (nexus.ts 不参与打包)。
 *
 * 为什么物理隔离: speedrun bot 原地搬自上游 (单 spawn 固定布局), 依赖裸
 * Creep.prototype.move/moveTo; Nexus 模块链顶层的 betterMove 覆写会拦截
 * move 意图 (move intent 丢失, 蠕虫原地不动)。两者不能共存于同一 bundle。
 */
export { loop } from "./speedrun";
