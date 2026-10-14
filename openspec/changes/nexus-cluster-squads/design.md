# Design

## D1 编队不持有单位，只持有槽位

编队记录 `SquadRecord` 只保存**槽位定义**（数量/能力/任务种类/优先级），成员通过槽位任务的 `assignedTo` **反填**。

- 复用 TaskBoard 的租约、对账、抢占、失败封顶等全部不变量，无需第二套分配器。
- 编队对成员**透明**：成员执行的是普通任务，Agent 层无需知道"我在编队里"。
- 增删编队类型不改动 Allocator / AgentSystem。

否决：把 `assignedTo` 扩展为编队 ID。需要改动全部任务不变量与 Agent 读取路径，收益不足。

## D2 需求经 global 运行时层单 Tick 队列传递

`requestSquad()` 写入 `globalThis.nexus.runtime.cluster.requests`，`cluster-squads`（planning 阶段）用 `takeSquadRequests()` 消费并清空。

- 符合 docs/nexus-design/03 §3.6「不建事件总线；事件表示为本 Tick 汇总的事实」。
- 跨阶段（emergency → planning）传递无需引入调度依赖。
- 丢失去只影响一个 Tick 的续期，TTL 迟滞兜底。

否决：独立事件总线 —— 隐藏时序依赖，违背「简单清晰」。

## D3 持久化分级

| 数据 | 层 | 理由 |
|---|---|---|
| 编队记录 `Memory.squads` | Memory（跨重载） | 决策状态；重载后成员/槽位关系仍需可归因 |
| 需求队列 `runtime.cluster.requests` | global（重载即失） | 单 Tick 派生，重建廉价 |
| 指令/快照派生 | TickContext | 每 Tick 重建 |

## D4 威胁分级决定协作形态

| tier | 响应 |
|---|---|
| peace | 无任务（塔仅修缮） |
| low | 规划器直接建单条 `defend` 任务（塔 + 单 defender） |
| high | 规划器**登记编队需求**，槽位数 = `STAFFING_CONFIG.tierDefenders.high`，由集群建队 |

理由：低强度用编队是过度工程；高强度单任务不足。槽位数直接复用既有编制配置，避免两处事实源。

## D5 命名空间隔离

- 防御规划器只清理 `defend:<room>` / `retreat:<room>` 前缀任务。
- 集群只清理 `squad:<id>:slot:` 前缀任务。

理由：两个规划器都写 `defend` 类型任务，若不隔离会互相取消（实测踩坑）。

## D6 槽位任务优先级下限抬升

`CLUSTER_CONFIG.priorityFloor`（80）与需求方优先级取大。

理由：编队任务是防御承诺，不应被经济繁荣期的 harvest/haul 挤掉（Allocator 的抢占阈值 `CRITICAL_PRIORITY = 90` 之上为紧急线，80 保证不被低优先级任务挤出）。

## D7 防御类槽位任务不带 targetId

威胁目标每 Tick 变化；`agentSystem` 的 `defend` 分支本就每 Tick 从快照重选目标（`rankHostiles(room)[0]`）。

理由：带静态 targetId 会导致目标死亡即任务失效，产生大量 replan 抖动。

## D8 解散时取消而非释放槽位任务

需求消失后这些任务无意义；释放回池会产生"幽灵防御任务"，被经济单位误领。

## 数据流

```
defense-planners(emergency)
  ├─ updateRoomThreat → Memory.rooms[].threat
  ├─ planDefenseRoom
  │    ├─ tier=low  → TaskBoard.upsert(defend:<room>:low)
  │    └─ tier=high → requestSquad() → runtime.cluster.requests
  ├─ assignTowers → broker.submit(pipeline=tower)
  └─ foldTowerSpend

cluster-squads(planning)
  ├─ takeSquadRequests()
  ├─ applyRequest → Memory.squads[id]
  ├─ 过期 → disband(取消槽位任务) + delete
  └─ 活跃 → maintain(槽位任务 upsert / 收缩清理 / 成员回填)

task-system(reconcile) → assignBatch(含槽位任务)
spawn-director(spawn)  → 槽位任务缺口 → defender
agents / action-broker → 提案与统一提交
```
