# Tasks

> 口径来源：移动意图生命周期与入口覆盖 → `specs/movement-intent-lifecycle`；钩子归属、阶段/优先级、`isWorkTile` 搬移与 stronghold 边界 → `design.md`。
> 实施 MUST 按本清单的范围隔离：B2/B6/B7/B8/B9/B12 与 M1 之后均不在本变更内。任何 sim 漂移先归因再决定是否重冻，禁止「漂移即回退」。

## 1. 变更前基线与取证

- [ ] 1.1 采集变更前基线：跑 `node scripts/sim-matrix.mjs --build`（8 门）+ `npx screeps-sim test sim/run-residue.sim.ts --no-bundle-check` + `npx screeps-sim test sim/stronghold-door.sim.ts --no-bundle-check`，读数存档本变更 `baseline/2026-10-29-pre-movement-window.md`；验证：文件含每场景 RCL 时间线、p95、红绿与命令原文，且与 `legacy-consolidation-b/baseline/sim-matrix-reference.json` 对照无未解释差异
- [ ] 1.2 固化 B1 取证与 B4 边界：记录 `Broker.run` 当前三个钩子调用、`main.ts` 中 commit 模块注册序、`Teams` / `PowerCreeps` 的移动登记点；同时用全仓扫描确认 `NEXUS_TASK_DRIVEN_CODES` 与 `in` 成员判定不存在，结论写入 `docs/bugs/movement-intent-window.md`；验证：文档含 file:line 证据、扫描命令与输出，B1/B4 各一段结论

## 2. 移动窗口模块与 Broker 收口

- [ ] 2.1 新建 `src/modules/agents/movementWindow.ts`：导出 `MovementStart`（`perception` / P0）、`MovementEnd`（`commit` / P0）与 `isWorkTile`；`isWorkTile` 按现行实现逐字搬移，不修 B7；验证：`npm run typecheck` 绿，`MovementStart` / `MovementEnd` 的 name、phase、band 与 design D2 一致
- [ ] 2.2 从 `src/modules/agents/index.ts` 的 `Broker.run` 删除 `preTickBetterMove` / `endTickResolve` / `updateCongestion` 及对应 import，保留 `noteMoveIntent`、提交、结果回投、动作速率与塔耗回填；验证：`npm run typecheck` 与 `npm run lint` 绿，`Broker.run` 内不再出现三个钩子符号
- [ ] 2.3 新增 `tests/movement-window.test.ts`：覆盖「持 harvest 任务且在工位 → 不可推」「无匹配工位 → 可推」「无 taskId → 可推」；验证：`node scripts/run-tests.mjs movement-window` 绿

## 3. 入口装配

- [ ] 3.1 `src/main.ts` 首位注册 `MovementStart`，在 `ActorOwnershipPersist` 之后、`Visuals` 之前注册 `MovementEnd`；验证：`npm run typecheck` 绿，注册序满足「start 先于 Perception；end 后于 Teams/PowerCreeps/Expansion/InterShard/Comms 且先于 Visuals」
- [ ] 3.2 `src/branch/local/main.ts` 与 `src/branch/season/main.ts` 按同一顺序装配；验证：`npm run build`、`npm run build:season` 绿，两个入口的注册序与 `main.ts` 一致
- [ ] 3.3 核对 `src/branch/stronghold/movement.ts` 与 `src/branch/stronghold/main.ts`：确认 `StrongholdMoveStart` 在 `Teams` 前、`StrongholdMoveEnd` 在 `Teams` 后，行为不变；验证：`node scripts/sim-matrix.mjs --only=stronghold-door` 或 `npx screeps-sim test sim/stronghold-door.sim.ts --no-bundle-check` 绿，且本变更未改该文件

## 4. 行为验证与基线重冻

- [ ] 4.1 跑 `node scripts/sim-matrix.mjs --build` 全场景，与 1.1 基线逐门对照；对 `arena` / `stronghold-door` 等漂移逐项归因，确认只来自晚段移动意图生效；race 门 L2@458 必须逐位；验证：归因表落 `baseline/2026-10-29-post-movement-window.md`，CPU p95 劣化 ≤2ms
- [ ] 4.2 漂移归因完成后重冻共享回归线：`node scripts/sim-matrix.mjs --update`，并把新 `sim-matrix-reference.json` 副本存入本变更 `baseline/`；验证：重跑 `node scripts/sim-matrix.mjs` 全门 GREEN，`run-residue` / `stronghold-door` 单独绿
- [ ] 4.3 更新文档：`docs/nexus-design/12-legacy-bot-migration-map.md` §25.2（B1 勾销并写变更名，B4 标注已由前序执行链收口解决）与 §25.6（M0 进度）；`openspec/changes/nexus-architecture-refactor/tasks.md` 任务 5.7 增加「被 m0-movement-commit-window 取代」注记；验证：三处文档与 `docs/bugs/movement-intent-window.md` 结论一致，无残留旧锚点表述
- [ ] 4.4 总验收：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run arch:guard`、`npm run structure:guard`、`openspec validate m0-movement-commit-window --strict` 全绿；验证：命令输出与基线读数一并存档，工作区仅含本变更预期文件（属主 nightx:night，未提交）
