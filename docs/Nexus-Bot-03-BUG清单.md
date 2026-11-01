# Nexus-Bot BUG 与技术风险清单
## 基于 `dev` 分支当前源码的架构级审计

> 说明：本清单区分“可以从当前代码直接确认的问题”和“需要运行时进一步验证的高风险问题”。没有经过运行时复现的项目，不把推测写成确定性 Bug。

> **快照性质声明**：本清单是架构级审计的**时点快照**，基准 commit `1ba8916`（2026-10-18，main）。各条目的处置状态只反映基准时点；后续状态演进**只在 docs/bugs/ 追踪**（对账映射表见 §38）。**已修复项按维护约定从本清单移除，BUG 编号不复用**；行为级缺陷（sim/线上观察）不进本清单，一律走 docs/bugs 登记流程（§36）。

---

## 目录

| 范围 | 内容 |
|---|---|
| §1 | 严重度定义（P0–P3 / A） |
| §2–§31 | 30 项架构 BUG（编号不连续，已修复项已移除） |
| §32–§34 | 修复顺序（按 docs/bugs 单一口径） |
| §35 | 重构前后不变量 |
| §36–§37 | Bug 管理方法 · 最终判断 |
| §38 | 处置状态映射表（与 docs/bugs 对账） |

### 当前未闭合概览（@1ba8916 快照）

| 状态 | 数量 | BUG 编号 |
|---|---|---|
| 部分修复 | 8 | 001 / 002 / 006 / 010 / 022 / 023 / 031 / 035 |
| 仍在代码 | 15 | 003 / 004 / 011 / 013 / 014 / 015 / 017 / 019 / 020 / 021 / 026 / 027 / 029 / 030 / 033 |
| 未验证 | 7 | 009 / 016 / 018 / 025 / 028 / 032 / 034 |

> 已修复的 5 项（005 / 007 / 008 / 012 / 024）已从本清单移除，**BUG 编号不复用**（编号一经使用即作废，见 §32）。
> 本表是快照时点统计，与 §38 对账表一致；后续状态演进只在 `docs/bugs/` 追踪。

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
> **状态@1ba8916**：**部分修复（进行中）** — broker 已有 spawn/construction/market·terminal/claim/PowerCreep 五管线与 tower/safemode；spawnDirector 主孵化链原生直调待迁（6.2 范围）；残留直读面见 BUG-013/015。由 nexus-architecture-refactor 任务 6.x 推进


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
> **状态@1ba8916**：**部分修复（进行中）** — legacy exec() 仍活但已受 legacyExecMode 三级开关 + NEXUS_TASK_DRIVEN_CODES 类别收编 + acquire("legacy-exec") 所有权登记；全量关闭在切换点 capabilities.ts。由任务 5.5/6.3 推进


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
> **状态@1ba8916**：**仍在代码** — movement/index.ts 猴补丁 Creep.prototype.move/moveTo 自成第二突变边界；收编属 Phase 5（02 篇 §11，G-P5-1）


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
> **状态@1ba8916**：**仍在代码** — movement 模块仍 @ts-nocheck；随 Phase 5 收编恢复类型（G-P5-4）


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


# 6. BUG-006
## P1
### EventBus / EventBusEnd / EndPhase 职责重复
> **状态@1ba8916**：**部分修复（已澄清）** — EventBus/EventBusEnd 职责已定（commit 主段 P2 / 终末 P0，start·tick·end 三通道，01 篇 §28.1）；endPhase 模块群与 EventBusEnd 的最终合并待 Phase 14/15


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


# 7. BUG-009
## P1 / Architecture
### RoomObservation 持续膨胀
> **状态@1ba8916**：**未验证** — RoomObservation 膨胀路径需运行时取证（观察衰减逻辑审查 + soak Memory 曲线）；未复现不计已修。取证任务已收编 docs/bugs/room-observation-growth-audit.md


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

