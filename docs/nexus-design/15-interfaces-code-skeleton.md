# 15. 核心接口与 TypeScript 代码骨架

> 本章提供架构约定和参考骨架。它不是完整可编译的 Bot：需要在项目中补齐模块实现、Screeps API 类型、测试与构建配置。命名可按实际项目调整，但模块责任和状态边界应尽量保留。

## 15.1 主循环

```ts
// src/main.ts
import { bootstrapNexus } from "./persistence/bootstrap";
import { createTickContext } from "./kernel/tickContext";
import { perception } from "./world/perception";
import { worldModel } from "./world/worldModel";
import { threatModel } from "./world/threatModel";
import { nexusCore } from "./nexus/brain";
import { taskBoard } from "./nexus/taskBoard";
import { allocator } from "./nexus/allocator";
import { spawnDirector } from "./spawning/spawnDirector";
import { agentSystem } from "./agents/agentSystem";
import { actionBroker } from "./kernel/actionBroker";
import { telemetry } from "./telemetry/metrics";

export function loop(): void {
  const memory = bootstrapNexus();
  const ctx = createTickContext(memory);

  ctx.runIsolated("perception", () => {
    const observation = perception.collect(ctx);
    worldModel.update(ctx, observation);
    threatModel.update(ctx, observation);
  });

  ctx.runIsolated("emergency-defense", () => {
    // 只创建高优先级防御计划；实际行动仍交给统一仲裁器。
    threatModel.proposeEmergencyTasks(ctx);
  });

  ctx.runIfBudget("global-planning", "P2", () => {
    nexusCore.evaluate(ctx, worldModel.view(ctx));
  });

  ctx.runIsolated("task-reconcile", () => {
    taskBoard.reconcile(ctx, worldModel.view(ctx));
    allocator.assign(ctx, worldModel.view(ctx));
  });

  ctx.runIsolated("spawn-planning", () => {
    spawnDirector.plan(ctx, worldModel.view(ctx));
  });

  ctx.runIsolated("agents", () => {
    agentSystem.proposeActions(ctx, worldModel.view(ctx));
  });

  ctx.runIsolated("action-broker", () => actionBroker.commit(ctx));
  telemetry.flush(ctx);
}
```

`runIsolated` 必须报告错误而不静默吞掉；`runIfBudget` 应对跳过的任务计数，避免长期饥饿。实际系统可以将防御计划、生产和行动顺序进一步拆分，但不应让模块绕过 ActionBroker 乱写指令。

## 15.2 任务模型

```ts
export type TaskKind =
  | "harvest" | "haul" | "fill_spawn" | "upgrade"
  | "build" | "repair" | "scout" | "reserve" | "claim"
  | "defend" | "attack" | "heal" | "boost"
  | "terminal_transfer" | "factory_produce";

export type TaskStatus =
  | "available" | "leased" | "in_progress"
  | "completed" | "failed" | "cancelled";

export interface NexusTask {
  id: string;
  dedupeKey: string;
  kind: TaskKind;
  status: TaskStatus;
  roomName: string;
  targetId?: string;
  targetPos?: { x: number; y: number; roomName: string };
  priority: number;
  createdAt: number;
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

## 15.3 Task 与能力匹配

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
  ttlRemaining?: number;
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

export function scoreCandidate(c: AllocationCandidate): number {
  return 100 * c.criticality
    + 30 * c.urgency
    + 20 * c.utility
    + 15 * c.capabilityFit
    - 2 * c.travelCost
    - 10 * c.riskCost
    - 8 * c.switchCost;
}
```

权重只是初始例子，实际要按数据校准。应先用硬条件排除不合法候选，再计算评分；不要使用极端权重来“模拟”硬约束。

## 15.4 任务租约与回收

```ts
export function shouldReleaseTask(
  task: NexusTask,
  now: number,
  assignedCreepExists: boolean,
  targetStillValid: boolean,
): boolean {
  if (!targetStillValid) return true;
  if (task.assignedTo && !assignedCreepExists) return true;
  if (task.leaseUntil !== undefined && task.leaseUntil < now) return true;
  if (task.deadline !== undefined && task.deadline < now) return true;
  return false;
}
```

实际实现还应判断任务是否已达成、是否正在产生有效进展、目标容量是否已满，以及失败次数是否到上限。

## 15.5 Action Broker 的最低要求

```ts
export type ActionIntent =
  | { kind: "move"; creepName: string; taskId: string; priority: number; run: () => number }
  | { kind: "work"; creepName: string; taskId: string; priority: number; run: () => number }
  | { kind: "combat"; creepName: string; taskId: string; priority: number; run: () => number }
  | { kind: "heal"; creepName: string; taskId: string; priority: number; run: () => number }
  | { kind: "structure"; structureId: string; taskId: string; priority: number; run: () => number };
```

上面只是抽象形式。真正的 `run` 闭包只在当前 Tick 存在，不允许放入 Memory。Broker 应按目标单位、依赖管线、优先级、重复调用和动作类别统一检查。

Broker 要特别谨慎：Screeps 官方行动规则并不等于每单位每 Tick 只能执行一个意图。某些行动可以与其他行动并行，另一些属于有优先级关系的执行管线。推荐根据已知的官方冲突表建立规则，并对具体版本做测试，而不是自行猜测。

## 15.6 SpawnRequest

```ts
export interface SpawnRequest {
  id: string;
  purpose: string;
  homeRoom: string;
  targetRoom?: string;
  taskId?: string;
  priority: number;
  energyBudget: number;
  requiredCapabilities: string[];
  desiredThroughput?: number;
  expectedTravelTicks?: number;
  safetyMarginTicks?: number;
  replacementFor?: string;
  expiresAt?: number;
}
```

BodyFactory 根据请求与当前房间可用能量返回合法 body，再交给 SpawnDirector 处理命名、生产队列和实际提交。生成失败时要检查当前能源、身体部件成本、Spawn 状态、名称冲突和请求过期。

## 15.7 资源承诺

```ts
export interface ResourceReservation {
  id: string;
  owner: string;
  roomName: string;
  resourceType: string;
  amount: number;
  createdAt: number;
  expiresAt: number;
  status: "reserved" | "committed" | "released";
}
```

“库存存在”不等于“库存可用”。所有需要未来消耗资源的扩张、Spawn、Boost、生产和市场模块都必须通过账本申请预留。

## 15.8 最低接口清单

- `TickContext`：当前 Tick、预算、观察缓存、Action Plan、日志字段。
- `WorldModel`：Intel 新鲜度、可见对象摘要、房间能力与威胁视图。
- `NexusCore`：战略状态、目标优先级、资源储备线。
- `TaskBoard`：任务状态、去重、租约、失败处理。
- `Allocator`：候选筛选、匹配与重分配。
- `AgentSystem`：把任务映射为候选意图。
- `ActionBroker`：统一校验与提交。
- `SpawnDirector` / `BodyFactory`：能力缺口到生产需求。
- `EconomyLedger`：库存、预留、承诺与结算。
- `RoomGraph` / `PathCache` / `TrafficManager`：导航与交通。
- `Telemetry`：指标与限频可视化。

