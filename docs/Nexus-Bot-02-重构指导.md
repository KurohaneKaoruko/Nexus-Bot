# Nexus-Bot 重构指导文档
## `dev` 分支 → NEXUS 目标架构的分阶段迁移方案

---

# 1. 重构原则

## 第一原则：不做“大爆炸重写”

当前仓库包含大量经过实际 Screeps 运行验证的旧逻辑：

- Movement；
- Teams；
- Industry；
- Spawn；
- Rush；
- Remote Mining；
- Economy；
- Body Factory；
- Combat。

这些代码的内部算法价值不能因为结构混乱而被全部删除。

采用：

> Strangler Refactor / 绞杀式重构。

```text
Legacy
 ↓
Adapter
 ↓
Nexus Contract
 ↓
逐步替换
 ↓
删除 Legacy
```

---

# 2. 重构阶段总览

```text
Phase 0  建立基线
Phase 1  Ownership
Phase 2  Command Boundary
Phase 3  Task/Agent
Phase 4  Movement
Phase 5  Construction
Phase 6  Spawn
Phase 7  Economy
Phase 8  Defense
Phase 9  Cluster/Squad
Phase 10 Teams
Phase 11 Industry
Phase 12 Expansion/InterShard
Phase 13 Legacy Removal
Phase 14 Performance
Phase 15 Production Hardening
```

---

# 3. Phase 0：冻结基线

## 目标

在任何重构之前建立：

- 当前编译状态；
- 当前模拟测试；
- 当前运行日志；
- RCL speedrun 基准；
- CPU 基准；
- Spawn 周期；
- creep 死亡率；
- 任务完成率。

必须记录：

```text
RCL1 → RCL2
RCL2 → RCL3
RCL3 → RCL4
RCL4 → RCL5
RCL5 → RCL6
```

不要以“代码更漂亮”作为重构成功标准。

---

# 4. Phase 1：Actor Ownership

新增：

```text
src/runtime/actorOwnership.ts
src/runtime/actorRegistry.ts
```

建立：

```ts
acquire(actorId, owner)
release(actorId)
ownerOf(actorId)
assertOwner(actorId, owner)
```

## 第一步

不要改变行为。

只记录：

```text
谁正在控制谁。
```

## 第二步

只报警。

## 第三步

发现冲突时阻止低优先级 owner。

## 验收

任何 Creep 在一个 Tick 中只能出现一个最终 owner。

---

# 5. Phase 2：Command Boundary

建立：

```text
src/commands/
src/runtime/commandBus.ts
```

先把：

```text
ActionBroker
```

提升为：

```text
Command Gateway
```

所有新代码只能：

```text
Intent → Command
```

旧代码暂时：

```text
Legacy → Adapter → Command Gateway
```

---

# 6. ActionResult 重构

把：

```ts
nativeReturnCode
```

从内部失败中分离。

内部：

```text
TaskExpired
OwnershipDenied
BudgetSuppressed
TargetStale
```

Screeps：

```text
ERR_BUSY
ERR_NOT_IN_RANGE
ERR_NOT_ENOUGH_RESOURCES
```

禁止混淆。

---

# 7. Phase 3：TaskBoard

当前 TaskBoard 保留。

新增 Runtime Index：

```text
byStatus
byRoom
byKind
byAgent
byPriority
byDedupeKey
```

API：

```ts
board.create()
board.claim()
board.renew()
board.complete()
board.fail()
board.release()
board.expire()
board.reconcile()
```

---

# 8. Task Reconciliation

每 Tick：

```text
Task
 ↓
检查 lease
 ↓
Agent 是否存在
 ↓
Agent 是否 alive
 ↓
目标是否仍存在
 ↓
房间是否仍有效
 ↓
资源承诺是否有效
```

任何一项失败：

```text
release / replan / expire
```

不能让任务静默卡死。

---

# 9. Phase 4：Agent

建立统一：

```ts
interface AgentRuntime {
    id: string;
    owner: ActorOwner;
    taskId?: string;

    perceive(): AgentObservation;
    decide(): Intent[];
    report(): AgentReport;
}
```

不要把 Legacy Creep prototype 直接删除。

先建立：

```text
LegacyCreepAdapter
```

让：

```text
Legacy Creep
```

表现成：

```text
Nexus Agent
```

---

# 10. Legacy Role 迁移

当前：

```text
prototype/Creep/function/
├── collectFunction
├── haulFunction
├── workFunction
├── buildFunction
├── controllerFunction
└── combatFunction
```

迁移为：

```text
LegacyRoleAdapter
```

每个旧角色只负责：

```text
执行算法
```

不能：