# 8. BUG-010
## P1
### Economy 与 Spawn 存在过强直接耦合
> **状态@1ba8916**：**部分修复（进行中）** — defender 孵化已走账本预留（spawnDirector）；economy planners 与孵化线的耦合面在 Phase 7 拆分（G-P8-3）中收口


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

# 9. BUG-011
## P1
### SpawnDirector 职责过度集中
> **状态@1ba8916**：**仍在代码** — spawnDirector 仲裁+执行+命名+登记一体；Phase 7 六件套拆分（02 篇 §15.1）的目标对象


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


# 10. BUG-013
## P1
### Industry 绕过 Nexus Control Plane
> **状态@1ba8916**：**仍在代码** — industry/console（32 处 Game.rooms 直读）与 autoMarket 未收编；Phase 12 逐系统 Adapter 化（02 篇 §25.1）的目标对象


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

# 11. BUG-014
## P1
### Nexus Squad 与 Legacy TeamData 双事实源
> **状态@1ba8916**：**仍在代码** — SquadRecord（memorySchema）与 teams/TeamData 并存；Phase 10 单事实源收口（G-P10-1）的目标对象


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

# 12. BUG-015
## P2
### 多模块仍直接访问 Game.rooms
> **状态@1ba8916**：**仍在代码** — 约 128 处 Game.rooms 直读分布 12+ 文件（industry/console 32、movement 8、teams 9、external 20+、economy 20+、agents 9）；随各域 Phase 收编，allowlist 单调降（G-P2-3/G-P14-4）


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

# 13. BUG-016
## P2
### Transfer 统计可能使用行动前状态
> **状态@1ba8916**：**未验证** — transfer 统计口径需对照实现取证（statistics/actionBroker 统计路径）；修复方向已定为观察差分口径（02 篇 §20）


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

# 14. BUG-017
## P2
### World / Economy 仍偏 Energy-only
> **状态@1ba8916**：**仍在代码** — LedgerResource = "energy" 硬编码单资源（ledger.ts）；多资源账本是 Phase 8 后扩展，接口位已保留


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

# 15. BUG-018
## P2
### Hostile disappearance ≠ kill
> **状态@1ba8916**：**未验证** — hostilesKilled 归因口径需运行时取证（失视场景计数不变性断言缺失）；G-P9-1 的验收对象


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

# 16. BUG-019
## P2
### Expansion 仍是独立 mutation system
> **状态@1ba8916**：**仍在代码** — external/expand 直读 Game.rooms 自持执行；Phase 13（02 篇 §26.1，G-P13-1）的目标对象


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

# 17. BUG-020
## P2
### InterShard 是独立运行域
> **状态@1ba8916**：**仍在代码** — intershard 模块未收编；Phase 13 末段（02 篇 §27），当前单 shard 运行期优先级最低


InterShard 不应该自己成为第二套战略系统。

### 修复

统一：

```text
Nexus Federation
```

InterShard 只是 transport adapter。

---

# 18. BUG-021
## P2
### Legacy Prototype Registry 与 Agent Registry 双重注册
> **状态@1ba8916**：**仍在代码** — prototype 角色库与 units 注册表双体系并存；Phase 4 类别收编完成后随 Phase 14 删除收敛


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

# 19. BUG-022
## P2
### Creep 名称解析是隐式协议
> **状态@1ba8916**：**部分修复** — 命名协议已固化（角色 id 入参 + unitCodeFromName 解析形态，spawnDirector 注释成文）；仍是隐式约定，规格化入 01 篇接口契约属后续


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

# 20. BUG-023
## P2
### Spawn 角色系统存在多套来源
> **状态@1ba8916**：**部分修复** — unitCode() 归一口径已在 scout-run-residue 修复中统一（注册表存角色名/查询用代号）；多套定义源的最终收口在 Phase 7 UnitDefinition 单源


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


# 21. BUG-025
## P2
### BodyFactory 与 SpawnDirector 的 policy 分界还不够清晰
> **状态@1ba8916**：**未验证** — BodyFactory 纯函数化程度需审查取证（是否读 Game）；G-P7-1 的验收对象


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

