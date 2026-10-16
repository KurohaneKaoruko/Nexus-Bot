# Nexus-Bot（dev）架构设计、源码审计与重构指导文档

> 基线：`KurohaneKaoruko/Nexus-Bot` 的 `dev` 分支  
> 定位：Screeps Bot / EX-MACHINA NEXUS  
> 目标：在保留旧 Bot 实战算法资产的前提下，完成统一控制平面、任务驱动、分层自治、可测试、可恢复、可扩展的重构。
>
> 本文不是“重新设计一个 Bot”，而是**对现有 Nexus-Bot 做架构收编**：旧代码保留算法价值，新架构夺取控制权。

---

# 1. 执行摘要

## 1.1 核心判断

当前 Nexus-Bot 已经拥有 NEXUS 架构的多个重要组件：

- TickContext / Kernel
- Perception / World
- Strategy
- Economy
- Cluster
- Task
- Agent
- ActionBroker
- Movement
- Spawning
- Defense
- Teams
- Industry
- Expansion
- InterShard
- Telemetry

因此项目的问题不是“没有架构”，而是：

> **新架构和旧 Bot 仍然同时拥有部分控制权。**

当前系统存在多个潜在控制平面：

```text
Nexus Kernel
   ├── Task / Agent / ActionBroker
   ├── Legacy Role / Prototype
   ├── Teams
   ├── Industry
   ├── Expansion
   └── Movement Runtime
```

如果这些系统都能直接操作 Creep、Structure 或 Spawn，就会形成：

- 行为覆盖
- 任务抢占
- 重复移动
- 重复资源操作
- 状态不一致
- 无法解释“是谁做的”
- 无法可靠测试
- 无法建立统一 CPU/错误/Telemetry 管线

所以本次重构的第一原则是：

> **Ownership First：先统一控制权，再整理业务模块。**

---

# 2. 设计目标

Nexus 最终应成为一个：

> **分层自治的集体智能体系统**

而不是传统的“Creep Role 集合”。

目标层级：

```text
Nexus
  ↓
Cluster
  ↓
Goal
  ↓
Task / Squad
  ↓
Agent
  ↓
Intent
  ↓
Command
  ↓
Screeps API
  ↓
World Observation
  └──────────────→ Nexus
```

对应机凯种式概念：

| 软件层 | 概念 |
|---|---|
| NexusCore | 集体意识 |
| WorldModel | 集体感知 |
| Memory | 长期记忆 |
| Cluster | 局部意识 |
| TaskBoard | 神经系统中的工作分配 |
| Agent | 执行机体 |
| Squad | 多机协同单元 |
| CommandBus | 运动/执行神经系统 |
| Telemetry | 自我诊断 |
| Strategy | 集体决策 |

---

# 3. Screeps 运行模型对架构的硬约束

## 3.1 Tick 是系统的基本时间单位

每个 Tick 都应该被视为一个离散事务周期：

```text
Tick N
  ↓
读取世界
  ↓
计算
  ↓
提交行动
  ↓
游戏引擎结算
  ↓
Tick N+1
  ↓
观察结果
```

不能把“调用 API”理解成“世界已经发生变化”。

例如：

```ts
creep.harvest(source);
```

不能立刻根据同一个旧快照假设：

```ts
creep.store.getUsedCapacity() === newValue;
```

正确思想：

```text
Intent
  ↓
API Call
  ↓
Accepted / Rejected
  ↓
Next Tick Observation
  ↓
State Reconciliation
```

## 3.2 Game 与 Memory 必须严格分离

`Game`：

- 当前 Tick 的实时世界对象
- 不应持久化
- 对象引用不能跨 Tick 保存

`Memory`：

- 跨 Tick 状态
- 只能保存可序列化数据
- 必须有 schema/version
- 必须有 migration
- 必须主动清理

推荐：

```ts
Memory.nexus.rooms[roomName]
```

保存数据，而不是：

```ts
Memory.nexus.rooms[roomName].room = Game.rooms[roomName]
```

## 3.3 CPU 是架构约束

系统必须允许：

```text
P0 Critical
P1 Runtime
P2 Planning
P3 Optimization
```

不同计算等级使用不同预算。

不要让：

