# 25. 旧 Bot 迁移总图：Rosmarin → Nexus

> 本文是 Rosmarin-Bot（旧 bot，参照基线：Rosmarin-Bot main 2026-10-02）迁入 Nexus 架构的全仓现状图与迁移路线。
> Phase 进度以 `docs/Nexus-Bot-02-重构指导.md` 为权威；架构定案见 `02-architecture-charter.md §21`。本文回答「旧 bot 的每项能力现在由谁在跑、还剩什么没迁」。
> 快照日期 2026-10-28，基于 main 变体（`src/main.ts`）的代码走查，**未运行代码**；标「推断」的条目需 sim 或私服取证。
> 外矿的逐项迁移见 `13-external-mining-migration.md`（本文所有 `docs/24`、`docs/nexus-design/24` 引用均指该文件）。

> ⚠ **基线适配（2026-10-29 整理入仓）**：本文走查基于 v1.0.0（`73d3295`）。dev 已演进百余提交，部分结论被超越——最显著：旧外矿链 `modules/external/` 已整链删除（legacy-consolidation-b C 波，见 `10-legacy-removal-ledger.md`）；Phase 进度以 `docs/Nexus-Bot-02-重构指导.md` 为权威。file:line 引用使用前对照当前代码复核。

## 25.1 状态口径

| 标记 | 含义 |
|---|---|
| **主线** | 走 Nexus 主干：TickModule → TaskBoard / Allocator → AgentSystem → ActionBroker，或 Nexus 自有的领域模块，热路径上没有旧代码 |
| **包装** | 有 Nexus TickModule，但 `run` 里调用的是旧代码 |
| **混合** | Nexus 决定一部分，旧代码执行另一部分 |
| **旧代码在跑** | 旧代码经其他入口（`RoomFeatures` 特性链、原型 `exec()`、旗帜）从 `main.ts` 可达并在执行 |
| **死代码** | 文件在，但 `main.ts` 不可达；只剩控制台入口的记为「死代码（控制台）」 |
| **缺失** | Rosmarin 有，Nexus 没有对应物 |

## 25.2 先修：跨域阻断性缺陷