# 22. BUG-026
## P3
### Prototype 文件命名不一致
> **状态@1ba8916**：**仍在代码** — prototype 文件命名不一致（P3 维护性）；随 Phase 14 删除自然消解，不单独修


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

# 23. BUG-027
## P3
### Legacy 代码注释携带大量旧设计上下文
> **状态@1ba8916**：**仍在代码** — legacy 注释携带旧设计上下文（P3）；随删除消解


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

# 24. BUG-028
## A
### `main.ts` 模块装配职责过重
> **状态@1ba8916**：**未验证** — main.ts 装配职责需结构审查取证；模块注册表化属 Phase 15 前后


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

# 25. BUG-029
## A
### Branch Variant 与 Core Runtime 边界需要进一步稳定
> **状态@1ba8916**：**仍在代码** — src/branch 与 core 边界待稳定（A 级债务）；随分支变体需求演进


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

# 26. BUG-030
## A
### Config / Constant / Policy 边界混杂
> **状态@1ba8916**：**仍在代码** — src/config 与 src/constant 目录并存边界混杂（A 级债务）；收口属配置治理专项


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

# 27. BUG-031
## A
### Runtime Cache 与 Memory Schema 需要严格分层
> **状态@1ba8916**：**部分修复** — actorOwnership 已按数据分级落地（活跃租约 global 层 / 持久索引 Memory 带版本，模块头注释成文）；全局层面的分界规格已入 01 篇 §24.3


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

# 28. BUG-032
## A
### World Snapshot 与 Game API 生命周期没有完全制度化
> **状态@1ba8916**：**未验证** — World Snapshot 生命周期制度化程度需审查取证；01 篇 §14.1/§24.3 已给规格


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

# 29. BUG-033
## A
### Task / Mission / Team / Unit 多种概念重叠
> **状态@1ba8916**：**仍在代码** — Task/Mission/Team/Unit 概念重叠（spawning/mission 与 tasks 并存）；概念归并在 Phase 7 拆分时裁定


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

# 30. BUG-034
## A
### Error Boundary 需要防止“静默成功”
> **状态@1ba8916**：**未验证** — errorBoundary 防静默成功口径需审查取证（错误吞没路径审计）


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

# 31. BUG-035
## A
### CPU skip 必须可解释
> **状态@1ba8916**：**部分修复** — cpuBudget canRun + recordSkip(name, reason) 已落地（skip 可解释）；全模块覆盖在 G-P15-1/3 收口


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

# 32–34. 修复顺序（汇总视图，口径归 docs/bugs）

> 本三章原各自维护 P0/P1/P2 修复顺序，与 docs/bugs 各文件头部的优先级标注形成双口径。现改为**单一口径**：docs/bugs 是缺陷优先级与批次的事实源，本章只做汇总导航，不再自定顺序。

## 32. 架构级（本清单 30 项）的推进顺序

> **BUG 编号规则**：编号一经分配即不复用。已修复项从本清单移除后，其编号作废，不分配给新条目（当前作废编号：005 / 007 / 008 / 012 / 024）。

架构级问题的修复程序就是 02 篇的 Phase 序列，优先级映射：

```text
P0 三项（BUG-001/002/003）
 ↓  Phase 1–2 + 5（Ownership → Command Boundary → Movement 收编）
P1 结构项（BUG-010/011/013/014 等）
 ↓  Phase 3–12 逐域（TaskBoard → Agent → Spawn → Economy → … ）
P2/P3/A 项
 ↓  随宿主 Phase 顺带收口或专项治理（BUG-029/030）
```

已闭环的 5 项（BUG-005/007/008/012/024）已从本清单移除，编号不复用。

## 33. 行为级（docs/bugs）的当前批次口径

以 docs/bugs 各文件头部优先级为准（已修复条目按维护约定删除，历史见 git）：

