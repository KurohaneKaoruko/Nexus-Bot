# 08. `dev` 分支复核（`dbe9d01`，2026-10-27）

> design/24、design/25 与 analysis/01–07 都基于 `main` v1.0.0（`73d3295`）。本文把其中的缺陷与设计结论逐条对照 `dev` 复核，标出哪些已修、哪些仍在、哪些已被维护者自己记录，以及 `dev` 上新发现的问题。
> 方法与前文相同：只读代码，没有运行 bot、tsc 或 sim。路径相对 `dev` 的 `src/`。

## 1. 总体判断

`dev` 比 v1.0.0 往前走了很多，design/25 描述的「双轨并存」大部分已经收口：

- `exec()` 双轨全链已退役（`docs/nexus-design/10-legacy-removal-ledger.md` 2026-10-25 条目；`agentSystem.ts` 中已无 `NEXUS_TASK_DRIVEN_CODES` 与原型 `exec()` 分支）。
- 旧任务池六池全链、manager / transporter / miner 原型执行体已删除，由 `linkQuota`、`manageQuota`、`mineralWork` 等接管（同台账）。
- 孵化只剩主线：`proto/features.ts:46` 注明 `SpawnWork → spawnControl.SpawnCreep` 已退役；`spawnCreep` 只出现在 `spawnDirector.ts:459`、`actionBroker.ts:794`（孵化进 Broker）与 race 变体。
- Power Creep 的原生调用改为 `powerAdapter` 提交面，移动走 Broker（`proto/PowerCreep/execute.ts:4,37`）。
- 维护者已有自己的架构审计与删除门禁：`docs/Nexus-Bot-03-BUG清单.md`（35 项）、`docs/Nexus-Bot-02-重构指导.md`（Phase 0–15 门禁 G-P0..G-P15）、`docs/nexus-design/10-legacy-removal-ledger.md`（四条件删除台账）。

因此 design/25 的 §25.3 分域现状与 §25.6 迁移路线在 `dev` 上**整体过时**，以维护者的 02 / 03 / 10 号文档为准。仍有参考价值的是下表中「仍在」的条目，以及第 3 节外矿的增量建议。

## 2. B1–B13 在 `dev` 上的状态

| # | v1.0.0 缺陷 | `dev` 状态 | 证据 |
|---|---|---|---|
| B1 | Broker 之外的移动意图被清空 | **机制仍在，影响面缩小** | `agents/index.ts:57` 仍在 Broker（commit 阶段）开头 `preTickBetterMove()`，`:96` 解算；`main.ts` 中 `Teams` 仍注册在 `Broker` 之后（`teams/index.ts:19` 为 commit 阶段）。原型 `exec()` 与 Power Creep 已不再绕过 Broker。编队的 `TeamAction.move`（`teams/core/TeamAction.ts:626`）最终是否经 BetterMove 包装登记意图未逐行确认——若是，编队移动仍会在解算之后登记而丢失（推断） |
| B2 | 单位离开己方房即被当作死亡 | **已修** | `world/perception.ts:311-327` 收集非己方可见房中的本方单位为 `remoteUnits`（注释引 bugs/P1-18 断点④）；`aliveNames` 包含 `remoteUnits`（`core/world.ts:205-216`）；分配器候选（`tasks/index.ts:77`）、驱动（`agentSystem.ts:1839`）、速率（`economy/model.ts:121-129`）都已纳入 |
| B3 | 两套孵化器同时在跑 | **已修** | 见第 1 节 |
| B4 | `in` 判断 `Set` 成员 | **已不存在** | `exec()` 双轨退役，判定随之删除 |
| B5 | 孵化了却无执行器的角色 | **维护者已记录，部分收口** | `docs/bugs/role-registry-executor-gap.md`（P1，2026-10-16 发现，主线断链 10-17 收口，剩余批次见任务 5.2）；词表死角色已裁撤（台账 2026-10-25） |
| B6 | nuke 旗帜触发 TypeError | **仍在，维护者已记录** | `docs/bugs/nuker-launch-missing-impl.md`（P2）；调用仍在 `proto/Flag/function/baseFunction.ts:48,51`，实现仍缺。补充：该调用位于 RoomFeatures 的旗帜循环内，抛错会中断同模块本 tick 的其余处理并可能触发熔断，影响比「核弹链路非主线」更大（v1.0.0 机制，`dev` 上未复核熔断细节） |
| B7 | `isWorkTile` 读小写 `Memory.nexus` | **仍在** | `agents/index.ts:26`：`(Memory as unknown as { nexus?: NexusMemory })?.nexus`。持久化根仍为 `Memory.Nexus`，此处恒为 `undefined`，工位锁不生效 |
| B8 | 结构缓存从不刷新 | **仍在** | 全仓无 `room.update()` 调用（只剩 `types/room.interface.d.ts:6` 注释） |
| B9 | 校准整体重建 `Memory.Nexus` | **仍在** | `core/store/calibration.ts:90,102,149` 三处 `createMinimal` 重建路径未变 |
| B10 | QoS 恒为 normal | **仍在** | `updateQoS` 在 `core/qos.ts` 之外仍无调用方 |
| B11 | `room.memory.defend` 无人写入 | **仍在** | 读方仍在（`proto/Room/function/baseFunction.ts:333-334`、`proto/PowerCreep/function/usePower.ts:41,48`），全仓无写入 |
| B12 | 布局数据分两处 | **仍在** | 规划器写 `Memory.Nexus.layout` 记录（`planner/memory.ts:42-52`、`layoutPlanner.ts:65,88,111`）；`economy/coreDepot.ts:3,32` 仍经 `getLayoutData` 读旧 `LayoutData`；`proto/Flag/function/layoutVisual.ts`、`external/road/*` 同样读旧域 |
| B13 | claim 链路不通 | **部分修复** | `strategy/expansion.ts` 已改用 `orthogonalNeighbors`（`utils/roomCoord`，注释引 bugs/P1-17），W/S 拼接与预定判断两分支问题已消失；仍只在有视野的邻房中选目标（`expansion.ts:31-33`） |