这些缺陷不属于某一个域，但会让多个域的迁移结论失真。按影响排序。

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| B1 | **Broker 之外发出的移动意图全部丢失** | BetterMove 接管 `move` / `moveTo`，调用只登记意图（`movement/index.ts:1957`）；`Broker.run` 开头 `preTickBetterMove()` 清空意图（`agents/index.ts:56` → `movement/index.ts:3295`），随后 `endTickResolve()` 只解算剩下的意图（`agents/index.ts:68`）。同阶段模块按注册序执行（`core/scheduler.ts:43-51`） | 机制已走查确认；行为后果为推断，需 sim 取证：① 原型 `exec()` 在 agents 阶段运行，意图在 commit 阶段开头被清掉——manager / transporter / miner 及所有走 `exec()` 的空闲单位不移动；② `Teams`（`TeamController`）与 `PowerCreeps` 是 commit 阶段且注册在 `Broker` 之后（`main.ts`），意图登记在解算之后、下 tick 被清——编队与 Power Creep 不移动。同样注册在 Broker 之后的 `Nukes`、`InterShard`、`Expansion` 不发移动意图（`teams/index.ts:33`、`intershard/index.ts:16`、`external/expand/ExpandModule.ts:15-18`），不受影响；扩张单位不动的原因是缺执行器（B5），修 B1 不会让它们动起来。Rosmarin 在 tick 开头清、tick 末尾解算（Rosmarin `src/modules/MoveModule.ts:44-48`） |
| B2 | **单位离开己方房即被当作死亡** | 感知只快照己方房（`world/perception.ts:88`）；`aliveNames` 只数快照（`core/world.ts:193`）；`runSpawnDirector` 删 `units` 与 `Memory.creeps`（`spawnDirector.ts:220-229`） | 跨房单位丢失 `memory.role` / `targetRoom` 等；外部房的单位不被驱动。详见 `13-external-mining-migration.md` §24.3 A、§24.5 |
| B3 | **两套孵化器同时在跑** | 旧任务池：`features.ts:45-46` → `MissionUpdate` / `SpawnWork` → `spawnControl.ts:294`（另有 `:126`、`:181`、`:328` 应急）；主线：`spawnDirector.ts:476`。`features.ts:41` 注释称「已退役」，与代码不符 | 旧池孵化的单位名形如 `H#XXXX`（`utils/naming.ts:42-44`），主线在岗计数与替补窗口看不到它们；旧池按 `role` 与 `home || homeRoom`（`utils/creepTickIndex.ts:81`）能看到主线单位。两者在同一 tick 可能对同一 spawn 下单（推断） |
| B4 | **`in` 判断 `Set` 成员恒为 false** | `agentSystem.ts:1172`：`creep.unitCode in NEXUS_TASK_DRIVEN_CODES` | 所有无任务指针的单位（含主线 harvester / carrier / defender）落入原型 `exec()`。叠加 B1，它们空闲时的移动意图同样被清空（推断，见 B1） |
| B5 | **已孵化但没有执行器的角色** | `roleRegistry`（`prototype/Creep/runtime/registry.ts:29-51`）缺：scout、reserver、claimer、cleaner、dismantle、logistic、attack-claimer、aid-*、up-*、power-*、deposit-harvest / transfer / attack / ranged、out-*（deposit-heal 有执行器，`registry.ts:41`） | 仍有活路径在孵化其中若干（`teams/flags/warSpawn.ts`、`ExpandController.ts:218-236`、`mineMission.ts:121-211`），孵出后只记 `missing-handler` 并闲置（清单来自分域走查，逐个角色的孵化入口未全部复核） |
| B6 | **nuke 旗帜让整个 RoomFeatures 模块抛错** | `Flag/function/baseFunction.ts:46,49` 调 `room.NukerCanLaunchTo` / `NukerLaunchTo`，二者只在 `types/room.interface.ts:71,78` 声明，没有实现 | 一面 `nuke-*` 旗帜 → 每 tick TypeError → 同模块的 `MissionUpdate` / `SpawnWork` / 其余旗帜处理被跳过；连续失败触发熔断 100 tick（`errorBoundary.ts:34,78`）。`teams/NukeModule.ts` 正好会创建这种旗帜 |
| B7 | **`isWorkTile` 读小写 `Memory.nexus`** | `agents/index.ts:25`；持久化根是 `Memory.Nexus` | 恒返回 true，采集工位锁不生效，矿工可被推离工位 |
| B8 | **结构缓存从不刷新** | `core/structureCache.ts` 依赖 `room.update()` 重建索引，全仓无调用方；Rosmarin 每 10 tick 调用（`framework/runner/RoomRunner.ts:14`） | 新建的 lab / tower / extension 等在 global reset 前对 `room.lab` 等 getter 不可见；`labWork` 等包装域依赖它 |
| B9 | **schema 校准会整体重建 `Memory.Nexus`** | `core/store/calibration.ts:94-104`（版本不可识别）、`:140-150`（迁移抛错）；`:88-92` 是根缺失时的初始化，不算重建 | 新 schema 与旧 accessor 共用 `Memory.Nexus`（`accessor.ts:13`），重建会连带抹掉 StructData、MissionPools、TeamData、OutMineData、RoomData 等旧数据。也没有从 Rosmarin 根键迁移的逻辑 |
| B10 | **QoS 恒为 normal** | `updateQoS` / `noteTickCpu` 无调用方（`core/qos.ts:55,92`） | 旧代码里按 QoS 等级的降级、应急冻结、CPU 熔断全部不生效；只剩 `every` / `minBucket` 节流 |
| B11 | **`room.memory.defend` 无人写入** | 读方：`labControl.ts:30`、`usePower.ts:64`、`economy/energyLogistics.ts:81`、`spawnRules.ts`、`externalMine.ts`；唯一写方是 Rosmarin `prototype/Room/feature/roomDefense.ts:89-100`，未迁 | 若 Memory 里残留 Rosmarin 时期的 `true`，lab 与 Power Creep 逻辑一直冻结；否则这些「防御期暂停」从不触发。另外，旧补能链（`features.ts:32` 注册）在受威胁时不会提升塔补能优先级 |
| B12 | **布局数据分在两处** | 规划器写 `Memory.Nexus.layout`（`planner/memory.ts:9-15`）；旧读方读 `LayoutData`（`economy/coreDepot.ts`、`spawning/mission/updaters/workMission.ts`、`Flag/function/layoutVisual.ts`、`external/externalRoad.ts`），无人写入 | 中央仓位查询返回空；旗帜布局可视化读空；外矿路网路线无法规划 |
| B13 | **claim 链路不通** | `strategy/expansion.ts` 房名拼接不分 W/S、预定判断两分支同为 `return name`；扩张目标只从有视野的邻房中选（`expansion.ts:34-35`）；主线把 claim 映射到不带 CLAIM 的 universal（`spawnDirector.ts:66`），`claimer` 不在 `isSpawnUnit`；claimer 进入目标房后不再被驱动（B2）。（`claimController` 直接调用、绕过 Broker（`agentSystem.ts:731`）本身能生效，不是阻断原因，列为 M5 的架构项） | 主线扩张不会成功占领（推断） |

