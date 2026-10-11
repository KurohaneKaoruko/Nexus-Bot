# Design

## Context

现状（见 proposal「Why」）：Kernel 调度（`phases.ts` 七阶段 + 模块注册）、TaskBoard/Allocator/AgentSystem/ActionBroker、经济规划器（`src/modules/economy/planners.ts` 单模块遍历所有房间）、低频经济模型（`model.ts`：累加器 + 诊断，产出 carrierMultiplier/quotaFloorBias/upgraderBonus）均已就绪；`Memory.nexus.global` 仅有 `posture`/`lastStrategicTick` 两个死字段。约束：Phase 1 承诺任务体系架构只加不改；AGENTS 禁止硬编码（阈值/周期/偏置全部进 `src/config/`）；所有持久化结构有界 + schemaVersion + 纯函数迁移。

## Goals / Non-Goals

**Goals：**

- 补齐 docs/nexus-design/03 §3.1 的「H[Nexus/全局层]」与「C[局部连结体]」两层：战略层产出姿态与政策，局部层的落地形态是各职能系统（经济，以及后续防御/扩张/工业）的按房间规划模块，消费指令产出任务。
- 指令下行 / 遥测上行的连结闭环可观测、可测量验收。
- 后续防御（Phase 3）、扩张（Phase 4/5）、工业（Phase 6）职能系统以同契约插拔，本期交付契约文档。
- 概念边界写清：经济/防御/工业是职能**系统**；「集群」专指多 Creep 协作编队（战斗小队、外矿协作组等，单位层协作形态），不用于职能域命名。

**Non-Goals：**

- 不实现 ThreatModel/Tower/撤退等防御行为，`emergency` 阶段保持空置，war 姿态仅保留枚举与输入挂钩点。
- 不实现侦察/房间评分/扩张投资模型；expand 姿态本期只上调储备与目标库存（为扩张积攒），不产生任何扩张动作。
- 不改 Allocator 评分与 AgentSystem 行为（risk 成本仍为 0 占位，待 Phase 3 威胁输入）。
- 不做 StrategyTuner 自动调参（docs/nexus-design/02 §2.3 属 Phase 7）。

## Decisions

### D1：新增 `strategy` 阶段，位置在 `emergency` 与 `planning` 之间

docs/nexus-design/03 §3.3 第 5 步（Strategic Planning）与第 6 步（局部规划）本就是两个阶段；现状 `phases.ts` 只有合并的 `planning`。新增 `strategy` 阶段让战略重估获得独立的错误隔离与预算计量段，且指令在局部规划前就绪。阶段表变更为纯追加，`TICK_PHASES` 顺序语义（顺序固定且确定）不受影响。
备选：战略模块注册为 `planning` 阶段第一个模块——被否，重估与规划混在同一段无法独立降级/熔断，也不符合 docs/nexus-design/03 阶段划分。

### D2：战略姿态 = 纯函数状态机，输入只读预聚合摘要

`evaluatePosture(global, inputs) → { posture, reason } | null`（null = 维持）。输入结构 `StrategyInputs`（库存总额、饥饿累计、诊断结论、工地存在性、可见房间数）由调用方从 `memory.economy`、`memory.ledger` 与世界快照聚合，战略模块自身不遍历 `Game`。转移规则表（全部进 `STRATEGY_CONFIG`）：

| 当前 → 目标 | 触发（且已过 `minDwellTicks` 驻留） |
|---|---|
| develop/expand → survive | 库存 < `criticalStockFloor` 或 窗口饥饿累计 > `starvationTrigger` |
| survive → develop | 库存 > `healthyStockFloor` 持续一个观测窗口 |
| develop → expand | 库存 > `surplusStockFloor` 且诊断 bottleneck=none 且无工地 |
| expand → develop | 库存 < `healthyStockFloor` |
| 任意 → war | 本期无输入源，不自动进入 |

阈值以「Source 理论产能 × 系数」表达（如 `criticalStockFloor = sourceCount × factor × 10`），避免绝对值随房间规模失配。重估触发 = 周期到点（`reevaluatePeriod`）或事件标志（库存穿越由指令派生发现后置位）。备选：每 Tick 全量重估——被否，违反 docs/nexus-design/02 §2.4 分层计算原则。

### D3：政策持久化于 `Memory.nexus.global`，schema v4

```ts
interface NexusGlobalMemory {
  posture: Posture;
  lastStrategicTick: number;
  policy: { reserveFloorFactor: number; riskTolerance: number }; // 按姿态取配置表覆盖
  goals: { targetStockFactor: number };
  lastTransition?: { from: Posture; to: Posture; at: number; reason: string };
  transitionCount: number; // 有界计数，仅统计
}
```

