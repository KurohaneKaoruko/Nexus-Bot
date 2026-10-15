# Tasks

> 状态图例：`[x]` 已完成（有测试/命令证据）；`[ ]` 未完成。
> 每个条目的「验证」为其验收方式；未通过验证的条目不得勾选（docs/nexus-design/21 §21.5 DoD）。

## 1. 存储层：schema v6 与运行时需求队列

- [x] 1.1 `src/store/memorySchema.ts`：新增 `SquadKind` 联合类型（当前仅 `"defense"`）与 `SquadRecord`（`id`/`kind`/`room`/`slots`/`priority`/`expiresAt`/`createdAt`/`members`）；`NexusMemory` 增 `squads`；`CURRENT_SCHEMA_VERSION` → 6，同步 `SUBSYSTEM_DEFAULTS`/`SUBSYSTEM_KEYS`。验证：类型检查通过；`tests/store/migrations.test.ts` 版本断言 5→6
- [x] 1.2 `src/store/migrations.ts` 新增 `migrateV5ToV6`（补空 `squads` 表 + 清洗不合规条目），注册进 `MIGRATIONS`。验证：`tests/store/migrations.test.ts` —— v5 样例迁移后 `squads` 存在、重复迁移幂等、脏条目被剔除
- [x] 1.3 `src/store/runtime.ts`：新增 `SquadRequest`（`kind`/`room`/`slots`/`priority`/`ttlTicks`）与 `ClusterRuntime`，挂到 `NexusRuntimeRoot.cluster`；实现 `requestSquad()`（按 `kind+room` 合并、有界）与 `takeSquadRequests()`（消费并清空）。验证：`tests/cluster/model.test.ts` 覆盖合并、上限截断、消费即清空
- [x] 1.4 `src/store/bootstrap.ts`：`createMinimal` 补 `squads: {}`。验证：`tests/core/bootSmoke.test.ts` 全新 Memory 下无异常

## 2. 集群层：编队模型与生命周期

- [x] 2.1 `src/modules/cluster/model.ts`：纯函数集 —— `squadIdOf`、`slotDedupeKey`、`slotPrefix`、`clampSlots`、`squadPriority`（优先级下限抬升 D6）、`applyRequest`（新建/续期）、`isExpired`、`atSquadCapacity`、`ownsSlot`。验证：`tests/cluster/model.test.ts`（10 例）覆盖 id 稳定性、优先级取大、容量上限、命名空间归属
- [x] 2.2 `src/modules/cluster/index.ts`：`runClusterPlanner`（消费需求 → 建队/续期 → 过期解散 → 活跃维持）+ `disband`（取消槽位任务，D8）+ `maintain`（槽位任务 upsert / 收缩清理 / 成员回填）+ `clusterModule`（`phase:"planning"`、`band:"P1"`、名 `cluster-squads`）。验证：`tests/cluster/planner.test.ts`（10 例）覆盖建队、续期不重复、TTL 解散并取消、收缩清理、成员回填
- [x] 2.3 槽位任务不带静态 `targetId`（D7），dedupe 键带编队命名空间前缀 `squad:<id>:slot:`。验证：`tests/cluster/planner.test.ts` 断言任务 `targetId` 为空、键前缀正确
- [x] 2.4 解散/收缩只触碰本命名空间任务（D5）。验证：`tests/cluster/planner.test.ts`「不越权」例 —— 同时存在 `defend:<room>` 任务时不被取消

## 3. 防御系统装配（补齐缺失入口）

- [x] 3.1 新增 `src/modules/defense/index.ts`：`defenseModule`（`phase:"emergency"`、`band:"P0"`、名 `defense-planners`），编排 `updateRoomThreat` → `planDefenseRoom` → `assignTowers`（经共享 broker 提交塔行动）→ `foldTowerSpend`。验证：`tests/defense/module.test.ts`（3 例）覆盖无威胁纯 no-op、有威胁产出任务、塔消耗入账
- [x] 3.2 抽出 `src/modules/agents/sharedBroker.ts`（`ensureBroker` + `TRANSIENT_REPLAN_REASONS`），供 defense 与 agents 共享同一 broker 实例，消除循环依赖。验证：类型检查通过；`tests/agents/*` 不回归
- [x] 3.3 `src/modules/index.ts` 在 perception 之后注册 `defenseModule`。验证：装配顺序单测 / 冒烟 —— emergency 阶段模块存在且先于 strategy

