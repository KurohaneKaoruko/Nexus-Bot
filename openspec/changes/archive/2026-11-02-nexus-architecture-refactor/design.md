# Design

## Context

基线为当前工作区 WIP（含未提交重构与 dist 产物，2026-10-16 sim 审计对象），非 HEAD。现状实测：

- **内核已成型**：`src/core`（nexus/scheduler/phases/tickContext/cpuBudget/qos/errorBoundary）以 8 阶段管线驱动（perception → emergency → strategy → planning → reconcile → spawn → agents → commit），模块级错误隔离与 CPU 预算带已存在。
- **broker 边界真实但狭窄**：`actionBroker` 的 submit/commit 两段式、管线仲裁、返回码 triage 只覆盖 creep 工作意图 + 塔动作 + 安全模式。**五条管线缺失**：spawn、construction、market/terminal、claim/reserve、PowerCreep 能力。
- **约 250+ 处直连突变**绕过 broker：legacy `prototype/` 角色库 ~115、`teams/` ~45、`economy/units/` ~70、`planner/` 12（直连 `createConstructionSite`）、`spawning/` 6（直连 `spawnCreep`）、market/terminal 10、`visuals/` 1（`spawning.cancel`）。
- **Movement 是第二突变边界**：`movement/index.ts` 猴补丁 `Creep.prototype.move/moveTo` + `endTickResolve`，自成移动意图管线，与 broker 平行。
- **`src/runtime/`、`src/commands/` 不存在**；人操命令层在 `src/console/`（含直连 market/site/flag 操作）。
- **五处双轨分裂**（架构测绘确认）：CPU 治理 cpuBudget（Nexus 相位管线）vs QoS 全局单例（legacy 侧消费）并存；Memory 轨 A（`Memory.Nexus` schema v11 + 迁移链 + global 运行时层，成熟）vs 轨 B（accessor 45+ getter 直读 legacy 域）；角色驱动 `NEXUS_TASK_DRIVEN_CODES` 10 个任务驱动角色 vs legacy `exec()` 其余 ~80 个 UnitData 角色；workforce 双实现（workforce.ts vs roomWorkforce.ts，P1-14 双轨根因）；外矿双轨（economy/remoteMining.ts vs mine/ 完整体系）。
- **两处内核纯度/单点风险**：`endPhase.ts` 硬编码业务 import 链（违反内核零依赖）；Movement 的 `endTickResolve` 契约是全局单点——主循环不调用则**全员冻结**，重构时序必须保持。
- **任务系统已成熟**（dedupeKey 幂等/租约/TTL 对账/终态不复活），task-index 是在其上加索引而非重建；sim 场景回归是唯一活跃回归制（vitest 已退役未删除，可复活作单测层）。
- **缺陷轨道**：`docs/bugs` 未修复 P0-16（孵化期 Memory 清理竞态，a/b/c 三个级联）、P1-17（expansion 半球硬编码）、P1-18（scout 孵化饥饿）、P1-19（upgrader 断档）、P2-20（RCL3 建造风暴）+ role-registry-executor-gap + race-strategy-port 分波。项目所有者确认：缺陷修复与重构**并行推进**，同域冲突时缺陷优先。

约束：

- Strangler Refactor——旧算法资产（Movement、Teams 战斗、Industry、BodyFactory、remoteMining 坐标换算）保留内部实现，只收编控制权，不大爆炸重写。
- AGENTS.md：模块化、拒绝过度工程、注释不带参考来源、配置不硬编码、以 nightx 身份开发、不擅自提交。
- 现有 7 个 in-progress OpenSpec change 不动；未同步的 phase1 `agent-action` delta 与本变更 `command-boundary` 交叠，本变更后行归档、冲突以本变更为准。

## Goals / Non-Goals

**Goals:**

- 建立 Actor Ownership（记录→告警→拦截三阶段）与全局唯一突变边界（补齐 spawn/construction/market/claim/PowerCreep 五条管线 + 修正 ActionResult 语义）。
- Movement、Teams、Industry、外部道路经 Adapter 收编进边界；豁免清单单调收缩。
- TaskIndex 近似 O(1) 查询；Agent 单路径（Task→FSM→Intent）+ 角色判定 Memory 权威化。
- Spawn 管线单源仲裁（Demand/Arbiter/BodyFactory/Queue/Command）+ 孵化中名单统一可见（根修 P0-16 类竞态的架构面）。
- ResourceLedger 五态分账；建造放量与产能联动；防务需求化。
- legacy 删除四条件门禁 + 架构守护脚本（豁免清单只减不增）。
- 缺陷轨道并行修复（P0-16→P1-17/18→P1-19/P2-20 + 两文档项），每修一项跑场景门回归。
- 全程场景门回归线 + 实服落地验证节奏。

**Non-Goals:**