迁移 v3→v4 纯函数补默认值（develop + 缺省政策），沿用 `migrations.ts` 逐版本模式 + 重复执行幂等测试。`SUBSYSTEM_DEFAULTS.global` 同步扩展。`riskTolerance` 本期只存不用（Phase 3 输入）。

### D4：指令 = TickContext 上的惰性纯派生，不持久化

`ctx.directive(): StrategyDirective` 每 Tick 首次调用时从 `memory.global` + `STRATEGY_CONFIG` 纯派生并缓存；首次调用天然发生在 `planning` 阶段（战略阶段之后），因此当 Tick 重估的结果立即对当 Tick 局部规划生效。战略模块被跳过/禁用/损坏时，派生退化为中性指令（等效 develop、零偏置、不节流），职能系统照常规划——「保底方案」语义（docs/nexus-design/02 §2.4）。

```ts
interface StrategyDirective {
  posture: Posture;
  reserveFloor: number;          // 绝对值，由 factor × sourceCount 推得
  kindBias: Record<TaskKind, number>; // 姿态偏置表查得，加到基础优先级上
  suppressUpgradeBuild: boolean; // survive 且库存 < reserveFloor
}
```

备选：战略模块每 Tick 主动写入 ctx——被否，禁用战略模块时指令缺失会让职能系统规划器直接失去输入；备选：指令持久化——被否，违反 docs/nexus-design/03 §3.4（跨 Tick 状态必须显式建模，派生值持久化会造成双源真相）。

### D5：指令生效语义 = 偏置加法 + 生成暂停 + 既有任务降权不取消

- **优先级偏置**：`board.upsert` 的 priority 基础值 + `directive.kindBias[kind]`（仅创建/更新时写入； Allocator 按 priority 排序天然生效）。
- **节流**：`suppressUpgradeBuild === true` 时经济规划器跳过 upgrade/build 的新建 upsert；既有存活任务因下一 Tick upsert 缺席、主体仍在，会走「取消」分支——为避免「暂停即取消」的抖动，改为：节流期间这两类任务 `expected` 集合仍加入（不新建），既有任务保持存活但 priority 压低（`upsert` 更新 priority），恢复后自动回基础值。取消语义仍只由「主体消失」触发，与迁移前一致。
- **Spawn 侧**：`survive` 时 SpawnDirector 维持队列但不再新排非关键岗位（builder/upgrader 类）——实现为读 `directive.posture` 的轻量门控；carrier/harvester 不受影响。本期不做身体缩水（避免与替补窗口逻辑耦合）。

理由：偏置是「软」影响（评分排序），节流是「硬」影响（任务不生成），两级配合符合 docs/nexus-design/05 §5.4「优先级拆解」方向，且都不触碰 Allocator 内核。

### D6：局部规划层不引入新抽象——职能系统规划器就是 planning 阶段模块

docs/nexus-design/03 §3.1 把局部层画成「Clusters/局部连结体」子图，落地只取其**职责**（按房间规划、读指令、产任务、经共享账本协调预留），不新增注册表/运行器抽象：经济系统规划器保持 Phase 1 以来的形态——`economy-planners` 模块（planning 阶段、P2 预算带），内部按房间调用 `planEconomyRoom(ctx, board, room)`（原房间循环体提取，便于单测与后续按房间扩展）。后续防御/扩张/工业系统以同样的 TickModule 契约注册为各自模块，变体开关独立禁用、错误隔离段天然隔离——调度器既有机制，内核零改动。

概念区分（写入 docs/nexus-design/19）：**职能系统**（economy/defense/industry/expansion）= 跨房间的职能域；**集群** = 多 Creep 协作编队（战斗小队、防御编队、外矿采集协作组），属单位层协作形态，未来由 Agent 层/任务编组实现，与职能系统正交。
备选（已否）：RoomCluster 契约 + 集群运行器（把职能域包装成「集群」）——概念错位，集群是多 Creep 协作而非职能域；备选（已否）：每房间局部对象统筹各域——当前无跨域房间级状态，属过度设计，待防御系统落地出现真实需求再重评。

### D7：反馈与可观测性复用既有管线

- 战略读取面：`memory.economy.diagnosis`、`lastStockTotal`、`accumulators`、`ledger.rates`——全部已有，零新增采集成本。
- HUD：`roomVisuals` 增一行 `posture | floor | throttle`；`economyIndicators` 旁新增 `strategySnapshot(ctx)`（姿态、驻留、偏置摘要、最近转移）供控制台查询。
- 转移记录：`global.lastTransition` 单条 + `transitionCount` 计数（Memory，跨重载可查），另在 `global` 运行时层维护有界转移环形日志（控制台排障用，重载即失可接受）；转移时 logger 限频输出一行。

