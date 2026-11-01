# Nexus-Bot 重构指导文档
## `dev` 分支 → NEXUS 目标架构的分阶段迁移方案

---

## 目录

| 范围 | 内容 |
|---|---|
| §0–§2 | 全文约定（Phase 三要素块）· 重构原则 · 阶段总览 |
| §3–§10 | Phase 0–4：冻结基线 · Actor Ownership · Command Boundary · ActionResult · TaskBoard · Reconciliation · Agent · Legacy Role 迁移 |
| §11–§20 | Phase 5–8：Movement · 禁止项 · Construction · ConstructionPlan · Spawn · SpawnDemand · BodyFactory · Economy · Ledger · Transfer 统计 |
| §21–§30 | Phase 9–15：Defense · Cluster/Squad · Squad 迁移 · Teams · Industry · Expansion · InterShard · 删除 Legacy · 性能 · Global Reset |
| §31–§38 | 提交规则 · Coding Agent 规则 · 每阶段验收 · 三批改动建议 · 迁移完成标志 · 路线核心原则 |

---

# 0. 全文约定：Phase 三要素块

本文档每个 Phase 章节自 §3 起统一附带**三要素块**。三要素块是 Phase 的可执行规格，Phase 正文（迁移内容）与三要素块冲突时以三要素块为准。

```text
┌─ 进入条件 ──────────────────────────────────────────┐
│ 前置 Phase 的产出依赖（硬依赖，缺一不可开工）        │
│ + 现存代码基线（开工时必须已存在的实现/工具）        │
├─ 验收门禁 ──────────────────────────────────────────┤
│ 编号门禁项 G-<phase>-<n>，每项必须：                 │
│   ① 可客观度量（命令/断言/指标，不是主观评价）       │
│   ② 注明度量方法（怎么测：命令、场景、断言）         │
│ 全部门禁通过才算 Phase 完成                         │
├─ 回滚策略 ──────────────────────────────────────────┤
│ 回滚开关（配置项名 + 安全档位）或还原步骤            │
│ （代码回退点 / Memory 兼容性说明）                   │
└─────────────────────────────────────────────────────┘
```

