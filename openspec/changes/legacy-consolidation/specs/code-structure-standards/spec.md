# Spec Delta

## Purpose

把「高内聚、低耦合」落成可度量的工程公约：文件规模上限与拆分判据、模块依赖方向、类型门禁与 `any` 预算、拆分的零行为变化约束。本 spec 钉死**度量口径**（怎么数行、怎么数 any、白名单怎么登记）、**依赖方向断言的精确规则**与**每个巨型文件的拆分边界**，实施会话 MUST 按同一口径执行，MUST NOT 现场发明度量方式或拆分方案。

## ADDED Requirements

### Requirement: 单文件规模上限与拆分判据

单个源码文件（`src/**/*.ts`，不含 `.d.ts`）MUST 不超过 **600 有效行**。有效行口径固定为：非空行且非纯注释行（块注释与行注释整体不计），由 `scripts/structure-guard.mjs` 统一实现。纯数据表与纯类型声明文件 MAY 豁免，豁免 MUST 逐条登记于 structure-guard 白名单（含文件路径与豁免理由），白名单外超限即红。初始白名单固定为：`src/constant/ResourceConstant.ts`（资源常量数据表）、`src/config/economy.ts`（经济常量数据表）、`src/types/*.d.ts`（类型声明，天然豁免不计入扫描）。

现有超限文件的拆分边界固定如下（拆分 MUST 按此边界，MUST NOT 任意切）：

| 文件（现状行数） | 拆分边界 | 薄装配层保留物 |
|---|---|---|
| `modules/movement/index.ts`（3343） | 路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动 六模块 | 三入口签名（`preTickBetterMove`/`endTickResolve`/moveTo 挂载）与模块参数 |
| `modules/agents/agentSystem.ts`（1727） | `runCreep` 按 task kind 拆 handler（scout/harvest/carry+fill_spawn/upgrade/build/repair/claim/reserve/defend/retreat 各自单元）+ 公共取料送货辅助独立 `logistics` 模块 + 远程采集族（remoteHarvest/remoteCarry/relay 接力）独立 `remote` 模块 | `runAgents` 签名与所有权登记主循环 |
| `modules/teams/core/TeamAction.ts`（1806） | 队形集结（Gather 族）/ 移动执行（move/QuadMoveTo/LinearMove）/ 代价矩阵（getMoveAbleCostMatrix 族）/ 路径缓存（checkCachePath 族）四域 | `TeamAction` 命名空间整体导出（调用方零改动） |
| `modules/planner/dynamic/63Planner.ts`（1183） | `ensurePlannerState` 与 `autoPlanner63` 各规划阶段按步骤拆分 | 两导出的签名 |
| 其余 >600 行非白名单文件（`moveMatch.ts`/`rosManor.ts`/`TeamSpawner.ts`/`statistics.ts` 等） | 按同一内聚判据（一个文件一个职责）逐个拆分 | 对外导出面不变 |

#### Scenario: 超限文件被标记

- **WHEN** 运行 structure-guard 规模扫描
- **THEN** 白名单外超限文件逐个列为红项，输出有效行数

#### Scenario: 拆分边界被执行

- **WHEN** B 波拆分 `movement`/`agentSystem`/`TeamAction`/`63Planner`
- **THEN** 产出的模块划分与上表边界一致，表内文件零逻辑改动混入

#### Scenario: 拆分后公共面不变

- **WHEN** 任一巨型文件完成拆分
- **THEN** 对外导出集合与拆分前等价（导出面 diff 为空），调用方零改动

#### Scenario: 白名单新增需登记理由

- **WHEN** 后续某数据表文件超限且申请豁免
- **THEN** 白名单新增行含路径与理由，否则守护红

### Requirement: 模块依赖方向断言

依赖方向断言的精确规则固定为（均按 import 说明符静态解析，`@/` 前缀绑定 `src/`）：

1. `src/core/**` MUST NOT import `src/modules/**`、`src/proto/**`、`src/console/**` 的任何符号（既有 `endPhase.ts` 等业务 import 链按现状留档，B 波只冻结不新增，清理由后续变更承担）；
2. `src/modules/**` MUST NOT import `src/console/**`；
3. `src/modules/**` 对 `src/proto/**` 的 import MUST 限定在白名单纯库面：`proto/index.ts` 导出的 `ensureMemoryCache`/`clearMemoryCache`/`getBoostCache`/`evaluateSourceWorkTiles` 及 `proto/` 内部文件中被登记为纯库（无游戏 API 突变）的导出；A 波完成后该白名单 MUST 收缩为实际存活的纯库面；
4. `src/runtime/**`、`src/modules/**` 之间允许正向（runtime 被 modules 消费），`src/branch/**` 只被构建入口引用；
5. 违规 import 即 structure-guard 红项，输出文件、说明符与命中的规则编号。

