# Proposal: m0-movement-commit-window

## Why

`docs/nexus-design/12-legacy-bot-migration-map.md` §25.2 的 B1 仍在现行代码中：`Broker.run` 在 commit 阶段开头调用 `preTickBetterMove()` 清空移动意图，随后在同一个 `Broker.run` 内调用 `endTickResolve()` 结算；而 `Teams`、`PowerCreeps`、`Expansion` 等 commit 阶段模块注册在 `Broker` 之后。它们当 tick 登记的移动意图落在结算之后，下一 tick 开头又被清空，因此编队与 Power Creep 实际不移动。`docs/nexus-design/12-legacy-bot-migration-map.md` §25.6 把 B1 列为 M0 止血的第一项，也是 M7 战争编队与后续校准的前置条件。

现行代码同时确认了边界：B4（`in` 判断 `Set` 成员）已随执行链收口消失——`NEXUS_TASK_DRIVEN_CODES` 与 `exec()` 兜底已不存在，无任务指针的单位现在只记空转诊断。`branch/stronghold/movement.ts` 已经采用「编队前重置 / 编队后结算」的拆分窗口，说明该时序模式在要塞变体上已有先例。

## What Changes

- 把移动窗口从 `Broker` 中抽出为两个独立 TickModule：
  - `MovementStart`：`perception` 阶段 P0，注册在模块清单首位，tick 开头清空 BetterMove 意图与缓存；
  - `MovementEnd`：`commit` 阶段 P0，注册在所有 commit 移动生产模块之后、可视化之前，执行 `endTickResolve`，随后执行拥堵位置差分。
- `Broker` 只保留提交、结果回投、动作速率与塔耗回填；不再拥有 `preTickBetterMove` / `endTickResolve` / `updateCongestion`。
- 主入口 `src/main.ts` 与 `local` / `season` 变体按同一顺序装配；`stronghold` 已有等价拆分窗口，仅做一致性核对，不改变其行为。
- `isWorkTile` 判定按现行语义搬移，不顺手修 B7（小写 `Memory.nexus` 根）——B7 是独立 M0 变更。
- **BREAKING（内部契约）**：取代 `nexus-architecture-refactor` 任务 5.7 固定的 `preTickBetterMove → broker.commit → endTickResolve` 锚点。新锚点为「tick 开头重置 → 全部 commit 模块 → 统一结算」。实现完成后同步更新旧变更注记与 `docs/nexus-design/12` §25.2 / §25.6 的状态。
- 验证口径：先重冻基线，再跑全场景门（重点 `arena` / `stronghold-door` 的编队与 `run-residue`），race 门 L2@458 不得回退，CPU p95 劣化不超过 2ms；B1 修复带来的编队 / Power Creep 移动属于预期行为变化，必须逐项归因后写回基线，不得以「漂移即回退」处理。
- **不在本变更范围**：B2 名册（`phase4-remote-intel`）；B6 核弹防护、B7 小写根、B8 结构缓存、B9 校准保留旧域、B12 布局统一（均为独立 M0 变更）；M1 及之后的迁移步骤。

## Capabilities

### New Capabilities

- `movement-intent-lifecycle`: 移动意图在 tick 内的重置与结算窗口、跨阶段模块的时序约束、结算后的拥堵采样，以及窗口钩子的优先级与失败隔离。

### Modified Capabilities

（无——`openspec/specs/` 当前只有 `cluster-squad`，不涉其需求。）

## Impact

- **代码**：`src/modules/agents/index.ts`（移除 Broker 内窗口钩子）、新增移动窗口 TickModule（建议 `src/modules/agents/movementWindow.ts`，保留 `isWorkTile` 的领域归属）、`src/main.ts`、`src/branch/local/main.ts`、`src/branch/season/main.ts`；`src/branch/stronghold/movement.ts` 仅核对或复用，不改变既有行为；`src/modules/movement/trafficMonitor.ts` 逻辑不变，仅调用位置后移。
- **不涉及**：Memory schema、配置项、ActionBroker 的提交协议、任务板与分配器资格。
- **行为**：`Teams` / `PowerCreeps` 以及未来任何在 commit 阶段晚于 Broker 登记的移动意图，当 tick 即可结算；agents 阶段既有意图路径不变。CPU 总量预计持平，结算从 Broker 段移到 commit 末尾，P0 保证不被预算跳过。
- **回归线**：以 `openspec/changes/legacy-consolidation-b/baseline/sim-matrix-reference.json` 为变更前参照；实现后新增本变更自己的基线快照，记录预期漂移与归因。
- **文档**：`docs/nexus-design/12-legacy-bot-migration-map.md` §25.2（B1 勾销、B4 标注已解决）与 §25.6（M0 进度）；`docs/bugs/` 新增或更新移动窗口取证记录；`nexus-architecture-refactor` 任务 5.7 注记改为被本变更取代。
