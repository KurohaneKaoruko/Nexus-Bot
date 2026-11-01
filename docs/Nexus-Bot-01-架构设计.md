# Nexus-Bot 架构设计文档
## 基于 `dev` 分支源码审计 + Screeps 游戏模型 + “机凯种智械连结”理念

> 基线仓库：KurohaneKaoruko/Nexus-Bot  
> 基线分支：`dev`  
> 文档定位：最终目标架构与实现规范，而不是当前代码结构的简单描述。

---

## 目录

| 范围 | 内容 |
|---|---|
| §1–§4 | 设计目标 · Screeps 作为架构约束 · 最终架构总图 · 六层职责 |
| §5–§9 | Actor Ownership · TickContext · World Model · Intelligence · Cluster |
| §10–§16 | Task System · Task Lease · Agent · Intent · Command · ActionBroker · ActionResult |
| §17–§23 | Movement · Economy · Spawn · Construction · Defense / Combat · Teams · Industry |
| §24–§28 | Memory · Runtime Index · CPU 架构 · Error Isolation · Event System |
| §29–§34 | 最终目录 · 依赖规则 · 模块标准结构 · 机凯种理念落地 · 最终 Tick · 重构成功标准 |

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

## 5.3 Ownership Record 字段表

数据分级（Memory/Runtime 分界，见 §24.3）：

| 数据 | 位置 | 结构 | 生命周期 |
|---|---|---|---|
| 活跃租约 | `global.Nexus.runtime.actorOwnership.leases` | `Record<actor名, OwnershipLease>` | 单 Tick 可重建的权威态；不占 Memory |
| 跨 Tick 持久索引 | `Memory.Nexus.ownership.runtime.actorOwnershipIndex` | `Record<actor名, {owner, expiresAt}>` | 只存 owner 名与到期 tick；schema 版本管理 |
| owner 候选名册 | `global` 运行时层 | `Record<owner名, 静态优先级>` | 每候选一条，代码注册 |
| 冲突热点 | `global` 运行时层 | `OwnershipConflictRecord[]` | 有界环形（最近 64 对），遥测聚合 |

字段定义：

```ts
interface OwnershipLease {
    owner: string;          // 当前持有者 (owner 名, 静态优先级见名册)
    acquiredTick: number;   // 获取 tick
    expiresAt: number;      // 到期 tick = acquiredTick + leaseTicks (配置);
                            // 持有者须在此之前续期, 逾期未续自动失效
}

interface OwnershipConflictRecord {
    tick: number;
    actorName: string;
    holder: string;         // 现有持有者
    challenger: string;     // 挑战者
    count: number;          // 同一对 (actor, holder, challenger) 累计冲突数
}
```

## 5.4 四操作语义与时序

| 操作 | 语义 | 时序要求 |
|---|---|---|
| `acquire(actor, owner, tick, {priority?})` | 获取控制权，返回 `{acquired, holder?, reason?}` | 各控制路径在**提交命令前**调用；同一 Tick 内先到者建立租约 |
| `release(actor, owner)` | 仅当前持有者能释放；删除租约 | 控制路径退出/让位时调用；非持有者调用无效果 |
| `renew(actor, owner, tick)` | 持有者续期 `expiresAt = tick + leaseTicks`；非持有者调用无效果 | 持续控制期间每 Tick（或至少每 leaseTicks 内）调用 |
| `ownerOf(actor)` | 只读查询当前持有者 | 任意时刻 |
| `assertOwner(actor, owner, tick)` | broker commit 前检查点：返回 `true` 放行 | broker 在 commit 阶段对 creep 管线命令逐条调用 |

时序关键点：

1. **孵化中保护**：孵化中名单在所有模式下不可夺取——挑战者只记冲突不接管，现有持有者不动（防御性语义）。
2. **无租约 = 无主 Actor**：`assertOwner` 对无租约 actor 放行——所有权机制只管冲突面，不要求全员持证。
3. **死亡自动释放**：spawnDirector 逐 tick 对账 `ctx.memory.units` 注册表与 `Game.creeps`，死亡单位连带给租约清账。

## 5.5 冲突判定矩阵

模式（`config/ownership.ts` 的 `mode`）× 挑战结果：