**校准提示**：P1-14 的 workforce 校准（docs/bugs、workforce-logistics）是在 B1 / B3 / B4 存在的条件下做的。修复其中任一项都会改变家内经济的实际行为，修复后需要按校准纪律成套复测，而不是沿用旧结论。

## 25.3 分域现状

### 25.3.1 内核与存储

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| Tick 调度 / 8 阶段 | 主线 | `core/scheduler.ts`、`core/phases.ts` | |
| CPU 预算带 P0–P3 | 主线 | `core/cpuBudget.ts:56-77` | |
| bucket 调速器 | 旧代码在跑 | `features.ts:67` → `bucketGovernor.ts:22` | 每 tick 写根级 `Memory.remoteThreshold` 等；它服务的外矿链已不运行 |
| QoS | 旧代码在跑（失效） | `core/qos.ts` | B10 |
| 错误隔离 | 主线（按模块）/ 缺失（按对象） | `errorBoundary.ts`、`tickContext.ts:50-67` | 一个单位或房间抛错即中断整个模块本 tick；Rosmarin 有按对象的隔离（`framework/createApp.ts:30-47`） |
| Memory schema / 迁移 | 主线 | `memorySchema.ts`（v10）、`migrations.ts`、`calibration.ts` | B9 |
| 旧 accessor（`Memory.Nexus` 旧域） | 旧代码在跑 | `core/store/accessor.ts` | 与 schema 共用根对象 |
| 结构缓存 | 旧代码在跑 | `features.ts:15` 副作用导入 | B8 |
| Memory 解析缓存 + `RawMemory.set` 节流 | 缺失 | Rosmarin `framework/createApp.ts:201-242` | Rosmarin 注释估算大 Memory 每 tick 省 1–3 CPU |
| Segments（跨玩家通信） | 缺失 | Rosmarin `modules/DDModule.ts`、`modules/infra/ddcomm.ts` | |
| 统计 | 旧代码在跑 | `endPhase.ts:26` → `core/statistics.ts` | 仅在 `stats` 旗帜存在时运行，与 `core/metrics.ts` 并存 |
| CPU profiler | 死代码（控制台） | `core/cpuProfiler.ts`；`console/function/diag.ts:4,16` | 只剩控制台 diag 读报告；采样入口 `profileStage` / `recordObjectCost` 无调用方，报告恒空；开关读根级 `Memory.stats.profiler`，与文档说明的位置不符 |

