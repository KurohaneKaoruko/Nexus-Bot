# Proposal: legacy-consolidation

## Why

`nexus-architecture-refactor` 已把新架构（TickModule 相位管线 + TaskBoard + ActionBroker + Actor Ownership + 架构守护）立成主线并完成 58/61 任务，但它留下的是**两套系统共存**的状态，而不是单一架构：

- **执行体双轨仍在**：`agentSystem.ts` 的 `NEXUS_TASK_DRIVEN_CODES` 只覆盖 10 个角色代号，集合外的角色（`manager`/`miner`/`transporter` 与全部战斗族）仍走 `creep.exec()` → `roleRegistry` → `src/proto/Creep/function/*` 的旧角色行为库。`legacyExecMode` 开关仍为 `on`。
- **任务源双轨仍在**：`room.MissionUpdate()` 每 tick 在 `RoomFeatures` 里为每个己方房调度 mission pool 更新器（transport/manage/work/mine/boost/buildRepair），与任务板并行产出两份任务事实源；`Memory` 里同时存在 `Nexus.tasks` 与 `MissionPools`。
- **旧代码体量仍大**：`src/proto/` 6937 行、`modules/spawning/mission/` 2722 行、`modules/economy/units/` 700 行、`modules/external/mine/` 2650 行休眠链；架构守护仍有 **273 处直连游戏 API / 40 文件 / 128 条豁免**，其中 P6（proto 角色库）56 条 150 处、P7（economy/units）12 条 19 处。
- **代码形态仍旧**：`@ts-nocheck` 35 个文件、`: any` 466 处；`movement/index.ts` 3343 行、`agentSystem.ts` 1727 行（其中 `runCreep` 单函数 484 行）、`TeamAction.ts` 1806 行、`63Planner.ts` 1183 行，均为 `any` 直通的大文件，与"高内聚、低耦合"背道而驰。

上一轮把"控制权"收编进边界，本轮收的是**代码本体**：把旧执行体与旧任务源按职责域真正退役，把大文件按内聚边界切开，把不可达代码删掉。`nexus-architecture-refactor` 的 9.2（legacy 删除执行）之所以迟迟不能推进，是因为 `manager`/`miner` 在 sim 的 RCL≤3 域结构性不出现、`external/mine` 全链休眠——本变更把这些"sim 不可达但仓库里活着"的域逐个定性并处置，正是 9.2 的前置。

`docs/nexus-design/02-architecture-charter.md` §21 已裁定"目录重组只在模块收编自然发生时顺带进行"，故本变更不搬家、不改目标目录，只按职责域消除第二实现。

## What Changes

分三波推进，每波内部按"最小可回退单元（一个职责域）"切片，切片之间以全场景门回归线为闸。

**A 波 — 旧执行体与旧任务源退役**

- `manager`/`miner`/`transporter` 三族按任务化重写：`manager`（storage↔link/terminal 中枢搬运）并入 `carry` + 配额目的地，`miner`（元素矿）并入 `harvest` + 矿点工位，`transporter`（工地搬运）并入 `carry`；退役 `modules/economy/units/*` 与 `utils/moveWork.ts` 侧信道（移动意图改走 broker `MoveIntent`）。
- mission pool 全链退役：`transport/manage/work/mine/boost/buildRepair` 更新器与 `MissionPools` 池化层删除，`room.MissionUpdate()` 从 `RoomFeatures` 摘除；`mineMission` 依赖的 `Memory.OutMineData` 人操目标改由任务板承载或随外部域一并退役。
- `src/proto/Creep/function/*` 角色行为库收缩为**纯库**（缓存、查询、体型评估），不再持有任何游戏 API 突变；战斗族执行体迁出 `roleRegistry` 成为 `modules/agents` 的任务处理器（经 broker 提交）。
- 删除 `exec()` 双轨与 `legacyExecMode` 开关：`NEXUS_TASK_DRIVEN_CODES` 分水岭、`roleRegistry`、`Creep.prototype.exec` 全部退场。
- 词表死角色（`deposit-haul/take`、`power-haul/take`、`cleaner`、`logistic`、`dismantle`、`out-*` 无孵化源者）裁撤，`UnitData.executor` 字段随角色退场逐批删除。

**B 波 — 模块内聚与类型门禁**

- `modules/movement/index.ts`（3343 行）按内聚边界拆为：路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动六个模块；`MoveIntent` 契约保持 `preTickBetterMove → commit → endTickResolve` 时序不变（破坏即全员冻结）。
- `modules/agents/agentSystem.ts`（1727 行）按任务 kind 拆为 handler 表，`runCreep` 单函数 484 行拆为 `harvest/carry/upgrade/build/repair/claim/remote/*` 分派单元。
- `modules/teams/core/TeamAction.ts`（1806 行）、`modules/planner/dynamic/63Planner.ts`（1183 行）按职责拆分。
- `@ts-nocheck` 35 文件清零；`: any` 466 处设单调下降预算并按域收敛；模块间依赖方向纳入守护脚本（禁止 `modules/*` 反向依赖 `proto/`、`console/`）。

