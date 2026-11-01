# Tasks

## 1. 基线冻结与状态契约

- [x] 1.1 冻结移动基线：记录 `betterMoveApi` 导出名/签名、6 个原型 patch 的安装次数与函数身份、`MovementStart`/`MovementEnd` 注册序、`movement/index.ts` 原始/有效行、structure-guard 读数（31 / 698 / 473 / 0）、六场景与 `run-residue`/`stronghold-door` 读数；写入 `openspec/changes/movement-state-namespace/baseline/movement-baseline.md` 与 `export-surface.json`。验证：`node scripts/structure-guard.mjs --report` 与本任务记录一致；`node scripts/sim-matrix.mjs --only=race` 可复现基线读数。
- [x] 1.2 建立共享绑定清单：把 `movement/index.ts` 的 40+ 个共享可变绑定逐项归入 `config` / `cache` / `tick` / `scratch` / `stats` / `proto`，写 `baseline/state-map.md`；同时定义“旧裸名 → `movementState.*`”替换表。验证：清单覆盖全部顶层 `let/const` 共享项，无未归口绑定；抽样 10 个绑定能在源码中定位读写点。
- [x] 1.3 新建 `src/modules/movement/movementState.ts`：导出单一状态对象、常量与 `resetTickState()`；状态对象不含 `Memory`/`global`。验证：`npm run typecheck` 绿；新增 `tests/movement-state.test.ts` 覆盖 `resetTickState()` 清空 8 个 tick Map/Set、`creepIdx/squadIdx` 复位、持久缓存/统计不被清空，`npm test` 绿。
- [x] 1.4 迁移持久状态：在 `index.ts` 内把 `config` / `cache` / `stats` / `proto` 组绑定替换为 `movementState.*`，不改读写顺序；`betterMoveApi` 的 setter 仍修改同一组状态。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,boot` 逐位一致；`grep` 确认旧裸名只出现在替换表/注释中。
- [x] 1.5 迁移 tick/scratch 状态：替换 `tick` / `scratch` 组绑定；`preTickBetterMove` 改为调用 `resetTickState()`，`IntentTiles`/`Priorities` 保留原分配与覆写方式。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,boot,run-residue` 逐位一致；`git diff` 仅含变量路径替换，无算法行改动。

## 2. 几何工具拆分

- [x] 2.1 抽出 `src/modules/movement/movementGeometry.ts`：搬入 `parseRoomName`、`formalize`、`tile2Pos`、`isEqual`、`isNear`、`inRange`、`getDirection`、`isHighWay`、`direction2Pos` 等纯工具；`index.ts` 改为 import 并保留原调用点。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,boot` 逐位一致；`node scripts/structure-guard.mjs` 显示该文件 ≤600 有效行且无新增 `@ts-nocheck`。
- [x] 2.2 为纯工具补回归：新增 `tests/movement-geometry.test.ts`，覆盖 `parseRoomName` 合法/非法、`tile2Pos` 边界、`getDirection` 八方向与 `isHighWay` 判定；验证：`npm test` 绿，且测试不依赖 `Game` 全局副作用。

## 3. 代价矩阵与路由拆分

- [x] 3.1 抽出 `src/modules/movement/movementCostRoute.ts`：搬入 `isObstacleStructure`、`initialMap`、`getEdgeArray`、`generateCostMatrix`、`checkRoom`、`checkSquadRoom`、`routeCallback*`、`findRoute`、`checkTemporalAvoidExit`、`routeReduce`、`bypassRoomCallback*`、`roomCallback*`；保持函数体与回调注册顺序不变。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,arena` 逐位一致；文件 ≤600 有效行；若该文件保留 `@ts-nocheck`，全仓计数 ≤35 并登记。
- [x] 3.2 回归路由/代价矩阵：用现有 sim 场景验证跨房路径与 hostile cost matrix 清理路径；验证：`node scripts/sim-matrix.mjs --only=speedrun,arena` 逐位一致，且 `run-residue` 中路径缓存清理行为与基线一致。

## 4. 路径缓存拆分

- [x] 4.1 抽出 `src/modules/movement/movementPathCache.ts`：搬入 `findTemporalPath`、`squadTemporalRoomCallback`、`findSquadTemporalPath`、`findPath`、`squadRoomCallback`、`findSquadPath`、`addPathIntoCache`、`invalidate`、`deletePath`、`findShortPathInCache`、`findLongPathInCache`、`setPathTimer`、`showVisual`、`clearUnused`；`index.ts` 只保留调用/装配。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,boot,run-residue` 逐位一致；文件 ≤600 有效行；保留标记时全仓计数 ≤35。
- [x] 4.2 回归缓存生命周期：验证 `pathClearDelay`、`pathCacheTimer`、`globalPathCache` 的清理路径与拆分前一致；验证：`run-residue` 读数与基线逐位一致，`node scripts/sim-matrix.mjs --only=race` 无路径缓存相关告警。

## 5. 意图与编队拆分

- [x] 5.1 抽出 `src/modules/movement/movementIntentSquad.ts`：搬入 `registerMoveIntent`、`registerSquad`、`checkSquadTarget`、`defaultCheckTile`、`hasMoveIntent`、`isSwapIntent`、`getMoveIntentStep`、`cancelMoveIntent`、`squadStepToPos`、`squadMove`、`squadMoveTo`、`findSquadPathTo`；保持 `tick` 状态读写与优先级语义不变。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=arena,speedrun` 逐位一致；文件 ≤600 有效行；保留标记时全仓计数 ≤35。
- [x] 5.2 回归编队/意图：新增 `tests/movement-intent.test.ts` 覆盖 `isSwapIntent`、`getMoveIntentStep`、双 creep 编队登记与取消的纯逻辑分支；验证：`npm test` 绿；`node scripts/sim-matrix.mjs --only=arena` 逐位一致。