### 25.3.2 执行、单位与孵化

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 单位分派 | 混合 | `agentSystem.ts:1145-1179` → `prototype/Creep/runtime/execute.ts` | 有任务走主线 `runCreep`，无任务走原型 `exec()`（B4）；分配器只看身体部件，不看角色（`tasks/allocator.ts:80-125`），任何单位都可能被任务接管再还给旧代码 |
| harvester / carrier / upgrader / worker | 混合 | 主线：`economy/planners.ts` → `agentSystem.ts:450-664`；旧：`economy/roles/*.ts` | 多出的单位、TTL<150 的单位、拿不到任务的单位跑旧角色；旧 upgrader 路径会 boost 并在 RCL8 / TTL<50 自杀 |
| 修理 | 混合 | 主线 `defense/planners.ts:129`；旧 `UpdateBuildRepairMission` → `worker.ts` | |
| manager（中央搬运） | 混合，旧为主 | 孵化：`spawnDirector.ts:124` + `spawnRules.ts:127`；驱动：`roles/manager.ts` + `UpdateManageMission` | 没有主线任务种类；不移动（推断，见 B1） |
| transporter | 混合，旧为主 | `spawnDirector.ts:125`、`roles/transporter.ts` | 同上 |
| miner（元素矿） | 混合，旧为主 | `spawnDirector.ts:126`、`roles/miner.ts` | 同上；元素矿采空时自杀 |
| universal | 混合 | `spawnDirector.ts:300-316`、`roles/universal.ts` | |
| rush-courier | 实际不驱动 | 孵化 `spawnDirector.ts:365-374`；驱动 `runCourierCreep`（`agentSystem.ts:1181`）排在 `exec()` 分支之后，被 `continue` 跳过 | 体型纯 CARRY 无 MOVE 属设计：在 spawn 旁取能后自爆留墓碑（`constant/CreepConstant.ts:58-60`），`runCourierCreep` 只有取能与自爆两个动作（`agentSystem.ts:817-860`） |
| scout / reserver / claimer | 主线不能孵化 | `bodyFactory.ts:65-83` | B5、B13；外矿部分见 `13-external-mining-migration.md` |
| defender | 主线 | `spawnDirector.ts:127,461-471`、`agentSystem.ts:665-697` | |
| 孵化队列 | 双轨 | B3 | |
| `directSpawn` | 混合 | `spawnDirector.ts:508-526` | 主线接口，但体型用旧 `GetRoleBodys` / `GenerateBodys`；编队 / 扩张 / Power Creep 陪护在用 |
| 体型生成 | 双轨 | 主线 `bodyFactory.ts:132-180`；旧 `Room/function/baseFunction.ts:506,566` | |
| 产出就绪闸 | 双轨 | 主线 `productionGate.ts`；旧 `productionGateAccess.ts` → `spawnMission.ts`、`spawnRules.ts` | 公式不同 |
| 吞吐定编 | 双轨 | 主线 `workforce.ts`（全局加总）；旧 `roomWorkforce.ts`（按房） | |
| 出生时 boost | 旧代码在跑 | `mission/index.ts:35` → `boostMission.ts:23`；`spawning/legacy/boostFunction.ts` | 调用方：编队与旧 upgrader；主线没有 boost 代码 |
| renew / recycle | 缺失 | 两边都几乎没有（Rosmarin 仅 `aid-upgrade.ts:63`） | |
| 旧 spawn 迁位 | 缺失 | Rosmarin `Room/function/rushSupport.ts:115` | |

