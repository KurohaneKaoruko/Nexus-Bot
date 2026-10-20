# 01. Screeps 游戏设计、规则与架构约束

## 1.1 先确定目标模式

本文按官方 **Screeps: World** 的常规持久化 MMO 设计，不按 Screeps Arena 的回合制/专用 API 设计，也不假设某个私服安装了额外 mod。私服可能改变 CPU、资源、NPC、结构和市场规则；部署前必须按目标服务器的 API 与配置重新核对。

Screeps 的关键特征并非“玩家操控很多单位”，而是玩家提交程序，程序每 Tick 依据当前可见游戏状态安排行动，游戏持续运行。它把 RTS 经济、路径、生产、占地、战斗与程序资源预算组合成一个长期自治问题。

## 1.2 世界空间

- 普通 Room 是 50×50 的网格，通过边界出口与相邻 Room 连接；世界还分成 Shard，特定门户可连通不同 Shard。
- 基础地形包含平原、沼泽和天然墙。道路会改变移动成本，但会损耗；建造墙可阻挡敌我双方，Rampart 则提供有所有权差异的通行与防护机制。
- Room 并不等价于一个完整的“地图对象”：Bot 只在拥有视野时得到实时对象。没有视野的房间必须以带时间戳的 Intel 表示。
- 位置可用 Room 名、x/y 三元信息表达；跨房间路径要先理解 Room 图，再在图内搜索。

**架构影响**：维护两种地图模型：`RoomGraph`（房间级连接与战略成本）和 `CostMatrix`（房间内局部通行成本）。不要把完整地图每 Tick 重建。

## 1.3 Tick 与行动意图

Screeps 的主循环每 Tick 读取一个状态快照并运行代码。代码调用的许多游戏方法是在提交“意图”；实际世界状态会在 Tick 结算时更新，新的结果通常从下一个 Tick 的快照中体现。移动后同 Tick 内读取的 `creep.pos` 不会立刻变成新位置。

这会造成几个重要现象：

1. **读写时序**：同 Tick 里不能假设上一个 API 调用已修改了对象属性。
2. **行动冲突**：多个 Creep 想进入同一格、同一 Creep 对同一类行动发出多条命令，都会由游戏规则解决，不应假设命令顺序等于执行顺序。
3. **协同移动**：移动是群体规划问题。仅仅让每只 Creep 各自 `moveTo`，不保证门口、道路与交汇处不会拥堵。
4. **同类行动优先级**：不同 Creep 行动之间存在依赖组和调用优先级；重复调用同一个方法时最后一次调用可能覆盖前一次意图。不能用一个简单的“每只 Creep 每 Tick 只能做一个动作”规则代替官方规则。
5. **状态反馈**：行动方法返回值表示意图是否成功提交/合法，并不总代表最终世界结果已反映到当前快照。指标系统要区分“命令被接受”和“目标结果完成”。

参考：[Understanding game loop, time and ticks](https://docs.screeps.com/game-loop.html)、[Simultaneous execution of creep actions](https://docs.screeps.com/simultaneous-actions.html)。

## 1.4 Creep、身体与生命周期

- 普通 Creep 的身体是可组合的部件序列，最多 50 个部件；部件影响可执行动作、容量、攻击、防护、工作效率与移动负担。
- 身体部件的成本和行动能力是硬约束，不能把“角色名”当作能力的真实来源。
- 普通 Creep 的标准寿命为 1,500 Tick；因此生产调度必须包含替补时机，不可等到机体死亡才开始制造。
- Spawn 生产需要能源与时间；更复杂的身体要考虑 Extension 提供的额外能源容量。
- `Creep.memory` 是主 `Memory` 中对应条目的便捷访问，不是一个与主记忆隔离的新存储引擎。
- Power Creep 与普通 Creep 生命周期不同：它们是账户级的特殊单位，通常不会像普通 Creep 一样永久丢失，但会有 Spawn/冷却与技能资源管理。

**架构影响**：以 `CapabilityProfile` 判断可执行能力；`BodyFactory` 根据任务产能与预算生成身体；`LifecycleManager` 提前计算替换窗口。

## 1.5 能源、资源与经济闭环

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

## 1.6 Controller、RCL 与 GCL

- Room Controller 的 RCL（Room Controller Level）决定当前房间可建造的结构种类、数量和部分容量限制。
- GCL（Global Control Level）限制玩家可拥有的房间数量，并在官方环境启用相应 CPU 解锁机制时关联 CPU 上限。
- 占领房间与升级房间是不同目标：`CLAIM` 用于取得控制权，持续升级 Controller 用于提高 RCL；GCL 与 Room Controller 的升级进度相关。
- Controller 会随着时间降级；升级不只是冲 RCL，也是在维护控制权。保留空置房间、预定 Controller 与实际占领的战略代价不同。
- RCL 8 解锁的结构与能力会把经济问题扩展为工业、贸易、防御和效率优化，而不只是增加房间数量。

Bot 不能把 RCL/GCL 的规则写死在零散角色脚本里。由 `RoomCapabilityModel` 集中根据 API 对象判断结构上限与可用能力；对等级表等静态数据，应在版本验证后集中维护。

参考：[Control](https://docs.screeps.com/control.html)。

## 1.7 CPU 与 Memory

- 在线模式的脚本执行受到 CPU 限制。官方文档当前说明：未启用 CPU Unlock 时常见基础上限为 20 CPU；启用后则与账户条件/GCL 等规则有关。具体账号上限以游戏内实际值为准。
- 未消耗的 CPU 可积累到 Bucket，用于后续较贵的操作；这适合安排低频全局规划、长路径重算、较大规模统计等可延迟任务。
- 主 `Memory` 的容量是有限的（官方文档说明为 2 MB）。不要把完整游戏对象、函数或循环引用放入 Memory；只保存 JSON 兼容的事实、ID、时间、计数和紧凑状态。
- `RawMemory` segments 可用于较大规模的延迟/分段数据，但有读取激活和容量约束；只有当普通 Memory 的确不足时才引入。
- 全局运行时对象/变量不会自动在 Tick 间持久化。模块级缓存可以加速当前执行环境，但不应把它当作可靠数据库。

参考：[CPU Limit](https://docs.screeps.com/cpu-limit.html)、[Global Objects](https://docs.screeps.com/global-objects.html)。

## 1.8 视野、NPC 与安全

- 没有可见性的房间无法按实时房间对象完整感知；Observer、侦察 Creep 或已过期 Intel 的推断应明确区分。
- NPC Invaders 会在符合条件的房间出现；高等级区域还可能涉及 Invader Core/Stronghold。防守不能只检测玩家敌人。
- Safe Mode 是临时防御工具，不能替代塔、Rampart、维修和战斗单位；是否启用必须考虑它对哪些敌对动作的阻断、剩余时长、激活次数和其他房间风险。
- Rampart、墙体、塔、战斗 Creep、治疗、撤退与安全模式各自具有不同成本和作用范围，不能用单一“敌人出现就全员冲过去”的逻辑处理。

参考：[Defending your room](https://docs.screeps.com/defense.html)、[NPC Invaders](https://docs.screeps.com/invaders.html)。

## 1.9 将规则变成软件不变量

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