```text
Market Analysis
Path Recalculation
Room Layout
Intel Compression
```

阻塞：

```text
Emergency Defense
Spawn
Critical Logistics
```

---

# 4. 目标架构

推荐最终结构：

```text
src/
├── kernel/
│   ├── loop.ts
│   ├── scheduler.ts
│   ├── phases.ts
│   ├── tickContext.ts
│   └── faultIsolation.ts
│
├── runtime/
│   ├── commandBus.ts
│   ├── eventBus.ts
│   ├── actorOwnership.ts
│   ├── actorRegistry.ts
│   └── runtimeState.ts
│
├── world/
│   ├── perception/
│   ├── model/
│   ├── intel/
│   └── topology/
│
├── state/
│   ├── schema/
│   ├── migration/
│   ├── repository/
│   └── indexes/
│
├── strategy/
├── cluster/
├── tasks/
├── agents/
│
├── commands/
│   ├── creep/
│   ├── movement/
│   ├── spawn/
│   ├── construction/
│   ├── structure/
│   ├── market/
│   └── intershard/
│
├── economy/
├── spawning/
├── construction/
├── movement/
├── defense/
├── combat/
├── expansion/
├── industry/
│
├── adapters/
│   ├── legacy/
│   ├── teams/
│   ├── movement/
│   ├── industry/
│   └── external/
│
└── telemetry/
```

---

# 5. 六层职责模型

## Layer 0：Kernel

职责：

- Tick 生命周期
- phase 顺序
- CPU budget
- error isolation
- runtime context

禁止：

- 具体经济策略
- 直接控制 Creep
- 具体战斗算法

---

## Layer 1：World

职责：

- 感知 Game
- 建立 snapshot
- Intel
- threat model
- room topology

禁止：

- 创建任务
- 修改游戏
- 做战略决策

---

## Layer 2：Decision

包括：

- NexusCore
- Strategy
- Cluster
- Economy
- Defense
- Expansion

输出：

```text
Goal
Directive
Plan
Demand
```

而不是：

```text
creep.move()
creep.harvest()
spawn.spawnCreep()
```

---

## Layer 3：Coordination

包括：

- TaskBoard
- TaskAllocator
- Squad
- ResourceLedger
- ActorOwnership

职责：

> 决定“谁负责什么”。

---

## Layer 4：Execution

包括：

- Agent FSM
- Movement
- BodyFactory
- Team Adapter
- Industry Adapter

职责：

> 决定“如何完成已经决定的事情”。

---

## Layer 5：Mutation

唯一允许接触原生 mutation API 的边界：

```text
CommandBus
  ↓
Command Adapter
  ↓
Screeps API
```

原则：

> Planning 不得 mutation。

---

# 6. Actor Ownership：必须新增的核心机制

## 6.1 问题

当前存在：

```text
Nexus Agent
Legacy Role
Team
Power
Movement Runtime
```

都可能触及 Actor。

因此必须建立：

```ts
type ActorOwner =
  | "nexus"
  | "team"
  | "legacy"
  | "power"
  | "system";
```

## 6.2 Ownership Record

```ts
interface ActorOwnership {
  actorId: string;
  owner: ActorOwner;

  acquiredAt: number;
  leaseUntil?: number;

  reason: string;
}
```

## 6.3 不变量

任何 Actor 在一个 Tick 中只能有一个 authoritative owner：

```text
Creep A
  owner = nexus
```

TeamController 不得直接操作它。

## 6.4 迁移策略

第一阶段允许：

```text
legacy
```

但所有 legacy actor 必须注册。

第二阶段：

```text
legacy actor
  ↓
adapter
  ↓
nexus ownership
```

第三阶段删除 legacy owner。

---

# 7. World Model

## 7.1 不允许业务系统直接扫描 Game

不要：

```ts
for (const roomName in Game.rooms) {
  ...
}
```

散落在：

- Economy
- Defense
- Spawn
- Tasks
- Industry

中。

应该：

```text
Game
 ↓
Perception
 ↓
WorldSnapshot
 ↓
Domain Views
```

## 7.2 推荐模型

```ts
interface WorldSnapshot {
  tick: number;

  rooms: Map<string, RoomSnapshot>;
  actors: Map<string, ActorSnapshot>;

  resources: ResourceSnapshot;
  threats: ThreatSnapshot;
  topology: TopologySnapshot;
}
```