**仍值得优先处理的（`dev`）**：B7（一行修复）、B12（中央仓位查询返回空）、B9（校准重建连带抹掉旧域）、B8（新建结构不可见）、B11（旧读方读不到防御态）、B6（补实现或在旗帜循环内防护）、B1（确认编队移动是否丢失）。

## 3. 外矿：`dev` 已有什么，design/24 还剩什么

`dev` 在 2026-10-27 的 `83153f3`（「批次 AD 上游外矿链整套移植」）中重写了主线外矿：`economy/remoteMining.ts`（502 行）、`spawning/remoteBudget.ts`、remoteMiner（RM）单位、外矿替补环、容器位与体型配套。对照 design/24：

| design/24 一期内容 | `dev` 现状 |
|---|---|
| 名册（跨房单位不判死、被驱动、被分配） | 已有（`remoteUnits`，见 B2） |
| 经济规划器清扫豁免 | 已有：目标房 ≠ 本矿的任务不扫（`economy/planners.ts:436-444`，注释引 bugs/P1-18 断点⑤） |
| 侦察、预定、外矿搬运（容器 → 母房） | 已有：scout / reserve / carry 任务（`remoteMining.ts:236-325`、`upsertRemoteCarry` `:147`、`cancelStaleRemoteCarryTasks` `:214`），预定续订阈值 `RESERVE_CONFIG.refreshTicks` |
| 外矿孵化预算 | 已有：`remoteSpawnLeftoverOf`（`spawning/remoteBudget.ts`），按部件当量从剩余孵化容量扣除 |
| 开关 | 已有：`profile.remoteMining` 三档 `off` / `manual` / `auto`；`manual` 读 `ctx.memory.economy.remoteTargets` |
| 多房 Intel 三态、房间类型推导 | **缺**：`manual` 模式直接读 `Game.rooms`（`remoteMining.ts:251-262`）；`auto` 的候选是 8 个邻房（`remoteSourcesOf` `:50-81`），不区分高速路 / SK / 中央房 |
| 外矿安全（威胁观测、暂停、撤回、恢复、剔除） | **缺**：`remoteMining.ts` 中没有任何敌对 / invader / keeper 判断 |
| 状态机与转移原因、最小驻留 | **缺** |
| 实测净收入反馈与亏损剔除 | **缺**（准入只看孵化容量，不看实测到账） |
| 旧外矿链删除 | 未做：`modules/external/` 仍在，拆成 `mine/`、`road/` 子目录，`outMine()` 仍无调用方（`proto/features.ts:52` 注释） |

**`dev` 外矿的新问题**

1. **外矿源注册表不分殖民地**：`remoteSourcesOf(ctx, homeRoomName)` 先读 `ctx.memory.economy.remoteSources`，非空即直接返回（`remoteMining.ts:51-52`），不看 `homeRoomName`；列表只在第一次计算时按当时的母房生成并永久缓存（`:76`）。第二个殖民地会拿到第一个殖民地的外矿列表与路程；母房 spawn 变化后路程也不会重算。建议按母房分键缓存，并在 spawn 集合变化时失效。
2. **候选不排除 SK / 高速路 / 中央房**：`neighborRooms` 的 8 个邻房全部进入注册表并做 PathFinder；SK 房的源会被当作普通外矿。design/24 §24.6.1 的房名推导规则可以直接用作过滤。
3. **无视野房以房间中心为锚点算路程**（`remoteMining.ts:62-64`），修正依赖矿工 / reserver 首次进房（`ensureRemoteSourceIntel` `:83`）；在修正之前，准入与吞吐定编用的是房心路程。

## 4. 本 PR 各文件在 `dev` 上的适用性

| 文件 | 适用性 |
|---|---|
| `design/25-旧Bot迁移总图.md` | §25.2 的 B6–B12 仍适用（见第 2 节）；§25.3 分域现状、§25.4 双轨清单、§25.6 路线已被 `dev` 的进展与维护者的 02 / 03 / 10 号文档取代 |
| `design/24-外矿迁移.md` | 名册、清扫豁免、侦察 / 预定 / 搬运、孵化预算已在 `dev` 实现；**仍可参考**：§24.6 多房 Intel（三态、房间类型推导）、§24.7 选点状态机与推导口径、§24.9 外矿安全、§24.10 收益反馈、§24.11 旧链删除清单 |
| `openspec/phase4-remote-intel/` | 第 1、3、5 节大部分已被 `dev` 覆盖；第 2、4、6、7 节可按 `dev` 现有的 `remoteMining.ts` 结构改写后使用 |
| `analysis/01–07` | v1.0.0 的走查记录，留作历史参照 |

## 5. 建议

1. 先做一行修复 B7（`Memory.nexus` → `Memory.Nexus`），并按第 3 节第 1 条修 `remoteSourcesOf` 的跨殖民地缓存。
2. 把 B12 与 B8 纳入 `docs/Nexus-Bot-03-BUG清单.md` 统一追踪（清单里未见对应条目）；B9 建议同样登记，并在 `calibration.ts` 的重建路径中保留旧域。
3. 外矿下一步按 design/24 §24.9 补安全（威胁观测与暂停），按 §24.6 用房名推导过滤 SK / 高速路 / 中央房。
