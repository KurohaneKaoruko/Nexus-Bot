# 架构公约（原 19 / 21 / 22 篇）

> 现行架构的活文档：分层落地与扩展契约（19）、架构定案与 src 顶层结构（21）、三循环与数据所有权（22）。
> 各节沿用原篇号（19 / 21 / 22），编号不连续属正常。
> 集群层（原 20 篇）内容独立且体量大，单独成篇：`03-cluster-squads.md`。

---

## 19. 智械连结：分层架构落地与扩展契约

本文档是「智械连结」分层智能（docs/nexus-design/04-foundations.md §2 / docs/nexus-design/09-legacy-archive.md §3）的落地契约与后续扩展指南。骨架（战略层 + 指令连结 + 局部规划层 + 遥测反馈）与防御/集群接入均已实装；工业等剩余层级智能按本文契约接入。
**集群层（多 Creep 协作编队）的完整架构、接口与进度见 docs/nexus-design/20；多 Agent 并行协作规范见 docs/nexus-design/02-architecture-charter.md。**

### 19.1 概念边界：系统、集群、连结体

| 概念 | 定义 | 示例 | 载体 |
|---|---|---|---|
| **职能系统** | 跨房间的职能域，负责一类事务的全流程 | 经济系统、防御系统、工业系统、扩张系统 | planning/emergency 等阶段的 TickModule |
| **集群** | 多 Creep 协作编队/协作组（单位层协作形态） | 战斗小队（quad/xA）、防御编队、外矿采集协作组（矿工+搬运+护卫） | 任务编组 + Agent 协作（Phase 3+ 实装） |
| **连结体（局部计算节点）** | docs/nexus-design/09-legacy-archive.md §3 的「局部层」概念：管理一个房间局部系统的角色 | 职能系统按房间执行时充当局部节点 | 各职能系统的 `planXxxRoom` 按房间入口 |

职能系统与集群正交：经济是系统，不是集群；一个防御编队是集群，不是系统。docs/nexus-design/09-legacy-archive.md §3 架构图中的「Clusters/局部连结体」子图，在本项目落地为**职能系统的按房间规划**（见 19.3），不引入独立的 Cluster 注册层。

### 19.2 分层智能与数据流（已实装骨架）

```
                ┌──────────────── 遥测反馈（上行）────────────────┐
                │                                                  │
  WorldModel ──►│ NexusCore (strategy 阶段)                        │
  (经济诊断/库存 │   姿态状态机 + 全局政策 → Memory.global          │
   累加器/速率)  └──────────────┬───────────────────────────────────┘
                               │ 指令（下行, 每 Tick 派生）
                               ▼
                 TickContext.directive() ──► 职能系统规划器（planning 阶段, 按房间）
                 （姿态/储备下限/        ──► SpawnDirector（survive 门控）
                   优先级偏置/节流）
                               │ 任务 upsert + 账本预留
                               ▼
                 TaskBoard ──► Allocator ──► AgentSystem ──► ActionBroker
                 （Agent 不读指令：执行自治，战略不逐单位微操）
```

- **战略层**（`src/modules/strategy/core.ts`）：低频周期 + 紧急标志重估姿态（survive/develop/expand/war）与政策；所有转移过最小驻留迟滞；原因引用量化输入。war 的输入源 = 威胁分（`maxThreatScore`，由 `defense-planners` 在 emergency 阶段写入 `rooms[].threat`）。
- **指令连结**（`src/modules/strategy/directive.ts` + `TickContext.directive()`）：从 `Memory.global` 纯派生的单 Tick 视图；战略模块缺席/损坏时退化为中性指令（develop 零偏置不节流）。指令含库存穿越检测：非 survive 且库存破临界线 → 置紧急标志，下一 strategy 阶段立即重估。
- **局部规划层**（`src/modules/economy/planners.ts` 的 `planEconomyRoom` 模式）：职能系统按房间读快照 + 指令 → 任务 upsert + 账本预留；dedupe key 幂等、主体消失取消、节流期既有任务降权存活。
- **遥测反馈**：`strategySnapshot(ctx)` / `Nexus.strategy()` 控制台查询、HUD 姿态行、转移记录（Memory 单条 + runtime 环形日志）。

### 19.3 职能系统接入契约（防御/工业等后续系统照此挂载）

一个职能系统 = 一个（或少数几个）TickModule + 按房间的规划入口：