## 7.3 当前观察与历史 Intel 分开

```text
VisibleState
HistoricalIntel
```

绝对不能把过期 Intel 当实时状态。

Intel 必须有：

```ts
observedAt
expiresAt
confidence
```

---

# 8. NexusCore

NexusCore 不负责“让 Creep 干活”。

它负责：

```text
Assess
 ↓
Prioritize
 ↓
Set Objective
 ↓
Allocate Budget
```

例如：

```text
当前：
能源储备低
RCL 即将升级
远程矿收益高
敌方威胁低

输出：

Objective:
  "Accelerate RCL"

Constraints:
  energyReserve >= X
  defenseLevel >= Y
```

然后交给：

```text
Economy
Spawn
Task
Cluster
```

各自执行。

---

# 9. Cluster

Cluster 是房间级自治层。

推荐：

```ts
interface RoomCluster {
  roomName: string;

  posture:
    | "bootstrap"
    | "develop"
    | "industrial"
    | "defensive"
    | "expansion"
    | "recovery";

  goals: GoalId[];

  resourceState: ResourceState;
  threatState: ThreatState;

  taskPolicy: TaskPolicy;
}
```

Cluster 可以：

- 判断房间缺什么
- 生成需求
- 选择本地策略

但不能绕过 Nexus 的全局预算。

---

# 10. Goal → Task

这是整个项目的核心链路。

```text
Goal
 ↓
Directive
 ↓
Plan
 ↓
Task
 ↓
Assignment
 ↓
Agent
```

例如：

```text
Goal:
  提升 RCL

Directive:
  maintain upgrade energy throughput

Plan:
  maintain upgrader workforce

Tasks:
  harvest
  haul
  upgrade
```

不要让：

```text
Upgrader
```

自己决定：

```text
我要去挖矿
```

否则系统会退化成传统 Role Bot。

---

# 11. TaskBoard

Task 是跨 Tick 的协调单位。

推荐：

```ts
interface Task {
  id: string;
  kind: string;

  roomName: string;
  targetId?: string;

  priority: number;

  status:
    | "open"
    | "assigned"
    | "blocked"
    | "completed"
    | "cancelled";

  assignedTo?: string;

  createdAt: number;
  updatedAt: number;

  leaseUntil?: number;
  attempts: number;

  dedupeKey?: string;
}
```

## 11.1 Lease

Creep 死亡后：

```text
Task
 ↓
lease expires
 ↓
Task becomes open
 ↓
Allocator reassigns
```

不能永久绑定：

```text
task.assignedTo = deadCreep
```

## 11.2 Task Index

Memory：

```text
tasks
```

Runtime：

```text
byId
byRoom
byStatus
byKind
byActor
byDedupeKey
```

不要每次：

```ts
Object.values(tasks)
```

扫描全部任务。

---

# 12. Agent System

Agent 是执行器，不是战略系统。

推荐：

```ts
interface AgentRuntime {
  actorId: string;
  taskId?: string;
  state: AgentState;
}
```

状态机：

```text
AcquireTask
   ↓
Validate
   ↓
PlanStep
   ↓
SubmitIntent
   ↓
ObserveResult
   ↓
Continue
```

异常：

```text
TargetInvalid
   ↓
Replan

Blocked
   ↓
Retry / Reroute

TaskExpired
   ↓
Release

ActorDead
   ↓
RecoverTask
```

---

# 13. Intent 与 Command 必须分离

这是一个关键设计。

Intent：

> “我想完成什么。”

Command：

> “调用哪个 Screeps API。”

例如：

```ts
interface MoveIntent {
  type: "move";
  actorId: string;
  target: PositionRef;
}
```

Command：

```ts
interface MoveCommand {
  type: "move";
  actorId: string;
  direction: DirectionConstant;
}
```

中间经过：

```text
Movement Planner
```

因此 Agent 不需要知道：

```ts
findPath()
CostMatrix
traffic
moveMatch
```

---

# 14. ActionBroker / CommandBus

当前 ActionBroker 应升级为真正的 mutation boundary。

推荐：