### 25.3.3 物流与经济

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 账本 / 配额 | 主线 | `economy/ledger.ts`、`quota.ts` | 看不到旧角色的搬运 |
| 补能请求 | 双轨 | 主线 `planners.ts:166-283` + quota；旧 `energyLogistics.ts:116` `buildFillRequests`（`features.ts:32` 注册） | 两套分配器指向同一批 spawn / ext / tower |
| 接力搬运 | 主线 | `agentSystem.ts:1022-1142` | |
| 源容器 | 混合 | 主线工位卸货 `agentSystem.ts:486-499`；旧 `harvester.ts`、`creepSource.ts:265-303` 建修 | |
| 控制器容器 | 主线 | `planner/controllerBuffer.ts`、`planners.ts:121-126` | 旧 `ensureControllerBufferSite` 为死代码 |
| 经济模型 / 动作速率 | 主线 | `model.ts`、`agents/index.ts:65` | 只统计经 Broker 的动作，旧角色的动作不计入 |
| 房间能量状态 | 旧代码在跑 | `features.ts:47` → `prototype/Room/function/baseFunction.ts:286-326` | 写 `room.memory.energyState` 等 |
| 跨房能量漏斗 | 包装 | `endPhase.ts:23` → `economy/FunnelModule.ts` | |
| 自动资源调度（ResourceManage） | 缺失 | Rosmarin `src/modules/ResourceManage.ts` | 房间间自动平衡与生产排程 |

### 25.3.4 规划、建造与移动

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 自动布局 | 包装 | `planner/index.ts` → `layoutPlanner.ts:1218` → `autoPlanner.ts` | B12 |
| 静态布局 / 63 规划 / mini 布局 | 死代码（控制台） | `console/function/layout.ts:278-282`；`layoutPlanner.ts:1303`（`buildMini`） | 首房自动启动的提供方已注册但无人调用；mini 房间模式档位存在（`strategy/roomModeAccess.ts:136-150`），但其 facilities / market 开关不被 `runIndustry` 读取（§25.3.6） |
| 控制器缓冲、源旁 extension | 主线 | `controllerBuffer.ts`、`sourceExtensions.ts` | |
| 工地放置与建造顺序 | 包装 | `planner/index.ts:97-119` → `layoutPlanner.ts:1079` | 旧放置点仍在：`creepSource.ts:295`、`miner.ts` |
| 城墙 / rampart 布局 | 包装 | `layoutPlanner.ts:172` | |
| RCL7+ 关键建筑 rampart | 缺失 | Rosmarin `prototype/Room/feature/autoBuild.ts:32-44` | |
| BetterMove / MoveMatch | 包装 | `movement/index.ts:3317-3324`，由 Broker 驱动 | B1、B7 |
| 交通监测 | 主线 | `movement/trafficMonitor.ts` | |
| 跨房寻路 / 路径缓存 | 旧代码在跑 | BetterMove 进程内缓存 | |

### 25.3.5 防御、战争与扩张

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 威胁模型、塔控、安全模式 | 主线 | `defense/index.ts`、`towerControl.ts`、`planners.ts:153-200` | |
| 防御编队 | 主线 | `cluster/index.ts:69-118` | |
| 维修城墙到维护线 | 主线 | `defense/planners.ts:98-140` | 主线没有「刷高墙」：Rosmarin `up-repair` 与 `upSpawn` 缺失。旧 worker 的 `exec()` 路径仍有部分刷墙能力：`getWallMission` 扫描城墙，上限 `getWallHitsMaxThreshold`（`workMission.ts:358-394`），LayoutData 为空时退回关键建筑坐标（`:185-200`） |
| 旧主动防御（defend-* 孵化、防御 cost matrix、`defend` 标记写入） | 缺失 | Rosmarin `prototype/Room/feature/roomDefense.ts` | B11 |
| 防核 | 实际缺失 | 旧 `getWallMission` 的核弹优先级只在 worker 的 `exec()` 路径 | 主线防御没有核弹处理 |
| 战争编队（`TEAM_` 旗帜） | 包装 | `teams/index.ts:23-24` → `TeamController` / `TeamBattle.ts` | 不移动（推断，见 B1） |
| 旗帜攻击（AIO / CLEAN / ACLAIM / DIS / LOOT） | 旧代码在跑 | `features.ts:56` → `warSpawn.ts:57-64` | 只有 aio 有执行器，其余孵出即闲置（B5） |
| 单兵战斗角色（double-* / one-ranged / defend-*） | 死代码（控制台） | `industry/console/spawn.ts:15` | |
| 主线扩张（claim） | 主线，不通 | B13 | |
| 跨 shard 扩张（`expand.set`） | 包装，不运转 | `ExpandController.ts:109-131`（expand.set）、`:214-238`（孵化） | 孵出的 claimer / aid-* 无执行器 |
| claim / aid / up 旗帜 | 缺失 | Rosmarin `prototype/Flag/spawns/{claimSpawn,aidSpawn,upSpawn}.ts` | `console/help.ts:353-378` 仍有说明 |
| 跨 shard Memory | 包装 | `intershard/index.ts`、`interShard.ts:59-125` | |
| 跨 shard 单位转移 | 包装，实际不运转 | `CreepMemoryTransfer.ts:43-45` | 单位需走进传送门；出己方房即不被驱动（B2）且无执行器（B5），因此不运转（推断） |
| 战略姿态 | 主线 | `strategy/core.ts` | 工业与编队不读姿态；旧 `Memory.Nexus.warmode` 另行控制 lab / factory / powerSpawn |