```text
修改 Nexus Task
修改 Strategy
决定 Spawn
```

---

# 11. Phase 5：Movement

当前 Movement Engine 不删除。

建立：

```text
execution/movement/
└── movementAdapter.ts
```

流程：

```text
Agent
 ↓
MoveIntent
 ↓
MovementPlanner
 ↓
current movement engine
 ↓
native move
```

第一阶段只包起来。

第二阶段把：

```text
moveTo
moveMatch
traffic
arrival
```

内部化。

第三阶段让 Agent 完全不知道底层移动实现。

---

# 12. Movement 禁止项

禁止 Agent：

```ts
creep.moveTo(...)
```

禁止 Strategy：

```ts
creep.move(...)
```

禁止 Task：

```ts
PathFinder.search(...)
```

PathFinder 应属于 Movement Layer。

---

# 13. Phase 6：Construction

Planner 当前存在：

```ts
room.createConstructionSite(...)
```

迁移：

```text
Planner
 ↓
ConstructionPlan
 ↓
ConstructionTask
 ↓
Builder Agent
 ↓
BuildIntent
 ↓
ActionBroker
```

Planner 永远不能执行。

---

# 14. Construction Plan

推荐：

```ts
interface ConstructionPlan {
    roomName: string;
    revision: number;
    sites: PlannedSite[];
}
```

当：

```text
layout revision
```

发生变化：

```text
旧 construction task
 ↓
reconcile
 ↓
重新规划
```

---

# 15. Phase 7：Spawn

当前 `SpawnDirector` 内部大量逻辑应该保留。

拆成：

```text
PopulationModel
SpawnDemandBuilder
SpawnArbiter
BodyFactory
SpawnQueue
SpawnExecutor
```

流程：

```text
Economy
Defense
Expansion
Tasks
 ↓
SpawnDemand
 ↓
SpawnArbiter
 ↓
BodyFactory
 ↓
Queue
 ↓
SpawnExecutor
```

---

# 16. Spawn Demand

不要：

```text
Economy → spawn()
```

而是：

```ts
interface SpawnDemand {
    unit: SpawnUnit;
    roomName: string;
    priority: number;
    reason: string;
    deadline?: number;
    budget?: number;
}
```

---

# 17. BodyFactory

当前 `bodyFactory.ts` 是高价值代码。

保留：

- rush harvester；
- rush upgrader；
- worker；
- carrier；
- defender；
- terrain hint；
- relay carrier；
- direct carrier。

但把它变成：

> Pure Function。

输入：

```text
unit
budget
terrain
strategic hints
```

输出：

```text
body
```

不得读取 Game。

---

# 18. Phase 8：Economy

当前 Economy 不应被大规模重写。

拆：

```text
EconomicObservation
EconomicModel
ResourceLedger
ReservationManager
EconomicPolicy
EconomicPlanner
```

---

# 19. Resource Ledger

严格定义：

```text
Physical Stock
Available Stock
Reserved Stock
Transit Stock
Committed Stock
```

公式：

```text
available =
physical
- reserved
- committed
```

不能把 reservation 当库存。

---

# 20. Transfer 统计修复

当前 Action Broker 统计如果使用：

```text
creep.carryEnergy
```

作为 transfer 实际量，存在偏差风险。

正确方式：

```text
before
 ↓
requested amount
 ↓
native result
 ↓
expected transfer
 ↓
next observation delta
```

对于长期经济模型：

> 下一 Tick 的 World Observation 是最终事实。

---

# 21. Phase 9：Defense

Defense 拆成：

```text
ThreatDetector
ThreatModel
DefensePolicy
DefensePlanner
SquadRequest
CombatCommand
```

Threat：

```text
visible threat
+
historical threat
+
confidence
```

不要把“敌人消失”直接统计为 kill。

---

# 22. Phase 10：Cluster / Squad

Cluster：

> 管理范围。

Squad：

> 战术执行单位。

不要混淆。

```text
Cluster
 ├── rooms
 ├── economy
 ├── logistics
 ├── defense
 └── squads
```

---

# 23. Squad 迁移

当前 Nexus SquadRecord 保留为：

```text
战略事实源
```

Legacy TeamData 改为：

```text
Runtime Adapter State
```

禁止 Teams 自己生成第二份战略 squad。

---

# 24. Phase 11：Teams

第一阶段：

```text
Nexus Squad
 ↓
TeamAdapter
 ↓
旧 TeamController
```

第二阶段：

```text
TeamAdapter
 ↓
CombatCommand
```

第三阶段：

逐步替换 Team 内部行为。

不要一次删除：