```ts
// src/modules/<domain>/planners.ts
export function planDefenseRoom(ctx: TickContext, board: TaskBoard, room: RoomObservation): void {
  const directive = ctx.directive();        // 读指令：姿态/风险（war/survive 输入）
  // 读房间快照 room.* 与 Memory 侧域状态 → board.upsert(...) 幂等提交任务
  // 资源承诺一律走共享账本 (src/modules/economy/ledger.ts)，禁止绕开重复记账
}

// src/modules/<domain>/index.ts
export const defenseModule: TickModule = {
  name: "defense-planners",                 // 命名约定 <domain>-planners / <domain>-<role>
  phase: "planning",                        // 或 "emergency"（防御适合 emergency 阶段）
  band: "P0",                               // 按紧急度选预算带
  run(ctx) {
    const world = ctx.world.current;
    if (!world) return;
    const board = createTaskBoard(ctx.memory.tasks);
    for (const room of Object.values(world.rooms)) planDefenseRoom(ctx, board, room);
  },
};
```

接入清单：

1. 注册进 `src/main.ts` 的 `nexus.use(...)` 装配清单（注册序即同阶段执行序）。
2. 变体裁剪：入口装配清单不挂载该模块即零注册零 CPU，无需其他改动。
3. 持久化状态进 `Memory.nexus` 对应子系统（schema 升版本 + 纯函数迁移 + 有界）；短命可弃数据进 `global` 运行时层（19.5）。
4. 任务类型在 `src/core/store/taskSchema.ts` 集中注册（`defend`/`attack`/`heal` 等已预留）。
5. 新任务种类的优先级进 `TASK_PRIORITY`，姿态偏置按需进 `STRATEGY_CONFIG.postureBias`。

### 19.4 各系统接入点

#### 防御系统（Phase 3，已实装）

- **阶段**：`emergency`（感知后、战略前即可响应；docs/nexus-design/09-legacy-archive.md §3.3 允许紧急意图先行，但提交仍统一走 ActionBroker）。
- **装配**：`src/modules/defense/index.ts` 的 `defense-planners`（威胁观测 → 应急任务 → 塔行动 → 塔能耗折叠）。
- **ThreatModel**：感知快照补充敌方单位/结构观测 → 威胁评分入 `Memory.rooms[].threat`（带 lastSeen/confidence，docs/nexus-design/09-legacy-archive.md §4.3）。
- **war 输入源**：`evaluatePosture` 的 war 转移规则读 `maxThreatScore`（威胁分超阈值 + 驻留迟滞）；`riskTolerance` 政策已随姿态写入，可接入 Allocator 的 risk 成本项（现为 0 占位）。
- **撤退/维修/塔控**：以 `retreat`/`repair`/tower 行动任务进 TaskBoard，复用租约与对账。
- **战后恢复**：威胁衰减后姿态回 develop，压制自动解除——复用本骨架的恢复语义。
- **高强度威胁**：改由编队机制组织协同响应（见下「集群」），防御系统退为**需求方**。

#### 扩张系统（Phase 4/5）

- **expand 动作位**：`expand` 姿态已上调储备/目标库存（为扩张积攒）；扩张系统消费该姿态产出 scout/reserve/claim 任务（任务类型已预留）。
- **侦察状态机**（docs/nexus-design/10 §10.2）：`Unknown → Candidate → Scouting → Evaluated → …` 状态存 `Memory.rooms[].expansion` 子结构，转移记录原因防抖动。
- **房间价值评分**：评分只读预聚合数据（Source 数、路程、威胁历史、GCL 余额），产出扩张投资建议供 NexusCore 参考——扩张是投资决策，不是自动占地。
- **多房间/远采**：新房间经济照 19.3 按房间规划（同一 economy-planners 自然覆盖）；跨房间运力走配额 + 账本扩展。

#### 集群（多 Creep 协作编队，已实装）

**完整架构见 docs/nexus-design/20。** 摘要：

- **编组载体**：`Memory.nexus.squads`（编队 = 槽位集合 + 成员列表 + 共享任务种类，有界 + TTL）。
- **任务形态**：槽位任务（`dedupeKey = squad:<kind>:<room>:slot:<n>`）由成员各自持有租约，成员行动仍经 AgentSystem → ActionBroker 统一仲裁。
- **与系统的关系**：防御系统「决定需要一支编队」（需求方，经 `requestSquad` 声明），集群机制「组织并维持编队」（执行形态，`cluster-squads` 模块）；生产请求经 SpawnDirector 排程（槽位任务与普通任务无差别）。
- **指挥层级**：编队内部可有简单领队逻辑（如 quad 的集火/拉扯），但不越过 ActionBroker 直接改全局状态。当前实装为槽位协同，领队逻辑见 docs/nexus-design/20 §20.7.2 待办 C4。