#### Scenario: 反向依赖被拒

- **WHEN** 新增一条 `core/` → `modules/` 的 import
- **THEN** structure-guard 红，要求改为依赖注入或事件回写

#### Scenario: proto 非白名单引用被拒

- **WHEN** 某模块 import `proto/` 白名单之外的符号
- **THEN** structure-guard 红，列出该符号与白名单内容

#### Scenario: 既有违规只冻结不新增

- **WHEN** B 波运行守护
- **THEN** 留档的既有违规数量不增加（新增即红），存量清零进度另行跟踪

### Requirement: 源码禁止类型逃逸标记

全部 `src/**/*.ts`（不含 `.d.ts`）MUST NOT 包含 `@ts-nocheck`。清零路径固定为逐文件小步：单文件移除标记 → 修复类型错误（只做类型收窄与显式判空，不改运行逻辑）→ `npm run typecheck` 绿 → 全场景门逐位 → 下一文件。`noUncheckedIndexedAccess` 收紧处的访问改写 MUST 显式判空，MUST NOT 用 `!` 断言或 `as any` 逃逸。35 个文件的目标清理顺序固定：`modules/planner`（13 文件）→ `modules/visuals`（3）→ `modules/teams`（4）→ `modules/movement`（2）→ `proto/`（8，A 波收缩后余量）→ 其余（5）。

#### Scenario: 新增逃逸标记被拒

- **WHEN** 任一源文件新增 `@ts-nocheck`
- **THEN** structure-guard 红（计数检查点不得增加）

#### Scenario: 清零后类型检查通过

- **WHEN** 35 文件全部清零
- **THEN** `npm run typecheck` 绿且全场景门逐位一致

#### Scenario: 断言逃逸被拒

- **WHEN** 类型修复引入 `!` 断言或 `as any` 使 `any` 检查点回升
- **THEN** structure-guard 红，要求改为显式判空或 `unknown` + 收窄

### Requirement: 宽类型预算单调下降

显式 `any` 的计数口径固定为：正则匹配源码中的类型位置 `any`（`: any`、`as any`、`<any>`、`any[]`、`any>`），由 structure-guard 实现并输出总数；检查点存于 `config/code-quality.json`。规则：总数对检查点单调不增；一次改动使总数下降时 MUST 同批推进检查点；`as any` 计入 any 同时单独计数（`as any` 优先清理）。清理顺序固定按域：`modules/planner` → `modules/movement` → `modules/teams` → `modules/visuals` → `proto` → `console` → `core` → `utils`。终态数值不设硬性截止（自然收敛），但 B 波收口 MUST 低于初始基线（466）的既定比例目标 ≤150 或实际收敛值。

#### Scenario: 新增 any 被拒

- **WHEN** 某改动使 any 总数超过检查点
- **THEN** structure-guard 红，该改动被拒绝

#### Scenario: 清理推进检查点

- **WHEN** 一次改动降低 any 总数
- **THEN** 检查点同批推进到新值，后续不得回升

#### Scenario: 域序执行

- **WHEN** B 波类型清理实施
- **THEN** 清理顺序与本条规定的域序一致，跨域乱序清理被拒绝

### Requirement: 结构拆分不改变可观测行为

拆分与类型化 MUST 保持可观测行为不变，判定口径全变更统一：

- 公共导出面 diff 为空（拆分前后对 `src/` 全仓的导出集合快照对比）；
- 模块装配清单与注册顺序不变（`main.ts` / 变体入口的 `nexus.use` 序列逐项相同）；
- 提交时序契约不变：`preTickBetterMove` → 各阶段 commit → `endTickResolve` 在同一 tick 内按原序执行，movement 拆分 MUST NOT 移动这三个调用的相对位置；
- 全场景门绿门逐位一致 + cpu p95 不劣化 >2ms；
- 拆分 PR MUST 零逻辑改动混入（diff 仅 import 重排、代码搬移、类型标注）。

#### Scenario: 拆分后场景门逐位一致

- **WHEN** 任一拆分切片完成
- **THEN** sim-matrix 绿门 RCL 时间线与快照逐键相等，p95 劣化 ≤2ms

#### Scenario: 时序契约不可破坏

- **WHEN** movement 拆分重排了三入口调用序
- **THEN** 即使场景门偶然通过也判定违规（run-residue / stronghold-door 必须单独跑绿作时序旁证）

#### Scenario: 零逻辑改动混入

- **WHEN** 审查一个拆分 PR 的 diff
- **THEN** 除搬移/导入/类型标注外无其他变更行
