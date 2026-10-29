# Spec Delta

## Purpose

把 B 波结构治理（巨型文件拆分 + 类型门禁清零）与 A 波收口对账落成可执行契约：以 2026-10-27 基线（9 个超限文件、31 个 `@ts-nocheck`、684 处显式 `any`、豁免 88 条）钉死拆分边界、清理域序、检查点推进与波间闸门。实施会话 MUST 按同一口径执行，MUST NOT 现场发明度量方式、拆分方案或清理顺序。

## ADDED Requirements

### Requirement: 豁免清单对账口径（A 波收口）

豁免清单当前 88 条 MUST 按两类归口对账，对账结论落台账：

1. **冲级赛直通隔离区（28 条）**：`branch/race/speedrun` 主链化带来的直通豁免，身份为物理隔离区（上游单文件血统，与 Nexus 命令管线互不渗透），作为独立类目登记，不受 ≤60 闸门约束，但 MUST 受单调约束（只减不增）；
2. **非赛条目（60 条）**：每条 MUST 归口三类之一——有接管计划的待收编轨道 / 永久豁免（人操、broker 执行层、移动适配层等结构性直连）/ 随 C 波删除自然消失（与 `dormant-code-retirement` 清单联动）。非赛条目总数 MUST ≤60 且随 C 波完成单调下降。

对账时 MUST 逐条核对 track 注记与实际调用状态一致（在-call），无「无主」条目；checkpoint（`config/arch-allowlist.min.json`）随对账推进。

#### Scenario: 对账后无无主条目

- **WHEN** A 波收口对账完成
- **THEN** arch:guard --report 输出的每条豁免都有明确类目与 track 注记，无待处置项

#### Scenario: 赛区豁免不占闸门额度

- **WHEN** 统计豁免总数
- **THEN** 28 条冲级赛直通条目单列，≤60 闸门只考核非赛 60 条

#### Scenario: C 波联动收缩

- **WHEN** dormant-code-retirement 清单第 1 项删除完成
- **THEN** 与 external/mine 链关联的豁免条目同批摘除，非赛条目数下降

### Requirement: 单文件规模上限与拆分边界

单个源码文件（`src/**/*.ts`，不含 `.d.ts`；speedrun 隔离区不参与计量）MUST 不超过 **600 有效行**（口径：非空行且非纯注释行，由 `scripts/structure-guard.mjs` 统一实现）。现有 9 个超限文件的拆分边界钉死如下（有效行数为 2026-10-27 基线实测，拆分 MUST 按此边界，MUST NOT 任意切）：

| 文件（有效行） | 拆分边界 | 薄装配层保留物 |
|---|---|---|
| `modules/movement/index.ts`（2483） | ~~路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动 六模块~~ **裁定不拆（2026-10-29）**：46 函数经 40+ 模块级共享可变绑定强制连通（ES import 只读），六模块与零变更行条款互斥——structure-guard 白名单登记，状态命名空间化后另立变更 | 三入口签名与时序/挂载点保持不动（本变更零触碰） |
| `modules/agents/agentSystem.ts`（1648） | `runCreep`（484 行）按 task kind 拆 handler 单元（scout/harvest/carry+fill_spawn/upgrade/build/repair/claim/reserve/defend/retreat）+ 公共取料/送货辅助独立 `logistics` 模块 + 远程采集族（remoteHarvest/remoteCarry/relay 接力）独立 `remote` 模块 + rush-courier 族（runCourierCreep/submitCourier*）独立 `courier` 模块 | `runAgents` 签名与所有权登记主循环 |
| `modules/teams/core/TeamAction.ts`（1284） | 队形集结（Gather 族）/ 移动执行（move/QuadMoveTo/LinearMove）/ 代价矩阵（getMoveAbleCostMatrix 族）/ 路径缓存（checkCachePath 族）四域（移动执行域 798 有效行超 600 上限，域内二分为 move+direction 两文件——边界内最小调整，2026-10-29 实现注记） | `TeamAction` 命名空间整体导出（调用方零改动） |
| `modules/agents/actionBroker.ts`（997） | 类型契约（ActionKind/Payload/Result/Deps 接口族）/ creep 管线执行器（case 表 combatMove 之前）/ structure+flag 执行器（executeStructureAction/executeFlagAction 及 case 表）/ broker 核心与共享单例（createBroker/getSharedBroker/executeNow） | 全部导出名与 `ActionBroker` 接口不变 |
| `modules/planner/dynamic/63Planner.ts`（898） | `ensurePlannerState` 与 `autoPlanner63` 各规划阶段按步骤拆分 | 两导出的签名 |
| `proto/Room/function/baseFunction.ts`（724） | 按成员函数职责域拆（结构扫描/能量路由/道路联动等，以类聚合拆 mixin 单元，`AddList` 类纯函数随迁） | `export default class BaseFunction` 聚合面不变（proto/Room/index.ts 的 extend 链零改动） |
| `modules/planner/dynamic/rosManor.ts`（717） | 庄园几何计算按内聚判据拆（槽位偏移表/庄园核/候选评估） | `computeManor`/`MANOR_SPAWN_CHEBYSHEV` 导出面不变 |
| `modules/spawning/spawnDirector.ts`（619） | 主排程（runSpawnDirector）/ directSpawn 面板 / race 远程定编族（raceRemoteDeficitOf/raceRemoteRequests）拆分 | 三组导出签名不变 |
| `modules/external/mine/state.ts`（605） | 不拆分——C 波删除对象，白名单登记豁免 | （C 波整文件删除，白名单行同步摘除） |

