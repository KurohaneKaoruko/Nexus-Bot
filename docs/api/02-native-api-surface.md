# API-02：Screeps 原生 API 分类目录与使用契约

本章是开发导航与使用规则，不是官方 API 的逐字副本。**所有原生签名、参数可选性、返回值、继承关系与常量都以当前 [Screeps API Reference](https://docs.screeps.com/api/) 和锁定的 `@types/screeps` 为准。** 不应仅凭本章自行发明签名。

## 2.1 全局对象

| 对象 | 职责 | 主要注意点 |
|---|---|---|
| `Game` | 本 Tick 的世界快照、对象索引、房间、单位、Spawn、地图和市场等 | 每个 Tick 重新建立；不要把对象属性当成普通可写数据库 |
| `Memory` | JSON 持久化数据入口 | 保存 ID/数字/字符串/数组/普通对象；必须做 schema 版本与清理 |
| `RawMemory` | 原始 Memory 序列化与分段存储 | 段激活后才读取；段容量、异步可用时间和序列化成本需控制 |
| `InterShardMemory` | Shard 间的受限字符串通信 | 不等于任意跨 Shard 共享对象；设计协议、版本和过期机制 |
| `PathFinder` | 跨房间路径搜索与自定义成本 | 搜索会消耗 CPU；设置 `maxOps` 等限制并缓存结果 |
| Screeps 全局常量 | 资源、身体部件、结构类型、方向、返回码、FIND/LOOK 常量等 | 用具名常量，不要散落硬编码整数/字符串 |

`Game` 快照的变化不是通过直接改对象属性完成。代码方法通常是在 Tick 中提交行动意图，游戏稍后统一处理。`Memory` 则是另一个持久化层，两者不要混为一谈。

## 2.2 `Game` 子系统目录

| 子系统 | 常见用途 | 开发模块 |
|---|---|---|
| `Game.time` | 当前 Tick 编号 | 调度、TTL、时间戳和任务租约 |
| `Game.creeps` / `Game.powerCreeps` | 获取本方活动机体 | AgentSystem、能力画像、生命周期 |
| `Game.spawns` / `Game.structures` | 建筑索引 | SpawnDirector、建筑功能索引 |
| `Game.rooms` | 当前有视野的房间 | Perception、RoomCluster |
| `Game.getObjectById` | 从 ID 重新解析当前 Tick 对象 | ActionBroker、目标解析 |
| `Game.cpu` | CPU limit、tickLimit、bucket、getUsed 等 | CpuBudget、限频与性能监测 |
| `Game.map` | 房间图、出口、地形、房间状态 | RoomGraph、侦察计划、跨房间导航 |
| `Game.market` | 订单、交易、价格历史与交易成本 | MarketPlanner |
| `Game.gcl` / `Game.gpl` | Global Control / Power 相关状态 | 扩张和 Power 系统 |
| `Game.shard` / `InterShardMemory` | Shard 元信息及通信 | 可选跨 Shard 协议 |

不要假设 `Game.rooms` 包含所有已知房间。它只代表当前可见房间；其他房间的状态必须来自带 `lastSeen` 的 Intel，且应随时间降低置信度。

## 2.3 Creep / PowerCreep

`Creep` 是由 `WORK`、`MOVE`、`CARRY`、攻击、治疗、占领、防护等部件构成的普通单位。常用 API 类别：

- 感知：`pos`、`room`、`body`、`store`、`hits`、`hitsMax`、`fatigue`、`ticksToLive`、`spawning`、`owner`。
- 移动：`move`、`moveTo`、`moveByPath`、`pull`。
- 经济：`harvest`、`pickup`、`withdraw`、`transfer`、`drop`。
- 工作：`build`、`repair`、`upgradeController`、`dismantle`。
- 控制器：`claimController`、`reserveController`、`attackController`、`signController`、Safe Mode 相关功能。
- 战斗：`attack`、`rangedAttack`、`rangedMassAttack`、`heal`、`rangedHeal`。
- 生命周期：自杀、通知、说话以及其他官方支持的方法。

不要用“职业名”推断能力；应查看 `body` / `getActiveBodyparts` 和负载状态。行动要求还可能受距离、目标有效性、冷却、拥有权、资源量、部件状态和行动管线限制。

`PowerCreep` 与普通 `Creep` 不是同一种生命周期模型。它们的创建、部署、Power 等级、冷却、资源需求和可用 API 应单独处理，不能直接套用普通 Creep 的替补逻辑。

## 2.4 Room / RoomPosition / RoomObject

- `Room`：只针对可见房间进行实时查询，使用 `find`、`lookAt`、`lookForAt` 和已知结构属性时，按官方签名及类型定义检查。
- `RoomPosition`：位置运算、范围判断、路径相关便捷方法。坐标有效区间和房间名必须由构造类型与验证函数检查。
- `RoomObject`：许多游戏对象共享的基础位置/房间/效果等信息。
- `Room.Terrain`：查询地形，适合用于缓存 Room 的移动成本基础数据。
- `RoomVisual` / `Game.map.visual`：可视化接口，用于调试和状态展示；应限频，不能让画图成为 CPU 热点。

`Room.find` 的 `FIND_*` 常量与 `lookForAt` 的 `LOOK_*` 常量用途不同。只需要少量信息时，优先使用明确的查询方式并缓存结果，避免在多模块里反复全量扫描。

## 2.5 结构 API 分组

| 结构/族 | 常见功能 | 需单独校验的方面 |
|---|---|---|
| Spawn / Extension | 生产 Creep、能源供给 | 空闲状态、可用能源、身体成本、名称、生产时间 |
| Container / Storage / Terminal | 本地存储、全局库存、跨房间转移与市场 | `Store` 容量、实际库存、Terminal 冷却、交易消耗 |
| Link | 房间内快速转移能源 | 冷却、来源/目标容量、传输损耗与时序 |
| Road / Rampart / Wall | 移动成本、保护、阻挡 | 损耗/衰减、通行规则、修理优先级 |
| Tower | 远程攻击、治疗与维修 | 能源、距离效果、行动返回码和目标优先级 |
| Controller | RCL、控制权、Safe Mode | 所有权、等级、升级/降级、Safe Mode 条件 |
| Lab / Extractor | 矿物、反应、Boost | 资源类型/数量、冷却、配方、目标身体部件 |
| Factory | Commodity 加工 | 配方、等级、资源配比、冷却 |
| PowerSpawn / PowerBank | Power 流程 | 能源/Power 消耗、时序、目标条件 |
| Observer / Nuker | 侦察、防御/战略打击 | 范围、冷却、弹药与目标条件 |
| Invader Core / Keeper Lair / Deposit | NPC、守护者及特殊资源 | NPC 机制、刷出与衰减计时、风险评估 |

所有这些对象的继承关系和准确签名请直接查 [API Reference](https://docs.screeps.com/api/)。不要为方便自己声明不完整的结构类型，除非该声明属于有测试的领域封装。

## 2.6 Store API

新代码应优先使用原生 `Store` API，而不是假设每类结构都只有 `energy` 字段。根据对象和目标环境的类型声明使用：

- `getUsedCapacity(resourceType?)`
- `getFreeCapacity(resourceType?)`
- `getCapacity(resourceType?)`
- 直接索引相应资源（只在类型与对象确实支持时）

**返回值要遵循类型定义，不能想当然地当成永远为数字。** 某些对象/资源组合的容量语义不同；将 `null` / 未支持资源的情形正确处理。所有 transfer / withdraw / terminal send 都要检查可用量、可接收量和动作合法性。

## 2.7 导航 API

- `PathFinder.search`：适合复杂目标、多目标和跨房间路径。检查 `path`、`cost`、`ops` 与 `incomplete` 等结果信息；不完整路径不得当作到达。
- `PathFinder.CostMatrix`：表示 Room 内格子的移动成本；成本为不可通行的配置值与可通行成本的含义需要按官方说明核对。
- `Game.map.findRoute` / `describeExits` / `getRoomLinearDistance` / Terrain 相关接口：用于 Room Graph 与战略层路线规划。
- `Creep.moveTo`：便利接口，可能使用其自身移动缓存；应统一配置参数和行为，避免与独立交通系统相互打架。

路线规划的目标、缓存、交通管理和重规划应由 EX-MACHINA 自己封装，但底层签名必须来自官方 API 定义。

## 2.8 市场、Shard 与 RawMemory

- `Game.market`：订单管理、成交、历史和交易成本。市场 API 每个动作都有具体限制，务必处理返回码并检查 Terminal / Credits / Resource / cooldown。
- `RawMemory.segments`：异步分段存取；必须在正确 Tick 激活所需分段，并验证内容、版本和尺寸。
- `InterShardMemory`：只用于已支持的跨 Shard 信息协议；不要把它当成无边界、强一致性的数据库。

## 2.9 对原生 API 的统一封装原则

业务模块应尽量不散落原生 API 调用；但也不要为了“抽象”而把 API 规则藏起来。推荐：

- `NativeObjectResolver`：每 Tick 根据对象 ID 解析当前对象并允许空值。
- `StoreAdapter`：为资源可用量、容量和预留做一层有测试的辅助函数。
- `MovementAdapter`：统一 `moveTo` 或 PathFinder 选项及错误反馈。
- `ActionBroker`：对行动前提与冲突规则做统一检查，但仍记录真实原生返回码。
- `GameRules`：只缓存经过验证、确实属于静态规则的配置；动态属性从 API 读取。

封装层不得掩盖原生返回码，也不得把不可用目标转成看似成功的结果。