```text
Intent
 ↓
Validation
 ↓
Ownership Check
 ↓
Conflict Resolution
 ↓
Command
 ↓
Commit
 ↓
Result
```

## 14.1 Result 不要伪造 native code

错误：

```ts
nativeReturnCode: ERR_NOT_ENOUGH_ENERGY
```

但实际上没有调用 native API。

正确：

```ts
interface ActionResult {
  accepted: boolean;

  nativeReturnCode?: ScreepsReturnCode;

  category:
    | "accepted"
    | "retryable"
    | "replan"
    | "invalid"
    | "suppressed";

  reason?: string;
}
```

内部原因和 Screeps 原生返回值必须分离。

---

# 15. Movement 重构

当前 Movement 已经具有大量实战价值。

不要重写。

改为：

```text
Nexus MoveIntent
       ↓
TrafficManager
       ↓
MovementEngine
       ↓
Legacy / BetterMove Adapter
       ↓
native movement
```

## Movement Engine 职责

- 路径
- CostMatrix
- traffic
- cross-room
- avoidance
- formation
- cache
- invalidation

## Agent 不得直接调用

```ts
creep.moveTo()
```

除非属于明确的低级 adapter。

---

# 16. Spawn Architecture

当前 SpawnDirector 职责过多，应拆成：

```text
Demand Sources
 ├── Staffing
 ├── Replacement
 ├── Defense
 ├── Expansion
 └── Special
        ↓
SpawnDemand
        ↓
SpawnArbiter
        ↓
BodyFactory
        ↓
SpawnQueue
        ↓
SpawnCommand
```

## SpawnDemand

```ts
interface SpawnDemand {
  kind: string;
  roomName: string;

  priority: number;

  requiredCapabilities: string[];

  deadline?: number;

  minBody?: BodyPlan;
  maxCost?: number;

  reason: string;
}
```

SpawnDirector 不应该自己理解所有业务。

---

# 17. Economy

经济系统应该回答：

> “文明现在缺什么？”

而不是：

> “我要让某个 Creep 去搬东西。”

建议：

```text
Observation
 ↓
Resource Ledger
 ↓
Flow Model
 ↓
Forecast
 ↓
Deficit
 ↓
Demand
```

资源状态区分：

```text
Observed
Available
Reserved
Committed
Projected
```

## 资源账本不变量

```text
Available =
Observed
- Reserved
- Committed
```

具体定义必须统一，禁止不同模块自行解释。

---

# 18. Economy → Spawn

错误：

```text
Economy
 ↓
spawnCreep()
```

正确：

```text
Economy
 ↓
LaborDemand
 ↓
SpawnDemand
 ↓
SpawnArbiter
```

这样以后：

```text
Economy
Defense
Expansion
```

可以竞争 Spawn，但最终只有一个 Arbiter 决定。

---

# 19. Construction

当前 Planner 直接执行：

```ts
createConstructionSite()
```

这是必须修改的。

正确：

```text
Planner
 ↓
ConstructionIntent
 ↓
ConstructionCommand
 ↓
CommandBus
 ↓
createConstructionSite
```

Planning 永远不 mutation。

Construction 进一步拆：

```text
RoomPlanner
ConstructionPlanner
ConstructionQueue
RepairPlanner
```

---

# 20. Defense

Defense 只负责：

```text
Threat Assessment
 ↓
Defensive Posture
 ↓
Defense Demand
```

不应该直接抢夺普通 Agent。

例如：

```text
Threat detected
 ↓
Defense creates urgent Task
 ↓
Task priority > economy
 ↓
Allocator
 ↓
Agent
```

如果确实需要战斗编队：

```text
Defense
 ↓
SquadRequest
 ↓
SquadManager
 ↓
TeamAdapter
```

---

# 21. Teams：保留，不重写

当前 Teams 已经有成熟战斗逻辑。

因此：

```text
Nexus Squad
 ↓
TeamAdapter
 ↓
Legacy Team Runtime
```

Nexus Squad 是战略真相源。

Legacy `TeamData` 只是执行状态。

不能同时存在：

```text
Nexus Squad
TeamData
```

两个独立的战略状态。

---

# 22. Industry：Adapter First

工业系统也不要全部重写。

迁移：