### 25.3.6 工业

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| lab 反应 | 包装 | `industry/index.ts:27` → `labControl.ts:71` | 原料搬运靠旧 manager / transporter，它们大概率不移动（推断，见 B1）；受 B8、B11 影响 |
| boost 备料 | 旧代码在跑 | `MissionUpdate` → `boostMission.ts:23` | 同上 |
| factory | 包装 | `factoryControl.ts:38`、`autoFactory.ts` | 产物经旧任务池搬出；不读房间模式 |
| 市场 | 包装 | `autoMarket.ts` | 仅 QoS normal 运行（B10 下恒运行）；不读房间模式的 market 开关 |
| terminal 发送 | 包装 + 缺失 | `terminalControl.ts:52`；唯一生产方是控制台 | 自动平衡（ResourceManage）缺失 |
| power spawn | 包装 | `powerSpawnControl.ts:20` | |
| Power Creep | 包装 | `industry/powerCreep/index.ts` | 不移动，只能在原地范围内用技能（推断，见 B1） |
| observer | 包装 | `observeControl.ts:74` | 只服务旧高速路扫描；Intel 不用它 |
| 核弹发射 | 缺失（且触发 B6） | Rosmarin `prototype/Room/structure/nukerControl.ts` | |
| link 网络 | 包装 | `linkControl.ts` | |
| 高速路 power / deposit | 旧代码在跑（不运转） | `mineMission.ts:121` | 孵出的角色无执行器 |
| 房间模式门控（facilities / market / stop） | 缺失 | Rosmarin `prototype/Room/execute.ts:10-46` | `runIndustry` 不读 |
| pixel | 主线（关闭） | `economy/pixel.ts`、`config/economy.ts:321` | 控制台 `pixel()` 写的 `GenPixel` 无人读取 |

### 25.3.7 控制台、可视化与变体

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 控制台命令族 | 旧代码在跑 | `features.ts:31` → `console/index.ts:52` | 15 个命令族；挂载在 RoomFeatures 中先于旗帜处理执行、每个 global 只挂一次（`features.ts:22-35,66`），B6 不影响挂载；但依赖 RoomFeatures（P2）运行——global reset 那一 tick 若 P2 预算被跳过，原型方法与控制台都不会挂载 |
| HUD / 面板 | 主线 + 包装 | `visuals/index.ts` | 孵化与 lab 面板被旧链和 Visuals 各画一次（`spawnControl.ts:203`、`labControl.ts:16`） |
| 变体 local / race / season / stronghold | 主线 | `src/branch/*/main.ts` | 与 main 挂同一组模块；race 只差 `roomMode: "rush"`；能力开关 `configureServerCaps` 从未调用（`config/capabilities.ts:37`），`isRaceCompat()` 在 race 构建里也为 false |
| `compat.ts` | 主线 | `src/branch/compat.ts` | `Game.market` 桩在模块加载时打一次，而 `Game` 每 tick 重建，桩大概只在 global reset 那一 tick 有效（推断） |

