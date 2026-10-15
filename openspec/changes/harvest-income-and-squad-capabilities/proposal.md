# Proposal

## Why

P1-14（沼泽地形经济低均衡陷阱）是当前唯一未修复的 P1 缺陷：rcl-sprint 场景采集利用率不足、升级吞吐塌陷，`rclReachedBy 4 @40000` 断言不过。经六轮成套校准，docs/bugs 已把根因定位到**双孵化器分治**——采集舰队实际由 legacy 孵化器按等级表供给，而新孵化器 `spawnDirector` 另有一套独立的采集定编（`max(1, 源数)`），两套口径互不知情，收入 ~6/t 与满产 20/t 的差距不在单体体型旋钮，而在供给口径分裂与采集工在源时间占比。

同时 `openspec/changes` 尚有 16 条待办未收口，其中集群能力扩展（`docs/nexus-design/20` §20.7.2 C3/C4/C5/C6）因该硬门一直搁置。约束解除后需与 P1-14 一并推进，但两者分属经济与集群两个功能域，须严格隔离范围。

## What Changes

### 主线 A：P1-14 采集供给收敛

- **采集定编口径统一到 workforce**：取消 `spawnDirector.unitTargets.harvester` 的 `max(1, 源数)` 独立口径，改由 `workforce` 的源饱和定编（每源一驻点 + 攒能升体型）单一来源供给，两条孵化路径共用同一编制事实。
- **legacy 孵化器让位**：legacy `UnitSpawnCheck.harvester` 不再按等级表独立发单，改为消费 workforce 定编结果；保留其作为**过渡期兜底**（workforce 未就绪或新链路异常时），避免收入断档。
- **采集体型收入感知定档**：采集体体型预算按「是否有在岗采集收入」分档——有收入时按容量定档（攒能升体型），无收入时按 `max(存量, 起步预算)` 且保 2-WORK 底线，避免涓流期降出 1-WORK 废体（docs/bugs 已留档：W2 硬底线一刀切为负，正解是收入感知）。
- **源饱和口径实测分解**：按源记录采集工时间去向（在源 / 往返 / 等待），作为定编调参的证据口径。
- **勾销 P1-14**：`rclReachedBy 4 @40000` 通过后，在 docs/bugs 勾销并附 sim 证据。

### 主线 B：集群能力扩展（C3/C4/C5/C6）

- **C3 异构槽位**：`SquadRecord.slots` 由标量升级为槽位定义数组，支持矿工+搬运+护卫混合编队按槽位分化。
- **C4 编队领队逻辑**：编队级共享目标（集火/拉扯），**不越过 ActionBroker**，须有指标证明收益才保留。
- **C5 外矿协作组**：`SquadKind` 扩展为 `"remote"`，schema 升版 + 需求方接入。
- **C6 编队收益指标**：协同前后战损/击杀对比入 telemetry——按 `docs/nexus-design/02` 原则 F，无证据的「智能」不上线。

### 范围外

- 私服实测（C2 / fix-p1-14 7.5 / fix-p1-10 7.6 / workforce 5.5 / phase3 7.2+7.3）：需真实服 47.100.24.220 且 4wt 自动重开，本次不纳入，保持未勾选。
- 集群 C1（编队 sim 回归）：与 P1-14 验收门争用 sim 运行时序，另行安排。

## Capabilities

### New Capabilities

- `harvest-supply-convergence`: 采集面供给的双轨合一——采集定编的单一事实来源、legacy 孵化器让位契约、采集体型收入感知定档、源饱和口径实测分解。补齐 `workforce-staffing` 未覆盖的**采集侧编制与体型**（该 spec 现仅覆盖升级 WORK 目标、carrier 运力定编、采集收入现算与饥饿负反馈）。
- `squad-heterogeneous-slots`: 编队异构槽位——槽位从数量标量升级为带 `taskKind`/`capabilities` 的定义数组，槽位级任务分化与生命周期（新增/收缩/解散）的一致性。
- `squad-coordination-metrics`: 编队协同行为与收益证据——领队级共享目标的表达方式与「不越过 ActionBroker」的边界约束，以及战损/击杀对比的 telemetry 采集口径。

### Modified Capabilities

- `cluster-squad`: 「编队只持有槽位，成员由任务反填」需求的槽位形态从**数量标量**改为**槽位定义数组**（`SquadRecord.slots` 结构变化，成员反填与生命周期不变量不变）；`SquadKind` 从单一 `"defense"` 扩展为可扩展联合。保留「增删编队类型不改动分配器」「命名空间隔离」「解散取消而非释放」等既有不变量。

## Impact

- **代码**：
  - `src/modules/spawning/`（`spawnDirector.ts` 采集定编、`legacy/spawnRules.ts` legacy 让位）
  - `src/modules/economy/workforce.ts`（采集侧定编单一来源）、`src/utils/rushBodies.ts` + `src/modules/spawning/bodyFactory.ts`（采集体型收入感知定档）
  - `src/core/store/memorySchema.ts`（`SquadRecord.slots` 结构变更、`SquadKind` 扩展、schema 升版与迁移）
  - `src/modules/cluster/`（`model.ts` 槽位模型、`index.ts` 维护与领队协调）
  - `src/core/metrics.ts` + `src/modules/cluster/index.ts`（C6 telemetry）
- **配置**：`src/config/economy.ts`（采集定编与体型档参数）、`src/config/cluster.ts`（槽位/领队/编队类型参数），零硬编码。
- **Memory schema**：`SquadRecord.slots` 标量 → 数组为**结构变更**，需升版迁移（旧编队记录按同质槽位展开为等长数组，保持续期语义不变）。
- **回归**：sim `rcl-sprint`（P1-14 验收主线：RCL4@40000 / cpuP95<20 / noErrors）、`boot-from-scratch`、`remote-mine`、`arena`（4 场景不得回退）。
- **文档**：docs/bugs P1-14 勾销附证据；docs/nexus-design/14 进度快照；docs/nexus-design/20 §20.7.2 C3-C6 勾销。