#### Scenario: 拆分边界被执行

- **WHEN** B 波拆分上表文件
- **THEN** 产出的模块划分与表内边界一致，拆分提交内除搬移/导入/类型标注外无其他变更行

#### Scenario: 拆分后公共面不变

- **WHEN** 任一文件完成拆分
- **THEN** 对外导出集合与拆分前等价（导出面 diff 为空），调用方零改动

#### Scenario: 超限清零

- **WHEN** B 波一完成
- **THEN** structure-guard 规模扫描白名单外超限文件数为 0（`mine/state.ts` 若未删则带白名单行）

### Requirement: 源码禁止类型逃逸标记

全部 `src/**/*.ts`（不含 `.d.ts`；speedrun 隔离区豁免为终态不计量）MUST NOT 包含 `@ts-nocheck`。清零路径固定为逐文件小步：单文件移除标记 → 修复类型错误（只做类型收窄与显式判空，不改运行逻辑）→ `npm run typecheck` 绿 → 全场景门逐位 → 下一文件。`noUncheckedIndexedAccess` 收紧处的访问改写 MUST 显式判空，MUST NOT 用 `!` 断言或 `as any` 逃逸。31 个文件（2026-10-27 实测）的清理顺序固定：`modules/planner`（13）→ `modules/visuals`（3，`highwayMine.ts` 依 dormant-code-retirement 定性结果处置）→ `modules/teams`（3）→ `modules/movement`（2）→ `proto/`（5）→ 其余（5：console/core/utils）。

#### Scenario: 新增逃逸标记被拒

- **WHEN** 任一源文件新增 `@ts-nocheck`
- **THEN** structure-guard 红（计数检查点不得增加）

#### Scenario: 清零后类型检查通过

- **WHEN** 31 文件全部清零
- **THEN** `npm run typecheck` 绿且全场景门逐位一致

### Requirement: 宽类型预算单调下降

显式 `any` 的计数口径固定为正则匹配类型位置 `any`（`: any`/`as any`/`<any>`/`any[]`/`any>`，`as any` 单独计数），由 structure-guard 实现输出总数；检查点存于 `config/code-quality.json`，每个清理切片推进一次且 MUST 单调不增（基线 684 / `as any` 471）。收敛顺序固定：planner → movement → teams → visuals → proto → console → core → utils；改精确类型或 `unknown` + 收窄。ts-nocheck 清零过程中暴露的 `any` 计入所在文件域序。目标检查点 ≤300（C 波删除自然带走的部分先于人工收敛生效）。

#### Scenario: 检查点单调不增

- **WHEN** 任一清理切片提交
- **THEN** 新检查点值 ≤ 上一检查点值，回升即 structure-guard 红

#### Scenario: 删除先于收敛

- **WHEN** C 波删除 external/mine 链
- **THEN** 其 any/占比随文件删除自然下降，检查点同批推进，不占用人工收敛工作量

### Requirement: B 波收口闸门

B 波完成 MUST 同时满足：structure-guard 全绿（600 行白名单外 0、ts-nocheck 0、any 达标、依赖方向零新增违规、词表三方一致绿）+ `npm run typecheck` 绿 + 全场景门 8 门逐位一致。此闸门是总验收前置。

#### Scenario: 三绿齐备才收口

- **WHEN** B 波二最后一个切片完成
- **THEN** `npm run structure:guard` + `npm run typecheck` + 全场景门三绿读数存档，缺一不得进入总验收

#### Scenario: 拆分零行为变化

- **WHEN** B 波任一拆分切片跑全场景门
- **THEN** 绿门场景 RCL 时间线与拆分前逐位一致（cpu p95 容差沿用 sim-matrix 规则），漂移即回退该切片
