# Design

## Context

参见 `proposal.md` 的 Why。当前 `src/modules/movement/index.ts` 是 3343 原始行 / 2483 有效行、67 个顶层函数、60+ 个顶层声明；其中 40+ 个可变绑定被多个函数共享。`legacy-consolidation-b` 3.1 已证明直接按函数搬移会触发 ES module 导入绑定只读（`TS2539`），因此必须先把共享状态收进单一命名空间，再拆模块。

现行移动契约由 `m0-movement-commit-window` 固定：

- `MovementStart`（perception / P0）调用 `betterMoveApi.preTickBetterMove()`
- 所有 commit 移动生产模块登记意图
- `MovementEnd`（commit / P0）调用 `betterMoveApi.endTickResolve(isWorkTile)`，随后 `trafficMonitor.updateCongestion`
- `stronghold` 变体走自己的 `preTickBetterMove` / `endTickResolve` 窗口
- 原型 patch：`Creep.prototype.move|moveTo|cancelOrder|pull`、`PowerCreep.prototype.move|moveTo|cancelOrder`、`RoomPosition.prototype.findSquadPathTo`

`moveMatch.ts`（871 行）是独立算法资产；`arrival.ts`、`trafficMonitor.ts` 已有独立职责，本变更不重构它们。

## Goals / Non-Goals

**Goals:**

- 把 40+ 个共享可变绑定收敛到一个进程内 `movementState` 命名空间，保持函数间共享语义与 tick 重置语义不变。
- 按内聚边界拆出职责模块，`movement/index.ts` 只做装配、原型 patch 安装和 `betterMoveApi` 导出。
- 保持 `betterMoveApi` 导出面、原型安装点、三入口时序、`stronghold` 独立窗口、`sim` 行为逐位一致。
- 拆分后从 structure-guard 的 movement 白名单摘除，白名单外超 600 行保持 0。
- 不把移动域类型债务失控；新增模块的 `@ts-nocheck` 总数不得突破检查点（默认四个迁移位，API 兜底最多五个）。

**Non-Goals:**

- 不修移动算法/优先级/队列/路径缓存策略的既有行为，不做顺带 bug fix。
- 不清理 `moveMatch.ts` 的算法与状态，不改 `arrival.ts` / `trafficMonitor.ts`。
- 不完成 `legacy-consolidation-b` 4.1/4.2 的全仓类型清零；移动域之外的 `@ts-nocheck` 不在本变更。
- 不把 `betterMoveApi` 改成新的服务接口，调用方零改动。

## Decisions

### D1: 单一 `movementState` 命名空间，而不是每模块各自持有状态

**选择**：新增 `movementState.ts`，导出一个进程内对象，按 `config` / `cache` / `tick` / `scratch` / `stats` / `proto` 六组承载原 40+ 个绑定。各职责模块只 import 这个对象，不再跨模块 import 可变绑定。

**理由**：共享可变绑定是原文件无法拆分的根因；单一对象保留“所有函数看到同一份状态”的语义，同时把可写面集中到一处，避免每模块一份状态导致缓存/意图不一致。`config` 可变配置仍由 `betterMoveApi.setPathClearDelay` 等入口修改；`tick` 组由 `preTickBetterMove` 重置；`cache` / `stats` / `proto` 跨 tick 保留。

**替代方案**：把状态作为显式参数传给每个函数——被否，67 个函数和 PathFinder 回调的签名会被大改，且回调需要闭包/全局 scratch，行为风险高于收益；每模块自持状态——被否，会复制缓存并破坏共享语义。

### D2: 按五个算法域 + 状态/工具/API + 薄装配层拆分，依赖方向单向

**选择**：

| 模块 | 职责 | 主要来源 | 预估有效行 |
|---|---|---|---|
| `movementState.ts` | 状态命名空间、常量、tick reset | 顶部 60+ 声明 + `preTickBetterMove` 的清空段 | < 200 |
| `movementGeometry.ts` | 房间名/坐标/方向纯工具 | `parseRoomName`–`direction2Pos` 中无状态工具 | ~245 |
| `movementCostRoute.ts` | 地形代价矩阵 + 跨房路由/room callback/临时避让 | `isObstacleStructure`–`generateCostMatrix`，`checkRoom`–`routeReduce`，`bypassRoomCallback*`、`roomCallback*` | ~470 |
| `movementPathCache.ts` | 路径缓存、临时寻路、清理 | `findTemporalPath`–`setPathTimer`、`clearUnused` | ~411 |
| `movementIntentSquad.ts` | 单 creep 意图、编队登记、队形路径与队形移动 | `registerMoveIntent`、`has/intent`、`cancelMoveIntent`、`registerSquad`、`checkSquadTarget`、`squadStepToPos`、`squadMove*`、`findSquadPathTo` | ~451 |
| `movementTraffic.ts` | 单步执行、路由启动、tick 结算 | `moveOneStep`、`startRoute`、`startSquadRoute`、`endTickResolve`、`preTickBetterMove` | ~453 |
| `movementApi.ts` | 公开算法入口与 `betterMoveApi` | `betterMoveTo`、`betterMove`、`betterPull`、`betterCancelOrder`、API 对象 | ~249 |
| `movement/index.ts` | 原型 patch 安装、`betterMoveApi` re-export | 原文件底部导入副作用 | < 80 |