```text
Nexus Industry Intent
 ↓
Industry Adapter
 ↓
Existing Industry Engine
```

顺序：

```text
Link
 ↓
Terminal
 ↓
Lab
 ↓
Factory
 ↓
PowerSpawn
 ↓
Market
 ↓
PowerCreep
```

每迁移一个子系统，就禁止 Nexus 外部再次直接调用旧入口。

---

# 23. Event System

当前 EventBus / EndPhase / EventBusEnd 存在生命周期职责重复。

最终：

```text
Kernel
 ↓
EventRuntime
 ├── start
 ├── tick
 └── end
```

事件只描述：

```text
发生了什么
```

而不是：

```text
现在应该做什么
```

例如：

```ts
ActorDied
```

是事件。

```text
CreateReplacementDemand
```

是响应策略。

不要把两者混在 EventBus 中。

---

# 24. Telemetry

每个核心操作应该可追踪：

```text
tick
actor
task
intent
command
result
cpu
```

建议日志：

```text
[Task]
task=123
actor=CreepA
kind=haul

[Intent]
actor=CreepA
type=transfer

[Command]
type=transfer
target=Storage1

[Result]
accepted=true
nativeReturnCode=OK
```

这会让“为什么 Creep 不工作”从几小时排查变成几十秒定位。

---

# 25. CPU Architecture

CPU Budget 建议：

```text
P0:
Emergency Defense
Critical Spawn
Critical Recovery

P1:
Agent execution
Tasks
Economy
Movement

P2:
Strategy
Cluster
Room planning

P3:
Market
Optimization
Long-term analysis
Expensive path recalculation
```

每个模块获得：

```ts
if (!budget.allow("economy", estimatedCost)) {
  defer();
}
```

不要让业务模块自己读取：

```ts
Game.cpu.bucket
```

Kernel 提供统一 Budget。

---

# 26. Error Isolation

推荐：

```ts
runIsolated("economy", () => ...)
```

错误分类：

```text
Transient
InvalidState
InvariantViolation
ExternalAPI
Fatal
```

例如：

```text
单个 Room Economy 崩溃
       ↓
记录错误
       ↓
跳过该模块
       ↓
其他房间继续
```

不要：

```text
try {
  main()
} catch {
  console.log(error)
}
```

然后整个系统继续带着未知状态运行。

---

# 27. Memory Schema

必须有：

```ts
interface NexusMemory {
  schemaVersion: number;

  nexus: NexusPersistentState;

  rooms: Record<string, RoomPersistentState>;

  actors: Record<string, ActorPersistentState>;

  tasks: Record<string, Task>;

  intel: Record<string, IntelRecord>;

  metrics: MetricsState;
}
```

## Migration

```text
schemaVersion 1
 ↓
migration
 ↓
schemaVersion 2
 ↓
migration
 ↓
current
```

绝对不要：

```ts
delete Memory
```

解决 schema 问题。

---

# 28. Legacy Migration Architecture

这是本项目最重要的实施原则。

采用：

# Strangler Refactor

```text
Legacy
   ↓
Adapter
   ↓
Nexus Contract
   ↓
Nexus Ownership
   ↓
Legacy internal implementation
   ↓
逐渐替换
```

而不是：

```text
Legacy
 ↓
Delete
 ↓
Rewrite
```

---

# 29. 文件迁移矩阵

## Core

```text
src/core/*
        ↓
kernel/runtime/state
```

规则：

- 生命周期 → kernel
- runtime 状态 → runtime
- Memory → state
- 不再允许 core 成为万能工具箱

## World

```text
src/modules/world/*
        ↓
world/*
```

Perception 保留。

WorldModel 单独建立。

## Tasks

```text
src/modules/tasks/*
        ↓
tasks/*
```

TaskBoard 成为唯一任务事实源。

## Agents

```text
src/modules/agents/*
        ↓
agents/*
commands/*
```

Agent 与 Action 分离。

## Movement

```text
src/modules/movement/*
        ↓
movement/*
adapters/movement/*
```

先 Adapter，后内部重构。

## Teams

```text
src/modules/teams/*
        ↓
adapters/teams/*
combat/
```

保留内部实现，Nexus 接管入口。

## Industry

