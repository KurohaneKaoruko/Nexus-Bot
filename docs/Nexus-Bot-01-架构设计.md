# Nexus-Bot 架构设计文档
## 基于 `dev` 分支源码审计 + Screeps 游戏模型 + “机凯种智械连结”理念

> 基线仓库：KurohaneKaoruko/Nexus-Bot  
> 基线分支：`dev`  
> 文档定位：最终目标架构与实现规范，而不是当前代码结构的简单描述。

---

# 1. 设计目标

Nexus-Bot 的目标不是做一个传统的“Creep Role Bot”，而是建立一个具有**集体感知、集体规划、任务分配、局部自治、统一行动仲裁、长期记忆**能力的 Screeps 自动化文明。

核心抽象：

```text
Screeps World
     ↓
Perception
     ↓
World Model
     ↓
Nexus Intelligence
     ↓
Strategic Directive
     ↓
Cluster / Squad
     ↓
Task
     ↓
Agent
     ↓
Intent
     ↓
Command
     ↓
ActionBroker / Adapter
     ↓
Screeps API
     ↓
下一 Tick 的 World Observation
```

“机凯种”式设计不应该理解成“所有 Creep 共享一个巨大 AI 对象”，而应该理解成：

1. 个体拥有局部执行能力；
2. 集体拥有统一世界模型；
3. 个体不直接决定全局战略；
4. 集体决定目标，个体负责执行；
5. 冲突通过统一仲裁解决；
6. 记忆与知识属于文明，而不是单个 Creep；
7. Creep 死亡不应导致知识死亡；
8. 网络断裂、房间失视、CPU 紧张时，系统仍能降级运行。

---

# 2. Screeps 作为架构约束

Screeps Bot 的程序模型不是普通实时服务器。

每 Tick：

```text
读取当前 Game
↓
计算
↓
提交 action
↓
引擎结算
↓
下一 Tick 才观察最终结果
```

因此架构必须遵守：

## 2.1 Observation 与 Command 分离

禁止：

```ts
if (creep.store.getFreeCapacity() > 0) {
    creep.harvest(source);
    creep.transfer(storage);
}
```

把“读状态”和“执行动作”混成一个不可追踪过程。

推荐：

```text
WorldSnapshot
    ↓
Decision
    ↓
Intent
    ↓
Command
    ↓
Commit
```

## 2.2 Memory 与 Runtime 分离

Memory：

- JSON 可序列化；
- 跨 Tick；
- 不保存 Screeps API 对象；
- 有 schema version；
- 有 migration。

Runtime：

- Game 对象；
- cache；
- index；
- PathFinder 结果；
- CostMatrix；
- 临时决策；
- CPU profiler。

绝不能把：

```ts
Room
Creep
Source
Structure
RoomPosition
CostMatrix
```

写进 Memory。

---

# 3. 最终架构总图

```text
┌────────────────────────────────────────────────────┐
│                    Nexus Kernel                     │
│ loop / phases / scheduler / CPU / errors           │
└───────────────────────┬────────────────────────────┘
                        │
                TickContext
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
   World Runtime    Memory Runtime    Telemetry
        │
        ↓
┌────────────────────────────────────────────────────┐
│                    World Layer                      │
│ Perception / Intel / Topology / WorldModel         │
└───────────────────────┬────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│                 Intelligence Layer                  │
│ Strategy / Economy Model / Threat / Expansion     │
└───────────────────────┬────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│                  Coordination Layer                 │
│ Cluster / Squad / TaskBoard / Allocation           │
└───────────────────────┬────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│                    Agent Layer                      │
│ Agent Registry / FSM / Role Capability / Intent    │
└───────────────────────┬────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│                  Command Layer                      │
│ CommandBus / ActionBroker / Ownership / Arbitration│
└───────────────────────┬────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│                 Execution Layer                     │
│ Movement / Spawn / Structure / Combat / Industry  │
└───────────────────────┬────────────────────────────┘
                        ↓
                    Screeps API
```

---

# 4. 六层职责

## Layer 0 — Kernel

负责：

- Tick 生命周期；
- phase 顺序；
- CPU budget；
- error boundary；
- scheduler；
- runtime 初始化；
- telemetry flush。