```text
（未修复）room-observation-growth-audit     P1 取证待做
（未修复）sim-audit-2026-10-12 P1-14         P1 沼泽地形 RCL4 未过
（进行中）role-registry-executor-gap         P1 剩余低频批次
（待决策）nuker-launch-missing-impl          P2 随 Phase 14 删除轨
（方法论）sim-audit-2026-10-19               P1 挂钟 CPU 预算不可复现, 已给规避做法
（留档）  upgrade-supply-gap-cache-merge     P2 结构缓存合并后不再现
```

> 2026-10-18 批次的 P0-16 / P1-17 / P1-18 / P1-19 / P2-20，以及 rcl1 欠采、scout 残留、spawn 池孤儿生产者、任务 id 碰撞、调度物流三项等，均已修复并归档。

## 34. 新缺陷进队规则

新发现缺陷（sim 审计/线上观察）**不进本清单**（本清单是架构审计快照），按 §36 流程登记 docs/bugs 并标注优先级与验证标准；跨轴根因（行为缺陷暴露架构问题）时，在 docs/bugs 文件里引用本清单 BUG 编号作关联（如 §38 表的关联列）。

---

# 35. 重构前后不变量

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

# 36. 最终 Bug 管理方法

所有 sim 审计与线上观察发现的问题进入：

```text
docs/bugs/
```

本流程与 AGENTS.md 的开发准则**逐步骤等价**（先修 bug 再开发；缺陷每修完一项在对应文档勾销并跑 sim 场景回归；新缺陷及时追加并标注优先级与验证标准）：

## 41.1 缺陷生命周期

```text
发现（sim 审计 / 线上观察 / 重构取证）
 ↓ 登记
docs/bugs/ 新建文件（当日，不积压）：
  - 文件头：优先级（P0–P2）+ 发现日期 + 状态（未修复/已修复+日期）
  - 正文八段：Summary / Symptoms / Reproduction / Root Cause /
    Impact / Fix / Regression Test / Production Verification
 ↓ 修复（先于新功能开发）
  - Fix 段记录根因与修法（含负结果实验留档——全负实验也写，防止回潮）
 ↓ 勾销
状态行改"已修复 + 日期"，勾销必须伴随：
  - Regression Test 段的 sim 场景回归记录（场景 × 断言结果）
  - 上实服的另附 Production Verification（落地窗口 + 观察结论）
```

## 41.2 文件命名

现行实际口径（与最初建议的 `P0-001-*.md` 编号制不同，按仓库现状执行）：

```text
主题描述式：room-observation-growth-audit.md / nuker-launch-missing-impl.md
审计批次式：sim-audit-<日期>.md（一批缺陷一份文档，逐项标 ✅/⏳）
```

新缺陷文件优先主题描述式；sim 审计整批落审计批次式文档。

## 41.3 与本清单（架构级）的分工

```text
行为级缺陷（表现为错误行为/指标劣化） → docs/bugs/（活文档，持续追踪）
架构级问题（结构/边界/耦合）          → 本清单（快照，随 Phase 推进）
跨轴根因                              → docs/bugs 文件内引用本清单 BUG 编号（§38 表）
```

---

# 37. 最终判断

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

---

# 38. 处置状态映射表（@1ba8916 快照对账）

架构级（本清单 30 项）与行为级（docs/bugs/）是两个正交轴：本表把架构项的处置状态与 docs/bugs 的修复批次对上账。**两轴的编号体系互不换算**——本清单 BUG-xxx 是结构问题编号，docs/bugs 的 P0-16/P1-17 等是行为缺陷编号，同一根因可能横跨两轴。