### 25.3.8 外矿

见 `13-external-mining-migration.md`：旧外矿链主线不运行，主线 `remoteMining.ts` 实际不运转，迁移分四期。

## 25.4 双轨并存清单

同一件事两套实现同时在跑，迁移完成的标志是每行只剩一套：

| 事项 | 旧 | 新 |
|---|---|---|
| 孵化 | `SpawnWork` 任务池 | `spawnDirector` |
| 体型 | `GetRoleBodys` / `GenerateBodys` | `bodyFactory` |
| 产出就绪闸 | `productionGateAccess` | `productionGate` |
| 定编 | `roomWorkforce`（按房） | `workforce`（全局） |
| 补能分配 | `energyLogistics.buildFillRequests` + 旧 carrier | quota + haul / fill_spawn 任务 |
| 角色执行 | 原型 `exec()` | `runCreep` |
| 源路程 / 升级饥饿记账 | `room.memory.sourceTiming` / `upgradersStarved` | `Memory.Nexus.rooms[r].sourceTiming` / workforce 记账 |
| CPU 门控 | `bucketGovernor` + （失效的）QoS | `cpuBudget` |
| 面板 | `roomPanels` | `visuals` |
| 统计 | `core/statistics` | `core/metrics` |
| 布局存储 | `LayoutData` | `Memory.Nexus.layout` |
| creep 归属 | `memory.home` | `memory.homeRoom` |

## 25.5 Memory 现状

- **只有一个根**：`Memory.Nexus`。新 schema 子系统（`tasks`、`units`、`rooms`、`ledger`、`spawn`、`layout`、`squads` …；`remotes` 为外矿契约计划在 v11 新增，当前不存在）与旧域（`StructData`、`AutoData`、`MissionPools`、`RoomData`、`LayoutData`、`TeamData`、`TeamSpawnQueue`、`NukerData`、`Expand`、`OutMineData`、`warmode`、`funnelCooldown`、`stats`、`GenPixel`、`ResourceManage`）并存。
- **根级写入**：`Memory.remoteThreshold` / `activeThreshold` / `activeThresholdUpdated`（`bucketGovernor.ts:24-39`，每 tick）；`Memory.xtrace`（`teams/core/TeamAction.ts:791`，临时调试痕迹，上限 40 条，注释写「查完移除」）。
- **引擎通道**：`room.memory`（`energyState*`、`defend`、`sourcePosCount`、`upgradeTiming`、`mode`…）；`flag.memory`（nuke、TEAM_、战争旗帜节流）；`creep.memory`（`role`、`home` / `homeRoom`、`targetSourceId`、`working`、`bind`、`dontPullMe`、`sourceRoom` / `targetRoom`、`boostmap`、`fsm`、`taskId`、`relayedTick`…）。
- **风险**：B9（校准重建会抹掉旧域）；没有从 Rosmarin 根键迁移的逻辑。迁移期间对旧域的任何清理都要显式列出，不能依赖整体重建。

## 25.6 迁移路线

按依赖排序。每一步是一个独立 openspec 变更，沿用「typecheck + lint + sim 场景」的验证口径。