Kernel **不允许知道经济、战斗、矿工等业务细节**。

---

## Layer 1 — World

负责：

- 感知；
- 房间观察；
- Creep observation；
- hostile observation；
- structure observation；
- resource observation；
- room intel；
- topology。

输出纯数据。

---

## Layer 2 — Intelligence

负责：

- 战略；
- 经济模型；
- 威胁模型；
- 扩张决策；
- 文明 posture；
- 资源供需；
- 战争/发展/扩张之间的取舍。

这一层回答：

> “我们现在应该做什么？”

不回答：

> “具体哪个 Creep 怎么走。”

---

## Layer 3 — Coordination

负责：

- Cluster；
- Squad；
- Task；
- Task priority；
- lease；
- assignment；
- population demand。

这一层把战略目标变成：

```text
需要什么工作
需要多少工作
工作在哪里
优先级是什么
持续多久
```

---

## Layer 4 — Agent

Agent 是执行实体的抽象。

一个 Agent 可以是：

- Creep；
- PowerCreep；
- Squad；
- Structure Controller。

Agent 不负责全局战略。

Agent 只负责：

```text
获取任务
生成 Intent
处理局部状态
报告结果
```

---

## Layer 5 — Command

所有真正改变游戏状态的操作进入 Command 层。

包括：

- move；
- harvest；
- transfer；
- withdraw；
- build；
- repair；
- upgrade；
- attack；
- heal；
- dismantle；
- claim；
- reserve；
- spawn；
- terminal；
- lab；
- factory。

---

# 5. Actor Ownership

这是整个重构中最重要的新机制之一。

## 5.1 问题

当前系统同时存在：

- NEXUS Agent；
- Legacy Creep prototype；
- Teams；
- Industry；
- Expansion；
- Movement。

多个系统可能同时认为自己可以控制同一个实体。

最终可能出现：

```text
Nexus Agent → move
Team → attack
Legacy Role → moveTo
```

---

## 5.2 Ownership 模型

```ts
type ActorOwner =
  | "nexus"
  | "team"
  | "legacy"
  | "power"
  | "external";
```

Runtime 保存：

```ts
interface ActorLease {
    actorId: string;
    owner: ActorOwner;
    acquiredAt: number;
    expiresAt?: number;
}
```

规则：

1. 一个 Actor 同一 Tick 只能有一个 owner；
2. owner 才能产生 command；
3. owner 不得直接把控制权转移给其他模块；
4. owner 消失后必须自动释放；
5. Legacy adapter 必须先声明 ownership；
6. 战斗 squad 可以获得临时 ownership；
7. 高优先级 emergency 可以抢占普通 task，但必须经过 Arbitration。

---

# 6. TickContext

当前 `TickContext` 是正确方向。

目标接口：

```ts
interface TickContext {
    readonly tick: number;
    readonly shardName: string;
    readonly profile: VariantProfile;
    readonly cpu: CpuBudget;
    readonly logger: Logger;
    readonly errors: ErrorBoundary;
    readonly telemetry: Telemetry;
    readonly world: WorldHolder;
    readonly memory: NexusMemory;

    runIsolated(
        name: string,
        band: PriorityBand,
        fn: () => void,
    ): void;
}
```

禁止向 Context 不断塞业务对象。

不要最终变成：

```ts
ctx.economy
ctx.defense
ctx.spawn
ctx.teams
ctx.industry
ctx.expansion
ctx.movement
...
```

否则 Context 会成为“巨型 Service Locator”。

---

# 7. World Model

当前 `RoomObservation` 已经很有价值，但长期不能无限膨胀。

目标：

```text
WorldSnapshot
├── rooms
│   ├── identity
│   ├── controller
│   ├── sources
│   ├── structures
│   ├── construction
│   ├── resources
│   └── threats
├── actors
├── topology
└── intel
```

World Model 的原则：

### 单一事实源

例如 Source 信息只能来自 World。

禁止：

```text
Economy 自己扫描 source
Task 自己扫描 source
Spawn 自己扫描 source
```

应该：