## 4. 防御 → 编队需求接线

- [x] 4.1 `src/modules/defense/planners.ts`：tier=high 分支由「直接建单条 defend 任务」改为 `requestSquad()`；tier=low 路径保持不变。验证：`tests/defense/planners.test.ts` 升级场景断言 `takeSquadRequests()` 有值且旧任务被取消
- [x] 4.2 清理循环限定 `defend:<room>` / `retreat:<room>` 前缀，与集群命名空间隔离（D5）。验证：`tests/defense/planners.test.ts` + `tests/cluster/planner.test.ts` 双向不越权
- [x] 4.3 `src/config/cluster.ts` 新增 `CLUSTER_CONFIG`（`maxSquads`/`maxSlotsPerSquad`/`maxPendingRequests`/`requestTtlTicks`/`priorityFloor`）；`src/config/defense.ts` 增 `TOWER_CONFIG.actionPriority`。验证：无硬编码魔数（lint/评审）；配置被模块引用

## 5. 单位层与观测

- [x] 5.1 `src/modules/agents/agentSystem.ts`（P1-4）：`nearestStore`/`nearestPile`/`fetchEnergy` 增可选 `anchor`，升级任务以 controller 为锚，`fetchScore = dist(creep,target) + dist(target,anchor)`。验证：`tests/agents/agentSystem.test.ts` 覆盖锚点偏好与在程 withdraw
- [x] 5.2 `src/modules/spawning/spawnDirector.ts`（P1-5/P1-6/P2-8）：岗位缺口与任务可用性解耦；清理 `Memory.creeps[dead]`；`replacementLead(..., creepName)` 确定性抖动 ±10%。验证：`tests/spawning/spawnDirector.test.ts`（含 P1-5/P1-6 新例）
- [x] 5.3 `src/core/boot.ts`：新增 `lastDefense`/`lastCluster` 快照与 `Nexus.defense()`/`Nexus.cluster()`，HUD 增防御/编队行。验证：`tests/core/bootSmoke.test.ts` 渲染不抛异常、快照可查

## 6. 文档与多 Agent 协作规范

- [x] 6.1 撰写 `docs/nexus-design/20-智能连结集群.md`：架构、组件、数据流、接口契约、关键决策 C1–C8、读取边界、进度表 §20.7.1、待办 §20.7.2、阻塞 §20.7.3、验收 §20.8。验证：文档与代码同 Tick 一致（评审）
- [x] 6.2 撰写 `CONTRIBUTING.md`：单一事实源表、文件归属、接口冻结、交接协议、DoD、冲突仲裁、bug/变更文档格式、分支提交规范、反模式。验证：评审通过
- [x] 6.3 更新 `docs/nexus-design/03-system-architecture.md`、`docs/nexus-design/19-智械连结扩展.md`、`docs/nexus-design/14-roadmap-acceptance.md`、`docs/api/API-REFERENCE.md`、`docs/bugs/sim-audit-2026-10-11.md` 反映编队层与防御装配。验证：交叉引用无断链
- [x] 6.4 全量回归：typecheck OK + build OK + `245/245` 测试通过（26 个测试文件）。验证：本地命令输出（见 §20.7.3 Windows 环境说明）

## 7. 实战验证（阻塞中，不勾选）