门禁项编号规则：`G-<phase>-<n>`，如 `G-P0-1`（Phase 0 第 1 项）、`G-P14-3`（Phase 14 第 3 项）。编号一经使用不复用：门禁项废除时标 `[废除：原因]`，不删行。

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
Phase 0  冻结基线
Phase 1  Actor Ownership
Phase 2  Command Boundary
Phase 3  TaskBoard
Phase 4  Agent
Phase 5  Movement
Phase 6  Construction
Phase 7  Spawn
Phase 8  Economy
Phase 9  Defense
Phase 10 Cluster / Squad
Phase 11 Teams
Phase 12 Industry
Phase 13 Expansion
Phase 14 删除 Legacy
Phase 15 性能
```

> 阶段与章节的对应：Phase 0–15 的正文分别为 §3、§4、§5、§7、§9、§11、§13、§15、§18、§21、§22、§24、§25、§26、§28、§29；夹在中间的其他章节是对应 Phase 的配套专题（如 §6 ActionResult、§8 Reconciliation、§10 Legacy Role 迁移）。

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

## 3.1 基线指标采集方法表

每个指标三答案：**怎么采、记在哪、什么格式**。

| 指标 | 怎么采（命令/方法） | 记在哪 | 什么格式 |
|---|---|---|---|
| 编译状态 | `npm run typecheck && npm run build` | 终端输出存档 | pass/fail + 错误数（0 预期） |
| 单测/集成 | `npm test` | 终端输出存档 | `N passed / M failed` + 用例总数 |
| sim 场景门 | `npm run sim`（speedrun / sprint / remote-mine / arena / boot / run-residue / race-body-audit 七场景） | sim 输出（断言结果 + tick 数） | 场景名 × pass/fail × 达成 tick |
| RCL 时间线 | speedrun 场景的 `rclReachedBy` 取证钩子（world/perception 记录每级达成 tick） | sim 输出 + Memory dump | `L2@<tick>, L3@<tick>, …`（未达级记 `None`） |
| CPU 基准 | sim 场景内 CPU 采样（均值/峰值/P95） | sim 输出 | `avg <x> / peak <y> / p95 <z>` 每 场景一行 |
| Spawn 周期 | sim Memory dump 的 `units` 注册表：bornAt 差分的均值 | `/tmp` dump 分析 | `平均孵化间隔 <n> tick` |
| creep 死亡率 | sim Memory dump：`units` 注册表中死亡回收数 ÷ 总出生数，按 场景分母 | 同上 | `死亡率 <p>%` |
| 任务完成率 | sim Memory dump：tasks 终态计数（done ÷ done+failed+expired） | 同上 | `完成率 <p>%` |
| 实服对照（可选） | 私服 W5N8 落地 4wt 窗口的 RCL 时间线与账号 CPU 曲线 | 私服截图/console | 与 sim 同口径的时间线 |

**记录约定**：每轮基线采集落一份 `docs/bugs/` 审计文档或 sim 场景输出存档，标注日期 + 基准 commit——Phase 验收时"回到基线"指回到同 commit 的这套数字，不是重新跑一遍然后凭感觉比较。

## 3.2 Phase 0 三要素块

**进入条件**

- 无（Phase 0 是一切的前置）。唯一前提：`main` 分支可构建、可跑 sim。

**验收门禁**

- `G-P0-1` 基线数字齐备：上表九项指标全部有"怎么采/记在哪/什么格式"三答案，且至少完成过一轮完整采集。度量：按表逐行检查存档存在。
- `G-P0-2` 可复现：同一 commit 重跑 speedrun 场景两次，`rclReachedBy` 时间线差异 ≤ 采样噪声（±50 tick，来自随机地形/路径）。度量：两次 sim 输出对比。
- `G-P0-3` 基线入库：基准 commit 哈希 + 采集日期 + 全部指标数字记录在案（docs/bugs 审计文档或独立基线文档）。度量：文档存在且含 commit 哈希。

**回滚策略**

- Phase 0 不改代码，无回滚需求。基线文档写错 = 重采一轮覆盖。

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

## 4.1 三阶段行为定义（与 01 篇 §5.4/§5.5 同口径）

| 阶段 | mode 值 | acquire 行为 | assertOwner（broker 侧）行为 | 升级条件 |
|---|---|---|---|---|
| 记录 | `record` | 总是 `acquired: true`；冲突只记账（后到者覆写租约，行为与无机制一致） | 一律放行 | 冲突面数据稳定收集 ≥ 1 轮实服窗口（4wt），且冲突热点清单可解释（每对 holder/challenger 有归因） |
| 告警 | `warn` | 同 record + 限频告警（同一冲突对 `warnIntervalTicks` 窗口内只告警一次） | 放行 + 告警 | 告警静默（连续 1 个实服窗口无非预期冲突对），且 sim 六场景在 enforce 档全绿 |
| 拦截 | `enforce` | 低优先级（≤ 持有者）挑战者被拒（`acquired: false`）；高优先级允许夺取 | 非租约方 creep 命令被拦（`suppressed("not-owner")`）——终态档 |

各阶段详细冲突判定矩阵见 01 篇 §5.5（模式 × 优先级 × 孵化中保护的完整表）。

## 4.2 降级开关

模式切换经 `src/config/ownership.ts` 的 `OWNERSHIP_CONFIG.mode`，**只改配置不动代码**：

```text
enforce → warn   : 拦截误伤时降一档（紧急止血）
warn → record    : 告警刷屏时静默观察
record → (无)    : 已是最低档；机制整体不可关闭（观察层恒在）
```

配套参数：`leaseTicks`（租约时长，缺省 5）、`warnIntervalTicks`（告警限频窗口，缺省 500）。

误伤判定标准（何时降级）：enforce 档下出现"合法控制路径被 `not-owner` 拦截"——特征是同一 actor 的 `suppressed("not-owner")` 连续多 Tick 且该 actor 任务租约仍有效。此时先降 warn 观察，归因修复后再升回。

## 4.3 Phase 1 三要素块

**进入条件**

- Phase 0 完成（`G-P0-3` 基线入库）——冲突面数据要能与基线行为对照。
- 现存代码基线：broker submit/commit 两段式已存在（assertOwner 挂点在 commit 前）。

**验收门禁**

- `G-P1-1` 机制存在：`acquire/release/ownerOf/assertOwner/renew` 五操作可用，数据分级符合 01 篇 §5.3（活跃租约在 global 层，持久索引在 Memory 带版本）。度量：代码审查 + `grep` 确认无 Memory 膨胀路径。
- `G-P1-2` record 档零行为漂移：record 档下七 sim 场景输出与 Phase 0 基线一致（时间线差异 ≤ 噪声带）。度量：场景对比。
- `G-P1-3` 冲突面可观测：冲突热点环形缓冲 + 遥测计数（`suppressedCount`）可从 sim/console 读出。度量：制造一次已知冲突（双路径控制同一 creep）能看到记录。
- `G-P1-4` enforce 档 sim 全绿：sim 六场景在 enforce 档断言全过。度量：`npm run sim` + mode 配置切换。
- `G-P1-5` 降级开关有效：enforce → warn → record 只改配置项即可，无需代码变更。度量：切换后场景重跑行为符合 4.2 表。

**回滚策略**

- 任何阶段异常：`OWNERSHIP_CONFIG.mode` 降回 `record`（观察层不拦截，行为与基线一致）。
- 机制本身回退：revert Phase 1 commits——模块无 Memory 强依赖（持久索引引导为空状态即可），回退无迁移负担。

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

## 5.1 Phase 2 三要素块

**进入条件**

- Phase 1 完成（`G-P1-1`–`G-P1-3`）：assertOwner 挂点已存在，命令边界可复用所有权检查。
- 现存代码基线：broker submit/commit 两段式 + 管线仲裁骨架（扩展而非新建）。

**验收门禁**

- `G-P2-1` 五条缺失管线补齐：spawn / construction / market·terminal / claim·reserve / PowerCreep 五类 ActionKind 在 broker 注册并有 commit 分支。度量：broker ActionKind 联合类型审查 + 每 kind 单测。
- `G-P2-2` 结果语义达标：ActionResult 符合 01 篇 §16（五分类 + nativeReturnCode 仅触达时存在）。度量：单测覆盖各分类路径（含 suppressed 的两种 reason）。
- `G-P2-3` 直连调用只减不增：豁免清单（allowlist）条目数单调下降，新增直连被检查脚本拒绝。度量：守护脚本运行 + allowlist 计数对比。
- `G-P2-4` 行为等价：迁移域的 sim 场景输出与迁移前一致（时间线 bit 口径）。度量：场景对比。

**回滚策略**

- 单管线回退：该管线的 Adapter 切回直连路径（Adapter 双轨期的意义），allowlist 条目回补一行。
- `executeNow` 例外（同步窗口）：仅限孵化/紧急命令，须注释声明理由——回滚即恢复直调并保留注释追踪。

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

完整规格（五分类判定表、决策树、内部错误码注册表）以 01 篇 §16.1–§16.3 为准；本 Phase 的验收并入 `G-P2-2`，不重复设门禁。

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

## 7.1 Phase 3 三要素块

**进入条件**

- Phase 2 完成（`G-P2-2`）：任务失败反馈（onReplan）已接 broker 结果分类。
- 现存代码基线：TaskBoard 无状态门面 + Memory.Nexus.tasks 记录表已存在。

**验收门禁**

- `G-P3-1` 索引零陈旧：所有任务状态变更同步走 indexAdd/indexRemove，任何查询路径读到的桶与全量扫描一致。度量：一致性断言单测（随机操作序列后桶 == 全量）。
- `G-P3-2` 查询成本解耦：分配扫描成本与任务总量解耦（大表不拖慢常驻查询）。度量：大表（≥1000 任务）基准测试，查询耗时与任务数近似无关。
- `G-P3-3` 任务 id 无碰撞：同 tick 批量建任务不发生静默覆盖。度量：批量创建单测（id 唯一性断言）。
- `G-P3-4` 行为等价：任务系统行为（完成率/回收路径）与基线一致。度量：sim 场景对比。

**回滚策略**

- 索引是 Runtime 层（WeakMap 缓存），回退 = 移除缓存直读全量——查询变慢但正确性无损；无 Memory 迁移负担。

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

验收并入 `G-P3-4`（reconcile 摘要计数——released/expired/failed/collected/compacted——可从 sim dump 读出且无"永生任务"：available 状态记录 age 超 lease×3 的数量为 0）。

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

## 9.1 Phase 4 三要素块

**进入条件**

- Phase 1–3 完成：所有权（`G-P1-4`）、命令边界（`G-P2-2`）、任务索引（`G-P3-1`）就位——Agent 的输入（租约）与输出（Intent）两侧都有了承接。
- 现存代码基线：agentSystem 主循环 + NEXUS_TASK_DRIVEN_CODES 类别收编开关已存在。

**验收门禁**

- `G-P4-1` 单路径决策：每个 creep 每 Tick 恰有一条决策路径（任务驱动 / legacy exec / courier 专线互斥），决策前 acquire。度量：冲突遥测为零（enforce 档 sim 全绿）。
- `G-P4-2` legacy exec 可关断：`legacyExecMode` 三级开关（类别级 → 全局）生效，关断后任务驱动覆盖全部存活单位。度量：开关切换场景对比（关断后无"无 owner 空转"creep）。
- `G-P4-3` 死 handler 清零：roleRegistry 注册的执行器全部有实现且可达（无"注册了但永不执行"的断链）。度量：注册表 × 执行路径覆盖审查。

**回滚策略**

- `legacyExecMode` 切回 `on`（legacy exec 立即恢复）——开关是本 Phase 的安全网，任何任务驱动缺口先切回再修。

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

验收并入 Phase 4 门禁（`G-P4-2`/`G-P4-3`）与 Phase 14 删除门禁——迁移本身不设独立门禁，删除 legacy 角色时按 §28 四条件判定。

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

## 11.1 Phase 5 三要素块

**进入条件**

- Phase 2 完成（`G-P2-1`）：move 管线已在 broker（MoveIntent 有提交通道）。
- Phase 4 完成（`G-P4-1`）：Agent 单路径决策就位，MoveIntent 有唯一生产者。
- 现存代码基线：movement engine（betterMove/moveMatch/traffic/PathFinder 缓存）自猴补丁运行。

**验收门禁**

- `G-P5-1` 原型猴补丁移除：`Creep.prototype.move/moveTo` 劫持撤销，移动全部经 MovementAdapter 进入 broker move 管线。度量：`grep` 无 prototype 劫持残留 + 冲突遥测为零。
- `G-P5-2` 移动行为等价：迁移后堵车率、到达耗时与基线同口径对比不劣化（±10% 噪声带）。度量：traffic 统计（blocked/hotspots）场景对比。
- `G-P5-3` PathFinder 归层：PathFinder 调用只出现在 Movement Layer；Agent/Task 层零直调。度量：`grep` 检查（§12 禁止项落地）。
- `G-P5-4` 类型恢复：movement 模块脱离 `@ts-nocheck`，typecheck 全绿。度量：`npm run typecheck`。

**回滚策略**

- 猴补丁恢复 = Adapter 直调旧引擎（引擎本体未动，包装层回退即恢复）；移动是最高频路径，回退必须在单 commit 内可完成。

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

禁止项的执行机制：守护脚本扫描（与 `G-P2-3` allowlist 同一工具），Agent/Task/Strategy 目录的 moveTo/move/PathFinder 直调为拒绝项，无 allowlist 豁免通道（移动收编不留豁免）。

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

## 13.1 Phase 6 三要素块

**进入条件**

- Phase 2 完成（`G-P2-1`）：construction 管线（createSite/拆除）已在 broker。
- Phase 4 完成：Builder Agent 走任务驱动。
- 现存代码基线：layoutPlanner 六模块 + controllerBuffer 评分选点已存在（算法保留，只收编执行出口）。

**验收门禁**

- `G-P6-1` Planner 零直建：planner 目录无 createConstructionSite/removeConstructionSite 直调（布局生成与执行彻底分离）。度量：守护脚本扫描，零 allowlist 条目。
- `G-P6-2` 建造放量联动：工地创建量与 builder 吞吐联动（不超builder 消化能力铺量）。度量：sim 场景在建工地数 ≤ builder 数 × 配置系数。
- `G-P6-3` 行为等价：RCL 时间线不劣化（建造链路收编不拖慢冲级）。度量：speedrun 场景 bit 对比。

**回滚策略**

- Planner 直建恢复：construction 管线回 Adapter 双轨（intent 失败时直调兜底），一条 allowlist 豁免注释即可——但目标态是零豁免。

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

规格字段说明（与 01 篇 §24.2 字段表模板同构，持久化部分按模板声明）：

| 字段 | 类型 | 落点 | 说明 |
|---|---|---|---|
| `roomName` | string | Memory（layout 记录） | 所属房 |
| `revision` | number | Memory | 计划版本号，单调递增；修订 = 新 revision，不覆写历史 |
| `sites` | PlannedSite[] | Memory（当前 revision） | 计划点位；已建/在建状态由 World 对账，不在计划内记忆 |

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

## 15.1 Phase 7 三要素块

**进入条件**

- Phase 2 完成（`G-P2-1`）：spawn 管线已在 broker（SpawnExecutor 有提交通道）。
- Phase 8 的 ResourceLedger 概念可用（孵化预留经账本，defender 先行口径已存在）——Phase 7/8 交叉依赖，先账本后拆分亦可。
- 现存代码基线：spawnDirector 仲裁+执行+命名+登记一体；directSpawn 已收编 broker（executeNow）。

**验收门禁**

- `G-P7-1` 拆分到位：六件套职责边界清晰——Demand Sources 只产需求单，Arbiter 只排序裁剪，BodyFactory 纯函数，Queue 有界，Executor 唯一持 spawnCreep 调用权（经 broker）。度量：模块依赖审查 + Executor 单点 grep。
- `G-P7-2` directSpawn 无旁路：紧急孵化经 broker executeNow（同步窗口注释声明），无第二直调点。度量：`grep` spawnCreep 直调仅 Executor 一处。
- `G-P7-3` 需求单可追溯：每只 creep 的出生可回溯到某条 SpawnDemand（reason 字段链路完整）。度量：sim dump 抽样断言。
- `G-P7-4` 行为等价：孵化节拍、定编口径与基线一致。度量：speedrun/sprint 场景 bit 对比。

**回滚策略**

- 拆分按模块渐进（先抽 BodyFactory 纯函数化，再拆 Arbiter），每步独立 commit 可单独 revert；spawnDirector 保留为装配壳直至 Phase 14 删除。

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

字段语义：`deadline` 是需求失效时刻（过线被 Arbiter 丢弃，不进 Queue）；`budget` 是该需求的能量上限（缺省走 BodyFactory 按库存定档）；`reason` 是溯源字段（`G-P7-3` 的断言依据）。

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

验收并入 `G-P7-1`（纯函数约束：单测以入参出参断言，无 Game 依赖注入即通过）。

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

## 18.1 Phase 8 三要素块

**进入条件**

- Phase 2 完成：reserve/commit 的能源经账本（defender 先行口径存在）。
- 现存代码基线：ledger 五态 + income 模型 + 饥饿生命体征已运行（算法保留，收编边界）。

**验收门禁**

- `G-P8-1` 五态分账达标：符合 01 篇 §18.1（记账时点/结算规则/五不变量）。度量：不变量单测（超发拒绝、TTL 回收、consumed 单调、available 非负）。
- `G-P8-2` 预留无泄漏：maintainLedger 每 Tick reconcile 阶段接线，超龄强制回收兜底。度量：soak 场景 Memory 峰值平稳（预留表有界）。
- `G-P8-3` Economy→Spawn 单通道：经济只产 SpawnDemand（经 `G-P7-1` 需求单），无直接 spawn 调用。度量：依赖审查。
- `G-P8-4` 行为等价：经济指标（harvested/delivered 速率）与基线一致。度量：sim 场景指标对比。

**回滚策略**

- 预留记账回退：拒发条件放宽为"总是成功"（等价关闭账本约束），泄漏面回到观察态——五态视图仍在，只是不拦截。

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

完整规格（字段级 schema、记账时点表、操作语义、五不变量）以 01 篇 §18.1–§18.2 为准；本 Phase 验收并入 `G-P8-1`/`G-P8-2`。

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

验收并入 `G-P8-4`（速率指标口径以观察差分为准，单测断言统计不读行动前状态）。

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

## 21.1 Phase 9 三要素块

**进入条件**

- Phase 2 完成：塔动作/安全模式管线在 broker（现有基础）。
- Phase 10 的 SquadRequest 通道可用（defense 是编队需求方）——Phase 9/10 交叉，先通道后需求亦可。
- 现存代码基线：defense-planners（emergency 阶段）+ 威胁更新已存在。

**验收门禁**

- `G-P9-1` 击杀归因正确：hostilesKilled 只计确证击杀（可见击杀/尸体），敌消失记"丢失接触"不计 kill。度量：威胁统计单测（消失场景计数不变）。
- `G-P9-2` Defense 是需求方：defense 模块零直控 creep（只产 SquadRequest/CombatCommand 经边界）。度量：守护脚本扫描 defense 目录直连调用为零。
- `G-P9-3` 威胁置信度：ThreatModel 含 visible/historical/confidence 三分量，失视衰减可配。度量：模型字段审查 + 失视场景统计衰减断言。

**回滚策略**

- 需求化回退：defense 切回自执行模式（Adapter 双轨），允许 temporary 直控 allowlist 条目（标注回收期限）。

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

## 22.1 Phase 10 三要素块

**进入条件**

- Phase 3 完成：任务板是编队槽位的承接层（槽位任务 `assignedTo` 反填成员）。
- 主 specs `cluster-squad` 已冻结（需求经单 Tick 队列、编队只持有槽位）——本 Phase 实现它。

**验收门禁**

- `G-P10-1` 单事实源：Nexus SquadRecord 是唯一战略编队记录，Teams 不产第二份。度量：squads 写入方 grep 唯一。
- `G-P10-2` 编队不持单位：SquadRecord 只存槽位定义与派生成员名，成员执行普通任务（对 Agent 透明）。度量：specs/cluster-squad 场景断言。
- `G-P10-3` 需求队列有界：SquadRequest 单 Tick 队列消费即清空、同类合并、超限截断。度量：specs/cluster-squad 场景断言。

**回滚策略**

- 编队需求暂停：SquadRequest 生产方停发（队列自然清空，存量编队随租约到期解散）——编队是叠加层，撤除不影响单体任务路径。

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

验收并入 `G-P10-1`；Team 内部算法的最终替换按 Phase 11 三阶段走。

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

## 24.1 Phase 11 三要素块

**进入条件**

- Phase 10 完成（`G-P10-1`）：Squad 单事实源就位，TeamAdapter 有上游。
- 现存代码基线：teams 战斗算法（Formation/TeamBattle/TeamCalc）成熟运行——Adapter First，算法不动。

**验收门禁**

- `G-P11-1` Teams 零直连：teams 目录直控 creep 的调用全部经 Adapter → CombatCommand。度量：守护脚本扫描 teams 直连调用（allowlist 只减不增）。
- `G-P11-2` 三阶段可停：每阶段结束点是稳定态（阶段一回退 = Adapter 摘除直连旧控；阶段二回退 = CombatCommand 降级直通）。度量：各阶段独立 commit + 场景绿。
- `G-P11-3` 战斗行为等价：编队战斗输出（攻防交换比）与基线同口径不劣化。度量：arena 场景对比。

**回滚策略**

- 阶段回退点内置（见 `G-P11-2`）；战斗域回退优先保行为（输一场战斗比架构洁癖重要）。

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

## 25.1 Phase 12 三要素块

**进入条件**

- Phase 2 完成（`G-P2-1`）：market/terminal/power 管线在 broker。
- 现存代码基线：industry 各子系统（link/lab/factory/powerspawn/market/console）自运行——按依赖顺序逐个 Adapter 化。

**验收门禁**

- `G-P12-1` 逐系统收编：按迁移顺序每系统完成 IndustryIntent → Adapter → legacy 链路，一次一个系统。度量：每系统独立 commit + 该系统直连调用清零。
- `G-P12-2` console 通道收编：industry console（人操通道）同样经边界（命令式操作走 executeNow 口径）。度量：console 目录 Game.rooms 直读清零。
- `G-P12-3` 行为等价：lab/factory 产出节拍、market 交易行为与基线一致。度量：相关场景或实服观察对照。

**回滚策略**

- 单系统回退：该系统 Adapter 摘除（回到直连 legacy），迁移顺序保证系统间无强依赖——Link 回退不影响 Lab 进度。

---

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

## 26.1 Phase 13 三要素块

**进入条件**

- Phase 2 完成：claim/reserve 管线在 broker。
- Phase 3 完成：扩张目标以 ExpansionTask 承接（claim creep 走任务驱动）。
- 现存代码基线：expand 邻房候选（半球硬编码已修）+ 外矿体系运行中。

**验收门禁**

- `G-P13-1` Expansion 零直连：expand 目录直控（claimController/move 直调）清零，Expansion 只产决策与任务。度量：守护脚本扫描。
- `G-P13-2` 外矿链路可观测：外矿收入/断链状态可从遥测读出（静默断裂可见）。度量：remote-mine 场景断言。
- `G-P13-3` 行为等价：扩张节奏（外矿开矿时间线）与基线一致。度量：remote-mine 场景 bit 对比。

**回滚策略**

- 决策与执行已分离，回退 = Executor 直连旧路径（Adapter 双轨）；邻房候选算法不动。

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

验收并入 Phase 13 门禁（`G-P13-1` 口径延伸至 intershard 目录；跨 shard 消息 schema 显式化 = `G-P13-2` 观测性的前置）。当前单 shard 运行期（speedrun 主线）本 Phase 优先级最低，不设独立门禁。

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

## 28.1 四条件判定程序

四条件**按序判定，缺一即拒**。判据与证据格式（台账：`docs/nexus-design/10-legacy-removal-ledger.md`）：

| 条件 | 判定程序 | 证据格式 |
|---|---|---|
| ① Nexus 等价存在 | 接管职责的新实现已在**生产路径**生效（不是"代码存在"而是"当前 Tick 流量走它"）。度量：生产路径代码审查 + 该路径的行为输出在 sim 可观测 | 引用实现文件 + 生效路径说明（一两句） |
| ② 实服验证 | 对应行为在私服（47.100.24.220）一个 4wt 重置周期内正常。度量：落地观察该域行为无回归（console 无异常刷屏、RCL 时间线不倒退） | 落地日期 + 观察窗口 + 行为正常描述。**豁免口径**：人操不可达路径（sim 内亦不可达）可按"路径不可达 + sim 互证"豁免，须在台账显式标注豁免理由——9.2 角色库删除不得豁免 |
| ③ sim 验证 | `scripts/sim-matrix.mjs` 全场景门绿。度量：场景矩阵输出 pass + 关键指标（RCL 时间线 bit）与删除前一致 | 场景矩阵输出（场景 × pass × 时间线 bit） |
| ④ CPU 验证 | 接管后 cpu p95 不劣化。度量：同场景对比，劣化 > 2ms 拒绝 | p95 数值对比（删除前 → 删除后） |

## 28.2 删除申请证据链

一次合法删除 = 台账一行新记录，四列齐全：

```text
| 日期 | 删除单元（域） | 豁免清单变化 | 四条件证据 | 结果 |
```

- **删除单元**：最小可回退单元（一个职责域）。跨域批量删除被拒——回退粒度优先。
- **豁免清单变化**：直连调用 allowlist 的条目增减（如 `334→328（−6）`），无变化写"无"。
- **四条件证据**：①–④ 各一格，按 28.1 格式；豁免须显式写豁免口径。
- **台账只增不改**：回退需显式记录决策（新行写"回退 + 理由"），不涂改旧行。

## 28.3 Phase 14 三要素块

**进入条件**

- Phase 1–13 对应域的 Adapter 已在生产路径生效（本 Phase 按删除顺序逐域进行，每域独立判定）。
- 台账机制已建立（`10-legacy-removal-ledger.md` 存在且格式如 28.2）。

**验收门禁**

- `G-P14-1` 每次删除有台账行：任何 legacy 删除 commit 必须对应台账新增一行，四条件证据齐全。度量：commit × 台账行一一对照。
- `G-P14-2` 最小单元：一次删除只动一个职责域。度量：commit diff 的文件范围审查。
- `G-P14-3` 删除后全绿：每次删除后 `scripts/sim-matrix.mjs` 全场景 pass + CPU p95 对比不劣化。度量：场景矩阵输出留档。
- `G-P14-4` allowlist 收敛：直连调用豁免清单总数不回升。度量：allowlist 条目数单调不增（台账"豁免清单变化"列可审计）。

**回滚策略**

- 单域回退：revert 该域删除 commit（最小可回退单元设计的意义所在）。
- 回退决策记台账（新行），allowlist 条目相应回补。

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

## 29.1 Phase 15 三要素块

**进入条件**

- Phase 14 主要域删除完成（优化对象是 Nexus 单实现，不是双轨期代码）。
- 现存代码基线：cpuBudget（P0–P3 带判 + 饥饿保护 + recordSkip 可解释）已运行——本 Phase 是预算带的扩展校准（P4 Cosmetic 细分）与热点优化。

**验收门禁**

- `G-P15-1` 预算带全覆盖：全部 TickModule 声明 band，无"未声明默认档"。度量：模块清单 × band 声明审查。
- `G-P15-2` CPU 达标：同场景 cpu avg/p95 对比 Phase 0 基线不劣化（目标：优化后 p95 低于基线）。度量：sim 场景 CPU 采样对比。
- `G-P15-3` skip 可解释：每类 CPU skip 有 reason 记录（`recordSkip(name, reason)`），skip 计数可从遥测读出。度量：高压场景 skip 报表审查（03 篇 BUG-035 口径）。
- `G-P15-4` 热点清零：重点优化清单逐项过审——Object.values 全量遍历改索引读、PathFinder 结果缓存复用。度量：profiler 热点表对比（无 >2% 单点残留清单项）。

**回滚策略**

- 性能优化逐项独立 commit（§31 规则），单点回退不影响预算带框架；预算带阈值调整纯配置。

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

这三项是**每阶段通用底线**（任何 Phase 的 commit 都必须过），各 Phase 的**专项验收**以各章三要素块的 `G-P<phase>-<n>` 门禁编号为准（§0 约定）——本章节不另设第二套指标，只做汇总索引：

| Phase | 门禁编号区间 | 专项重点 |
|---|---|---|
| P0 冻结基线 | `G-P0-1`–`G-P0-3` | 基线数字齐备、可复现、入库 |
| P1 Ownership | `G-P1-1`–`G-P1-5` | 三档模式 + 降级开关 |
| P2 Command Boundary | `G-P2-1`–`G-P2-4` | 五管线 + 结果语义 + allowlist 收敛 |
| P3 TaskBoard | `G-P3-1`–`G-P3-4` | 索引零陈旧 + 无碰撞 |
| P4 Agent | `G-P4-1`–`G-P4-3` | 单路径 + legacy 可关断 |
| P5 Movement | `G-P5-1`–`G-P5-4` | 猴补丁移除 + 禁止项落地 |
| P6 Construction | `G-P6-1`–`G-P6-3` | Planner 零直建 |
| P7 Spawn | `G-P7-1`–`G-P7-4` | 六件套 + directSpawn 无旁路 |
| P8 Economy | `G-P8-1`–`G-P8-4` | 五态分账 + 无泄漏 |
| P9 Defense | `G-P9-1`–`G-P9-3` | 击杀归因 + 需求方化 |
| P10 Cluster/Squad | `G-P10-1`–`G-P10-3` | 单事实源 + 槽位制 |
| P11 Teams | `G-P11-1`–`G-P11-3` | 零直连 + 三阶段可停 |
| P12 Industry | `G-P12-1`–`G-P12-3` | 逐系统收编 |
| P13 Expansion | `G-P13-1`–`G-P13-3` | 零直连 + 链路可观测 |
| P14 删除 Legacy | `G-P14-1`–`G-P14-4` | 台账证据链 + allowlist 单调降 |
| P15 Performance | `G-P15-1`–`G-P15-4` | 预算带全覆盖 + 热点清零 |

生产验证（实服落地后的观察项，非门禁判据——门禁以 sim 可测为准，生产观察为旁证）：

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

> 裁定注（与 01 §29.1 联动）：`commands/`、`execution/`、`adapters/` 是**职责标签**而非必须的物理目录——现行结构里它们对应 broker 执行层（`modules/agents/actionBroker.ts` 的 commit 分支）与各 Adapter 模块。完成标志的判据是"调用权只在执行层"，物理目录以 nexus-design/02-architecture-charter.md §21.1 现行态为准。

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