### D8：扩展契约文档 = docs/nexus-design/19

`docs/nexus-design/19-智械连结扩展.md`：职能系统与集群的概念区分表（系统=职能域、集群=多 Creep 协作编队）、各职能系统的接入契约（planning/emergency 阶段模块 + 指令消费）、防御系统接入点（`emergency` 阶段 + ThreatModel 作为 war/risk 输入源）、扩张系统接入点（expand 姿态动作位、侦察状态机挂 TaskBoard 的 scout/reserve/claim 任务类型）、集群（多 Creep 编队协作）在单位层的扩展位、各层职责边界表（哪些层允许读什么）。这是「本次做骨架、其余写进文档」的交付物。

### D9：持久化三层分级——TickContext / global 运行时 / Memory

Screeps 的 `global` 跨 Tick 存活但代码重载即失，读取零解析成本（Memory 每 Tick 有序列化负担）。本变更新增数据一律按下表分级：

| 层 | 存活期 | 放什么（本变更） | 丢失代价 |
|---|---|---|---|
| TickContext | 单 Tick | 指令派生 memo、快照聚合 | 无（每 Tick 重建） |
| `global.nexus.runtime` | 进程期（重载即失） | 紧急重估事件标志（库存穿越检测置位，战略模块消费后清除）、转移环形日志（有界）、观测用输入摘要 | 退化为周期重估、日志清空——零行为损失 |
| Memory | 跨重载 | 姿态、政策、目标库存、lastTransition、transitionCount（决策状态与长期统计，重建代价高） | 不可丢（schema 迁移保障） |

判定规则：重建代价高或必须活过代码重载 → Memory；重建廉价、丢失只影响观测或加速 → global；单 Tick 派生 → ctx。纪律：`global` 结构在 `globals.d.ts` 声明、经 `src/store/runtime.ts` 类型化访问器读取（缺失返回默认值自愈，不当异常抛）；不得存放游戏 API 对象引用（与 Memory 同规）；环形日志有界。
备选：事件标志与转移日志直接放 Memory——被否，每 Tick 写 Memory 增加序列化负担，且这两类数据恰恰是「短命/可弃」的；备选：全部放 global——被否，姿态与政策在重载后丢失会让殖民地回到 develop 缺省，违背「决策状态必须跨重载存活」的一致性模型（docs/nexus-design/02 §2.5）。
范围边界：既有子系统（economy 累加器等）向 global 的迁移不属本变更——那是 economy-model 既有规格的行为变更，收益记录进 docs/nexus-design/19 供后续独立变更评估。

## Risks / Trade-offs

- [survive 节流过狠导致升级断档] → 节流只作用于「新任务生成 + 既有任务降权」，且退出条件是库存回健康线（非到满仓）；验收场景明确「压制期间关键结构缺货不恶化」。
- [姿态在阈值附近抖动] → 最小驻留时长迟滞 + 触发线与恢复线分离（critical < healthy 分离配置）；`transitionCount` 可观测抖动。
- [战略重估读到滞后一个诊断窗口的数据] → 可接受：战略本就是低频决策（docs/nexus-design/02 §2.4 第 3 层），事件触发（库存穿越）走的是每 Tick 累计的 `lastStockTotal`，不依赖诊断窗口。
- [迁移破坏线上 Memory] → v3→v4 纯函数 + 幂等单测 + `SUBSYSTEM_DEFAULTS` 隔离重置兜底；上线前在私服 W5N8 落地验证。
- [`global` 运行时层在代码重载后丢失] → 只放缓重建数据（D9 表），访问器缺失自愈；最坏退化 = 一次周期性重估代替紧急重估、转移日志清空，姿态与政策不受影响。
- [规划器按房间化重构引入行为回归] → 重构前后 dedupe key / 任务集一致性测试护栏（同快照输入对比任务集合），重构与指令生效分两个提交。

## Migration Plan

1. 先落 schema v4 + 迁移测试（旧 Memory 样例 → 迁移 → 幂等重跑）。
2. 规划器按房间化重构（行为兼容，无指令逻辑），一致性测试通过。
3. 战略模块 + 指令 + 偏置/节流接入，逐场景测试。
4. HUD/文档收尾；私服落地验证 survive 自愈场景后按 `submit.js 47.100.24.220@nexus --branch main` 上传。
回滚：变体 profile 关闭 `strategy` 模块即回中性指令（D4 退化路径），schema v4 对 v3 只增字段，回滚代码不触发降级迁移。

## Open Questions

（无——war 输入源与 expand 动作位已按 Non-Goals 明确推迟，接入方式在 docs/nexus-design/19 契约中约定。）