```text
src/modules/industry/*
        ↓
industry/*
adapters/industry/*
```

逐子系统迁移。

---

# 30. Bug Register

以下问题是当前源码审计中最明显、最值得优先处理的项目。

## BUG-001 — P0

### ActionBroker 不是全局唯一 mutation boundary

部分系统仍然直接修改游戏状态。

典型风险：

```text
Planner → Game API
Industry → Game API
Expansion → Game API
Teams → Game API
Legacy → Game API
```

### 后果

无法统一：

- ownership
- action priority
- telemetry
- error handling
- CPU accounting

### 修复

所有 mutation：

```text
Intent
 ↓
CommandBus
 ↓
Adapter
 ↓
Game API
```

---

## BUG-002 — P0

### NEXUS Agent 与 Legacy Agent 双执行

当前系统仍存在：

```text
Nexus Task-driven execution
+
Legacy liveVendor.exec()
```

### 风险

同一 Creep 可能：

```text
Nexus → move
Legacy → moveTo
Team → move
```

### 修复

建立 ActorOwnership。

---

## BUG-003 — P0

### Movement 与 Agent 存在隐式双控制

Movement 自己拥有完整 runtime，而 Agent 又拥有行动层。

### 修复

Movement 降为 execution infrastructure。

---

## BUG-004 — P1

### Movement 大量类型约束被关闭

存在：

```ts
// @ts-nocheck
```

### 风险

Movement 是最复杂的底层系统之一，却缺少编译期保护。

### 修复

不要一次性删除 `@ts-nocheck`。

逐文件：

```text
ts-nocheck
 ↓
明确类型
 ↓
strict
 ↓
删除 suppressions
```

---

## BUG-005 — P1

### ActionBroker 混淆内部失败和 native error code

例如内部发现 store empty，却直接生成 Screeps native error。

### 修复

分开：

```text
nativeReturnCode
internalReason
```

---

## BUG-006 — P1

### Event 生命周期重复

EventBus、EndPhase、EventBusEnd 对生命周期存在重复表达。

### 修复

统一 EventRuntime。

---

## BUG-007 — P1

### TaskBoard 高频全量扫描

```ts
Object.values(tasks)
```

可能在多个模块重复执行。

### 修复

建立 runtime index。

---

## BUG-008 — P1

### dedupeKey 缺少严格 domain namespace

不同系统可能构造相同字符串。

### 修复

```text
economy:haul:roomA:storage
defense:defend:roomA
construction:build:site123
```

---

## BUG-009 — P1

### RoomObservation 持续膨胀

同一个 snapshot 同时服务：

- Economy
- Defense
- Construction
- Agent
- Controller
- Traffic

### 修复

建立 Domain View。

---

## BUG-010 — P1

### Economy / Spawn 跨域直接耦合

Economy 不应该直接决定具体 Spawn API。

### 修复

Demand → SpawnArbiter。

---

## BUG-011 — P1

### SpawnDirector 职责过度集中

当前同时承担：

- staffing
- replacement
- bootstrap
- remote mining
- scout
- defender
- claimer
- body planning

### 修复

Demand Source 拆分。

---

## BUG-012 — P1

### Planner 在 planning 阶段直接 mutation

`createConstructionSite()` 应在 command boundary。

### 修复

ConstructionIntent。

---

## BUG-013 — P1

### Industry 绕过统一 command boundary

### 修复

IndustryAdapter。

---

## BUG-014 — P1

### Nexus Squad 与 Legacy TeamData 双事实源

### 修复

Nexus Squad 成为 authoritative state。

TeamData 仅 runtime adapter state。

---

## BUG-015 — P2

### 多模块直接扫描 Game.rooms

### 修复

World Model。

---

## BUG-016 — P2

### Action telemetry 可能使用行动前快照估算实际 transfer

调用：

```text
transfer
```

后不能用旧 carry 快照直接当实际传输量。

### 修复

使用：

```text
expected amount
+
native result
+
next tick delta
```

---

## BUG-017 — P2

### Resource model 目前偏 energy-centric

长期工业必须支持：

```text
RESOURCE_ENERGY
RESOURCE_MINERAL
RESOURCE_POWER
commodity
```

统一抽象。

---

## BUG-018 — P2