| 场景 | record 档 | warn 档 | enforce 档 |
|---|---|---|---|
| 无现有持有者 | 后到者建立租约 | 同左 | 同左 |
| 持有者 = 挑战者（重入） | 幂等刷新租约 | 同左 | 同左 |
| 挑战者优先级 **≤** 持有者 | 记冲突；后到者**覆写**租约（行为与无机制一致） | + 限频告警（同冲突对窗口内一次） | **拒绝**（`acquired=false`），持有者不动 |
| 挑战者优先级 **>** 持有者 | 覆写（最后说话者胜） | + 告警 | 夺取（高优先级接管，走覆写路径） |
| actor 孵化中（任何持有状态） | 记冲突，不产生租约变更 | 同左 | 同左 |
| broker 侧 `assertOwner` 非租约方提交 | 放行（只记账） | 放行（+告警） | **拦截**（`suppressed("not-owner")`），`suppressedCount++` |

优先级数值：名册静态注册（数值越高优先级越高）；挑战时可经 `options.priority` 临时覆盖，缺省取名册值。冲突热点环形缓冲只保留最近 64 对 `(actor, holder, challenger)`，按 count 聚合——遥测看冲突面，不追求全量留痕。

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

## 14.1 六层接口契约总表

各层只认相邻层的输出类型，跨层调用违规。每层契约按"输入 → 输出 → 失败时行为"三段式定义：

| 层 | 输入 | 输出 | 失败时行为 |
|---|---|---|---|
| **Cluster**（§9） | WorldView 快照 + Strategy 指令（posture/goals） | 管理域清单（rooms/remote 源/物流关系）+ 各域需求单（SquadRequest、SpawnDemand、ConstructionPlan 入口） | 单域失效不拖垮集群：域内降级为本地自治（维持既有任务租约继续执行），集群层不重试世界感知 |
| **Goal/Task**（§10–§11） | Cluster 需求单 + WorldView 缺口 | `NexusTask` 记录（含 lease/requirements/target） | 任务生成失败静默（本 Tick 无任务）；任务执行失败走 lease 过期回收 → 重新发布；同 dedupeKey 幂等合并 |
| **Agent**（§12） | 任务租约（`NexusTask.lease`）+ 自身状态机 | Intent 序列（每 Tick 至多一条/管线） | FSM Failure 分四路：retry（原样重提）/ replan（回任务层）/ abandon（释放租约）/ emergency（上报事件，让位应急逻辑） |
| **Intent**（§13） | Agent 决策 | `MoveIntent` / `HarvestIntent` / …（声明式，无副作用） | Intent 是纯数据，无失败语义；失败发生在下游 Command 阶段，经 ActionResult 反馈回 Agent |
| **Command**（§14） | Intent + 验证上下文（ownership 表/预算/仲裁窗） | `Command`（带 source 溯源与 priority） | 校验拒绝 → invalid（修提交方）；仲裁出局 → suppressed（下一 Tick 重提）；所有权拒绝 → suppressed（检查 acquire 时序） |
| **Commit/Broker**（§15–§16） | Command 队列 | `ActionResult`（五分类，见 §16.1） | 按 §16.2 决策树分类；accepted 落地效果下一 Tick 由感知确认（Tick 不变量：本 Tick 结果 ≠ 下一 Tick 状态） |

## 14.2 调用方向与禁止项

```text
Cluster → Task（发需求单）      ✓
Task → Agent（租约授予）        ✓
Agent → Intent（决策产出）      ✓
Intent → Command（验证升级）    ✓
Command → Commit（仲裁执行）    ✓

Cluster → Agent（直接指挥）     ✗ 必须经 Task
Agent → Agent（互相调用）       ✗ 经任务板协调
Intent → Game API               ✗ Intent 是纯数据
Command 跳过仲裁直执行          ✗ executeNow 例外须注释声明同步窗口理由
跨层读内部状态                   ✗ 只能读相邻层发布的接口类型
```

