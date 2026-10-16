# Nexus-Bot BUG 与技术风险清单
## 基于 `dev` 分支当前源码的架构级审计

> 说明：本清单区分“可以从当前代码直接确认的问题”和“需要运行时进一步验证的高风险问题”。没有经过运行时复现的项目，不把推测写成确定性 Bug。

---

# 1. 严重度定义

## P0 — Critical

可能导致：

- 主循环失效；
- 核心单位完全失控；
- 经济系统永久死锁；
- 房间直接死亡；
- 大规模状态损坏。

必须优先处理。

## P1 — Severe

可能导致：

- 大量 CPU 浪费；
- 任务系统卡死；
- Spawn 错误；
- 经济效率显著下降；
- 战斗行为错误。

## P2 — Major

局部功能错误、边界条件错误、数据失真。

## P3 — Minor

维护性、可读性、调试困难。

## A — Architecture Debt

不一定立即表现为游戏 Bug，但会阻碍后续扩展。

---

# 2. BUG-001
## P0 / Architecture
### ActionBroker 不是全局唯一 Mutation Boundary

当前存在：

```text
ActionBroker
Planner
Industry
Teams
Expansion
InterShard
Legacy Prototype
```

多个模块都拥有直接执行 Game mutation 的能力。

例如 Planner 存在：

```ts
room.createConstructionSite(...)
```

Spawn 存在：

```ts
spawn.spawnCreep(...)
```

Teams / Expansion / Industry 也存在直接 runtime 行为。

### 风险

无法保证：

```text
一个 Tick
一个 Actor
一个 command owner
```

也无法实现：

- command tracing；
- action arbitration；
- command priority；
- replay；
- centralized retry；
- global mutation metrics。

### 修复

引入：

```text
CommandGateway
 ↓
Ownership
 ↓
Arbitration
 ↓
Execution
```

Legacy 通过 Adapter。

---

# 3. BUG-002
## P0
### NEXUS Agent 与 Legacy Creep Agent 双控制平面

当前 Agent System 仍然存在 Legacy execution：

```text
liveVendor.exec()
```

同时 Nexus Task-driven agent 也存在。

### 风险

同一 Creep 可能：

```text
Nexus Task
+
Legacy Role
```

同时产生行为。

结果可能：

```text
move 被覆盖
task 状态与行为不一致
重复 action
目标状态不同步
```

### 修复

引入 Actor Ownership。

短期：

```text
Nexus owner
Legacy owner
```

互斥。

长期：

```text
Legacy Role
 ↓
Agent Adapter
```

---

# 4. BUG-003
## P0
### Movement 存在独立行为执行链

Movement Engine 本身已经拥有：

- path cache；
- traffic；
- move matching；
- arrival；
- cross-room movement；
- betterMove。

如果 Agent 又直接 `moveTo()`：

就形成：

```text
Agent movement
+
Movement engine
```

两个控制器。

### 修复

Agent：

```text
MoveIntent
```

Movement：

```text
MovementPlanner
```

最终：

```text
MovementAdapter
```

执行。

---

# 5. BUG-004
## P1
### Movement `@ts-nocheck`

当前 Movement 模块使用：

```ts
// @ts-nocheck
```

### 风险

TypeScript 无法发现：

- Screeps API 类型错误；
- undefined；
- 参数类型错误；
- nullable position；
- 错误的 return；
- cache schema 不一致。

Movement 又恰好属于 Bot 最底层执行系统，因此风险很高。

### 修复

分阶段：

```text
@ts-nocheck
 ↓
unknown / explicit cast
 ↓
strict types
```

不要一次全部打开 strict。

---

# 6. BUG-005
## P1
### ActionBroker 内部错误与 Screeps native error 混淆

例如内部判断：

```text
store-empty
```

不应伪装成：

```text
ERR_NOT_ENOUGH_ENERGY
```

### 风险

Telemetry 无法区分：

```text
API 拒绝
```

与：

```text
Nexus 主动阻止
```

导致错误率统计失真。

### 修复

分离：

```text
nativeReturnCode
internalReason
category
```

---

# 7. BUG-006
## P1
### EventBus / EventBusEnd / EndPhase 职责重复

当前生命周期存在多个表达。

### 风险

未来增加事件时容易：

```text
重复触发
漏触发
顺序不确定
```

### 修复