- 不重写 Movement 引擎、Teams 战斗算法、Industry 子系统的内部实现。
- 不在本变更内追求 speedrun 榜第一（效率冲刺由 race-strategy-port 分波与既有 in-progress change 承担）。
- 不迁移到文档 01 §29 的全量目标目录结构（`src/kernel`、`src/world`、`src/state` 等整树搬移）——按"职责收编优先于目录搬家"执行，目录重组只在模块收编自然发生时顺带进行，避免一次性大规模文件移动破坏 7 个 in-progress change 的路径引用。（原引用 04 §4 目标架构目录树，04 已索引化，内容归 01 §29）
- 不处理 `docs/nexus-design/`（23 篇既有设计）与本程序的关系裁定——旧 change 继续按其执行，互不干扰。

## Decisions

### D1: Ownership 先行，模式三档渐进（Phase 1）

新建 `src/runtime/actorOwnership.ts` + `actorRegistry.ts`，提供 acquire/release/ownerOf/assertOwner。落地上不在 broker 校验前强推拦截：先以"仅记录"模式上线收集真实冲突面（Nexus Task vs Legacy Role vs Teams 直操），sim 观测一周后切"告警"，生产稳定后切"拦截"。理由：审计显示双控制面分散在 ~250 处，直接拦截会瞬间打断主循环；渐进模式让存量冲突显形后再收刀。租约数据放 `global` 运行时层（单 Tick 重建，不占 Memory 序列化成本），跨 Tick 持久所有权仅存 owner 名与租约到期 Tick 于 creep memory 侧索引。

### D2: broker 扩管线而非另立 CommandBus（Phase 2）

不新建平行 CommandBus。`actionBroker` 已具备 submit/commit/仲裁/triage 骨架与全部模块的依赖注入关系，扩展它成本最低：新增 spawn/construction/market/claim/power 五类 ActionKind 与对应 commit 分支，`ActionResult` 改为 `accepted/retryable/replan/invalid/suppressed` + 可选 `nativeReturnCode`（未触达原生 API 时字段不存在）。Ownership 检查插入 submit→commit 之间（commit 时 assertOwner）。移动意图保持 Movement 管线（D3）。理由：文档 01 §14 允许"ActionBroker 升级为真正 mutation boundary"这一等价路径；另立 CommandBus 会制造第三套提交语义，违反"拒绝不必要抽象"。

### D3: Movement 收口为"意图进边界、执行留引擎"（Phase 4/文档02 Phase 4）

Movement 猴补丁体系（BetterMove/traffic/moveMatch/endTickResolve）整体保留，重定位为 broker 的移动执行器：agentSystem 产出 MoveIntent（含目标/优先级/理由），movement 引擎消费意图执行；`Creep.prototype.moveTo` 猴补丁继续兜底 legacy 单位（收编期内合法通道，登记豁免清单）。收编完成的单位类别关闭其 legacy moveTo 通路。理由：Movement 是实战验证最充分的资产，重写即大爆炸；"谁想动"与"怎么动"分离即可达成单点仲裁。

### D4: 孵化中名单统一 API 根治 P0-16 类竞态（Phase 6 + 缺陷轨道）

P0-16 的三级联（a 普查双轨/b visuals 熔断/c courier 幽灵计划）共享一根因：孵化期单位"不在 Game.creeps 又确实存在"的状态对子系统不可见。修法分两层：近期修复（缺陷轨道）——`ClearModule` 排除 `Game.spawns` 孵化白名单 + visuals 改告警不取消 + courier 过滤 spawning；架构层（spawn-arbiter spec）——`isSpawning(name)` 统一查询接口成为孵化管线的组成部分，子系统一律问它。近期修复先落（缺陷优先原则），架构层接口在 Phase 6 管线化时收编该逻辑。

### D5: 豁免清单驱动的架构守护（Phase 0）

新增守护脚本（CI/预提交可跑）：扫描 `src/` 全部动作类原生调用，与 `arch-guard-allowlist`（按文件+调用类别登记，含人操豁免的 `src/console/`）比对，超出清单即红。清单基线 = 本次审计的 250+ 处现状快照，此后**只减不增**。legacy 删除（Phase 13）以清单条目清零为完成度量。理由：四条件门禁（legacy-removal-gate spec）需要机器可验证的进度锚点，清单是最诚实的那个。

### D6: 目录策略——职责收编优先于目录搬家

文档 01 §29.1 的迁移矩阵（core→kernel/runtime/state 等）作为长期方向，但不在本变更做整树搬移。新增代码落新位（`src/runtime/`、`src/commands/` 仅在需要时创建）；存量模块原位收编（planner 加意图层、spawnDirector 拆 Demand/Arbiter/Queue 于 `src/modules/spawning/` 内）。每次目录移动都会使 7 个 in-progress change 的 tasks 引用失效，收益（纯目录洁癖）不抵成本。（原引用 04 §29 文件迁移矩阵，04 已索引化，矩阵归 01 §29.1）

### D7: 缺陷轨道与重构轨道的并行编排

