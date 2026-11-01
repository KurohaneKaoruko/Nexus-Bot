# 移动意图结算窗口取证（B1 / B4）

> 取证基线：`fefacb3`（m0 实施前，PR #2–#5 已合入）。本文记录当前代码事实与扫描命令；m0 只调整窗口归属，不改 B4，也不回退 PR #2 已完成的 B7 修复。

## B1：晚段 commit 移动意图跨 tick 丢失

### 结论

B1 仍成立：`Broker.run` 在 commit 阶段开头重置 BetterMove 意图，并在同一个 `run` 内结算；`Teams` / `PowerCreeps` 注册在 `Broker` 之后，它们当 tick 登记的移动意图落在结算之后，下一 tick 开头又被 `preTickBetterMove()` 清空，因此不会执行。

### 证据

1. `Broker` 是 commit / P1 模块，`run` 内三个窗口钩子：
   - `src/modules/agents/index.ts:57`：`betterMoveApi.preTickBetterMove()`
   - `src/modules/agents/index.ts:96`：`betterMoveApi.endTickResolve(isWorkTile)`
   - `src/modules/agents/index.ts:98-101`：结算后 `updateCongestion(ctx, world)`
2. 主入口注册顺序：`src/main.ts:33-64` 中 `Broker` 在 `:45`，`Teams` 在 `:48`，`PowerCreeps` 在 `:49`，`Expansion` 在 `:53`，`Comms` 在 `:54`，`ActorOwnershipPersist` 在 `:60`，`Visuals` 在 `:62`。调度器同阶段按注册序执行（`src/core/scheduler.ts:43-50`），因此 Teams / PowerCreeps 晚于 Broker。
3. `Teams` 是 commit / P2（`src/modules/teams/index.ts:17-24`），运行 `TeamController`；编队移动经 `src/modules/teams/core/TeamClass.ts:347` → `src/modules/teams/core/teamActionMove.ts:222/229/231` → `combatMove()`。`combatMove` 在 `src/modules/combat/combatAdapter.ts:141-155` 调 `submitCombat`，后者在 `src/modules/combat/combatAdapter.ts:62-75` 通过 `sharedBrokerForDirectCommands().executeNow(...)` 立即执行移动命令。
4. `PowerCreeps` 是 commit / P2（`src/proto/PowerCreep/index.ts:44-56`），`pc.exec()` 内的移动经 `src/proto/PowerCreep/execute.ts:29-43` → `pcMoveTo()`；`src/proto/PowerCreep/function/powerAdapter.ts:43-70` 同样用 `executeNow(...)` 立即执行 `move`。
5. `preTickBetterMove()` 的实现直接清空移动意图表：`src/modules/movement/index.ts:3155-3166`。
6. `Creep.prototype.move/moveTo` 与 `PowerCreep.prototype.move/moveTo` 的 BetterMove 猴补丁在 `src/modules/movement/index.ts:3178-3181` 挂载，晚段移动命令确实会进入同一意图表。

### 行为链

`Broker` 重置 → `Broker` 结算 → `Teams/PowerCreeps` 登记移动意图 → 下一 tick `Broker` 重置（意图被清空） → 永不结算。主入口的 `MovementEnd` 必须移到 Teams/PowerCreeps 之后、Visuals 之前，才能让晚段意图当 tick 生效。

## B4：`in` 判断 Set 成员 / 旧执行器回退

### 结论

B4 已解决：代码中不存在 `NEXUS_TASK_DRIVEN_CODES`、`unitCode in ...` 或旧 `exec()` 回退路径。无任务指针的单位只记空转诊断并跳过，不再进入旧执行器。

### 证据

- `src/modules/agents/agentSystem.ts:51-56`：无 `taskId` 时调用 `reportIdleUnit()` 后 `continue`，没有旧执行器分派。
- `src/modules/agents/agentSystem.ts:16-21`：空转诊断限频，仅 `console.log`。
- `docs/nexus-design/10-legacy-removal-ledger.md:42`：旧 `exec()` 双轨与 `NEXUS_TASK_DRIVEN_CODES` 已登记删除（历史台账）。

### 扫描命令与结果

在 `src tests scripts sim` 范围执行：

```bash
grep -RIn "NEXUS_TASK_DRIVEN_CODES" src tests scripts sim
# NO_MATCH

grep -RInE "\bunitCode\s+in\b" src tests scripts sim
# NO_MATCH

grep -RInE "\bin\s+(NEXUS_TASK_DRIVEN_CODES|CREEP_PIPELINES|BATCH_PIPELINES|TASK_KINDS|[A-Z][A-Z0-9_]*_CODES|[A-Z][A-Z0-9_]*_SET)\b" src tests scripts sim
# 唯一命中：src/modules/visuals/roomVisuals.ts:21
#   unit in UNIT_CODES
# UNIT_CODES 是 Object.freeze 的 Record（src/constant/UnitConstant.ts:14-18），
# 不是 Set；该 in 判断合法，不属于 B4。
```

结论：B4 不再构成移动窗口的前置问题；m0 不修改该路径。

## B7 边界

PR #2 已把 `isWorkTile` 的持久化根从错误的 `Memory.nexus` 改为 `Memory.Nexus`（`src/modules/agents/index.ts:25-26`）。m0 的 `isWorkTile` 搬移必须保留这一现行语义，不能以「B7 不在 m0 范围」为由回退成小写根。B7 的独立变更需求已由 PR #2 完成；m0 只搬移函数并保持行为不变。