```text
FormationTables
TeamBattle
TeamCalc
TeamUtils
```

这些很可能是成熟算法。

---

# 25. Phase 12：Industry

迁移顺序：

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

每个系统：

```text
IndustryIntent
 ↓
Adapter
 ↓
Legacy implementation
```

---

# 26. Phase 13：Expansion

当前：

```text
external/expand
```

迁移成：

```text
ExpansionPlanner
ExpansionTask
ClaimIntent
ExpansionExecutor
```

Expansion 只决定：

```text
是否扩张
目标房间
所需资源
兵力
时间窗口
```

Claim Creep 如何移动，不属于 Expansion。

---

# 27. InterShard

InterShard 不应该成为业务系统的隐藏控制器。

应该：

```text
InterShardCoordinator
 ↓
InterShardCommand
 ↓
InterShardAdapter
```

跨 shard 的信息：

```text
intel
orders
resource strategy
squad coordination
```

必须显式定义 schema。

---

# 28. Phase 14：删除 Legacy

只有当：

```text
Nexus contract
+
Adapter
+
Tests
+
Production validation
```

全部通过后，才能删除 Legacy。

删除顺序：

```text
Legacy Role
 ↓
Legacy Spawn
 ↓
Legacy Planner mutation
 ↓
Legacy Team strategy
 ↓
Legacy Industry strategy
 ↓
Legacy movement wrapper
```

---

# 29. Phase 15：性能

建立 CPU budget：

```text
P0 Emergency
P1 Core
P2 Normal
P3 Maintenance
P4 Visual
```

重点优化：

```text
Object.values(Game.creeps)
Object.values(Game.rooms)
Object.values(tasks)
PathFinder.search
Room.find
CostMatrix construction
```

---

# 30. Global Reset

必须保证：

```text
Memory survives
Runtime cache dies
```

因此：

```text
global reset
 ↓
load Memory
 ↓
rebuild indexes
 ↓
rebuild caches
 ↓
continue
```

绝不能依赖：

```text
global.foo
```

保存持久事实。

---

# 31. 每次重构的提交规则

每个 Commit 只做一种变化。

推荐：

```text
refactor(runtime): add actor ownership
refactor(commands): introduce command gateway
refactor(tasks): add runtime indexes
refactor(agents): add legacy adapter
refactor(movement): wrap legacy engine
refactor(spawn): split demand arbitration
...
```

禁止一个 commit：

```text
“重构所有系统”
```

---

# 32. Coding Agent 规则

交给 Agent 时必须明确：

1. 不改变业务算法，除非任务明确要求；
2. 不扩大改动范围；
3. 不绕过 Command Boundary；
4. 不新增直接 Game mutation；
5. 不写 API object 到 Memory；
6. 不删除 Legacy，除非迁移完成；
7. 新代码必须通过 TypeScript；
8. 修改后运行模拟测试；
9. 报告行为变化；
10. 报告 CPU 变化。

---

# 33. 每阶段验收

每阶段必须：

```text
npm test
npm run build
simulation
```

生产验证：

```text
RCL progression
spawn starvation
creep death recovery
task recovery
room loss
room regain
enemy invasion
remote mining
terminal logistics
global reset
CPU bucket pressure
```

---

# 34. 第一阶段实际改动建议

第一批不要碰业务。

只新增：

```text
src/runtime/actorOwnership.ts
src/runtime/actorRegistry.ts
src/runtime/commandBus.ts
src/runtime/commandTypes.ts
src/runtime/intent.ts
```

然后给现有系统加观察层。

目标：

```text
行为不变
控制权可见
```

这是最安全的重构起点。

---

# 35. 第二批

把：

```text
ActionBroker
```

改成：

```text
CommandGateway
```

增加：

```text
ownership validation
command tracing
action result classification
```

行为仍然保持一致。

---

# 36. 第三批

将 Agent：

```text
Legacy
```

与：

```text
Nexus
```

统一到：

```text
AgentRuntime
```

这是整个项目真正开始“变成 Nexus”的阶段。

---

# 37. 最终迁移完成标志

代码中搜索：

```text
spawnCreep(
createConstructionSite(
creep.move(
creep.moveTo(
creep.harvest(
creep.transfer(
creep.withdraw(
creep.build(
creep.repair(
creep.upgradeController(
```

最终这些 mutation 只能出现在：

```text
commands/
execution/
adapters/
```

而不能出现在：

```text
strategy/
coordination/
tasks/
agents/
```

---

# 38. 重构路线核心原则

永远遵循：

```text
先控制权
再接口
再状态
再行为
最后删除旧实现
```

而不是：

```text
先整理目录
再重写代码
```