```text
Perception
 ↓
World
 ↓
Economy / Tasks / Spawn
```

---

# 8. Intelligence

## 8.1 Strategic Posture

建议保持：

```ts
type Posture =
  | "survive"
  | "develop"
  | "expand"
  | "war";
```

但不要让 posture 直接决定所有行为。

应该：

```text
Observation
 ↓
Strategic Evaluation
 ↓
Posture
 ↓
Directive
```

例如：

```ts
interface StrategicDirective {
    posture: Posture;
    priority: number;
    objectives: StrategicObjective[];
    expiresAt: number;
}
```

---

# 9. Cluster

Cluster 是 NEXUS 的局部文明单元。

不要把 Cluster 等同于房间。

一个 Cluster 可以：

```text
主房
├── remote source A
├── remote source B
├── highway
├── terminal network
└── military staging room
```

因此：

> Room 是地图实体；Cluster 是管理实体。

---

# 10. Task System

完整链路：

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

Task：

```ts
interface NexusTask {
    id: string;
    kind: TaskKind;
    roomName: string;
    priority: number;
    status: TaskStatus;
    createdAt: number;
    expiresAt?: number;
    lease?: TaskLease;
    target?: TaskTarget;
    requirements?: TaskRequirement[];
}
```

---

# 11. Task Lease

任务必须支持租约：

```ts
interface TaskLease {
    agentId: string;
    acquiredAt: number;
    heartbeatAt: number;
    expiresAt: number;
}
```

原因：

Creep 可能：

- 死亡；
- 卡路；
- 进入不可见房；
- owner 崩溃；
- role 改变；
- 战争导致任务失效。

如果没有 lease：

```text
Task
 ↓
dead Creep
 ↓
永远 claimed
```

整个系统最终会出现“任务幽灵”。

---

# 12. Agent

Agent 状态机：

```text
Idle
 ↓
AcquireTask
 ↓
Prepare
 ↓
Execute
 ↓
Verify
 ↓
Report
 ↓
AcquireTask
```

失败：

```text
Execute
 ↓
Failure
 ├── retry
 ├── replan
 ├── abandon
 └── emergency
```

---

# 13. Intent

Agent 不直接操作 Game。

例如：

```ts
interface MoveIntent {
    type: "move";
    actorId: string;
    target: PositionTarget;
    priority: number;
}
```

```ts
interface HarvestIntent {
    type: "harvest";
    actorId: string;
    sourceId: string;
}
```

Intent 表示：

> “我想做什么。”

不是：

> “我已经做了。”

---

# 14. Command

Intent 经过验证后生成 Command。

```text
Intent
 ↓
Validation
 ↓
Ownership
 ↓
Conflict Arbitration
 ↓
Command
 ↓
Commit
```

Command 必须包含：

```ts
interface Command {
    id: string;
    actorId: string;
    type: CommandType;
    priority: number;
    createdAt: number;
    source: string;
}
```

---

# 15. ActionBroker

ActionBroker 是 Screeps API 的统一边界。

原则：

```text
业务系统
   ↓
Intent
   ↓
Broker
   ↓
Game API
```

禁止：

```ts
creep.transfer(...)
creep.harvest(...)
spawn.spawnCreep(...)
room.createConstructionSite(...)
```

出现在领域决策代码中。

---

# 16. ActionResult

必须区分：

### Screeps 原生错误

例如：

```ts
ERR_NOT_ENOUGH_ENERGY
ERR_BUSY
ERR_INVALID_TARGET
ERR_NOT_IN_RANGE
```

和：

### NEXUS 内部错误

例如：

```ts
"store-empty"
"ownership-denied"
"task-expired"
"budget-suppressed"
"target-stale"
```

不要把内部错误伪装成 Screeps native return code。

推荐：

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

---

# 17. Movement

当前 Movement Engine 应当保留。

不要重写。

重构为：

```text
Agent
 ↓
MoveIntent
 ↓
MovementPlanner
 ↓
TrafficPlanner
 ↓
Path Engine
 ↓
betterMove / moveMatch
 ↓
native move
```

旧 Movement 代码作为：

```text
MovementAdapter
```

存在。

---

# 18. Economy