**C 波 — 休眠与不可达代码退役**

- `modules/external/mine/*`（2650 行休眠链）与 `outMine`/`ExternalMine` 原型挂载退役；活链是 `economy/remoteMining` 的 `planRemoteHarvest` + 任务板。
- `proto/PowerCreep/mode/*` 休眠模式、`proto/Flag/function/warSpawn.ts` 旗标战争孵化线、`modules/visuals/highwayMine.ts` 等零挂载/零引用面清理。
- 死导出与双实现收敛：`core/qos.ts` 兼容读口随 legacy 消费方退场逐段摘除；`core/store/accessor.ts` 的 legacy 域 getter 随对应域删除。

**BREAKING**：`Memory.MissionPools`、`Memory.OutMineData`、`Memory.rooms[].energyState*` 等 legacy 域随域退役做 schema 迁移删除；`Creep.prototype.exec` 与 `roleRegistry` 公共面消失；外部脚本/控制台命令中引用这些路径的入口同步改写。

## Capabilities

### New Capabilities

- `legacy-execution-retirement`: 旧角色执行体按域退役的判定与执行契约——包括"新实现已在生产路径接管"的等价判据、`exec()` 双轨的分阶段关闭点、`roleRegistry` 与词表 `executor` 的退场顺序，以及删除必须登记台账且未满足实服条件时如实标注。
- `mission-pool-retirement`: mission pool 调度链退役契约——任务板成为唯一任务事实源、`Memory` 中双写结构迁移与清理、以及 per-room 调度入口退场后 `RoomFeatures` 的职责收敛。
- `code-structure-standards`: 模块内聚与类型门禁——文件规模上限、拆分判据、模块依赖方向、`@ts-nocheck` 禁令与 `any` 预算单调下降。
- `dormant-code-retirement`: 休眠/不可达代码的退役契约——判定"零挂载、零调用点、仅有类型声明"的口径，以及退役后 `Memory`、类型声明、`console` 入口的同步清理。

### Modified Capabilities

（无——主 specs 现仅 `cluster-squad`，本变更不改变其编队仅持槽位、成员经任务反填的既有约定；`nexus-architecture-refactor` 未归档的 `legacy-removal-gate`/`command-boundary` 等 delta 定义保持不变，本变更只在其门禁下执行删除并新增台账行。）

## Impact

- **代码域**：`src/modules/agents`（handler 表化、`runCreep` 拆分）、`src/modules/economy`（`units/` 退役、配额并入 `carry`）、`src/modules/spawning`（`mission/` 退役）、`src/proto`（角色行为库收缩为纯库、`exec` 与 registry 退场）、`src/modules/movement`（六模块拆分）、`src/modules/teams`（`TeamAction` 拆分）、`src/modules/planner`（`63Planner` 拆分）、`src/modules/external`（`mine/` 退役）、`src/core`（`qos` 读口、`accessor` legacy getter）、`src/console`（引用改写）。
- **删除量级**：预计净减约 7000–9000 行（`proto` 角色行为库 3584 行中的突变部分、`mission/` 2722 行、`economy/units/` 700 行、`external/mine/` 2650 行、`utils/moveWork` 与死导出）。
- **架构守护**：直连调用 273 处 / 128 条 → 目标 ≤104 处 / ≤60 条（清掉 P6 的 56 条 150 处与 `economy/units` 的 12 条 19 处）；`config/arch-allowlist.min.json` checkpoint 单调不增。
- **Memory**：schema 版本递增 + 逐版本纯函数迁移；`MissionPools`/`OutMineData` 删除需带一次性清理，禁止留悬挂键。
- **测试**：全场景门回归线（`scripts/sim-matrix.mjs`，8 场景）+ 单测扩充（`runCreep` 拆分后的 handler 分派、mission pool 迁移函数、移动意图契约）+ 架构守护与类型门禁脚本。
- **风险与约束**：`manager`/`miner`/`transporter` 在 sim 的 RCL≤3 域结构性不出现，其等价性只能靠单测 + 实服观察证明；本轮实服条件**不落实**，删除台账逐行显式标注"实服待补"，不得冒充实四条件齐备。
- **不变项**：不整树搬目录（`02-architecture-charter.md` §21.1 现行结构即权威）；不动 `race-speedrun-10-20-40` 与 `refine-architecture-docs`；`nexus-architecture-refactor` 保持 in-progress，9.2 的台账行由本变更补入。
- **基线**：`dev` HEAD `4a3ee14`；回归参考快照取 `nexus-architecture-refactor/baseline/sim-matrix-reference.json`（speedrun L4@32160 / arena L3@10286 / sprint L3@41766 / boot L3@8915 / race L2@458 / remote-mine L3@0）。
