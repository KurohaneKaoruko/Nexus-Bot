# 基础（原 01 / 02 / 16 篇）

> 背景与参考：Screeps 游戏机制（01）、机凯种式设计原则（02）、术语与规则来源（16）。
> 各节沿用原篇号（1 / 2 / 16），编号不连续属正常。

---

## 1. Screeps 游戏设计、规则与架构约束

### 1.1 先确定目标模式

本文按官方 **Screeps: World** 的常规持久化 MMO 设计，不按 Screeps Arena 的回合制/专用 API 设计，也不假设某个私服安装了额外 mod。私服可能改变 CPU、资源、NPC、结构和市场规则；部署前必须按目标服务器的 API 与配置重新核对。

Screeps 的关键特征并非“玩家操控很多单位”，而是玩家提交程序，程序每 Tick 依据当前可见游戏状态安排行动，游戏持续运行。它把 RTS 经济、路径、生产、占地、战斗与程序资源预算组合成一个长期自治问题。

### 1.2 世界空间

- 普通 Room 是 50×50 的网格，通过边界出口与相邻 Room 连接；世界还分成 Shard，特定门户可连通不同 Shard。
- 基础地形包含平原、沼泽和天然墙。道路会改变移动成本，但会损耗；建造墙可阻挡敌我双方，Rampart 则提供有所有权差异的通行与防护机制。
- Room 并不等价于一个完整的“地图对象”：Bot 只在拥有视野时得到实时对象。没有视野的房间必须以带时间戳的 Intel 表示。
- 位置可用 Room 名、x/y 三元信息表达；跨房间路径要先理解 Room 图，再在图内搜索。

**架构影响**：维护两种地图模型：`RoomGraph`（房间级连接与战略成本）和 `CostMatrix`（房间内局部通行成本）。不要把完整地图每 Tick 重建。

### 1.3 Tick 与行动意图

Screeps 的主循环每 Tick 读取一个状态快照并运行代码。代码调用的许多游戏方法是在提交“意图”；实际世界状态会在 Tick 结算时更新，新的结果通常从下一个 Tick 的快照中体现。移动后同 Tick 内读取的 `creep.pos` 不会立刻变成新位置。

这会造成几个重要现象：

1. **读写时序**：同 Tick 里不能假设上一个 API 调用已修改了对象属性。
2. **行动冲突**：多个 Creep 想进入同一格、同一 Creep 对同一类行动发出多条命令，都会由游戏规则解决，不应假设命令顺序等于执行顺序。
3. **协同移动**：移动是群体规划问题。仅仅让每只 Creep 各自 `moveTo`，不保证门口、道路与交汇处不会拥堵。
4. **同类行动优先级**：不同 Creep 行动之间存在依赖组和调用优先级；重复调用同一个方法时最后一次调用可能覆盖前一次意图。不能用一个简单的“每只 Creep 每 Tick 只能做一个动作”规则代替官方规则。
5. **状态反馈**：行动方法返回值表示意图是否成功提交/合法，并不总代表最终世界结果已反映到当前快照。指标系统要区分“命令被接受”和“目标结果完成”。