Economy 负责回答：

```text
我们有什么？
我们缺什么？
资源流向哪里？
哪里发生饥饿？
哪里存在瓶颈？
```

而不是：

```text
直接命令某个 Creep 搬运。
```

资源模型：

```text
Observed
 ↓
Available
 ↓
Reserved
 ↓
Committed
 ↓
Consumed
```

必须区分：

- 实际库存；
- 已预留；
- 在途；
- 已承诺；
- 预计收入。

---

# 19. Spawn

目标：

```text
Strategic Demand
 ↓
Population Demand
 ↓
Spawn Demand
 ↓
Spawn Arbiter
 ↓
Body Factory
 ↓
Spawn Queue
 ↓
Spawn Command
```

不要让：

- Economy；
- Team；
- Expansion；
- Defense；

各自偷偷 Spawn。

它们只能提出：

```text
SpawnRequest
```

最终由 Spawn Arbiter 决定。

Legacy `directSpawn()` 应逐步迁移到：

```text
LegacySpawnAdapter
```

---

# 20. Construction

Planner 只能：

```text
产生 ConstructionIntent
```

不能：

```ts
room.createConstructionSite(...)
```

最终：

```text
LayoutPlanner
 ↓
ConstructionPlan
 ↓
ConstructionTask
 ↓
Agent
 ↓
ConstructionIntent
 ↓
ConstructionCommand
 ↓
ActionBroker
```

---

# 21. Defense / Combat

战斗必须分成：

```text
Threat Detection
 ↓
Threat Model
 ↓
Defense Policy
 ↓
Squad Objective
 ↓
Squad Task
 ↓
Team Adapter
 ↓
Combat Engine
```

Nexus 决定：

```text
为什么打
打哪里
打多久
什么时候撤
需要多少兵
```

Legacy Teams 决定：

```text
怎么编队
怎么移动
怎么集火
怎么治疗
```

---

# 22. Teams Adapter

当前 Teams 是高价值 Legacy Engine。

不要立即重写。

目标：

```text
Nexus Squad
    ↓
SquadCommand
    ↓
TeamAdapter
    ↓
Legacy TeamController
```

`TeamData` 不再作为战略事实源。

最终唯一事实源：

```text
Nexus SquadRecord
```

---

# 23. Industry

Industry 采用 Adapter 迁移：

```text
Nexus Industry Intent
 ↓
Industry Adapter
 ↓
Legacy:
  Link
  Terminal
  Lab
  Factory
  PowerSpawn
  Market
```

迁移顺序：

1. Link
2. Terminal
3. Lab
4. Factory
5. Power Spawn
6. Market
7. Power Creep

---

# 24. Memory

Memory 必须：

```text
schemaVersion
migration
validation
cleanup
```

当前 schema version 11。

以后：

```text
v11
 ↓
v12
 ↓
v13
```

不得直接覆盖旧结构而不迁移。

---

# 25. Runtime Index

Task、Actor、Room 等高频查询建立 Runtime Index：

```text
TaskIndex
ActorIndex
RoomIndex
ReservationIndex
SquadIndex
```

Index 不写 Memory。

global reset 后重新构建。

---

# 26. CPU 架构

CPU 分层：

```text
P0 Emergency
P1 Strategic
P2 Coordination
P3 Maintenance
P4 Cosmetic
```

当 CPU 紧张：

```text
P4 → skip
P3 → skip
P2 → reduce
P1 → preserve
P0 → always run
```

禁止因为 CPU 不足导致：

- Threat response；
- Spawn bootstrap；
- Actor recovery；

完全停止。

---

# 27. Error Isolation

模块错误不得杀死整个 Tick。

```text
Module
 ↓
runIsolated()
 ↓
try/catch
 ↓
Error Classification
 ↓
Circuit Breaker
```

但是：

> Error Boundary 不是吞错。

必须 telemetry：

```text
module
tick
error class
message
count
last occurrence
```

---

# 28. Event System

统一：

```text
EventRuntime
├── start
├── tick
└── end
```

避免：

```text
EventBus
EventBusEnd
EndPhase
```

三个不同对象分别表达 Tick 生命周期。

---