| BUG | 优先级 | 状态@1ba8916 | 承接方 | docs/bugs 关联 |
|---|---|---|---|---|
| BUG-001 | P0/A | 部分修复（进行中） | refactor 任务 6.x（五管线落地，主孵化链待迁） | — |
| BUG-002 | P0 | 部分修复（进行中） | refactor 任务 5.5/6.3（三级开关 + 类别收编） | role-registry-executor-gap.md（执行断链侧） |
| BUG-003 | P0 | 仍在代码 | Phase 5（02 §11.1） | — |
| BUG-004 | P1 | 仍在代码 | Phase 5（G-P5-4） | — |
| BUG-006 | P1 | 部分修复（已澄清） | 01 §28.1 已规格化；合并待 Phase 14/15 | — |
| BUG-009 | P1 | 未验证 | 取证待做 | room-observation-growth-audit.md（2026-10-18 收编登记） |
| BUG-010 | P1 | 部分修复（进行中） | Phase 7/8（G-P8-3） | — |
| BUG-011 | P1 | 仍在代码 | Phase 7（02 §15.1） | — |
| BUG-013 | P1 | 仍在代码 | Phase 12（02 §25.1） | nuker-launch-missing-impl.md（industry 域内） |
| BUG-014 | P1 | 仍在代码 | Phase 10（G-P10-1） | — |
| BUG-015 | P2 | 仍在代码 | 随各域 Phase 收编（allowlist 单调降） | — |
| BUG-016 | P2 | 未验证 | 取证待做（修复方向已定 02 §20） | — |
| BUG-017 | P2 | 仍在代码 | Phase 8 后多资源扩展 | — |
| BUG-018 | P2 | 未验证 | G-P9-1 验收对象 | — |
| BUG-019 | P2 | 仍在代码 | Phase 13（02 §26.1） | — |
| BUG-020 | P2 | 仍在代码 | Phase 13 末段（02 §27） | — |
| BUG-021 | P2 | 仍在代码 | Phase 4→14 收敛 | role-registry-executor-gap.md（注册侧） |
| BUG-022 | P2 | 部分修复 | 命名协议已固化；规格化待做 | 已归档（git 历史） |
| BUG-023 | P2 | 部分修复 | Phase 7 UnitDefinition 单源 | 已归档（git 历史） |
| BUG-025 | P2 | 未验证 | G-P7-1 验收对象 | — |
| BUG-026 | P3 | 仍在代码 | 随 Phase 14 消解 | — |
| BUG-027 | P3 | 仍在代码 | 随 Phase 14 消解 | — |
| BUG-028 | A | 未验证 | 取证待做 | — |
| BUG-029 | A | 仍在代码 | 分支变体治理专项 | — |
| BUG-030 | A | 仍在代码 | 配置治理专项 | — |
| BUG-031 | A | 部分修复 | 模块级已落地；全局规格入 01 §24.3 | — |
| BUG-032 | A | 未验证 | 规格已给（01 §14.1/§24.3） | — |
| BUG-033 | A | 仍在代码 | Phase 7 概念归并 | — |
| BUG-034 | A | 未验证 | 取证待做 | — |
| BUG-035 | A | 部分修复 | G-P15-1/3 收口 | — |

**状态口径**：`已修复` = 快照时点闭环（有代码证据）；`部分修复` = 机制已立、收口未完；`仍在代码` = 待对应 Phase 处理；`未验证` = 需运行时/审查取证，不预判。

**docs/bugs 行为级缺陷索引**（与本表正交，状态以各文件头部为准；已修复条目按维护约定删除，历史见 git）：

| docs/bugs 文件 | 优先级 | 状态 |
|---|---|---|
| sim-audit-2026-10-11.md（P0-1/2/3、P1-4/5/6/10/11、P2-7/8/9） | P0–P2 | 全部已修复留档（P2-7 待 sim 回归确认回落） |
| sim-audit-2026-10-12.md（P1-12、P2-13、P2-15、P1-14） | P1–P2 | 已修复；**P1-14 未修复（RCL4 未过）** |
| sim-audit-2026-10-19.md | P1 | 方法论级，已给规避做法 |
| room-observation-growth-audit.md | P1 | 未修复（取证待做） |
| role-registry-executor-gap.md | P1 | 主线收口；剩余批次进行中 |
| race-strategy-port.md | P1 | 实验日志（非缺陷），机制提炼见 nexus-design/24 |
| nuker-launch-missing-impl.md | P2 | 未修复（随 Phase 14 删除轨决策） |
| upgrade-supply-gap-cache-merge.md | P2 | 暂缓留档（不再现） |