- [x] 7.1a **编队全链路集成测试（C1 的确定性替身）**：`tests/cluster/e2e.test.ts`（4 例）在真实 Tick 循环上串联 defense-planners(emergency) → cluster-squads(planning) → 任务认领，覆盖 C1 两条验收标准：① 高强度威胁建队后 slots 全部被认领（成员回填 = slots）；② 威胁衰减后编队解散且槽位任务全部 cancelled；另含低强度不建队、重载自愈两例对照。验证：`vitest run tests/cluster/e2e.test.ts` 全绿
- [ ] 7.1b **sim 回归（docs/nexus-design/20 待办 C1）**：高强度威胁场景下编队建队 → 成员分配 → defend 执行；威胁衰减后编队解散且槽位任务 cancelled。验证：`nexus-sim` 跑场景 JSON + 回归记录。**阻塞**：~~`sim/` 的 `v8` crate 需 `librusty_v8.a`——GitHub Release 不可达（HTTP 000）、npmmirror 无镜像、源码构建需 clang（本机无）~~【2026-10-15 收口】该阻塞记录已过期：回归制现为 `npm run sim`（screeps-sim 包 + `.sim.ts` 用例驱动，见 fix-p1-14-rush-sprint §7.2）；本项改为与 P1-14 验收门的 sim 时序**排期冲突**，尚未安排，本轮不勾销。
- [ ] 7.2 **私服落地验证（docs/nexus-design/20 待办 C2 / W5N8）**：落地新代码 → 轮询 Memory 观察 `Nexus.cluster()` 可查、编队生命周期无异常。验证：`submit.js 47.100.24.220@Nexus` + API 取证
> **§7.3 编队收益指标（docs/nexus-design/20 待办 C6）已由 `harvest-income-and-squad-capabilities` §3.3 承接**（C6 的主责留档处为该族，其 delta spec 为 `squad-coordination-metrics`），本族不再留同门待办。验收标准原文保留：协同前后战损/击杀对比入 telemetry，作为「智能」上线的证据；验证为指标可查询、有对照数据。【2026-10-15 落地事实】`src/modules/cluster/benefit.ts` 按房定长记录协同窗口与基线窗口的 kills/losses/memberTicks 三对对照值（基线取编队建立前的等长窗口），经 `query.squadBenefit()` 与状态面板取证；协同总闸 `CLUSTER_CONFIG.benefit.enabled` 默认关闭，净收益达标方放行。

## 8. 后续扩展（本变更范围外，登记于 docs/nexus-design/20 §20.7.2）

> **2026-10-15 收口**：C3/C4/C5 的主责族为 `harvest-income-and-squad-capabilities`（delta spec `squad-heterogeneous-slots` / `squad-coordination-metrics`）。本族仅保留指针与验收标准原文，不再留重复待办；当前落地状态逐条列于下方，勾销与推进均在主责族内进行。

- **§8.1 异构槽位（C3）**：`SquadRecord.slots` 由数量升级为槽位定义数组，支持矿工+搬运+护卫混合编队。【2026-10-15 状态】结构侧已落地于主责族（`CURRENT_SCHEMA_VERSION` 10→11、旧标量槽位按同质定义展开的幂等迁移、`cluster/model.ts` 数组口径 helper、`cluster/index.ts` 遍历与解散按命名空间取消、`statusPanel.ts` 展示适配）；混合编队的实例化随 C5 需求方接入（见下条），验收仍以主责族 §2.x 为准。
- **§8.2 编队内领队逻辑（C4）**：集火/拉扯，编队级共享目标；不越过 ActionBroker，需指标证明收益。【2026-10-15 状态】未落地，主责项为 `harvest-income-and-squad-capabilities` §4.1（共享目标写入编队记录、只影响目标选择、编队层零游戏 API 调用、随解散清除）。
- **§8.3 外矿协作组（C5）**：`SquadKind = "remote"`，schema v7 + 需求方接入。【2026-10-15 状态】schema 侧已落地于主责族（v10→v11，`SquadKind` 联合类型含 remote，旧编队记录随迁移清洗）；需求方接入与净收益为正的开启判据未落地，主责项为 `harvest-income-and-squad-capabilities` §4.2（开启判据挂 §3.3 的收益指标，指标为负或缺失时保持关闭）。
