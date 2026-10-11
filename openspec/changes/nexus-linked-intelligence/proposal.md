# Proposal

## Why

docs/nexus-design/02 定义的「智械连结」是分层智能：NexusCore 定战略、局部层解具体问题、Agent 保执行自治，指令下行、遥测上行。当前实现只有「局部 + 个体」两层：经济规划器是单一全局模块遍历所有房间（无战略层，局部无法感知全局态势——库存告急时升级/建造仍照常竞争能源），`Memory.nexus.global.posture` 是无人读写的死字段，`emergency` 阶段空置。Phase 2 吞吐已稳定（仅剩 soak 验收），正是补上「连结」缺失层级的时机：让每一层都有可观测、可测量的智能，而不是靠单一模块或个体各自为战。

## What Changes

- **NexusCore 战略层**（docs/nexus-design/02 原则 B / docs/nexus-design/03 §3.2 / docs/nexus-design/04 §4.2）：新增 `strategy` 阶段与战略模块，低频周期 + 阈值穿越事件触发重估战略姿态（`survive`/`develop`/`expand`/`war`）与全局政策（动态能源储备下限、风险容忍占位、目标库存）；姿态转移带迟滞并记录原因（有界）；决策只读预聚合摘要（经济诊断/账本/累加器），不扫描游戏对象。`war` 本期无自动输入源（ThreatModel 属 Phase 3），仅保留枚举与挂钩点。
- **指令连结（StrategyDirective）**：TickContext 提供单 Tick 有效的战略指令视图（姿态、储备下限、任务种类优先级偏置、升级/建造节流），从持久化政策纯派生（O(1)，惰性缓存），战略模块跳过或禁用时退化为中性指令——「中央层定战略」的下行数据载体，且 Agent 层不读指令（执行自治边界，不做逐单位微操）。
- **局部规划层（连结的局部端）**（docs/nexus-design/03 §3.1）：经济系统规划器按房间接入指令，任务源行为兼容（dedupe key 不变）；指令生效语义：`survive` 下压低 upgrade/build 基础优先级，且库存低于储备下限时暂停其新任务生成、既有任务降权不取消（防抖动）；防御（Phase 3）/扩张（Phase 4/5）/工业（Phase 6）等后续职能系统以 planning 阶段模块同契约插拔。概念边界：经济/防御/工业是**职能系统**；「集群」专指多 Creep 协作编队（战斗小队、外矿协作组等，单位层协作形态），不用于职能域命名。
- **遥测反馈连结**（docs/nexus-design/02 原则 F）：姿态/政策进 HUD 与指标（转移次数、驻留时长有界统计）；转移 reason 引用具体量化输入；验收场景可测量（清空库存 → 一次转移进 survive → 净库存回正 → 迟滞后回 develop）。
- **Memory schema v4**：`global` 扩展 `policy`/`goals`/`lastTransition`，纯函数迁移 v3→v4 + 单测。
- **global 运行时层**：战略的短期、重建廉价数据（紧急重估事件标志、有界转移环形日志）存 `global`（读取零解析成本、代码重载即失），Memory 只存必须跨重载存活的决策状态（姿态/政策/长期统计）；访问一律经类型化访问器 + 缺失自愈，丢失时退化为周期重估，零行为损失。
- **扩展契约文档**：新增 `docs/nexus-design/19-智械连结扩展.md`，写明职能系统/集群的概念区分，以及防御/扩张等剩余层级智能如何按职能系统模块契约接入连结架构（本次只做骨架，其余按用户要求落文档）。

## Capabilities

### New Capabilities

- `strategy-core`：NexusCore 战略层——姿态状态机（低频 + 事件触发、迟滞、原因记录）、全局政策（储备下限/风险容忍/目标库存）、降级安全（重估可跳过、保底为沿用旧政策）。
- `strategy-directive`：指令连结——单 Tick 派生的战略指令（姿态、储备下限、优先级偏置、节流开关）、消费契约（职能系统规划器与 Spawn 读、Agent 不读）、战略模块缺席时的中性退化。
- `room-planning`：局部规划层——按房间执行的职能系统规划模块契约（快照+指令→任务+预留）、经济规划器行为兼容迁移与指令生效、后续职能系统可插拔边界。
- `strategy-feedback`：遥测反馈——战略决策的量化输入契约、姿态/政策可观测性（HUD/指标/转移记录）、验收测量场景。

### Modified Capabilities

（无——主 specs 尚未从 phase0-2 同步；TaskBoard/Allocator/AgentSystem/ActionBroker 的既有行为契约不变，本期不改其需求。）

## Impact

- **新增**：`src/modules/strategy/core.ts`（战略模块）、`src/modules/strategy/directive.ts`（指令派生）、`src/config/strategy.ts`（周期/阈值/偏置表，全部配置化）、`src/store/runtime.ts`（`global` 运行时类型化访问器）、`docs/nexus-design/19-智械连结扩展.md`（含系统/集群概念区分与各职能系统接入契约）。
- **修改**：`src/core/phases.ts`（`emergency` 与 `planning` 之间增 `strategy` 阶段）、`src/core/tickContext.ts`（惰性 `directive()`）、`src/modules/economy/planners.ts`（按房间化重构 + 接指令，dedupe key 不变）、`src/modules/spawning/spawnDirector.ts`（读指令的储备门控）、`src/store/memorySchema.ts` + `migrations.ts`（schema v4）、`src/modules/visuals/roomVisuals.ts`/`src/core/boot.ts`（HUD 姿态行）、`src/modules/index.ts`（注册序）。
- **不动**：TaskBoard/Allocator/AgentSystem/ActionBroker 架构与阶段语义（Phase 1 承诺：只加层与能力，不改架构）；`movement` vendor 代码；`economy` 诊断的既有调整逻辑（carrierMultiplier 等保持，战略层只读）。
- **验收对齐**：docs/nexus-design/02 §2.7 验收问题、docs/nexus-design/14 Phase 5 的架构前置（战略姿态/多系统局部规划骨架；扩张投资与 CPU 降级不在本期）。