每层失败的**传播边界**：下层失败不自动向上冒泡重试——retryable 在 Agent 层消化（原样重提），replan 在 Task 层消化（换人/换目标），invalid 在提交方消化（修代码），suppressed 在源系统消化（下 Tick 重提）。上层只看到"任务完成/任务失败终态"，不看到命令层的返回码细节。

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
    planId: string;
    actorName: string;
    kind: ActionKind;
    pipeline: ActionPipeline;
    accepted: boolean;
    nativeReturnCode?: ScreepsReturnCode;
    category:
        | "accepted"
        | "retryable"
        | "replan"
        | "invalid"
        | "suppressed";
    reason?: string;
    intentReason?: string;
}
```

字段约束：

| 字段 | 类型 | 必有 | 语义 |
|---|---|---|---|
| `accepted` | boolean | 是 | 原生调用返回 `OK` 的命令才为 `true`；其余一律 `false` |
| `nativeReturnCode` | number | 否 | **仅在命令真正触达原生 API 时存在**；校验/仲裁阶段被拒的命令不得伪造该字段（缺省即"未触达"） |
| `category` | ResultCategory | 是 | 内部处置五分类，与原生返回码正交 |
| `reason` | string | 否 | 拒绝原因码（内部错误码注册表见 §16.3）；`accepted` 时缺省 |
| `intentReason` | string | 否 | 在途意图的场景标签（来自 ActionPlan.reason），供遥测归因，非失败原因 |

## 16.1 五分类判定表

| category | 产生原因 | 消费方职责 | 重试策略 |
|---|---|---|---|
| `accepted` | 原生调用返回 `OK` | Agent 更新本地任务进度；任务系统不动账 | 无需重试；效果在下一 Tick 感知确认 |
| `retryable` | 暂时性失败：`ERR_NOT_IN_RANGE` / `ERR_TIRED` / `ERR_NOT_ENOUGH_ENERGY` / `ERR_NOT_ENOUGH_RESOURCES` / `ERR_BUSY` | Agent 保持当前意图；通常是移动/等待问题 | 同 Tick 不重提；下一 Tick 原样重提（移动到位/资源到位后自然恢复），不改变任务 |
| `replan` | 目标或前提失效：`ERR_INVALID_TARGET` / `ERR_FULL` / `ERR_NO_BODYPART` / `ERR_NO_PATH`，或内部判定目标消失（`target-gone` / `flag-gone` / `order-gone` / `site-gone` / `structure-gone`） | Agent 不得原样重提；须回退到任务层重新规划 | 经 `onReplan` 反馈给任务系统：`fail` 会计尝试次数，按任务上限终态化后释放租约换人 |
| `invalid` | 命令本身不合法：参数缺失（`*-missing-args`）、actor 不存在或孵化中（`actor-missing-or-spawning`）、任务租约丢失（`lease-lost`）、未知 kind（`unknown-kind`） | 提交方缺陷或时序竞态；Agent 不得盲目重试相同命令 | 丢弃该命令；若为竞态（孵化中/租约丢失）等待下一 Tick 感知对齐后重建意图 |
| `suppressed` | 仲裁出局：管线冲突（`pipeline-conflict`，同 actor 同管线更高优先级命令胜出）或所有权拒绝（`not-owner`，enforce 档下非 owner 提交） | 被 suppress 的是**合法命令**，只是本 Tick 输了仲裁 | 下一 Tick 由源系统重新提交（意图仍是活的）；连续 suppressed 应触发遥测告警排查优先级配置 |

## 16.2 分类决策树

命令进入 broker 后按以下顺序判定，第一个命中的分支即终态分类：

```text
submit 阶段
  ├─ 仲裁: 同 (actor, pipeline) 多条命令?
  │    └─ 是 → 落败者 → suppressed ("pipeline-conflict", 未触达原生 API)
  ├─ 所有权: creep actor 且 enforce 档下非 owner?
  │    └─ 是 → suppressed ("not-owner", 未触达原生 API)
  └─ 入队等待 commit

