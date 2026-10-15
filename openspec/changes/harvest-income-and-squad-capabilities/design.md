# Design

## Context

见 proposal.md - Why。此处只记录约束方案选择的现状事实。

**采集侧现状**（三条并存的编制事实）：

| 路径 | 采集定编口径 | 体型来源 |
|---|---|---|
| `spawnDirector.unitTargets.harvester` | `Math.max(1, sources + remoteHarvest)` | `bodyFactory` → `buildRushHarvesterBody`（按容量定档） |
| legacy `UnitSpawnCheck.harvester` | `getHarvesterTargetBySource`（等级表 + 源旁可站位 + WORK 折算） | `UnitLevelData` 等级表（RCL2=[W3,C1,M1] / RCL3=[W5,C1,M3]） |
| `productionGate.harvesterTargetTotal` | `room.sources.length`（每源一驻点） | 不涉及体型 |

docs/bugs 2026-10-15(三) 留档的实测结论：新孵化器口径算出 2 只，实际采集舰队由 legacy 供给；两套口径互不知情。

**集群侧现状**：`SquadRecord.slots` 为标量 `number`，`capabilities`/`taskKind` 为编队级单值，故同质编队。`SquadKind = "defense"` 单一类型。消费面收敛——`slots`/`capabilities`/`taskKind` 的读取点仅 4 处文件（`cluster/index.ts`、`cluster/model.ts`、`visuals/statusPanel.ts`、`defense/planners.ts` 写入侧），C3 改造面可控。当前 `CURRENT_SCHEMA_VERSION = 10`。

**纪律约束**：docs/bugs 留档的校准史显示本问题域**单杠杆改动必被反噬**（六轮实验中紧急降档下限、urgent 门槛、专线提权、攒能超时等单独调整全部为负）。因此本设计不接受单点补丁，要求成套同拍落地并逐轮 A/B 留档。

## Goals / Non-Goals

**Goals:**

- 采集面供给收敛为 workforce 单一事实来源，两条孵化路径消费同一编制结果，消除双轨分治。
- 采集体型按「有无在岗采集收入」分档定档，消除涓流期 1-WORK 废体与换代断采。
- 编队槽位支持异构分化（C3），并为领队协调（C4）与外矿协作（C5）留出承载结构。
- 编队收益进入 telemetry（C6），使「智能」有证据可依。
- 明确子代理并行开发的功能域边界与串行依赖。

**Non-Goals:**

- 不引入第二套采集分配器；不重写 legacy 孵化器整体，只做采集角色的让位契约。
- 不实现跨 shard 迁移、动作兼容矩阵、Goal Board 等 docs 中其他域的待办。
- 不做私服实测验收（见 proposal 范围外）。
- 不在本次解决 P1-14 之外的缺陷；新发现缺陷按 AGENTS.md 追加到 docs/bugs 而非就地扩范围。

## Decisions

### D1：采集定编单一来源 = workforce，legacy 降级为兜底

**决策**：以 `productionGate.harvesterTargetTotal`（每源一驻点）为编制事实来源，扩展到 workforce 统一导出；`spawnDirector.unitTargets.harvester` 改为消费该值，不再自算 `max(1, sources)`。legacy `UnitSpawnCheck.harvester` 保留发单能力，但增加前置条件：**仅当新链路未产出采集缺口时**才发单（兜底而非并列供给）。

**理由**：留档证据表明 legacy 等级表体型本身不差（RCL3=[W5,C1,M3]），问题在两套编制并存导致供给与孵化错配。保留 legacy 兜底可避免收敛过程中出现收入断档——docs/bugs 2026-10-14(二) 记录过「预置 cc 使 control 2.3×」这类单点改动被其他瓶颈吞没的教训，收敛必须容错。

**备选方案**：(a) 直接删 legacy 采集发单——风险是收敛期若 workforce 判定有误则采集面归零，触发 P1-10 那类降级螺旋；(b) 新链路设主、legacy 设从但保留独立口径——仍属双轨，未解决根因。均否决。

### D2：采集体型收入感知定档（有收入按容量 / 无收入保 2-WORK 底线）