### hostile vanished ≠ confirmed kill

敌人消失可能因为：

- 离开房间
- 视野变化
- 死亡
- 其他原因

不能直接记作 kill。

---

## BUG-019 — P2

### Expansion / InterShard 仍是独立 mutation runtime

最终需要纳入 Nexus Command Boundary。

---

## BUG-020 — P2

### Legacy prototype registry 与 NEXUS Agent 边界不够清晰

需要统一 actor registration / ownership。

---

# 31. 重构阶段

## Phase 0 — Freeze

禁止继续添加新的 legacy direct mutation。

建立：

```text
architecture rules
ownership rules
command rules
memory rules
```

验收：

```text
CI 检查禁止新增 direct Game mutation
```

---

## Phase 1 — Actor Ownership

实现：

```text
ActorRegistry
ActorOwnership
Lease
```

验收：

- 每个 Creep 有 owner
- dead creep 自动释放
- 冲突 owner 被拒绝

---

## Phase 2 — Command Boundary

统一：

```text
ActionBroker
CommandBus
```

验收：

- mutation API 可追踪
- native return code 不伪造
- owner 校验生效

---

## Phase 3 — Movement Adapter

保留旧 Movement。

改：

```text
Agent → MoveIntent → MovementAdapter
```

验收：

- Agent 不直接 moveTo
- traffic 仍正常
- path cache 仍正常

---

## Phase 4 — Task Index

建立：

```text
TaskIndex
```

验收：

- O(1)/近似 O(1) 查询
- 无 stale index
- task lifecycle 完整

---

## Phase 5 — Agent

统一：

```text
Task → Agent FSM → Intent
```

关闭 legacy actor execution。

---

## Phase 6 — Construction

Planner 与 mutation 分离。

---

## Phase 7 — Spawn

拆 Demand / Arbiter / BodyFactory / Queue。

---

## Phase 8 — Economy

统一 ResourceLedger。

---

## Phase 9 — Defense / Combat

Defense 变成 demand generator。

Teams 变成 adapter。

---

## Phase 10 — Industry

逐子系统 adapter 化。

---

## Phase 11 — Expansion / InterShard

纳入 CommandBus。

---

## Phase 12 — Legacy Removal

只有满足：

```text
Nexus equivalent exists
+
production validated
+
simulation validated
+
CPU validated
```

才能删除旧实现。

---

# 32. 测试架构

## Unit Test

测试纯逻辑：

```text
Task scoring
BodyFactory
ResourceLedger
Threat scoring
Strategy
SpawnArbiter
```

## Integration Test

测试：

```text
Task → Agent
Agent → Intent
Intent → Command
Command → Adapter
```

## Scenario Test

必须覆盖：

```text
bootstrap
RCL2
RCL3
RCL4
RCL5
RCL6
RCL7
RCL8
```

以及：

```text
creep death
spawn death
room invasion
source depletion
storage full
terminal full
remote room lost
CPU pressure
Memory migration
```

---

# 33. 必须建立的生产级不变量

## Actor

```text
一个 Actor 一个 owner
```

## Task

```text
一个 Task 最多一个 authoritative assignee
```

## Resource

```text
不能超额预留
```

## Action

```text
只有 Command Boundary 能 mutation
```

## Memory

```text
只保存 schema-approved serializable data
```

## World

```text
业务系统不能修改 observation
```

## Tick

```text
当前 Tick 的 command result
≠
下一 Tick 的 world state
```

---

# 34. Coding Agent 开发规则

以后让 Coding Agent 修改 Nexus-Bot 时，应强制遵守：

## Rule 1

不要新增：

```ts
creep.moveTo()
creep.harvest()
creep.transfer()
spawn.spawnCreep()
room.createConstructionSite()
```

到业务模块。

必须通过 command boundary。

## Rule 2

不要新增第二套 Task 系统。

## Rule 3

不要新增第二套 Memory schema。

## Rule 4

不要新增第二个 Spawn decision maker。

## Rule 5

不要让新模块直接依赖 legacy module。

如果必须使用：

```text
adapter
```

## Rule 6

不要为了“整理代码”重写已经经过实战验证的算法。

## Rule 7

修改底层接口必须：