依赖严格单向：`state` → `geometry` → `costRoute` → `pathCache` → `intentSquad` → `traffic` → `api` → `index`。禁止子模块反向 import `index.ts`，也禁止在模块间共享可变绑定；需要跨域调用时只能走函数导入。

**理由**：3.1 的六域边界是“路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动”。本变更把相邻且互相依赖的 **代价矩阵 + 路由**、**意图 + 编队** 各自合并，得到五个算法域；每域仍远低于 600 有效行，同时减少模块数与 import 噪声。合并后默认只用四个 `@ts-nocheck` 迁移位（全仓 34），必要时 API 兜底为第五个（全仓 35），仍低于 guard 检查点。

**替代方案**：严格保留六域、十个文件——被否，会需要六个 `@ts-nocheck` 位，拆完即 36，突破检查点；按函数逐个拆十几个文件——被否，装配成本与 import 噪声过高；只拆纯工具、保留巨型执行文件——被否，无法达到规模上限。

### D3: 原型 patch 与导出面固定在 `index.ts`

**选择**：所有 `Creep.prototype` / `PowerCreep.prototype` / `RoomPosition.prototype` 赋值只在 `movement/index.ts` 模块加载时执行一次；`originMove` / `originPull` / `originCancelOrder` 从 `movementState.proto` 读取；`betterMoveApi` 在 `index.ts` re-export，方法签名不变。

**理由**：调用方 `agents/movementWindow.ts`、`agents/index.ts`、`branch/stronghold/movement.ts` 依赖 `@/modules/movement` 的导入副作用和 `betterMoveApi` 形状。把 patch 分散到执行模块会把“导入即安装”的时序变成隐式依赖，容易重复包装或漏装。

**替代方案**：在 `movementApi.ts` 安装 patch——被否，API 模块会被执行模块反向 import，形成循环；把 patch 改为显式 `install()` 调用——被否，调用方必须改，超出零改动约束。

### D4: `@ts-nocheck` 采用“迁移上限”而非立即清零

**选择**：`movementState.ts`、`movementGeometry.ts`、`movement/index.ts` 必须通过严格类型检查；`movementApi.ts` 优先无标记，四个算法域 `movementCostRoute.ts`、`movementPathCache.ts`、`movementIntentSquad.ts`、`movementTraffic.ts` 若无法在不改变逻辑的前提下清零，可保留 `@ts-nocheck`。这样默认全仓计数从 31 变为 34（原 `movement/index.ts` 的标记退役，四个域新增），仍低于检查点 35；若 API 模块也确需标记，最多到 35，超出即停止并调整拆分粒度。每个保留的标记在 tasks 中登记为 `legacy-consolidation-b` 4.1 的清算对象。

**理由**：本变更是结构拆分，不是 4.1 的类型清理；把 2483 行算法一次性严格类型化会把范围扩大数倍，并引入行为风险。固定上限可防止“拆一个文件、复制八份 nocheck”的结构债务爆炸，同时让状态/几何/API/装配层这四处最值得类型化的边界先收干净。

**替代方案**：所有新模块一律 `@ts-nocheck`——被否，项目计数会从 31 涨到 38，突破检查点；立即全量类型化——被否，超出本变更范围，留给 `legacy-consolidation-b` 4.1。

### D5: tick 状态重置集中在 `resetTickState()`

**选择**：`preTickBetterMove` 只调用 `movementState` 的 `resetTickState()`；重置集合与现有清空顺序一致：`cachedMoveIntents`、`creepToSquad`、`squadToCreeps`、`squadNextTile`、`rerouteSquad`、`checkedTiles`、`nameToIntentIdx`、`pullPair`，以及 `creepIdx = 1`、`squadIdx = 1`。`IntentTiles` / `Priorities` 数组保留，按需覆写。

**理由**：这些 Map/Set 的 tick 生命周期是移动结算正确性的核心；集中重置可避免拆模块后某个模块忘记清空。持久缓存与统计不参与重置。