# 29. 最终目录

```text
src/
├── kernel/
├── runtime/
├── world/
│   ├── perception/
│   ├── model/
│   ├── intel/
│   └── topology/
├── state/
│   ├── schema/
│   ├── migration/
│   ├── repository/
│   └── indexes/
├── intelligence/
│   ├── strategy/
│   ├── economy/
│   ├── threat/
│   └── expansion/
├── coordination/
│   ├── cluster/
│   ├── squad/
│   ├── tasks/
│   └── population/
├── agents/
├── commands/
│   ├── creep/
│   ├── movement/
│   ├── spawn/
│   ├── structure/
│   └── combat/
├── execution/
│   ├── movement/
│   ├── spawning/
│   ├── construction/
│   ├── defense/
│   └── industry/
├── adapters/
│   ├── legacy/
│   ├── teams/
│   ├── industry/
│   ├── movement/
│   └── expansion/
└── telemetry/
```

---

# 30. 依赖规则

允许：

```text
kernel
 ↓
runtime
 ↓
world
 ↓
intelligence
 ↓
coordination
 ↓
agents
 ↓
commands
 ↓
execution
 ↓
adapters
```

禁止反向依赖。

尤其禁止：

```text
World → Economy
Economy → World implementation
Agent → Strategy
Task → TeamController
Strategy → Creep
```

---

# 31. 一个模块的标准结构

```text
modules/example/
├── index.ts
├── model.ts
├── policy.ts
├── planner.ts
├── tasks.ts
├── intents.ts
└── adapter.ts
```

推荐：

```text
model = 数据
policy = 决策规则
planner = 计划
tasks = 任务
intents = 意图
adapter = 外部实现
```

避免一个 `index.ts` 变成 2000 行。

---

# 32. “机凯种”理念如何真正落地

不要在代码里写：

```text
MachineMindAI
CollectiveConsciousness
```

这种表面化 Lore。

真正应该体现为工程机制：

### 集体感知

```text
Perception → WorldModel
```

### 集体记忆

```text
NexusMemory
```

### 集体规划

```text
Strategy
```

### 局部意识

```text
Cluster
Squad
Agent
```

### 神经连接

```text
CommandBus
EventBus
```

### 冲突消解

```text
Arbitration
```

### 自我修复

```text
Lease
Recovery
CircuitBreaker
```

### 知识不会随个体死亡消失

```text
Creep death
      ↓
World observation
      ↓
NexusMemory remains
```

这才是“智械连结”真正对应到 Screeps 架构上的方式。

---

# 33. 最终 Tick

目标执行流：

```text
BOOTSTRAP
  ↓
MEMORY CALIBRATION
  ↓
PERCEPTION
  ↓
WORLD UPDATE
  ↓
EMERGENCY
  ↓
STRATEGY
  ↓
PLANNING
  ↓
RECONCILIATION
  ↓
SPAWN
  ↓
AGENT DECISION
  ↓
INTENT COLLECTION
  ↓
COMMAND ARBITRATION
  ↓
COMMIT
  ↓
TELEMETRY
  ↓
END
```

注意：

**Agent 不应在 `agents` phase 直接调用 Screeps mutation API。**

Agent 只产生 Intent。

真正 Commit 在最后统一发生。

---

# 34. 重构成功标准

最终必须满足：

```text
[ ] 一个 Actor 一个 owner
[ ] 一个 Task 一个事实源
[ ] 一个 Squad 一个事实源
[ ] World 是感知事实源
[ ] Memory 是长期事实源
[ ] Runtime Index 不进入 Memory
[ ] Game mutation 经过 Command Boundary
[ ] Agent 不直接操作 Game
[ ] Strategy 不直接操作 Creep
[ ] Economy 不直接 Spawn
[ ] Planner 不直接 createConstructionSite
[ ] Teams 不直接决定战略
[ ] Industry 不直接改变 population policy
[ ] Legacy 只能通过 Adapter 被调用
[ ] 每个模块可以独立 fault isolation
[ ] CPU 紧张时按 priority 降级
[ ] global reset 不破坏持久状态
[ ] Creep 死亡不会导致 Task 永久锁死
```