```text
compile
+
unit test
+
scenario test
```

## Rule 8

任何跨 Tick 状态必须声明：

```text
persistent
```

或：

```text
runtime-only
```

---

# 35. 最终运行模型

最终 Tick 应类似：

```text
┌───────────────────────────────┐
│           Tick Kernel         │
└──────────────┬────────────────┘
               ↓
       Build TickContext
               ↓
        Perceive World
               ↓
       Reconcile Memory
               ↓
       Critical Defense
               ↓
        Nexus Strategy
               ↓
       Cluster Planning
               ↓
       Economic Planning
               ↓
        Task Reconcile
               ↓
        Spawn Planning
               ↓
       Agent Scheduling
               ↓
        Intent Creation
               ↓
      Ownership Validation
               ↓
       Movement Resolution
               ↓
       Command Arbitration
               ↓
       Screeps Mutation
               ↓
         Telemetry
               ↓
          End Phase
               ↓
           Tick N+1
```

---

# 36. 最终架构原则

Nexus 的核心不是：

> “让每个 Creep 更聪明。”

而是：

> **让整个系统成为一个统一的智能体。**

Creep 不需要知道整个世界。

房间也不需要知道整个世界。

NexusCore 也不应该直接操作每一个 Creep。

正确结构是：

```text
Nexus
  知道“为什么”

Cluster
  知道“在哪里”

Task
  知道“做什么”

Agent
  知道“下一步怎么做”

Movement / Industry / Team
  知道“具体怎么执行”

CommandBus
  知道“如何安全地修改世界”

WorldModel
  知道“世界现在是什么样”

Memory
  知道“过去发生过什么”
```

这才是真正意义上的：

# EX-MACHINA NEXUS

不是一个“有很多 Creep 的 Bot”，而是：

> **一个通过大量分布式执行单元实现统一意识、局部自治和持续反馈的 Screeps 集体智能系统。**

---

# 37. 最终重构优先级

绝对不要按文件数量排序。

按风险排序：

```text
P0
│
├── Actor Ownership
├── Command Boundary
└── Agent / Legacy 双控制
│
P1
│
├── Movement Boundary
├── Task Index
├── Spawn Arbitration
├── Construction Mutation
├── Economy Boundary
├── Squad Truth Source
└── Industry Adapter
│
P2
│
├── WorldModel
├── Resource Model
├── Intel
├── Telemetry
└── CPU Optimization
│
P3
│
└── Legacy cleanup / naming / cosmetic refactor
```

**不要先做 P3。**

尤其不要花大量时间：

```text
rename files
整理 import
统一变量名
移动目录
```

而控制权问题仍然存在。

---

# 38. 最重要的最终原则

本项目重构成功的标志不是：

```text
目录看起来漂亮
```

而是能够回答：

> **“这个 Tick，为什么这个 Creep 做了这个动作？”**

系统应该能够沿着：

```text
Action
 ↓
Intent
 ↓
Task
 ↓
Goal
 ↓
Strategy
```

完整追溯。

例如：

```text
Creep-A
 ↓
transfer 50 energy
 ↓
HaulTask-184
 ↓
StorageRefillGoal
 ↓
Room-Economy Directive
 ↓
Nexus Strategy
```

如果以后任何一个 Creep 出现：

```text
不移动
乱跑
不采集
不升级
不运输
重复运输
错误战斗
```

Telemetry 应该能够告诉开发者：

```text
Owner:
Task:
State:
Intent:
Command:
Native Result:
Last Observation:
Next Retry:
Reason:
```

这就是 NEXUS 与传统 Screeps Role Bot 的根本区别。

---

# 39. 一句话定义最终架构

> **Nexus-Bot 应采用“分层集体智能 + Task-driven Coordination + Actor Ownership + Intent/Command Separation + Legacy Adapter”的模块化单体架构。**

最终控制链固定为：

```text
WORLD
 ↓
NEXUS
 ↓
CLUSTER
 ↓
GOAL
 ↓
TASK
 ↓
AGENT
 ↓
INTENT
 ↓
COMMAND
 ↓
SCREEPS
 ↓
OBSERVATION
 └────────→ WORLD
```

任何新功能都应该能够放入这条链，而不应该建立第二条平行控制链。
