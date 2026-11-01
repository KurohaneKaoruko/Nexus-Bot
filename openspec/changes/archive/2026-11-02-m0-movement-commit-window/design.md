# Design

## Context

See `proposal.md` for motivation. Current movement ownership is split incorrectly:

- `src/modules/agents/index.ts` 的 `Broker.run` 在 commit 阶段开头 `preTickBetterMove()`，在同一个 `run` 内 `endTickResolve(isWorkTile)`，随后 `updateCongestion`。
- `Teams`、`PowerCreeps`、`Expansion`、`InterShard`、`Comms` 都在 commit 阶段且注册在 `Broker` 之后；其中 `Teams` / `PowerCreeps` 会登记移动意图，落在结算之后。
- `src/branch/stronghold/movement.ts` 已用 `StrongholdMoveStart`（Teams 前）/ `StrongholdMoveEnd`（Teams 后）解决同一问题，是可复用的时序先例。
- `docs/nexus-design/12` 基于 v1.0.0 走查，其中「修 B1 会让 manager / transporter / miner 恢复移动」已不再成立：这些旧执行路径已退役，B4 的 `in` 判定也已消失。本变更的实际行为面只有 commit 晚段仍有移动意图的模块。
- `Visuals` 也在 commit 阶段；它在旧实现中读取的是 `endTickResolve` 之后的位置。结算钩子不能简单放到模块清单绝对末位，否则可视化会回退一 tick。

## Goals / Non-Goals

**Goals:**

- 移动意图在 tick 开头统一清空，在所有 commit 移动生产模块之后统一结算。
- `Teams` / `PowerCreeps` 等晚段模块的移动意图当 tick 生效。
- 拥堵采样仍读取结算后的位置，`Visuals` 仍读取结算后的位置。
- 钩子保持 P0，预算带不因 P2/P3 门槛跳过结算。
- 不改变 agents 阶段既有任务驱动路径、`isWorkTile` 语义和 Memory 结构。

**Non-Goals:**

- 不修 B2（名册）、B6（核弹）、B7（小写根）、B8（结构缓存）、B9（校准）、B12（布局）。
- 不重写 BetterMove，不拆分 `movement/index.ts`，不改 `Creep.prototype.move/moveTo` 猴补丁。
- 不改变 stronghold 的编队时序，不把 stronghold 的窗口并入主链装配。
- 不新增配置项，不升级 Memory schema。

## Decisions

### D1: 窗口钩子放在 agents 领域，而不是 movement 引擎

新增 `src/modules/agents/movementWindow.ts`，导出 `MovementStart` / `MovementEnd` 与 `isWorkTile`。理由：

- `isWorkTile` 读 `Memory.Nexus.tasks` 与 `rooms[*].worksites`，属于 agents / 任务领域，不属于 BetterMove 引擎。
- `MovementEnd` 还负责 `updateCongestion`，它消费 `WorldView` 与任务执行结果，放在 agents 领域符合现有依赖方向。
- 若放到 `modules/movement`，movement 会反向依赖任务 schema，破坏移动引擎的纯执行定位。

备选：保留在 `agents/index.ts` 并只导出钩子。缺点是 `Broker` 仍与窗口同文件，职责边界不清晰；拆出后 `index.ts` 只保留 Agents / Broker 装配。

### D2: 起点在 perception P0、终点在 commit P0，且终点在 Visuals 之前

- `MovementStart`：`phase: "perception"`、`band: "P0"`，在入口模块清单第一位注册，先于 `Perception`。此时只清模块级缓存，不依赖 `world.current`。
- `MovementEnd`：`phase: "commit"`、`band: "P0"`，注册在所有 commit 移动生产模块之后、`Visuals` 之前。主链顺序为 `... Comms → EventBusEnd → FunnelEnd → InterShardEnd → ClearEnd → StatisticsEnd → ActorOwnershipPersist → MovementEnd → Visuals → Pixel`。
- P0 的理由：`endTickResolve` 是单位移动的唯一出口，不能像 P2/P3 分析段那样在 bucket 低时被跳过。`runIsolated` 仍保留错误边界与熔断，行为与旧 Broker 钩子一致。
- 终点不放在绝对末位的理由：`Visuals` 需要结算后的位置；`Pixel` 等末位模块不产生移动意图。未来若在 `MovementEnd` 之后新增移动生产模块，必须在同一提交内把 `MovementEnd` 后移或显式登记豁免。