**替代方案**：各模块自行清空自己拥有的 Map——被否，`cachedMoveIntents` 与 `nameToIntentIdx` 被多个域读写，所有权不单一，分散清空易漏。

### D6: 路径/寻路 scratch 进入 `state.scratch`，不改成局部参数

**选择**：`temporalAvoidFrom`、`findPathIgnoreCondition`、`bypassRoomName`、`combinedX/Y`、`minX/maxX`、`startRoomName/endRoomName`、`ops/toPos/creepCache/path/idx/posArray/found` 等进入 `state.scratch`；保持原函数的读写顺序。

**理由**：这些变量被 PathFinder 回调和跨函数调用链共享，改成参数需要重写回调签名；`@ts-nocheck` 下变量类型也无法安全推导。集中 scratch 是行为最小的搬移。

**替代方案**：把 path 缓存/寻路改成纯函数返回值——被否，属于算法重写，超出本变更。

### D7: `moveMatch.ts` 保持独立，不并入新模块

**选择**：`moveMatch` 的数组、Map 和算法体不动；`movementTraffic` 继续 `import moveMatch from "./moveMatch"`。

**理由**：它是 SSP+SPFA 算法资产，已有独立 871 行文件；拆它会把本变更变成算法重构。3.1 的边界也只要求 `movement/index.ts`。

### D8: 先状态化、再拆文件、最后摘白名单

**选择**：分三步落地并各自过门：

1. 在单文件内引入 `movementState` 并替换所有共享绑定（仍是一个文件）。
2. 逐域搬函数到新模块，index 保留 re-export/patch；每域过 typecheck + 快速 sim 预检。
3. 全部模块稳定后删除白名单，跑八门总验。

**理由**：第一步是最高风险的大面积变量替换，单独成切片便于定位；第二步每域可独立回退；第三步才改变 guard 口径，避免拆分中途误报。

## Risks / Trade-offs

- [变量替换漏改导致运行时 `undefined`] → 先用脚本建立“旧绑定 → 新 `S.*` 路径”清单，替换后全仓 `grep` 旧裸名；每切片跑 typecheck + sim 预检，最终八门逐位。
- [PathFinder 回调依赖 scratch，拆模块后闭包/引用变化] → scratch 只挂 `state.scratch`，不改变回调注册方式；先状态化切片单独过门，再搬函数。
- [原型 patch 重复安装或安装顺序变化] → patch 只留 index；用启动断言检查 `Creep.prototype.move` 等函数身份只被包装一次，`originMove` 仍指向拆前保存的原函数。
- [模块循环依赖] → 固定单向依赖表；`state` 不 import 任何业务模块，子模块不 import `index`；typecheck/import cycle 检查纳入门。
- [`@ts-nocheck` 迁移超上限] → 每新增一个标记前先确认总数 ≤35；优先 typed 的 state/geometry/API/index，超限即停止并调整拆分粒度。
- [行为漂移] → 所有切片过六场景逐位；`run-residue` / `stronghold-door` 在最终门单独跑；cpu p95 劣化 >2ms 拒绝。
- [顺带修 bug 的诱惑] → 明确 non-goal；发现既有缺陷只登记 `docs/bugs`，不在本变更修。

## Migration Plan

1. **基线冻结**：记录 `betterMoveApi` 导出名/签名、三入口注册序、原型 patch 函数身份、`movement/index.ts` 有效行、`@ts-nocheck`/any 计数、六场景读数与 `run-residue`/`stronghold-door`。
2. **状态化切片**：新增 `movementState.ts`，在 `index.ts` 内替换 40+ 绑定为命名空间访问；`preTickBetterMove` 调 `resetTickState`；跑 typecheck + 六场景。
3. **拆分切片**：按 D2 顺序抽 `geometry` → `costRoute` → `pathCache` → `intentSquad` → `traffic` → `api`；index 逐步变薄；每切片跑 typecheck + 快速场景（race/boot）。
4. **安装收口**：patch 集中到 index；删除临时 re-export；确认 `betterMoveApi` 导出面 diff 为空。
5. **白名单摘除**：从 `scripts/structure-guard.mjs` 移除 `src/modules/movement/index.ts`；跑 `structure:guard` 确认白名单外超限 0。
6. **总验收**：六场景逐位 + `run-residue` + `stronghold-door` + typecheck + lint + arch/structure 双守护；更新迁移文档与 `legacy-consolidation-b` 3.1 注记；读数存档本变更 `baseline/`。
7. **回滚**：按切片 revert；状态化与拆分分开提交。无 Memory 迁移，回滚无数据负担。