commit 阶段 (execute 逐条执行)
  ├─ actor 不存在 / 孵化中 → invalid ("actor-missing-or-spawning")
  ├─ 命令绑定 taskId 且租约丢失 → invalid ("lease-lost")
  ├─ 参数校验失败 (*-missing-args / unknown-kind) → invalid
  ├─ 目标解析失败 (target-gone / flag-gone / order-gone /
  │   site-gone / structure-gone / controller-gone / tower-gone /
  │   spawn-gone / no-terminal / room-not-visible) → replan
  └─ 触达原生 API → 按返回码 triage:
       OK                        → accepted
       NOT_IN_RANGE / TIRED /
       NOT_ENOUGH_* / BUSY       → retryable
       INVALID_TARGET / FULL /
       NO_BODYPART / NO_PATH     → replan
       其余未列举返回码          → invalid (保守兜底)
```

判定规则：

1. **未触达原生 API 的结果永远没有 `nativeReturnCode`**——invalid（校验类）与 suppressed（仲裁类）是纯内部判定。
2. **触达原生 API 的结果永远没有内部 reason 覆盖分类**——返回码经 triage 表映射，同一返回码在不同 kind 下分类一致。
3. 新增 kind 时必须同时在 triage 表与决策树的参数校验分支登记，否则落入 `unknown-kind` invalid。

## 16.3 内部错误码注册表

内部 reason 码是跨 Tick 稳定的字符串契约（遥测聚合口径），新增必须唯一且带域前缀：

| reason 码 | 分类 | 语义 | 修复方向 |
|---|---|---|---|
| `pipeline-conflict` | suppressed | 同 (actor, pipeline) 仲裁落败 | 检查重复提交源 |
| `not-owner` | suppressed | enforce 档下非 owner 提交命令 | 检查 acquire 时序 |
| `actor-missing-or-spawning` | invalid | Creep 不存在或仍在孵化 | 等待出生；出生前禁止提交 |
| `lease-lost` | invalid | 命令绑定的任务已易主或终态 | 下一 Tick 重新领任务 |
| `move-without-position` | invalid | move 命令缺 targetPos | 提交方补参 |
| `store-empty` | invalid | 库存不足（预检拦截，未触达 API） | 等待补给后重提 |
| `ownership-denied` | invalid | 所有权断言失败（预检拦截） | 同 `not-owner`，检查 acquire 时序 |
| `task-expired` | invalid | 任务已过期（预检拦截） | 重新领任务 |
| `budget-suppressed` | suppressed | CPU/资源预算抑制 | 预算恢复后自动放行 |
| `target-stale` | replan | 目标对象已从世界消失 | 回任务层重规划 |
| `target-gone` | replan | 战斗/工作目标消失（combat/work 管线） | 回任务层重规划 |
| `*-missing-args` | invalid | 各 kind 的参数缺失统称（`createFlag-` / `removeFlag-` / `spawnCreep-` / `createSite-` / `marketDeal-` / `terminalSend-` / `cancelMarketOrder-` / `createMarketOrder-` / `changeMarketOrderPrice-` / `combatMove-` / `combatStep-` / `combatStrike-` / `combatMoveByPath-`） | 提交方补参 |
| `unknown-kind` | invalid | kind 未在执行器注册 | 执行器与 kind 同步更新 |
| `room-not-visible` | replan | 目标房不在视野（flag/site/market 类） | 等待侦查或改道 |
| `flag-gone` / `site-gone` / `structure-gone` / `controller-gone` / `tower-gone` / `spawn-gone` / `order-gone` / `no-terminal` | replan | 各管线的目标对象消失 | 回任务层重规划 |

注册表维护规则：

- reason 码一经发布不得改义（遥测按字符串聚合）；废弃码保留在表中标 `[deprecated]`。
- 新增码须在broker实现与本表同步登记，两处不一致视为实现缺陷。

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

## 18.1 ResourceLedger 五态模型

资源模型：

```text
Observed（观测库存）
 ↓ 扣除
Available（可用量 = Observed − Reserved − Committed）
 ↓ reserve()
Reserved（已预留，无目的地）
 ↓ 绑定 destId
Committed（已承诺，带目的地的在途）
 ↓ commit()
