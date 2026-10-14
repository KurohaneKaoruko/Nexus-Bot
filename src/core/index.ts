/**
 * 内核契约类型统一出口: 模块侧统一从 "@/core" 引用, 免深路径。
 * 仅收口跨模块契约 (调度/上下文/阶段/预算带); world 与 store 领域类型仍按领域路径引用。
 */
export type { TickModule, TickScheduler } from "./scheduler";
export type { TickContext } from "./tickContext";
export type { TickPhase } from "./phases";
export type { PriorityBand } from "./cpuBudget";