备选：保留在 Broker 内，只把 `endTickResolve` 改成「延迟到 tick 末」的回调。缺点是 Broker 仍拥有移动生命周期，且回调注册顺序隐式；独立 TickModule 的装配顺序可直接审阅。

### D3: `isWorkTile` 原样搬移，B7 留给独立变更

`isWorkTile` 的现有实现读小写 `Memory.nexus`（B7），导致工位锁实际不生效。本变更只搬移函数，不改变其行为，避免把「移动窗口」与「Memory 根修复」混在同一次 sim 对照里。搬移后在 `docs/nexus-design/12` §25.2 注明 B7 仍待独立变更。

备选：顺手改为 `Memory.Nexus`。会让本变更同时改变工位锁与移动窗口，sim 漂移无法二分归因；拒绝。

### D4: Broker 只保留提交与记账

`Broker.run` 删除 `preTickBetterMove` / `endTickResolve` / `updateCongestion`，保留 `takeIntents`、`broker.submit/commit`、结果回投、`noteMoveIntent`、`recordActionRates`、`recordTowerSpend`。移动窗口只有一个所有者，避免将来再次出现「谁先注册谁结算」的隐式契约。

### D5: stronghold 维持现有拆分窗口

`StrongholdMoveStart` / `StrongholdMoveEnd` 已经满足「Teams 前重置、Teams 后结算」，且 stronghold 不挂 Perception / Agents / Visuals。本次只做一致性核对，不改为共享模块；共享需要为「无经济工位」注入谓词，收益低于改动风险。

### D6: 取代旧时序锚点

`nexus-architecture-refactor` 任务 5.7 把 `preTickBetterMove → broker.commit → endTickResolve` 固定为契约。本变更把契约改为「tick 开头重置 → 所有 commit 移动生产模块 → 结算 → 拥堵采样 → 可视化」。实现时更新旧任务注记与 `docs/nexus-design/12` §25.2 / §25.6，避免后续变更继续引用旧锚点。

## Risks / Trade-offs

- **[编队 / Power Creep 行为变化]** 修好后它们当 tick 移动，`arena`、`stronghold-door` 等场景可能出现时间线漂移。→ 先重冻变更前基线，再逐场景归因；只接受「晚段移动意图开始生效」可解释的漂移，其余按回归处理。
- **[CPU p95 上移]** 结算从 Broker 段移到 commit 末段，总成本不变但峰值位置变化。→ 以 `sim-matrix` 的 p95 对照，劣化 >2ms 拒绝；必要时检查 `MovementEnd` 是否在 `Visuals` 前产生额外扫描。
- **[Visuals 读到旧位置]** 若 `MovementEnd` 被错误注册到 `Visuals` 之后，画面会滞后一 tick。→ 入口顺序测试 + 代码注释锚定；任务中显式核对 `main/local/season` 三处注册序。
- **[钩子熔断导致冻结]** `MovementEnd` 连续抛错会被错误边界熔断，移动停摆。→ 沿用现有熔断语义并在遥测中保留模块名；`endTickResolve` 本身无新增外部调用，风险不高于旧 Broker 钩子。
- **[B7 继续存在]** 工位锁仍因小写根失效。→ 在本变更文档中显式标注，B7 独立变更修复；不在本变更的 sim 结论里宣称工位锁已修复。
- **[未来模块绕过窗口]** 新 commit 模块若在 `MovementEnd` 之后登记移动，会重现 B1。→ 在 `movementWindow.ts` 与入口清单加注释；spec 的「End hook sits after movement producers」场景作为评审检查项。

## Migration Plan

1. 先跑变更前基线（`sim-matrix` 8 门 + `run-residue` + `stronghold-door`），存档到本变更 `baseline/`。
2. 新增 `movementWindow.ts`，从 `agents/index.ts` 搬移 `isWorkTile`，删除 Broker 内三个钩子调用。
3. 在 `main.ts` / `local` / `season` 入口按 D2 顺序装配；`stronghold` 不动。
4. 跑 typecheck / lint / 单测 / 全场景门；对 `arena` / `stronghold-door` 的漂移做归因，确认是晚段移动意图生效后重冻基线。
5. 更新文档与旧变更注记，提交基线快照。

回滚：恢复 `Broker.run` 内的 `preTickBetterMove` / `endTickResolve` / `updateCongestion` 三行并移除入口钩子即可；无 Memory 迁移、无配置回滚。

## Open Questions

无。B1 的行为面已由现行代码确认；B4 已解决；其余 M0 项明确排除。