| 步 | 内容 | 依赖 / 说明 |
|---|---|---|
| **M0 止血** | B1 移动时序（tick 开头清意图、所有 commit 模块之后解算）与 B4（`in` 改 `.has()`）**同一变更**；B2 名册（= 外矿迁移一期第 1 节，`13-external-mining-migration.md`）；B6 nuke 旗帜（先防护：无实现时跳过并告警）；B7 小写根；B9 校准只重建 schema 子系统、保留旧域；B8 结构缓存定期刷新；B12 布局存储统一（旧读方改读 `Memory.Nexus.layout`，或由规划器同步写 `LayoutData`） | 每项单独变更、单独 sim 对照（B1 与 B4 合并对照：只修 B1 时，无任务的主线单位仍走旧 `exec()` 并开始移动，测到的是会被随后修 B4 撤销的过渡态）。B1 / B4 会改变家内经济实际行为，修后按校准纪律复测（§25.2 校准提示） |
| **M1 孵化单轨** | 主线 `spawnDirector` 接管全部角色（含 manager / transporter / miner，编队与扩张走 `directSpawn`），退役 `SpawnWork` 任务池与旧体型。前置两项：① `bodyFactory` 覆盖 `directSpawn` 用到的角色（目前 `directSpawn` 用旧 `GetRoleBodys` / `GenerateBodys`，`spawnDirector.ts:522`；`bodyFactory.buildBody` 对 aio、aid-*、team-* 等返回 null，`bodyFactory.ts:132-180`），再退旧体型；② 往旧池写单的生产方逐个改道或下线：`teams/flags/warSpawn.ts:110/146/172/214/267`、`mineMission.ts:121-122/143/165/196/203`、`external/externalMine.ts`、`industry/console/spawn.ts:11/23/30` | M0 之后。退役前把旧池里仍有意义的孵化规则（boost 预约、应急降档）逐条对照迁入 |
| **M2 角色入任务板** | manager / transporter / miner 改为主线任务种类（中央搬运、元素矿采集）；旧 carrier 的请求匹配并入 quota；`exec()` 回退只留给尚未迁移的角色 | M1 |
| **M3 外矿** | `13-external-mining-migration.md` 一到四期 | 一期第 1 节属 M0；其余在 P1-14 门禁之后；二期路网若复用 `externalRoad.ts` 的路线规划，依赖 M0 的 B12 |
| **M4 防御补齐** | 刷高墙（repair 任务 + 按 RCL 的目标血量）、防核、RCL7+ 关键建筑 rampart；`defend` 语义改由威胁模型提供（替代 B11 的旧标记） | M0 |
| **M5 扩张（Phase 5）** | 重写 `strategy/expansion.ts`；claimer / aid 走任务板；claim 动作进 Broker；claim / aid / up 旗帜的能力并入扩张系统 | M0（B1、B2）、M1 |
| **M6 工业** | 包装域逐个改为主线模块：账本记账、读姿态与房间模式；补 ResourceManage（自动平衡）与核弹发射；observer 服务 Intel；高速路 power / deposit 角色补执行器或下线（B5）；QoS 门控改由 `cpuBudget` 预算带承担（B10），`core/qos.ts` 在 M8 删除 | M2（搬运靠主线单位） |
| **M7 战争** | 编队移动（B1 修后复验）；`TEAM_` 编队并入 cluster（集群待办 C3 / C4，`03-cluster-squads.md`）；旗帜攻击角色补执行器或下线 | M0、M1 |
| **M8 收尾** | 删除 `prototype/**` 中已无调用的角色与函数、`spawning/legacy/**`、旧 accessor 中已迁走的域、`modules/external/**`；清理 25 个 `@ts-nocheck` 文件（16,857 行）与 `.oxlintrc.json` 中指向不存在路径的忽略项 | 各域迁完 |

## 25.7 维护约定

- 本文与 docs/14 进度快照同步维护：某项能力状态变化时，同一次提交更新 §25.3 对应行与 §25.4 双轨清单。
- 状态以走查或 sim 证据为准；「主线」只在旧代码确实不在热路径上时才标。
- 缺陷 B1–B13 修复后在 §25.2 标注勾销与对应变更名，不删除行。

## 25.8 待维护者确认

1. **B1 是否是有意为之。** 若旧角色「不移动」是有意冻结（例如过渡期只让主线单位干活），本文的 M0 第一项应改为「下线这些角色的孵化」，而不是修复时序。
2. **校准是否需要重做。** B1 / B3 / B4 修复后家内经济的实际行为会变，P1-14 的校准结论可能失效。
3. **迁移顺序。** 本文把孵化单轨（M1）排在外矿（M3 二期以后）之前；若更看重外矿收入，可以先做 `13-external-mining-migration.md` 一期，再做 M1。