### 19.5 持久化三级分层（D9 规则）

| 层 | 存活期 | 放什么 | 丢失代价 |
|---|---|---|---|
| TickContext | 单 Tick | 指令派生缓存、快照聚合 | 无（每 Tick 重建） |
| `global` 运行时层（`globalThis.Nexus.runtime`，经 `src/core/store/runtime.ts` 访问） | 进程期，代码重载即失 | 紧急重估标志、转移环形日志、观测输入摘要、单 Tick 编队需求队列 | 退化为周期重估/日志清空/编队延迟一个 Tick 续期，零行为损失 |
| `Memory.nexus` | 跨重载 | 决策状态（姿态/政策/目标）、长期统计、任务/账本/Intel | 不可丢（schemaVersion + 逐版本迁移保障） |

判定规则：重建代价高或必须活过代码重载 → Memory；重建廉价、丢失只影响观测或加速 → global 运行时；单 Tick 派生 → ctx。两层都禁止存放游戏 API 对象引用。

**既有子系统迁移候选**（收益评估后另立变更，不在本次范围）：economy 累加器（每 Tick 写 Memory，诊断窗口后清零——可迁 global）、traffic blocked/hotspots（短命统计）、economy.travel 样本窗口（丢失仅退化一个替补窗口精度）。迁移属 economy-model/traffic 既有规格的行为变更，需独立评估。

### 19.6 各层读取边界

| 层 | 可读 | 禁读 |
|---|---|---|
| NexusCore（战略） | 预聚合摘要（诊断/库存累计/累加器/速率/威胁分） | Game 对象实时扫描；任务执行细节 |
| 职能系统规划器 | 房间快照、当 Tick 指令、自身域状态、共享账本 | 其他域内部状态（经账本/任务板协调）；直接指挥 Creep |
| SpawnDirector | 指令、任务缺口、在编/在途计数 | 战略政策细节（只认指令视图） |
| Agent | 自己的任务、房间快照、局部反馈（拥堵/不可达） | **战略指令**（执行自治边界）；其他 Creep 的私有状态 |
| 集群/编队 | 编队共享目标与成员状态 | 全局政策；越过 ActionBroker 提交意图 |

> 集群/编队层的读取边界扩展见 `03-cluster-squads.md` §20.6（本篇为通用五层，该篇在此基础上增补编队行，两者不冲突）。

### 19.7 验收对齐

新职能系统/集群接入时逐条回答 docs/nexus-design/04-foundations.md §2.7 的七个验收问题（输入与过期、归属层级、最坏 CPU、目标消失/死亡/失视的处理、Memory schema 与清理、成功测量、是否直连游戏 API）。骨架侧已满足：指令中性退化保底、重估预算门控、转移迟滞可观测、Memory 迁移幂等（当前 schema v6，见 `src/core/store/memorySchema.ts`）。

---

## 21. 架构定案

> Nexus 架构定案: 全部域按 TickModule 架构挂载, 统一运行时结构。
> 本篇记录架构定案与 src 顶层结构规范, 供后续开发参照。

> ⚠ 目录结构裁定：01 篇 §29 的目标目录（kernel/world/state/…）是长期方向，但**不做整树搬移**——现行 src 顶层结构（本篇 21.1）即当前权威，目录重组只在模块收编自然发生时顺带进行（nexus-architecture-refactor design.md 裁定）。冲突时：目标态看 01 §29，现行态看本篇。

### 21.1 src 顶层结构规范

src 顶层只保留主要分类与入口, 其余一律收进分类内:

```
src/
├── main.ts            # 主入口 (Nexus 架构, 官服口径; 装配清单平铺挂载)
├── branch/            # 构建变体入口 (一律 Nexus 架构, 差异只在 profile 与垫片)
│   ├── compat.ts      #   私服共享垫片 (缺 Power 类/市场 API 时补桩降级)
│   ├── local/         #   本地客户端/私服变体
│   ├── race/          #   冲级服变体 (roomMode 固定 rush)
│   ├── season/        #   赛季服变体 (占位, 规则明确后裁剪)
│   └── stronghold/    #   要塞挑战服变体 (占位, 待规则适配)
├── config/            # 常量配置 (战略/经济/防御/编队/冲级/布局/变体开关)
├── constant/          # 角色代号等游戏侧常量表
├── core/              # 内核 (调度/预算/内存/世界快照 + ai 库 + qos/event 等基建)
├── runtime/           # Actor Ownership 运行时 (actorRegistry/intentQueue/actorOwnership)
├── proto/             # 原型拓展 (方法挂载 + 特性链驱动; 角色行为库现行 API)
├── console/           # 人机接口 (控制台命令族)
├── types/             # 全局类型声明
├── modules/           # 功能域 (蓝图 L2-L7 域化落位)
│   ├── world/         #   [L2 感知]
│   ├── strategy/      #   [L3 帝国]  姿态/指令/扩张
│   ├── cluster/       #   [L4 集群]  编队生命周期/槽位任务
│   ├── tasks/         #   [L5 任务]  黑板与分配
│   ├── economy/       #   [经济+物流] 任务源/诊断/账本/配额/外矿
│   ├── spawning/      #   [孵化]     排程+替补+directSpawn, 体型编译
│   ├── agents/        #   [L6+L7 行动] 执行器/意图网关/共享 Broker
│   ├── movement/      #   [交通]     BetterMove + trafficMonitor
│   ├── planner/       #   [基建]     布局规划
│   ├── defense/       #   [安全]     威胁/塔控/应急
│   ├── combat/        #   [战斗]     combatAdapter
│   ├── industry/      #   [工业]     结构链+自动化链
│   ├── teams/         #   [编队战斗]
│   ├── intershard/    #   [跨 shard]
│   ├── external/      #   [外矿/扩张]
│   └── visuals/       #   [观测呈现]
└── utils/             # 纯工具
```

> `proto/` 原位于 `modules/prototype/`，已迁至顶层并更名；`runtime/` 承载 Actor Ownership 运行时（01 篇 §5 的落地载体）。

### 21.2 定案

- 全部功能域已按 Nexus TickModule 架构挂载 (Teams/PowerCreeps/Industry/EventBus/Nukes/
  InterShard/Expansion 正式域模块), 五变体入口统一装配
- 孵化链主线化: 编队/扩张/pc 陪护走 directSpawn; 角色族定编判定保留在
  spawning mission 孵化主链 (proto 提供原型方法挂载驱动 (原 modules/prototype))
- 外矿同名-role / 扩张 claim 已按任务板主线化 (kind scout/claim)
- 类型债: nocheck 152 → 33 件 (-78%), 错误 4109 → ~660 (-84%)
- 开发历程详见 git log

---

## 22. 三循环与数据所有权 (架构对齐公约)

> 本篇把分层智能体架构的建议对齐到项目现行结构, 固化为公约。
> 结论: 现行架构已实现建议的绝大部分支柱 (分层模块化 / 任务驱动 / 分层自治 / 行动协调 / 可恢复);
> 本篇补齐的是显式契约——三循环模型、数据所有权表、CPU 分级语义。

### 22.1 三循环模型

> 本节按**更新频率**切分控制链；同一条链的逐层数据流与代码落点见本篇 §19.2，此处不重复展开。

三个循环对应不同的更新频率与职责, 映射到 TICK_PHASES 与模块:

| 循环 | 职责 | 落点 | 频率 |
|---|---|---|---|
| 战略循环 | 姿态/目标/预算/风险政策 | `strategy` 阶段 → `modules/strategy` (posture + directive) | 低频重估 + 紧急重估标志 |
| 调度循环 | 目标 → 任务生成/去重/分配/续约 | `planning`+`reconcile` 阶段 → 各域 planners + `modules/tasks` (board+allocator) | 每 Tick, 贪心+迟滞 |
| 执行循环 | 机体按任务执行一步, 提交行动 | `agents`+`commit` 阶段 → `modules/agents` (提案) → ActionBroker (仲裁+唯一原生调用点) | 每 Tick |

控制链 (单向, 反馈经结果通道回流):

```
World Model (core/world + modules/world)  → 提供事实
NexusCore (modules/strategy)              → 定义目标与约束 (directive)
Cluster (modules/cluster + 各域 planner)   → 拆解局部工作
Task System (modules/tasks)               → 分配任务 (S = 权重·优先级 + 能力匹配 − 路程 − 风险 − 切换成本)
Agent (modules/agents)                    → 执行任务一步, 产行动提案
Action Layer (actionBroker + movement)    → 仲裁冲突 / 交通协调 / 提交原生指令
结果 (ActionResult / 失败原因 / 速率)       → 回写任务与账本, 修正下一轮规划
```

### 22.2 数据所有权表