Consumed（已消耗，累计单调递增）
```

五态字段级定义：

| 状态 | 字段 | 类型 | 记账时点 | 结算规则 |
|---|---|---|---|---|
| Observed | `observed` | number | 每 Tick 感知阶段后，由快照聚合（结构存量 + 落地能量 + Creep 携带） | 只读视图，不落 Memory；随快照每 Tick 重建 |
| Reserved | `reserved` | number | `reserve()` 成功的瞬间 | 汇总本房所有 `destId === undefined` 的有效预留额；预留过期/释放/兑现即移出 |
| Committed | `committed` | number | `reserve()` 时携带 `destId` 的预留即视为承诺 | 汇总本房所有带 `destId` 的有效预留额；同 Reserved 口径移出 |
| Available | `available` | number | 派生态，查询时计算 | `max(0, observed − reserved − committed)`；不足 0 时截断为 0，绝不出现负可用 |
| Consumed | `consumed` | number | `commit()` 按实际用量入账 | `consumedTotal[roomName]` 单调递增累计，永不回退 |

**Reserved → Committed 的转换时点**（唯一答案）：预留记录在创建时就由 `destId` 有无定性——`reserve()` 带 `destId` 直接进入 Committed，不带则停留在 Reserved。二者不是先后关系而是**用途分型**：无目的地的预算（如孵化体成本）是 Reserved，带目的地的在途承诺（如搬运到某结构的配额）是 Committed。同一预留不发生状态迁移，只有删除（过期/释放/兑现）。

预留记录（ReservationRecord）字段：

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 预留 ID（tick 编码 + 随机后缀） |
| `owner` | string | 是 | 持有者标识（如 `spawn-request:defender:12345`） |
| `roomName` | string | 是 | 记账房间 |
| `resourceType` | "energy" | 是 | 资源种类（Phase 2 仅能源，接口保留扩展位） |
| `amount` | number | 是 | 预留量（正整数） |
| `createdAt` | number | 是 | 创建 tick |
| `expiresAt` | number | 是 | 过期 tick（缺省 createdAt + TTL 配置） |
| `destId` | string | 否 | 目的地结构 ID；有则计 Committed，无则计 Reserved |

核心操作语义：

```text
reserve(input)  → 可用量不足时拒绝（不超发），成功返回预留 ID，失败返回 null
commit(id, n)   → 按实际用量 n 入 Consumed（clamp 到 [0, amount]），删除记录；
                  少用部分随记录删除自动回到可用库存
release(id)     → 计划取消/主体消失时删除记录，量回到可用库存
maintainLedger() → reconcile 阶段对账：过期清理 + 超龄强制回收（判据 createdAt，
                   兜住反复续期永不兑现的泄漏）+ 主体消失释放
```

不变量：

```text
不变量 1（不超发）: 任意时刻 Σ(有效预留.amount) ≤ observed
不变量 2（无泄漏）: 预留只有三条出路——过期、释放、兑现；超龄兜底强制回收
不变量 3（单调消耗）: consumedTotal 只增不减
不变量 4（可用非负）: available = max(0, observed − reserved − committed) ≥ 0
不变量 5（TTL 有界）: 预留自创建起超过 maxReservationAge 强制回收，无视续期
```

## 18.2 速率与饥饿观测

- 生产/交付/消耗速率：每 Tick O(1) 累加，每 `rateWindowTicks` 窗口折叠 EMA（平滑系数配置化），恒定 O(房间×资源种)。
- 饥饿生命体征：每房至多一条，口径为孵化线（任一 spawn 存量 0）优先于升级线（cc 低于保障水位）；脱离饥饿或房间失联即清除——有界，不落流水明细。

必须区分：

- 实际库存；
- 已预留；
- 在途；
- 已承诺；
- 预计收入（见 income 模型，不进五态账本）。

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

## 24.1 NexusMemory 顶层结构

```text
Memory.Nexus
 ├── schemaVersion          # 全局 schema 版本，migrations 逐版本升级
 ├── global                 # 战略姿态/策略参数/目标 (posture, policy, goals)
 ├── rooms                  # Record<房名, RoomIntelRecord> 房间情报
 ├── tasks                  # Record<任务ID, NexusTask> 任务事实源
 ├── units                  # Record<creep名, UnitRecord> 单位注册表
 ├── ledger                 # 预留/速率/饥饿 (reservations, rates, hunger,
 │                          #   consumedTotal, expiredCount, overdueCount)
 ├── traffic                # 堵车与热点 (blocked, hotspots)
 ├── economy                # 经济子系统状态 (含 remoteTargets)
 ├── defense                # 威胁与 safemode 统计
 ├── squads                 # Record<编队ID, SquadRecord> 战略编队事实源
 ├── spawn                  # 孵化线状态
 ├── layout                 # 布局记录
 ├── metrics                # 遥测持久化
 └── ownership              # 跨 Tick 所有权持久索引
      (runtime.actorOwnershipIndex: 只存 owner 名与到期 tick)