统一：

```text
EventRuntime
```

负责：

```text
start
tick
end
```

---

# 8. BUG-007
## P1
### TaskBoard 高频 O(N) 查询

当前大量任务查询依赖：

```text
Object.values(tasks)
```

### 风险

随着：

```text
rooms
remote mining
construction
industry
combat
```

增长，CPU 线性增加。

### 修复

Runtime Index：

```text
byStatus
byRoom
byKind
byAgent
byPriority
```

---

# 9. BUG-008
## P1
### Task dedupeKey 的命名空间风险

如果不同业务使用相同形式的 dedupe key：

```text
room:target
```

可能发生跨域碰撞。

### 修复

```text
<domain>:<kind>:<room>:<target>
```

例如：

```text
economy:harvest:E1S1:source123
construction:build:E1S1:site123
```

---

# 10. BUG-009
## P1 / Architecture
### RoomObservation 持续膨胀

当前已经同时承载：

- sources；
- structures；
- hostiles；
- creeps；
- controller；
- controller buffer；
- damageables；
- piles；
- towers。

### 风险

World contract 成为巨型 DTO。

### 修复

拆成：

```text
RoomIdentity
ControllerObservation
ResourceObservation
StructureObservation
ActorObservation
ThreatObservation
```

由 WorldSnapshot 聚合。

---

# 11. BUG-010
## P1
### Economy 与 Spawn 存在过强直接耦合

经济系统应该提供：

```text
economic demand
```

而不是直接决定：

```text
spawn action
```

### 风险

以后：

```text
Defense
Expansion
Industry
```

也要求 Spawn。

如果没有统一仲裁：

```text
谁最后执行谁赢。
```

### 修复

统一 SpawnDemand。

---

# 12. BUG-011
## P1
### SpawnDirector 职责过度集中

当前 SpawnDirector 同时处理：

- staffing；
- replacement；
- bootstrap；
- remote；
- scout；
- defender；
- courier；
- body；
- terrain；
- wait policy。

### 风险

一个条件变化可能影响完全不同的生产策略。

### 修复

拆：

```text
PopulationModel
DemandBuilder
SpawnArbiter
BodyFactory
Executor
```

---

# 13. BUG-012
## P1
### Planner 直接执行 Construction Mutation

当前 Planner 有：

```ts
createConstructionSite()
```

### 架构问题

Planning 阶段不应该改变世界。

### 修复

```text
Plan
 ↓
Task
 ↓
Agent
 ↓
Intent
 ↓
Command
```

---

# 14. BUG-013
## P1
### Industry 绕过 Nexus Control Plane

Industry 当前仍具有自己的自动化控制器。

### 风险

Industry 可能：

```text
自己决定生产
自己决定资源
自己执行 action
```

与 Economy / Strategy 冲突。

### 修复

Legacy Industry Adapter。

---

# 15. BUG-014
## P1
### Nexus Squad 与 Legacy TeamData 双事实源

当前同时存在：

```text
SquadRecord
TeamData
```

### 风险

两者不同步。

例如：

```text
Nexus:
Squad A 有 4 个成员

Team:
Squad A 有 3 个成员
```

### 修复

Nexus SquadRecord 是唯一战略事实源。

TeamData 只是 runtime adapter state。

---

# 16. BUG-015
## P2
### 多模块仍直接访问 Game.rooms

如果多个模块分别：

```text
Game.rooms
room.find()
```

会造成：

- 重复扫描；
- CPU 浪费；
- 状态口径不同。

### 修复

Perception 统一采集。

---

# 17. BUG-016
## P2
### Transfer 统计可能使用行动前状态

如果：

```text
creep.carry
```

用于估计 transfer 实际数量，可能出现：

```text
requested ≠ transferred
```

特别是 target 容量不足时。

### 修复

使用：

```text
Action Result
+
next Tick Observation Delta
```

校准长期统计。

---

# 18. BUG-017
## P2
### World / Economy 仍偏 Energy-only

当前 `CreepSummary` 等数据明显以：

```text
carryEnergy
```

为核心。

这对早期冲级非常有效，但进入：

```text
mineral
lab
factory
commodity
power
```

后不足。

### 修复

逐步引入：

```ts
StoreSnapshot {
    [resource: string]: number;
}
```

不要一次重构全部经济。

---