单一写入方原则 (避免多系统各自估算同一份资源):

| 数据 | 唯一主要写入方 | 读取方 |
|---|---|---|
| 房间快照与 Intel | `modules/world/perception` (写 `Memory.nexus.rooms`) | 所有规划器 |
| 战略姿态与政策 | `modules/strategy/core` (写 `Memory.nexus.global`) | 各域 (经 `directiveFor`) |
| 任务状态与分配 | `modules/tasks` (board + allocator) | Agent、各域 planner |
| Creep 执行进度 | `modules/agents` (任务租约回写) | allocator、agentSystem |
| 资源预留与承诺 | `modules/economy/ledger` (reserve/commit/release) | economy、spawning、industry(未来) |
| 移动请求与路权 | `modules/movement` (BetterMove + trafficMonitor) | Agent、Broker |
| 行动结果 | `modules/agents/actionBroker` | 任务生命周期、遥测、账本速率 |
| 布局记录 | `modules/planner` → `Memory.nexus.layout` | construction、worksite |

三类信息的生命周期（TickContext / global 运行时 / Memory 三级分层）见本篇 §19.5，此处不重复；本节只规定各域的**唯一写入方**。

### 22.3 CPU 分级语义 (已实现, `core/cpuBudget`)

> 现行实现为 **P0–P3 四档**（`PriorityBand`）；01 篇 §26 的 P0–P4 五档是目标态，其中 P4 Cosmetic 尚未落地。

| 带 | 内容 | 策略 |
|---|---|---|
| P0 | 紧急防御、关键生存、Broker 提交 | 永远执行, 保最低成本 |
| P1 | 核心经济、Agent 执行、孵化 | 高频, 预算内优先 |
| P2 | 任务重分配、布局放量、面板 | 周期/变化触发 |
| P3 | 昂贵分析、扩张比较、市场 | bucket 低于阈值时暂停; 饥饿保护兜底 |

衡量标准是单位 CPU 产出 (每百 CPU 净收益 / 完成任务数 / RCL 达成时间), 不是缓存命中率。

### 22.4 建议对照与采纳决定

| 建议 | 现状 | 决定 |
|---|---|---|
| 模块化单体 + 分层多智能体 + 任务驱动 | 已实现 (nexus + phases + tasks) | ✅ 维持 |
| Tick Kernel / CPU 预算 / 异常隔离 | 已实现 (core/ 四件套) | ✅ 维持 |
| 世界模型三类信息 | 已实现 (快照/Intel/runtime 三级) | ✅ 维持 |
| Task Board + 评分分配 | 已实现 (17 种 kind、dedupeKey、租约、迟滞) | ✅ 维持 |
| Action Layer / IntentBroker | 已实现 (管线仲裁、唯一原生调用点、结果回写) | ✅ 维持 |
| Traffic Manager | 已实现 (BetterMove endTickResolve + trafficMonitor) | ✅ 维持 |
| Resource Ledger | 已实现 (economy/ledger) | ✅ 维持 |
| 三循环模型 / 数据所有权表 | 隐式存在 | ✅ 本篇显式化为公约 |
| Goal Board (战略目标显式化) | posture+policy 已有, 目标列表未显式 | ⏳ 路线图 (扩张/工业阶段需要时引入) |
| Agent FSM 显式化 | 任务 handler 内隐式状态 | ⏳ 路线图 (远程采集/战斗任务接入时重构) |
| 轻量 tick 内事件 | 结果通道隐式 | ✅ EventBus 已归位 core |
| platform/screeps 适配层 | 无独立适配层 (Broker 收口行动 + sim 全链路验证) | ❌ 不采纳 (企业级六边形对 Screeps 过重) |
| 建议的扁平目录 (kernel/persistence/...) | 已有等价结构 | ❌ 不采纳 (与既定 src 规范冲突: core≈kernel, core/store≈persistence, modules/*≈领域) |

### 22.5 开发顺序对照 (建议 §8 vs 现行路线)

1. 工程基础 ✅ (TS 严格门禁 / 双 tsconfig / 构建 / sim 回归 / 部署链)
2. Kernel + Memory + World Model ✅
3. 最小 Task Board ✅ (采集/搬运/升级/建造/补员闭环, sim 验证)
4. Agent + 行动协调 ✅ (提案制 + Broker 仲裁 + 交通)
5. NexusCore + 房间自治 ✅ 最小版 (posture 驱动) — 后续增强
6. 高级玩法 ⏳ 路线 (布局→Rush→外矿→工业→编队)