缺陷轨道独立成 tasks 组，按 sim-audit-2026-10-16 建议顺序：P0-16（放大器，官服会真杀孵化单）→ P1-17/P1-18（静默死锁对，修完冲级收入才有增量）→ P1-19/P2-20（吞吐主战场，与 race-strategy-port W1/W2 同拍）。并行规则：缺陷任务不改架构接口时与重构任务无依赖可真并行；触碰同一文件域时缺陷先行（如 P0-16 修 `clear.ts`/`roomVisuals.ts`，早于 Phase 6 收编这些文件）。race-strategy-port 的 W1（reserver/远程搬运/skipBuildTypes）与 Phase 8 Economy 收编同战场，编排为其前置。

### D8: 子代理并行实施编排

实施阶段（apply 工作流）按低耦合域切分并行轨道，每轨道一个子代理，轨道间以"共享文件域不相交"为硬约束：

| 轨道 | 域 | 主要触碰 |
|---|---|---|
| A 内核边界 | ownership/broker 扩管线/守护脚本 | `src/runtime/`(新)、`src/modules/agents/`、脚本 |
| B 缺陷修复 | docs/bugs 全项 | `clear.ts`、`roomVisuals.ts`、`expansion.ts`、`remoteMining.ts`、`spawnDirector.ts` |
| C 孵化建造 | spawn 管线/construction 意图化 | `src/modules/spawning/`、`src/modules/planner/` |
| D 经济账本 | ResourceLedger/收入口径 | `src/modules/economy/` |
| E 战斗收编 | defense 需求化/teams adapter | `src/modules/defense/`、`src/modules/teams/` |
| F 产业外域 | industry/expansion/intershard | `src/modules/industry/`、`src/modules/external/` |

串行依赖仅三处：Phase 1 ownership（A 先行，B/C 的接口依赖它）；Phase 2 broker 管线（A 先行）；Phase 13 删除（全部轨道收编完成后）。E/F 与 C/D 可全程并行。每轨道完成即跑场景门回归，不合入红门。

### D9: 五处双轨的收编次序

架构测绘确认的五处双轨按"谁阻碍突变收编谁先行"排序：角色驱动双轨（c）是 Ownership/broker 的直接阻碍，Phase 1–2 一并处理；workforce 双实现（d）与外矿双轨（e）由缺陷轨道 P1-14/P1-17/P1-18 修复时顺带定于一尊（race-strategy-port W1/W2 亦在此域）；Memory 双轨（b）在 legacy 删除期（Phase 12–13）随 accessor 域消亡自然收敛，不提前大迁移；CPU 治理双轨（a）以 cpuBudget 为尊，QoS 降级为 legacy 侧兼容读口，随 legacy 域删除逐段摘除。

### D10: 内核纯度与 Movement 单点的守护

`endPhase.ts` 的硬编码业务 import 改为 TickModule `end` 钩子注册制（各域模块自带 end 钩子向 commit 相位 P0 段注册），消除内核对业务的直接依赖；Movement 的 `preTickBetterMove → broker commit → endTickResolve` 时序作为 Broker 模块的契约测试锚点固定，任何重构不得破坏（否则全员冻结）。vitest 退役套件不动（已退役裁决），单测需求以守护脚本 + sim 场景探针满足。

### D11: ActionResult 与遥测的统一

`category` 五分类成为 broker 唯一对外语义；`docs/bugs` 的验证标准（如 `warn.broker.invalid.withdraw actor-missing-or-spawning` 归零）与遥测计数挂钩，使缺陷勾销可机器验证。

## Risks / Trade-offs

- **渐进模式窗口期的双控制**：拦截模式启用前冲突仍可能发生。缓解：记录模式本身产出冲突遥测，sim 场景先验证拦截语义再上实服；P0-16 类已知冲突点由缺陷轨道先行修复。
- **broker 扩管线引入回归面**：五条新管线触达 spawn/planner/industry 现行为。缓解：每条管线独立收编+场景门回归；Arbiter/BodyFactory 保持纯函数可单测。
- **与 in-progress change 的路径冲突**：phase3/workforce-logistics 等仍在改 defense/economy 域。缓解：D6 原位收编策略 + D8 轨道并行时的文件域检查；真冲突时缺陷修复与已开 change 优先，本变更让位等待。
- **speedrun 分段门长期红**：本变更不直接冲榜，效率增量来自缺陷轨道与 race-strategy-port；分段门红不阻断重构合入（属"冲级目标未达成"），但行为回归红必阻断。
- **豁免清单维护成本**：清单需要随收编同步收缩，否则沦为僵尸文档。缓解：守护脚本强制清单与代码一致（清单有条目无调用→要求删除条目；有调用无条目→红）。
- **实服 4wt 重置周期长**：落地验证节奏受私服自动重开限制。缓解：验证项按风险分级，P0 类行为（孵化/采集）在首个周期内确认，其余可跨周期累积。
