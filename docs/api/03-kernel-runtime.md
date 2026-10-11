# API-03：Kernel、TickContext、CPU 与错误边界

## 3.1 Kernel API

Kernel 组织每 Tick 执行阶段；它不负责选择战略，也不应该包含采集/战斗的业务细节。

建议公共接口：

```ts
export type PriorityBand = "P0" | "P1" | "P2" | "P3";

export interface TickContext {
  readonly tick: number;
  readonly shardName: string;
  readonly cpu: CpuBudgetView;
  readonly memory: NexusMemory;
  readonly metrics: TickMetrics;
  readonly phase: TickPhase;
}

export type TickPhase =
  | "bootstrap" | "perception" | "emergency" | "planning"
  | "reconcile" | "spawn" | "agents" | "commit" | "telemetry";

export interface CpuBudgetView {
  readonly used: number;
  readonly limit: number;
  readonly tickLimit: number;
  readonly bucket: number;
  canRun(band: PriorityBand, estimatedCost?: number): boolean;
}
```

`TickContext` 是当前 Tick 的临时对象，不得存入 `Memory`。其中 `memory` 是经 `bootstrap` 迁移并校验后的自定义数据视图，而不是把原生 `Memory` 原样当作无类型字典。

## 3.2 CPU Budget API

```ts
export interface CpuBudget {
  snapshot(): CpuBudgetView;
  canRun(band: PriorityBand, estimatedCost?: number): boolean;
  measure<T>(name: string, fn: () => T): T;
  recordSkip(name: string, reason: "budget" | "not-due" | "disabled"): void;
  shouldRunPeriodic(key: string, interval: number, offset?: number): boolean;
}
```

行为契约：

- `P0`：必要的安全和防崩溃行动；除非无法运行，否则不得被可选分析抢占。
- `P1`：基本经济与单位行动；在正常预算内优先保障。
- `P2`：局部规划、任务重新评分与房间级优化；可延迟。
- `P3`：市场扫描、大范围路线重算、历史聚合和昂贵分析；仅在预算允许时运行。
- `estimatedCost` 是规划估值，不是保证；应记录估值误差并持续调整。
- 每个周期任务必须有 `maxInterval` / 最大可延迟周期或明确的饥饿保护。
- 通过 `Game.cpu.getUsed()` 等官方 API 取得真实用量；limit / tickLimit / bucket 以当前对象读数为准。不可假设帐户所有 tick 都可使用同样预算。

## 3.3 错误边界

```ts
export interface ModuleError {
  module: string;
  tick: number;
  code: "DATA" | "API" | "POLICY" | "INVARIANT" | "UNEXPECTED";
  message: string;
  roomName?: string;
  creepName?: string;
  taskId?: string;
  nativeReturnCode?: number;
}

export interface ErrorHandler {
  report(error: ModuleError): void;
  isCircuitOpen(module: string, tick: number): boolean;
  recordSuccess(module: string, tick: number): void;
}
```

错误策略：

- 单个目标失效：清除或重建该目标任务，不应中断整个 Tick。
- 可恢复 API 返回码：进入针对该错误的状态迁移，例如 `ERR_NOT_IN_RANGE` → 提交移动；`ERR_FULL` → 选择另一个接收者；`ERR_TIRED` → 等待并重试。
- 数据 schema 损坏：隔离有问题的条目；禁止将非法数据无限传播到其他模块。
- 未预期异常：包含模块、Tick 和任务上下文进行限频记录；关键模块应被独立保护。
- `catch` 不得空处理。记录后返回有定义的失败状态。

## 3.4 运行阶段接口

```ts
export interface TickModule {
  readonly name: string;
  readonly priority: PriorityBand;
  run(ctx: TickContext): void;
}

export interface TickScheduler {
  register(module: TickModule): void;
  runPhase(phase: TickPhase, ctx: TickContext): void;
}
```

约束：

- 模块间依赖通过显式接口注入；不依赖循环 import 的单例副作用。
- `register` 应拒绝重名模块并稳定排序；同优先级顺序应确定，便于复现测试。
- 除感知、迁移和纯计算以外的模块不能直接写原生行动。行动统一进入 `ActionBroker`。
- 模块退出时应保留可观测结果：成功、失败、跳过、耗时估计。

## 3.5 日志与指标

核心指标建议：

- 每模块 CPU 用量、跳过次数、估值与实际用量差；
- 任务创建/去重/领取/完成/失败/过期数；
- Creep 存活数、平均 TTL、替补不足量；
- Source 产出、物流运输量、能量在关键位置的分布；
- 出生请求等待时间与失败原因；
- 移动卡住、路径不完整、拥堵格与重规划次数；
- 敌方威胁等级、受损建筑、战损和 Safe Mode 使用情况；
- Memory 主体大小估计、segment 负载大小、schema 版本。

日志必须有限长、限频；不要把每个 Creep 的每个 Tick 行动详细日志永远保存到 Memory。
