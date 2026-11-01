# API-05：TaskBoard、任务生命周期与 Allocator

## 5.1 设计目标

任务属于蜂群，而不是某一只 Creep。机体只是任务的暂时执行者。每个任务都必须有唯一标识、可去重的语义键、明确的状态迁移、失败原因和回收规则。

## 5.2 核心类型

```ts
export type TaskKind =
  | "harvest" | "carry" | "fill_spawn" | "upgrade"
  | "build" | "repair" | "scout" | "reserve" | "claim"
  | "defend" | "attack" | "heal" | "boost"
  | "terminal_transfer" | "factory_produce";

export type TaskStatus =
  | "available" | "leased" | "in_progress"
  | "completed" | "failed" | "cancelled";

export interface SerializedPosition {
  x: number;
  y: number;
  roomName: string;
}

export interface NexusTask {
  id: string;
  dedupeKey: string;
  kind: TaskKind;
  status: TaskStatus;
  roomName: string;
  targetId?: string;
  targetPos?: SerializedPosition;
  resourceType?: ResourceConstant;
  amount?: number;
  priority: number;
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  requiredCapabilities: string[];
  assignedTo?: string;
  leaseUntil?: number;
  lastProgressTick?: number;
  attempts: number;
  maxAttempts: number;
  failureReason?: string;
}
```

`ResourceConstant` 来自锁定的 Screeps 类型声明。若目标类型包未暴露某个类型，不要随意改为 `any`；先核验版本，再使用项目明确列举的兼容类型。

## 5.3 TaskBoard 公共 API

```ts
export interface TaskQuery {
  roomName?: string;
  kinds?: TaskKind[];
  statuses?: TaskStatus[];
  minPriority?: number;
  unassignedOnly?: boolean;
}

export interface TaskBoard {
  get(id: string): NexusTask | undefined;
  list(query?: TaskQuery): readonly NexusTask[];
  upsert(input: NewTaskInput): NexusTask;
  claim(taskId: string, creepName: string, now: number, leaseTicks: number): boolean;
  heartbeat(taskId: string, creepName: string, now: number, leaseTicks: number): boolean;
  markProgress(taskId: string, creepName: string, now: number): boolean;
  complete(taskId: string, creepName: string, now: number): boolean;
  fail(taskId: string, creepName: string | undefined, now: number, reason: string): boolean;
  release(taskId: string, creepName: string, now: number, reason?: string): boolean;
  cancel(taskId: string, now: number, reason: string): boolean;
  reconcile(now: number, liveness: UnitLiveness): ReconcileSummary;
}
```

`NewTaskInput` 应省略自动生成字段（如 id/createdAt/attempts）并允许调用方提供 idempotent `dedupeKey`。实现时在 schema 中定义其确切类型，不能把 `NexusTask` 的所有字段都设成可选来代替合法的创建合同。

## 5.4 状态机与不变量

允许的状态迁移：

```text
available -> leased -> in_progress -> completed
available -> failed
leased -> available          (释放、持有人丢失、租约到期)
in_progress -> available     (可恢复失败并重新排队)
leased/in_progress -> failed (达到失败上限或任务已不可执行)
available/leased/in_progress -> cancelled (战略取消)
```

终态 `completed`、`failed`、`cancelled` 不应自动恢复为活动态。若需要重试，应新建任务 ID 或按明确的 retry policy 重置同一任务；不要静默复用终态记录。

关键不变量：

- `dedupeKey` 唯一表示某段时间内的一种任务意图；upsert 必须幂等。
- 任务只能由当前 `assignedTo` 的执行者 heartbeat、progress、complete 或 release；系统管理操作需要明确的管理员/系统通道。
- `leaseUntil <= now` 即租约过期。
- 目标不存在、失效或已达成，应清理/终止任务；不可仅依靠租约到期回收。
- `attempts` 在实际失败后按统一规则增长，创建时不因规划重复运行增长。
- 任务达到 `maxAttempts` 后进入 `failed` 或进入显式的隔离队列，不可永远循环。
- `deadline` 应定义边界：本手册约定 `now > deadline` 为过期；整个代码库保持一致。

## 5.5 Lease 建议

```ts
export interface LeasePolicy {
  defaultTicks: number;
  byKind: Partial<Record<TaskKind, number>>;
  heartbeatGraceTicks: number;
  maxAttemptsByKind: Partial<Record<TaskKind, number>>;
}
```

不同任务的 lease 应不同：采集/升级可长一些；短期填充、一次性紧急防御应短；跨房间搬运须覆盖旅行时间或按路线进度 heartbeat。不要给所有任务同一个 lease。

任务回收要同时判断：单位是否存活/正在出生、任务目标是否仍有效、是否取得进展、是否阻塞、是否到期、目的地是否已无空间、任务是否仍被战略需要。

## 5.6 Allocator API

```ts
export interface CapabilityProfile {
  work: number;
  carry: number;
  move: number;
  melee: number;
  ranged: number;
  heal: number;
  claim: number;
  tough: number;
  boostTags: string[];
  ttlRemaining: number;
  fatigue: number;
  freeCarry: number;
}

export interface AllocationCandidate {
  creepName: string;
  taskId: string;
  capabilityFit: number;
  travelCost: number;
  riskCost: number;
  switchCost: number;
  urgency: number;
  utility: number;
  criticality: number;
}

export interface Assignment {
  creepName: string;
  taskId: string;
  score: number;
}

export interface Allocator {
  profile(creep: Creep): CapabilityProfile;
  canExecute(profile: CapabilityProfile, task: NexusTask): boolean;
  score(candidate: AllocationCandidate): number;
  assignBatch(ctx: TickContext, world: WorldView): readonly Assignment[];
}
```

算法约定：

1. 先做硬性资格过滤（身体部件、任务类型、目标状态、路程与 TTL、所在房间/允许区域）。
2. 再进行效用评分：紧急性、关键性、能力匹配、运输成本、危险、当前任务切换成本。
3. 应处理任务容量与互斥（如固定采矿工位、唯一站点或有限运输需求）。
4. 首版可使用贪心分配：按“未满足任务优先级 × 可执行候选质量”排序，逐一分配；未来再升级到二分匹配/最小费用最大流。
5. 设置 hysteresis（切换阈值）：新任务必须比当前任务显著更好才切换，防止每 Tick 抖动。
6. 每次分配前检查 TaskBoard lease，分配成功后更新 lease/UnitMemory，失败不应留下半更新状态。

初始评分示例（权重需实测，不是游戏常量）：

```ts
score = 100 * criticality
      + 30 * urgency
      + 20 * utility
      + 15 * capabilityFit
      - 2 * travelCost
      - 10 * riskCost
      - 8 * switchCost;
```

**不能依赖权重模拟硬约束。** 不可执行的候选应先被过滤掉，而不是靠扣分。

## 5.7 任务数据保存规则

持久化只保存任务序列化 DTO。任务的原生目标对象在执行 Tick 用 `Game.getObjectById` 重新解析；对象不存在时返回 `undefined/null` 必须有处理逻辑。任何闭包、回调函数、Creep 实例、Room 实例或 PathFinder 的非序列化对象都不能放在任务 Memory 里。