## 6. 交通执行、API 与薄装配层

- [x] 6.1 抽出 `src/modules/movement/movementTraffic.ts`：搬入 `moveOneStep`、`moveOneStepSquad`、`startRoute`、`startSquadRoute`、`endTickResolve`、`preTickBetterMove` 及 tick 结算辅助；`preTickBetterMove` 仍调用 `resetTickState()`。验证：`npm run typecheck` 绿；`node scripts/sim-matrix.mjs --only=race,boot,arena` 逐位一致；文件 ≤600 有效行；保留标记时全仓计数 ≤35。
- [x] 6.2 抽出 `src/modules/movement/movementApi.ts`：搬入 `betterMoveTo`、`betterMove`、`betterPull`、`betterCancelOrder`、`wrapFn` 与 `betterMoveApi` 对象；优先不带 `@ts-nocheck`，若确有无法在零逻辑改动下消除的类型错误，可按 D4 兜底到第五个标记位。验证：`npm run typecheck` 绿；`baseline/export-surface.json` 与方法签名逐项 diff 为空；`node scripts/sim-matrix.mjs --only=race,boot` 逐位一致；若保留标记，全仓计数 ≤35 并登记。
- [x] 6.3 收薄 `src/modules/movement/index.ts`：只保留 `betterMoveApi` re-export、原型 patch 安装（`Creep`/`PowerCreep`/`RoomPosition`）与必要的模块导入；不再承载算法实现。验证：`npm run typecheck` 绿；启动断言确认 6 个 patch 各安装一次、`originMove`/`originPull`/`originCancelOrder` 指向拆前原函数；`node scripts/sim-matrix.mjs --only=race,boot` 逐位一致。
- [x] 6.4 类型债务对账：确认 `movementState.ts`、`movementGeometry.ts`、`index.ts` 无 `@ts-nocheck`；确认 `movementApi.ts` 与四个算法域的标记情况与 D4 及 `baseline/state-map.md` 登记一致；全仓 `@ts-nocheck` ≤35。验证：`grep -Rl '^// @ts-nocheck' src --include='*.ts'` 计数与登记一致；`node scripts/structure-guard.mjs` 绿。
- [x] 6.5 摘除规模白名单：从 `scripts/structure-guard.mjs` 的 `LINE_WHITELIST` 删除 `src/modules/movement/index.ts`；如 `lineLimitOver` 实测为 0，则把 `config/code-quality.json` 的 `lineLimitOver` 推进到 0，`tsNocheck`/`any` 不因本次结构搬移上调。验证：`node scripts/structure-guard.mjs --report` 显示白名单外超 600 行为 0、`@ts-nocheck` 与 any 均不高于检查点。

## 7. 文档与变更对账

- [x] 7.1 更新 `docs/nexus-design/12-legacy-bot-migration-map.md` 的 movement 条目：记录状态命名空间化、五个算法域拆分、原型 patch/时序保持、白名单摘除与 `@ts-nocheck` 迁移上限。验证：文档中的文件路径与 module 名均可在仓库中解析，`rg` 无旧 `movement/index.ts` 未拆分表述残留。
- [x] 7.2 更新 `openspec/changes/legacy-consolidation-b/tasks.md` 3.1 的处置注记：回指本变更、说明状态命名空间化与拆分已由本变更承接；不勾选 4.1/4.2。验证：`openspec validate legacy-consolidation-b --strict` 通过，3.1 注记与本变更名称一致。
- [x] 7.3 在本变更 `baseline/` 记录最终读数：`structure-guard` 三行读数、`@ts-nocheck` 清单、六场景/run-residue/stronghold-door 读数、p95 对照、导出面 diff 结论。验证：读数与 8.1/8.2 的实际命令输出一致，无手工估算值。

## 8. 集成验收

- [x] 8.1 静态门：`npm run typecheck`、`npm run lint`、`npm test`、`npm run arch:guard`、`npm run structure:guard` 全绿；`npm run build` 与 `npm run build:stronghold` 成功。验证：命令退出码为 0；lint 仅允许既有 race 隔离区 warning；最终 `dist/main.js` 为主构建产物。
- [x] 8.2 行为门：`node scripts/sim-matrix.mjs` 六场景逐位一致；`run-residue` 与 `stronghold-door` 单独绿；cpu p95 对基线不劣化 >2ms；race 门保持 L2@458。验证：矩阵逐门 GREEN，读数写入 `baseline/`，与 `baseline/movement-baseline.md` 对照无漂移。
- [x] 8.3 契约门：重跑 `baseline/export-surface.json` 对比，`betterMoveApi` 导出名/签名 diff 为空；检查 `MovementStart`/`MovementEnd` 注册序、`stronghold` 独立窗口、6 个原型 patch 安装次数与 `origin*` 身份。验证：契约脚本退出码 0；`moveMatch.ts`、`arrival.ts`、`trafficMonitor.ts` 的 `git diff` 为空。
- [x] 8.4 变更收口：`openspec validate movement-state-namespace --strict` 通过，`openspec status --change movement-state-namespace` 显示 implementation-ready；确认本变更未修改 `legacy-consolidation-b` 的 4.1/4.2 完成状态，也未提交代码。验证：两条命令输出符合预期，`git status` 仅包含本变更规划文件与实现文件，无 commit。