**决策**：采集体型的预算口径按房间是否有在岗采集收入分档：
- **有收入**：按 `energyCapacityAvailable` 定档（现状），攒能升体型；
- **无收入**：预算取 `max(energyAvailable, 起步预算)`，且体型下限为 2-WORK（250 能量），即无收入时不降出 1-WORK。

**理由**：docs/bugs 2026-10-15 校准实录明确记载——W2 硬底线一刀切为负（remote-mine 人口 13→11，涓流期换代断收入），正解是「收入感知体型」；同批实验亦记载「采集换代免等待」为负（换代即时化让孵化槽被抢占）。故下限必须**条件化**而非全局硬门。

**备选方案**：(a) 全局 2-WORK 底线——已实证为负；(b) 采集换代免等待——已实证为负；(c) 提权至 urgent 线——已实证为负。均已留档否决，不重复实验。

### D3：legacy 让位用配置闸门而非删代码

**决策**：新增 `SPAWN_CONFIG.legacyHarvestStandby`（默认启用兜底），legacy 采集发单增加「workforce 已满足编制则不发单」的前置判定。legacy 代码路径保留，不删除。

**理由**：AGENTS.md 禁止擅自扩大范围；legacy 孵化链还承载 universal/worker/carrier 等角色，本次只收采集。配置闸门让回退只需改一个开关，便于 sim A/B。

### D4：C3 槽位结构 = 数组，但保留 `slots` 标量作为派生只读

**决策**：`SquadRecord.slots` 由 `number` 改为 `SquadSlotDef[]`（`{ taskKind, capabilities, count }` 形态，编队级 `taskKind`/`capabilities` 降为默认槽位定义，保留于 schema 供迁移与消费方回退）。消费方 `cluster/index.ts` 的槽位循环、disband 的 dedupeKey 生成、`statusPanel` 展示行改为遍历数组。

**理由**：异构编队需要每槽位独立的 `taskKind`+`capabilities`；保留 `slots` 标量会让 schema 双写易漂移。消费面仅 4 处文件，直接改造比引入适配层更符合「拒绝过度工程化」。迁移需把旧 `slots: n` 展开为 n 个同质槽位，保持续期语义不变。

**备选方案**：`slots: number` 保留 + 增 `slotDefs?` 可选字段——双写两处真相，违背 CONTRIBUTING §2.2 单一事实源。否决。

### D5：C4 领队逻辑经 ActionBroker，禁止旁路

**决策**：领队级共享目标写入 `SquadRecord.sharedTarget`，由 AgentSystem 读取后**仍经 ActionBroker 提交意图**；编队层不直接调用游戏 API。领队目标只影响**目标选择**，不影响单位行动路径（成员仍执行普通任务）。

**理由**：`docs/nexus-design/20` 既有 spec 已定「集群零游戏 API 调用」为不变量，且留档要求「不越过 ActionBroker」。C4 前置依赖 C3（异构槽位才有领队意义）。

**收益门**：按 `docs/nexus-design/02` 原则 F，C4/C6 的收益指标未达正收益则**不保留该行为**（配置默认关闭，指标达标后再开）。这是留档的硬要求，不是可选项。

### D6：C6 指标入 telemetry，基线取编队建立前窗口

**决策**：编队收益指标记入 `metrics`（协同前后战损/击杀/存活时长对比），基线窗口取编队建立前的同房等长窗口。C4/C5 的开启条件挂钩该指标。

**理由**：留档要求「无证据的智能不上线」；指标必须能在 sim 中取证，否则无法作为开关判据。

### D7：子代理并行轨道与冲突矩阵

**决策**：按**文件写入集合不相交**切分并行轨道，同 track 内串行。

| 轨道 | 范围 | 写入文件（独占） | 依赖 |
|---|---|---|---|
| **T1** | 采集供给收敛 + 体型定档 + P1-14 验收 | `spawnDirector.ts`、`legacy/spawnRules.ts`、`economy/workforce.ts`、`productionGate.ts`、`utils/rushBodies.ts`、`spawning/bodyFactory.ts`、`config/economy.ts` | 无（可立即开工） |
| **T2** | C3 异构槽位 + schema 升版迁移 | `store/memorySchema.ts`、`cluster/model.ts` | 无（可与 T1 并行） |
| **T3** | C3 消费侧适配 + C6 telemetry | `cluster/index.ts`、`visuals/statusPanel.ts`、`core/metrics.ts`、`config/cluster.ts` | T2（须待 schema 变更落地） |
| **T4** | C4 领队 + C5 外矿协作 | `cluster/` 内领队协调、`config/cluster.ts` 的编队类型部分、`store` 迁移的 remote kind | T2 + T3 |

