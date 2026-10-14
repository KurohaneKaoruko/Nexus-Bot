/**
 * 每 Tick 执行阶段 (docs/nexus-design/03 §3.3 / docs/api/03 §3.4)。
 * 顺序固定且确定, 便于复现测试; 未实现的阶段零模块空跑, 后续阶段按此顺序填充模块。
 * bootstrap 与 telemetry 不作为调度阶段: bootstrap 在建上下文前完成, telemetry 在阶段链后收尾。
 * strategy 位于 emergency 与 planning 之间: 战略重估先于 Cluster 规划, 指令当 Tick 即生效。
 */
export const TICK_PHASES = [
	"perception",
	"emergency",
	"strategy",
	"planning",
	"reconcile",
	"spawn",
	"agents",
	"commit",
] as const;

export type TickPhase = (typeof TICK_PHASES)[number];