```

各子系统损坏时按 `SUBSYSTEM_DEFAULTS` 安全空状态隔离重置（bootstrap 隔离，单子系统损坏不拖垮全局）；全部为纯 JSON。

## 24.2 字段表模板（新增 Memory 字段的声明格式）

新增任何持久化字段必须按下表声明，缺任一项视为不合规（评审可直接打回）：

| 列 | 说明 | 示例 |
|---|---|---|
| 字段 | 完整路径 | `Memory.Nexus.ledger.reservations.<id>.amount` |
| 类型 | JSON 可序列化类型 | `number` |
| 生命周期 | `永久` / `跨 Tick 会话` / `TTL 过期` / `条件清除` | `TTL 过期（createdAt + TTL）` |
| 迁移策略位 | 引入版本号 + 缺省填充规则 | `v11 引入；旧 Memory 引导为空对象` |
| 写入方 | 唯一拥有写权的模块 | `economy/ledger.ts` |
| 重建代价 | global reset 后能否从 Game 重建 | `不可重建（会计事实），容忍清零` |

示例（所有权索引）：

| 字段 | 类型 | 生命周期 | 迁移策略位 | 写入方 | 重建代价 |
|---|---|---|---|---|---|
| `Memory.Nexus.ownership.runtime.actorOwnershipIndex` | `Record<actor名, {owner, expiresAt}>` | 租约到期自动清除 | v11 引入；旧 Memory 引导为空状态 | runtime/actorOwnership.ts | 可重建（下 Tick acquire 时自然恢复） |

## 24.3 Memory / Runtime 分界线清单

以下数据**永远不落 Memory**（见 §25）：

```text
TaskIndex / ActorIndex / RoomIndex / ReservationIndex / SquadIndex 的桶结构
PathFinder 结果 / CostMatrix / 路径缓存
Game 对象引用 (Room/Creep/Source/Structure)
Tick 内临时决策 / CPU profiler 采样
ActionBroker 队列与 lastResults
OwnershipLease 活跃数据 (global 运行时层, 单 Tick 可重建)
事件监听注册表
```

以下数据**必须落 Memory**（跨 Tick 事实）：

```text
任务记录与租约归属 (tasks)
单位注册表 (units) —— spawnDirector 逐 tick 对账
预留会计记录 (ledger.reservations)
房间情报 (rooms) —— 观察衰减与历史 intel
战略姿态 (global)
编队槽位定义 (squads)
布局记录 (layout)
schema 版本与迁移状态
```

灰色地带裁定规则：**问"global reset 后丢了会疼吗"**——疼（会计事实/战略状态）→ Memory；不疼（可从 Game 重建的索引/缓存）→ Runtime。拿不准时默认 Runtime（丢索引只费一点重建 CPU，错进 Memory 是永久膨胀）。

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

> 现行实现为 **P0–P3 四档**（`src/core/cpuBudget.ts` 的 `PriorityBand`），**P4 Cosmetic 尚未落地**。四档语义与降级策略见 `docs/nexus-design/02-architecture-charter.md` §22.3。本节为目标态分层。

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

## 28.1 事件通道定义

事件系统是**轻量延迟事件队列**，刻意不做：事件优先级、持久化、嵌套调度器。目标是一个行为稳定、随手可用的最小事件系统。

| 通道 | 执行时机 | 典型用途 | 承载模块 |
|---|---|---|---|
| `start` | commit 主段开头 | Tick 前置钩子（上次 Tick 结果的衍生动作） | EventBus（band P2） |
| `tick` | commit 主段 | 常规延迟任务（定时重试、延迟检查） | EventBus（band P2） |
| `end` | commit 终末 | Tick 收尾钩子（汇总、清理） | EventBusEnd（band P0） |

事件规格（DelayEventSpec）字段契约：

| 字段 | 类型 | 必有 | 语义 |
|---|---|---|---|
| `life` | 'start' \| 'tick' \| 'end' | 否 | 生命周期阶段，缺省 `tick` |
| `when` | number \| (ctx) => boolean | 否 | 触发条件：数字 = 延后 tick 数；函数 = 每轮该阶段动态判定 |
| `times` | number \| (ctx) => boolean | 否 | 终止条件：数字 = 最多执行次数；函数 = 执行后判定是否移除。缺省 1 |
| `exec` | (ctx: DelayEventContext) => void | 是 | 事件体；ctx 含 `tick` / `createdTick` / `runCount` / `data` |
| `data` | any | 否 | 事件携带数据 |

全局 API：`event.add(spec) → id` / `event.cancel(id)` / `event.get(id)` / `event.list(phase?)`。事件只存内存（Runtime），**不跨 Tick 序列化**——global reset 后事件全丢是设计内行为，事件体不得承载不可丢的事实（那些属于 Memory）。

## 28.2 事件类型注册表

新增事件必须登记一行（类型/载荷 data 结构/订阅方/通道/建议 times）：

| 事件用途 | data 载荷 | 订阅方 | 通道 | 备注 |
|---|---|---|---|---|
| 模块级延迟重试（如建造再查） | `{ subject: string }` | 提交方自身 | tick | `when: n` 数字延时 |
| 周期性检查（如超龄回收扫描） | 自定义 | 检查模块 | tick | `when` 函数 + `times` 函数 |
| Tick 收尾汇总 | 无 | 遥测/清账模块 | end | 幂等，重复执行无害 |

注册表维护规则：事件的 data 载荷结构一经使用即冻结（与内部 reason 码同规约，遥测按结构聚合）；新增字段不得复用旧字段名改义。

## 28.3 CPU 预算分配表（与 §26 联动）

事件通道受 CPU 预算带管束（§26 的 P0–P4 分层）：

| 预算带 | 内容 | 紧张时 |
|---|---|---|
| P0 | Emergency：EventBusEnd、tick 收尾清账 | 永远运行 |
| P1 | Strategic：战略重估、孵化仲裁 | 尽量保留（饥饿保护：连续跳过超限强制放行一次） |
| P2 | Coordination：EventBus(start/tick)、重规划、事件分发 | 降频/跳过 |
| P3 | Maintenance：遥测折叠、远期分析 | 跳过 |
| P4 | Cosmetic：可视化、非关键日志 | 最先跳过 |

模块声明自己的 band；`canRun(name, band)` 判定 + `recordSkip(name, reason)` 记录跳过原因（CPU skip 必须可解释，见 03 篇 BUG-035）。连续跳过的段触发饥饿保护：只要有 P1 级余量就强制放行一次，实际运行即清零计数。

---

# 29. 最终目录

## 29.1 现行态裁定（与索引页/架构公约 §21 联动）

本节目录树是**长期目标态**。现行 src 顶层结构以 `docs/nexus-design/02-architecture-charter.md` §21.1 为当前权威——目录重组只在模块收编自然发生时顺带进行，不做整树搬移（nexus-architecture-refactor 裁定）。新增代码落新位，存量模块原位收编。

文件迁移矩阵（目标态方向）：

| 现行 | 目标位 | 规则 |
|---|---|---|
| `src/core/*` | kernel / runtime / state | 生命周期 → kernel；runtime 状态 → runtime；Memory → state；core 不再当万能工具箱 |
| `src/modules/world/*` | world/* | Perception 保留；WorldModel 单独建立 |
| `src/modules/tasks/*` | tasks/* | TaskBoard 成为唯一任务事实源 |
| `src/modules/agents/*` | agents/* + commands/* | Agent 与 Action 分离 |
| `src/modules/movement/*` | movement/* + adapters/movement/* | 先 Adapter，后内部重构 |
| `src/modules/teams/*` | adapters/teams/* + combat/* | 保留内部实现，Nexus 接管入口 |
| `src/modules/industry/*` | industry/* + adapters/industry/* | 逐子系统迁移 |

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