**冲突判定**：`config/cluster.ts` 被 T3 与 T4 同时需要 → 拆分为「T3 写槽位/指标参数，T4 只追加编队类型与领队参数」的顺序约束；`store/memorySchema.ts` 仅 T2 写，T4 只提迁移需求给 T2，不并行改。`src/core/world.ts` 的 `harvestIncomeOf` 被 T1 独占，**不得由其他轨道并发修改**。

**并行前提**：T1 与 T2 可真正并行（文件集不相交）；T3/T4 因 schema 与 cluster 消费面重叠，必须串行接续。若 T2 未完成，T3 不得开工。

## Risks / Trade-offs

- **[收敛期采集断档]** → legacy 兜底闸门（D3）默认启用；sim 四场景（sprint/boot/remote-mine/arena）逐场景断言采集利用率与 RCL 时间线，任一劣化即回退该轨道。
- **[单杠杆反噬（历史高发）]** → T1 内三项改动（定编合一/体型分档/兜底闸门）**必须同拍落地**，禁止拆成三次提交分别 A/B；校准结论按 docs/bugs 既有格式留档。
- **[schema 结构变更致旧编队记录失效]** → 迁移把旧 `slots: n` 展开为 n 个同质槽位，`expiresAt` 与 `members` 不动，保证续期语义与在编成员不变；迁移幂等，坏条目回退默认空编队而非抛错。
- **[消费面漏改致展示或维护异常]** → `slots`/`capabilities`/`taskKind` 读取点已穷举为 4 处文件（`cluster/index.ts`、`model.ts`、`statusPanel.ts`、`defense/planners.ts`）；T3 需 grep 复核零残留标量用法。
- **[C4/C5 无收益反而劣化]** → 收益门默认关闭（D5/D6），指标为负则不保留；这是 docs/nexus-design/02 原则 F 的直接要求。
- **[私服未验证的声明风险]** → 本次仅 sim 回归，不做性能或榜单口径的对外声称（沿用 docs/nexus-design/14 第 69 行口径约束）。
- **[并行轨道写冲突]** → 以 D7 文件独占表为准；越界修改需先与对应轨道 owner 协调，禁止各轨道自行改 schema 或 shared 收入口径。

## Migration Plan

1. **T1 先落地并自测**：采集供给收敛 + 体型分档 + 兜底闸门同拍，跑 sim 四场景；sprint 达 `rclReachedBy 4 @40000` 则勾销 P1-14，否则按校准史继续成套迭代（不在本次变更内承诺达成）。
2. **T2 schema 升版**：新增 `SquadSlotDef`，`CURRENT_SCHEMA_VERSION` 10 → 11，迁移展开旧标量槽位；迁移幂等用例以 node 直跑验证。
3. **T3 消费侧 + C6 指标**：槽位遍历改造 + telemetry 采集；grep 复核标量用法零残留。
4. **T4 领队 + 外矿协作**：在 C3/C6 就位后开工，收益门默认关闭。
5. **回滚策略**：T1 通过 `legacyHarvestStandby` 单开关回退；T2-T4 为加法式变更，回滚即关闭对应配置开关 + schema 迁移保持向后兼容（旧版本读到数组需容错——按当前 schema 迁移惯例以 `satisfies` + 清洗兜底处理）。

## Open Questions

- 采集体型「无收入」判定用 workforce 在岗收入现算还是 spawn 局部口径：留待 T1 实现时以实测数据决定（二者差异需源饱和分解数据支撑，见 specs `harvest-supply-convergence`）。
- C4 领队目标的具体表达形态（共享目标点 vs 目标 id 集合）：由 T4 在 C3 数据结构确定后收敛，不影响 specs 需求。
- C5 外矿协作组的净收益判据阈值：留 docs/nexus-design/10 落地后校准，本次只要求「净收益为正」这一方向性判据。