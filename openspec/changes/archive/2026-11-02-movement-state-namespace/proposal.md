# Proposal: movement-state-namespace

## Why

`src/modules/movement/index.ts` 仍是全仓唯一被白名单豁免的 600 行超限文件（3343 原始行 / 2483 有效行，67 个顶层函数）。`legacy-consolidation-b` 任务 3.1 已实证它无法按原方案直接拆分：40+ 个模块级共享可变绑定（`globalPathCache`、`costMatrixCache`、`IntentTiles`、scratch 变量、统计变量等）把函数连成单一分量，而 ES module 导入绑定跨模块只读；直接搬函数会触发 `TS2539`，并破坏「拆分内除搬移/导入/类型标注外零变更行」的验证条款。用户裁定当时不拆，登记白名单，并要求先做状态命名空间化。

现在前置结构治理已完成：3.5 / 3.6 拆分收口，超 600 行白名单外为 0，`movement/index.ts` 是最后一处未完成的结构性拆分。继续推进它，才能把 structure-guard 的规模豁免清零，并为后续移动行为迭代留下可维护的模块边界。

## What Changes

- **状态命名空间化**：把 `movement/index.ts` 中跨函数共享的模块级可变绑定收敛到单一进程内状态对象（配置 / 缓存 / 每 tick 意图 / 寻路 scratch / 统计 / 原型原始函数六组），函数统一通过命名空间读写；不引入 `Memory`、`global` 或第二套状态存储。
- **按内聚边界拆分**：将 67 个顶层函数搬到职责模块，`movement/index.ts` 只保留装配、原型 patch 安装与 `betterMoveApi` 导出。落地边界：
  - `movementState`：共享状态与常量契约
  - `movementGeometry`：坐标/房间名/方向纯工具
  - `movementCostRoute`：地形代价矩阵与跨房路由
  - `movementPathCache`：路径缓存、临时寻路与清理
  - `movementIntentSquad`：移动意图、编队登记与队形仲裁
  - `movementTraffic`：单步执行、编队推进与 tick 结算
  - `movementApi`：`betterMoveTo` / `betterMove` / `betterPull` / `squadMove*` 与公开 API
- **保持契约不变**：`betterMoveApi` 的导出名与签名不变；`Creep.prototype.move|moveTo|cancelOrder|pull`、`PowerCreep.prototype.move|moveTo|cancelOrder`、`RoomPosition.prototype.findSquadPathTo` 的安装点与时序不变；`MovementStart` → 所有 commit 移动生产模块 → `MovementEnd` → `Visuals` 的窗口不变；`moveMatch.ts`、`arrival.ts`、`trafficMonitor.ts` 不动。
- **清出规模豁免**：拆分完成后从 `scripts/structure-guard.mjs` 的 `LINE_WHITELIST` 摘除 `src/modules/movement/index.ts`，并保持 structure-guard 白名单外超限为 0。
- **类型债务有界**：本变更只做结构搬移，不把移动域的类型清理混入；新增模块若必须携带既有 `@ts-nocheck`，总数不得突破 guard 检查点（当前 31，检查点 35），并在 tasks 中登记为后续 B 波二的清算对象。可类型化的状态/几何/API 模块优先去掉标记。

**非目标**：

- 不改移动算法、优先级、代价矩阵、路径缓存生命周期或队形行为；不做顺带 bug 修复。
- 不改 `MovementStart` / `MovementEnd` 的注册序与 `stronghold` 独立移动窗口。
- 不处理 `movement` 之外的 4.1/4.2 类型债务，也不改变 `moveMatch.ts` 的算法资产。
- 不把 `movement/index.ts` 改成新的公共 API 或抽象层；调用方仍从 `@/modules/movement` 取 `betterMoveApi`。

## Capabilities

### New Capabilities

无。此变更是纯结构重构，不改变外部可观察行为，按 OpenSpec pure-refactor 规则设置 `skip_specs: true`；结构边界与类型口径继续受 `legacy-consolidation-b` 的 `code-structure-standards` 约束。

### Modified Capabilities

无。

## Impact

- **代码**：`src/modules/movement/` 新增状态、几何、代价矩阵、路由、路径缓存、意图/编队、执行/结算、API 模块；`index.ts` 变薄；`moveMatch.ts`、`arrival.ts`、`trafficMonitor.ts` 不改。
- **守护**：`scripts/structure-guard.mjs` 摘除 movement 白名单行；`config/code-quality.json` 仅在 `@ts-nocheck`/any 实测下降时推进，不得回涨。
- **调用方**：`agents/movementWindow.ts`、`agents/index.ts`、`branch/stronghold/movement.ts`、`console` 诊断与原型调用方零改动。
- **回归**：六场景矩阵逐位一致，`run-residue`、`stronghold-door` 单独绿；cpu p95 不劣化 >2ms；导出面与原型安装点断言通过。
- **文档**：更新 `docs/nexus-design/12-legacy-bot-migration-map.md` 的 movement 条目，并在 `legacy-consolidation-b` 任务 3.1 的处置注记中回指本变更。