参考：[Understanding game loop, time and ticks](https://docs.screeps.com/game-loop.html)、[Simultaneous execution of creep actions](https://docs.screeps.com/simultaneous-actions.html)。

### 1.4 Creep、身体与生命周期

- 普通 Creep 的身体是可组合的部件序列，最多 50 个部件；部件影响可执行动作、容量、攻击、防护、工作效率与移动负担。
- 身体部件的成本和行动能力是硬约束，不能把“角色名”当作能力的真实来源。
- 普通 Creep 的标准寿命为 1,500 Tick；因此生产调度必须包含替补时机，不可等到机体死亡才开始制造。
- Spawn 生产需要能源与时间；更复杂的身体要考虑 Extension 提供的额外能源容量。
- `Creep.memory` 是主 `Memory` 中对应条目的便捷访问，不是一个与主记忆隔离的新存储引擎。
- Power Creep 与普通 Creep 生命周期不同：它们是账户级的特殊单位，通常不会像普通 Creep 一样永久丢失，但会有 Spawn/冷却与技能资源管理。

**架构影响**：以 `CapabilityProfile` 判断可执行能力；`BodyFactory` 根据任务产能与预算生成身体；`LifecycleManager` 提前计算替换窗口。

### 1.5 能源、资源与经济闭环

能量（Energy）是早期生产与建筑的核心资源。常规来源是 Source；Source 储量有限并周期恢复。Creep 通过 `WORK` 获取资源，`CARRY` 负责携带；资源由容器、Storage、Terminal 等结构或 Creep 持有。

基础循环是：

`Source → 矿工/采集者 → Container/Link → Carrier/物流设施 → Spawn/Extension/Controller/建筑`。

中后期资源类别会增加：

- Minerals：通过 Extractor 采集，实验室可进行反应与身体 Boost。
- Power：由 Power Bank 等机制获得，并在符合要求的房间中处理；与 Power Creep 发展相关。
- Commodities：从 Deposit 采集或在 Factory 加工，可形成多级配方生产链。
- Credits：通过市场交易使用；Terminal 是跨房间转移和市场参与的核心结构。

不能把“库存多”当作经济健康：资源必须位于正确位置、能在正确时间送达正确消费者。库存、产能、物流、消费承诺和可用流动性应分别建模。

参考：[Resources](https://docs.screeps.com/resources.html)、[Market System](https://docs.screeps.com/market.html)、[Power](https://docs.screeps.com/power.html)。

### 1.6 Controller、RCL 与 GCL

- Room Controller 的 RCL（Room Controller Level）决定当前房间可建造的结构种类、数量和部分容量限制。
- GCL（Global Control Level）限制玩家可拥有的房间数量，并在官方环境启用相应 CPU 解锁机制时关联 CPU 上限。
- 占领房间与升级房间是不同目标：`CLAIM` 用于取得控制权，持续升级 Controller 用于提高 RCL；GCL 与 Room Controller 的升级进度相关。
- Controller 会随着时间降级；升级不只是冲 RCL，也是在维护控制权。保留空置房间、预定 Controller 与实际占领的战略代价不同。
- RCL 8 解锁的结构与能力会把经济问题扩展为工业、贸易、防御和效率优化，而不只是增加房间数量。

Bot 不能把 RCL/GCL 的规则写死在零散角色脚本里。由 `RoomCapabilityModel` 集中根据 API 对象判断结构上限与可用能力；对等级表等静态数据，应在版本验证后集中维护。

参考：[Control](https://docs.screeps.com/control.html)。

### 1.7 CPU 与 Memory

- 在线模式的脚本执行受到 CPU 限制。官方文档当前说明：未启用 CPU Unlock 时常见基础上限为 20 CPU；启用后则与账户条件/GCL 等规则有关。具体账号上限以游戏内实际值为准。
- 未消耗的 CPU 可积累到 Bucket，用于后续较贵的操作；这适合安排低频全局规划、长路径重算、较大规模统计等可延迟任务。
- 主 `Memory` 的容量是有限的（官方文档说明为 2 MB）。不要把完整游戏对象、函数或循环引用放入 Memory；只保存 JSON 兼容的事实、ID、时间、计数和紧凑状态。
- `RawMemory` segments 可用于较大规模的延迟/分段数据，但有读取激活和容量约束；只有当普通 Memory 的确不足时才引入。
- 全局运行时对象/变量不会自动在 Tick 间持久化。模块级缓存可以加速当前执行环境，但不应把它当作可靠数据库。

参考：[CPU Limit](https://docs.screeps.com/cpu-limit.html)、[Global Objects](https://docs.screeps.com/global-objects.html)。

### 1.8 视野、NPC 与安全

- 没有可见性的房间无法按实时房间对象完整感知；Observer、侦察 Creep 或已过期 Intel 的推断应明确区分。
- NPC Invaders 会在符合条件的房间出现；高等级区域还可能涉及 Invader Core/Stronghold。防守不能只检测玩家敌人。
- Safe Mode 是临时防御工具，不能替代塔、Rampart、维修和战斗单位；是否启用必须考虑它对哪些敌对动作的阻断、剩余时长、激活次数和其他房间风险。
- Rampart、墙体、塔、战斗 Creep、治疗、撤退与安全模式各自具有不同成本和作用范围，不能用单一“敌人出现就全员冲过去”的逻辑处理。

参考：[Defending your room](https://docs.screeps.com/defense.html)、[NPC Invaders](https://docs.screeps.com/invaders.html)。

### 1.9 将规则变成软件不变量

| 不变量 | Bot 必须做到什么 |
|---|---|
| 当前 Tick 的快照不是实时可变数据库 | 动作结果通过返回码、下一 Tick 状态和事件统计验证 |
| Creep 随时间死亡 | 所有持续性任务都必须可转交；替补提前启动 |
| Room 可失去视野 | Intel 必须有 `lastSeen` 与置信度/过期政策 |
| 资源与建筑有硬限制 | 调度前检查容量、拥有权、距离、身体能力与资源 |
| CPU 有硬预算 | 模块可跳过、降级、限额与延后执行 |
| Memory 容量有限 | 数据有 schema、清理政策、版本迁移和上限监测 |
| 指令可能冲突 | 统一记录关键意图与任务所有权，减少相互覆盖 |
| 局部环境会变化 | 所有任务都有失败分支、期限和重新规划条件 |

---

## 2. 机凯种式智械连结：从设定到可执行的软件原则

### 2.1 设计目标

本架构借鉴《游戏人生》机凯种所启发的集体意识、信息连结、分层指挥和专用机体概念。我们不把虚构设定逐项硬套进游戏，而是抽象出能在 Screeps 的 CPU、Memory、Tick 和 API 约束下实现的工程机制。

目标不是让每只 Creep 拥有昂贵的独立“大模型”，而是把有限的计算预算集中在群体最需要的决策上，并让大量低成本机体执行可恢复的任务。

### 2.2 六条架构原则

#### 原则 A：统一知识，不强求全知

`World Model` 存放所有已知事实，并为每条动态情报记录来源、观测时间和过期规则。共享的是已知信息，而不是假设所有房间实时可见。

#### 原则 B：统一战略，不做逐单位中央微操

`Nexus Core` 决定发展方向、风险容忍度、能源储备和房间优先级；`Room Cluster` 自主处理当地采集、物流、防御和建筑。中央层定战略，局部层解具体问题。

#### 原则 C：机体是能力节点，不是固定职业身份

Creep 的身体决定它的行动能力。角色标签可以用于统计和生产配额，但调度器应评估实际能力、当前状态、路途成本、寿命与替换成本。固定岗位（例如驻点矿工）是有意的专业化，不是架构限制。

#### 原则 D：任务独立于机体

任务存在于共享 Task Board；Creep 只是有时限的执行者。机体死亡、任务目标消失或任务租约超时时，任务应重新进入候选池，必要时拆分或取消。

#### 原则 E：局部失败不能扩大成全局崩溃

每一模块都必须可以在预算不足、输入缺失、对象过期时跳过或降级。主循环用模块级错误隔离，不能因一只坏 Creep 或一条过期记录停止整个殖民地。

#### 原则 F：以可测量结果改进策略

所有“智能”机制都要提出可量化目标：能源净产出、运输单位每 Tick 有效运量、任务完成率、路径成本、战损、CPU/Tick、Memory 大小。没有反馈的数据记录只会成为垃圾，不是智能。

### 2.3 机凯种概念与软件实现的映射

| 概念意象 | Bot 模块 | 实际职责 | 不应该怎么做 |
|---|---|---|---|
| 全连结指挥体 | `NexusCore` | 全局目标、风险政策、资源预算 | 不要每 Tick 重算所有 Creep 的每一步路径 |
| 连结体/局部计算节点 | `RoomCluster` | 管理一个房间或房间群的局部系统 | 不要把独立 Cluster 变成不可共享情报的孤岛 |
| 个体机体 | `Agent` + `UnitRecord` | 执行任务、汇报状态、处理局部异常 | 不要将文明知识仅存在于某只 Creep 的 Memory 中 |
| 共用记忆 | `WorldModel` / `Memory` | 房间 Intel、资源图、任务与战略 | 不要保存整个 API 对象或无限历史日志 |
| 集体推演 | `Planner` + `Telemetry` | 根据目标、成本、约束选择计划 | 不要用复杂算法替代简单且稳定的规则 |
| 机体损失 | `LifecycleManager` | 替补、任务转移与数据清理 | 不要因为单位死亡而永久丢失任务 |
| 自我调整 | `StrategyTuner` | 用历史指标调整阈值和评分参数 | 不要在没有安全边界的情况下在线改变所有权重 |

### 2.4 计算应该分层，而不是所有地方都“智能”

建议分为四种计算成本：

1. **每 Tick 必须做**：紧急风险检查、现有任务的执行、必要生产与能源补给。
2. **每 Tick 可做轻量计算**：任务有效性检查、单位能力缓存、可见敌人汇总。
3. **低频全局计算**：房间收益对比、扩张路线、物流网络调优、产业计划重算。
4. **可选实验性计算**：策略参数搜索、长时间统计、复杂战术模拟。只在 CPU 和 Bucket 有余裕时执行。

每一层都必须有超时/预算策略，并提供一个“保底方案”。例如，房间全局规划未能在当前 Tick 完成时，应继续执行旧的有效任务，而不是停止所有单位等待新计划。

### 2.5 一致性模型：不是所有数据都需要强一致

- **强一致的短期状态**：本 Tick 的任务租约、Spawn 占用、资源预留、关键动作请求。应在同一进程运行里统一仲裁。
- **最终一致的知识**：房间危险历史、路线成本估计、长周期收益、市场趋势。可以延迟合并，也可被后续观测修正。
- **短命状态**：当前目标 ID、阻塞次数、短期冷却，应带 TTL，避免永久污染 Memory。

不要为每个字段强制更新时间戳；时间戳用于会随时间变假的知识。对静态参数和永久账户成就不必每 Tick 更新。

### 2.6 群体决策不是“全员投票”

Screeps 的计算预算不适合对每个动作做复杂分布式协商。更合理的群体智能是：

- 全局层分配稀缺资源和战略优先级；
- 局部层解决高频且低延迟的任务；
- Agent 保留执行细节的自主性；
- 行动仲裁层防止意图冲突；
- Telemetry 将完成结果反馈给战略层。

这是一种层级规划、共享黑板和约束优化的组合，而不是现实网络中多个节点持续互发消息。单个账号的 Screeps Bot 在同一套代码运行；只有涉及 Shard 间时才需要通过特定机制交换精简消息。

### 2.7 设计验收问题

每实现一个新功能都要回答：

1. 它需要什么输入？哪些输入可能过期？
2. 它属于全局战略、房间 Cluster 还是单个 Agent？
3. 最坏 CPU 成本如何限制？
4. 任务目标消失、Creep 死亡、房间失去视野时怎么办？
5. 它会修改 Memory 吗？schema 和清理政策在哪里？
6. 成功如何测量？失败如何记录且避免重复刷日志？
7. 它是否直接调用游戏 API，还是只输出计划供统一仲裁？

---

## 16. 术语表、规则核验与参考资料

### 16.1 术语表

| 术语 | 含义 |
|---|---|
| Tick | Screeps 游戏循环的一次迭代；Bot 在该周期读取状态并提交行动意图 |
| Creep | 玩家通过 Spawn 生产、由身体部件组合能力的普通单位 |
| Power Creep | 拥有特殊 Power/技能系统的账户级单位，生命周期与普通 Creep 不同 |
| Room | 50×50 网格房间，是地图、控制权、基础设施与局部规划的重要单位 |
| Shard | 世界的分片；不同 Shard 间通过特定门户/机制连通 |
| RCL | Room Controller Level；决定房间结构容量与可用能力 |
| GCL | Global Control Level；影响可控制房间数量，并在相关官方账户机制下与 CPU 限额有关 |
| Intel | 对不可见房间的持久化观测摘要；必须带新鲜度，不能等同实时视野 |
| Nexus Core | 本架构的全局战略大脑，是设计概念，不是游戏内原生对象 |
| Cluster | 房间/房间群级局部规划模块，是设计概念 |
| Task Board | 存储任务生命周期与租约的共享黑板，是设计概念 |
| Action Broker | 统一校验、仲裁并提交行动的执行层，是设计概念 |
| Lease | 任务的临时所有权，超时或持有者失效时可回收 |
| Capability Profile | 根据身体部件、负载与寿命计算的能力画像 |
| CPU Bucket | 未使用 CPU 可积累的预算池，适合可延迟计算 |
| CostMatrix | Pathfinder 的房间内移动成本表示 |
| Resource Reservation | 为未来生产/扩张/交易预留的资源承诺记录，不是额外库存 |
| TickModule | 按 Tick 阶段挂载的功能模块单元；经 `nexus.use()` 注册，执行序由 `TICK_PHASES` 决定（`02-architecture-charter.md` §21.1、`09-legacy-archive.md` §3.3） |
| Actor Ownership | 行动所有权：规定同一 actor 同一 Tick 的动作提交权归属，防止多控制面重复提交（01 篇 §5） |
| Intent / Command | Agent 产出的行动意图，经校验与冲突仲裁后成为可提交命令（01 篇 §13–§14） |
| ActionResult | ActionBroker 的统一返回，按 ok / retry / replan / fail / skip 五类分流（01 篇 §16） |
| Squad（编队） | 多 Creep 协作编队，集群层载体；成员以普通槽位任务执行，对编队无感知（`03-cluster-squads.md`） |

### 16.2 官方规则来源

以下官方页面在 2026-10-10 编写本文时已核对。游戏规则、API 与账户机制可能变化；正式部署应再次查看官方文档和目标服务器当前配置。

1. [Introduction](https://docs.screeps.com/introduction.html) — 世界与房间、地形、Source、Spawn 等基础规则。
2. [Understanding game loop, time and ticks](https://docs.screeps.com/game-loop.html) — Tick 快照、执行和状态生效时序。
3. [Simultaneous execution of creep actions](https://docs.screeps.com/simultaneous-actions.html) — Creep 行动依赖管线和同 Tick 冲突优先级。
4. [Creeps](https://docs.screeps.com/creeps.html) — 身体部件、单位能力与生命周期。
5. [Control](https://docs.screeps.com/control.html) — GCL、RCL、结构数量与 Controller 降级。
6. [CPU limit](https://docs.screeps.com/cpu-limit.html) — 在线 CPU 预算与 Bucket。
7. [Global objects](https://docs.screeps.com/global-objects.html) — Game、Memory 与持久化限制。
8. [Resources](https://docs.screeps.com/resources.html) — Energy、Minerals、Labs、Commodities 等资源系统。
9. [Market System](https://docs.screeps.com/market.html) — Terminal、交易单、市场费用与交易规则。
10. [Defending your room](https://docs.screeps.com/defense.html) — Safe Mode、墙、Rampart、Tower 与主动防守。
11. [NPC Invaders](https://docs.screeps.com/invaders.html) — NPC 入侵、突袭与 Stronghold。
12. [Power](https://docs.screeps.com/power.html) — Power、Power Spawn、Power Creep 与技能。
13. [API Reference](https://docs.screeps.com/api/) — 当前可用对象、方法、常量及结构属性。
14. [Organizing scripts using modules](https://docs.screeps.com/modules.html) — 脚本模块组织方式。
15. [Start Areas](https://docs.screeps.com/start-areas.html) — 新手区域、复活区域及特殊规则。
16. [screepers/screeps-typescript-starter](https://github.com/screepers/screeps-typescript-starter) — TypeScript 工程构建与上传起步项目。

### 16.3 规则核验流程

遇到规则差异或官方更新时：

1. 先看对应官方 Gameplay 文档；
2. 再看 API Reference 对象和方法的当前定义；
3. 检查官方 changelog 或目标私服的版本/Mod；
4. 为关键规则写一个最小模拟测试；
5. 将变化集中更新在 `GameRules`/配置模块，避免多个子系统各自保留旧假设。

### 16.4 文档边界

本文没有声称已实现所有系统，也不把机凯种的虚构设定当成 Screeps 的原生功能。文档提供统一的工程设计、规则映射与实现路线；对 Spawn 配方、结构冷却、市场成本、特定 Power 效果以及私服差异等精确数值，代码中应尽可能从 API 状态读取或集中维护，并在目标环境测试。