# 19. BUG-018
## P2
### Hostile disappearance ≠ kill

当前通过：

```text
previous hostiles
-
current hostiles
```

推断消失。

### 可能原因

- 死亡；
- 离开房间；
- 失去视野；
- 其他。

### 修复

命名：

```text
hostilesVanished
```

只有在有伤害归因时才统计 kill。

---

# 20. BUG-019
## P2
### Expansion 仍是独立 mutation system

扩张模块仍然拥有较高自治权。

### 风险

Expansion：

```text
直接 spawn
直接 claim
直接 move
```

会绕过 Nexus。

### 修复

转换：

```text
Expansion Objective
 ↓
Expansion Task
 ↓
Claim Agent
```

---

# 21. BUG-020
## P2
### InterShard 是独立运行域

InterShard 不应该自己成为第二套战略系统。

### 修复

统一：

```text
Nexus Federation
```

InterShard 只是 transport adapter。

---

# 22. BUG-021
## P2
### Legacy Prototype Registry 与 Agent Registry 双重注册

当前 prototype 体系有自己的 registry。

Nexus Agent 又有自己的 registry。

### 风险

同一实体可能：

```text
被注册两次
生命周期不同步
死亡清理不一致
```

### 修复

统一：

```text
ActorRegistry
```

Legacy registry 变成 adapter-local registry。

---

# 23. BUG-022
## P2
### Creep 名称解析是隐式协议

`unitCodeFromName()` 依赖命名格式：

```text
N体 CODE-HEX
```

### 风险

外部生成名字、旧名字、特殊名字可能解析错误。

### 修复

Memory：

```text
unit
unitCode
```

作为 authoritative source。

名称只作为 fallback。

---

# 24. BUG-023
## P2
### Spawn 角色系统存在多套来源

当前同时存在：

```text
UnitConstant
BodyFactory
SpawnDirector
Mission Pool
TeamSpawner
ExpandController
directSpawn
```

### 风险

角色定义可能不一致。

### 修复

建立：

```text
UnitDefinition
```

唯一来源：

```text
capabilities
body policy
population class
```

---

# 25. BUG-024
## P2
### directSpawn 是绕过 Spawn Arbiter 的逃生通道

当前 directSpawn 的设计明确允许：

```text
绕过任务板/池
```

### 短期合理

编队、扩张、PC 陪护等确实需要即时生产。

### 长期风险

它会成为：

> 所有模块绕过 Nexus 的万能入口。

### 修复

保留 API，但改成：

```text
SpawnRequest(priority=emergency, mode=direct)
```

最终仍由 SpawnExecutor 执行。

---

# 26. BUG-025
## P2
### BodyFactory 与 SpawnDirector 的 policy 分界还不够清晰

BodyFactory 应是：

```text
pure compilation
```

但 SpawnDirector 目前负责大量：

- waiting；
- bootstrap；
- production gate；
- replacement；
- income gate。

### 修复

SpawnDirector 变成 policy orchestration。

BodyFactory 永远 pure。

---

# 27. BUG-026
## P3
### Prototype 文件命名不一致

存在：

```text
moveFuntion.ts
```

这类命名问题。

### 修复

统一：

```text
movementFunction.ts
```

但不要与功能重构放在同一个 commit。

---

# 28. BUG-027
## P3
### Legacy 代码注释携带大量旧设计上下文

这些注释很有价值，但已经成为：

```text
设计文档
+
历史实验记录
+
当前实现说明
```

的混合体。

### 修复

分成：

```text
docs/specs
docs/experiments
inline comments
```

代码注释只保留当前 invariant。

---

# 29. BUG-028
## A
### `main.ts` 模块装配职责过重

当前入口已经挂载大量模块。

这是正确的“显式装配”思想，但随着模块增长：

```text
main.ts
```

会变成大型 composition root。

### 修复

保留：

```text
main.ts
```

作为 composition root，但把 profile-specific composition 提取：

```text
runtime/buildModules.ts
```

---

# 30. BUG-029
## A
### Branch Variant 与 Core Runtime 边界需要进一步稳定

当前存在：

```text
branch/local
branch/race
branch/season
branch/stronghold
```

### 风险

variant-specific logic 泄漏到 core。

### 修复

只允许：

```text
VariantProfile
```

进入 core。

Core 不 import branch implementation。

---

# 31. BUG-030
## A
### Config / Constant / Policy 边界混杂

当前：

```text
config
constant
thresholds
strategy
economy
```

容易产生“魔法规则到底属于哪里”的问题。

建议：

```text
constant = immutable domain facts
config = tunable parameters
policy = decision algorithm
threshold = policy parameter
```

---

# 32. BUG-031
## A
### Runtime Cache 与 Memory Schema 需要严格分层

任何：

```text
Map
Set
Game object
Room object
Creep object
PathFinder object
```

不得进入 Memory。

反过来，Memory schema 不应该为了方便运行时而存大量派生 index。

---

# 33. BUG-032
## A
### World Snapshot 与 Game API 生命周期没有完全制度化

需要规定：

```text
Game object
```

只允许在：

```text
Perception
Execution
Adapter
```

出现。

Strategy / Task / Agent 应优先使用 snapshot。

---

# 34. BUG-033
## A
### Task / Mission / Team / Unit 多种概念重叠

当前项目历史上存在：

```text
Task
Mission
Team
Unit
Agent
Creep
```

如果没有明确词汇表，很容易让新代码继续造第五套概念。

建议：

```text
Actor = 谁
Agent = Actor 的控制运行时
Task = 工作
Mission = Legacy/高阶任务兼容层
Squad = 多 Actor 战术单位
Unit = Spawn archetype
```

---

# 35. BUG-034
## A
### Error Boundary 需要防止“静默成功”

`runIsolated()` 捕获异常后不向外传播是正确的。

但必须保证：

```text
异常
 ↓
record
 ↓
metric
 ↓
diagnostic
```

而不是：

```text
异常
 ↓
吞掉
```

否则线上会出现：

> “机器人不工作，但是日志没报错。”

---

# 36. BUG-035
## A
### CPU skip 必须可解释

当：

```text
cpu.canRun() === false
```

时，必须记录：

```text
module
priority
estimated cost
budget
skip count
```

否则以后看到：

```text
为什么这个房间突然不采矿？
```

无法回答。

---

# 37. P0 修复顺序

必须：

```text
BUG-001
 ↓
BUG-002
 ↓
BUG-003
```

然后：

```text
BUG-005
BUG-012
BUG-014
```

---

# 38. P1 修复顺序

```text
Task Index
 ↓
Spawn Arbitration
 ↓
World Contract
 ↓
Industry Adapter
 ↓
Squad Authority
```

---

# 39. P2 修复顺序

```text
Economy Resource Model
 ↓
Hostile Attribution
 ↓
Expansion
 ↓
InterShard
 ↓
Registry
```

---

# 40. 重构前后不变量

最终必须始终成立：

### Invariant 1

```text
一个 Actor 一个 owner
```

### Invariant 2

```text
一个 Task 一个事实源
```

### Invariant 3

```text
一个 Squad 一个事实源
```

### Invariant 4

```text
Strategy 不直接 mutation
```

### Invariant 5

```text
Agent 不直接 mutation
```

### Invariant 6

```text
World 不保存 Game object
```

### Invariant 7

```text
Memory 不保存 Game object
```

### Invariant 8

```text
Legacy 只能通过 Adapter
```

### Invariant 9

```text
CPU 紧张时核心系统仍运行
```

### Invariant 10

```text
Creep 死亡后 Task 能恢复
```

---

# 41. 最终 Bug 管理方法

建议以后所有线上问题进入：

```text
docs/bugs/
```

格式：

```text
P0-001-actor-double-control.md
P1-002-task-stuck.md
P1-003-spawn-starvation.md
P2-004-hostile-attribution.md
```

每个文件：

```text
# Summary

## Symptoms

## Reproduction

## Root Cause

## Impact

## Fix

## Regression Test

## Production Verification
```

---

# 42. 最终判断

当前 Nexus-Bot 最危险的不是某一个函数。

真正的系统性问题是：

```text
多个成熟系统
+
多个历史控制入口
+
新的 Nexus 抽象
```

正在同时运行。

因此：

> **第一目标不是优化算法，而是建立唯一控制权。**

一旦：

```text
Actor Ownership
Command Boundary
Task Authority
World Authority
```

稳定下来，后续 Economy、Combat、Industry、Expansion 都可以渐进式迁移，而不会继续产生“新系统控制一次、旧系统再控制一次”的结构性 Bug。
