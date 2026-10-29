# Tasks

> 验证口径（沿用户裁决 2026-10-12）：回归制 = 严格 typecheck + lint + sim 场景（报告 JSON / ticks CSV / --dump-memory）。
> 纯函数用「编译产物 node 直跑用例」锁定（同 fix-p1-14 / workforce-logistics 的迁移与 resolver 用例做法）。
> 门禁：第 0、1 节是现网缺陷取证与修复，可先行；第 2 节起为新功能，P1-14 勾销后开工（或由维护者裁决放行）。
> 设计契约：docs/nexus-design/24（外矿迁移）；全仓背景：docs/nexus-design/25。持久化根为 `Memory.Nexus`。

## 0. 取证（改动前）

- [ ] 0.1 跨房单位取证场景 `sim/roster-probe.sim.ts`：母房 + 一个邻房；构造一个会跨房的单位（预置单位 + 预置 `Memory.Nexus.tasks` 中一条租给它的 scout 任务，或实现者认为更简单的等价构造）。初始 Memory 必须带可识别的 `schemaVersion`，否则校准会整体重建（docs/25 B9）。记录：单位跨房当 tick 是否进入 `world.dead`、`Memory.creeps[name]` 是否被删除、之后是否在边界出口格来回。验证：取证记录写入 docs/bugs（新条目），作为第 1 节基线
- [ ] 0.2 现有外矿取证：`sim/remote-mine.sim.ts` 跑 30k + dump-memory，记录外矿采集任务的 id 是否每 tick 变化（清扫取消重建，docs/24 §24.3 B7）、是否出现过 scout 单位。验证：记录并入 0.1 的 docs/bugs 条目
- [ ] 0.3 场景补洞：`sim/remote-mine.sim.ts` 邻房改为中立控制器（`controller: { level: 0, mine: false, pos }`），母房预置 storage（满足 §24.7.1 开闸条件），保留现有断言。验证：场景可跑，断言结果与 0.2 一致

## 1. 殖民地名册（缺陷修复）

- [ ] 1.1 `core/world.ts` 的 `WorldView` 新增 `units` 与 `visible`（docs/24 §24.5.1）；`world.rooms` 语义不变。验证：`npm run typecheck` 绿
- [ ] 1.2 `world/perception.ts`：`Game.creeps` 一次遍历生成 `units`；为有本方单位驻留的非己方房生成 `visible` 轻量快照。验证：typecheck 绿；dump-memory 不新增持久字段
- [ ] 1.3 `aliveNames` 与 `world.dead` 改按 `units`。验证：typecheck 绿；roster-probe 中跨房单位的 `Memory.creeps` 与 `units` 保留，`world.dead` 只在真实死亡 tick 出现（对照 0.1）
- [ ] 1.4 `runAgents` 遍历 `units`，上下文取 `rooms[r] ?? visible[r]`；驱动范围按 docs/24 §24.5.3（己方房内与现状一致，含 `agentSystem.ts:1172` 的分流判定原样保留；外部房只驱动持有 Nexus 任务指针的单位）；`runCreep` 的 `room` 参数放宽为联合类型。验证：typecheck 绿 + lint 绿；roster-probe 中单位不再在边界来回，任务按计划推进
- [ ] 1.5 其余单位口径改按名册（docs/24 §24.5.2）：在岗计数（`spawnDirector.ts:246-253`，按 `homeRoom` 归属）、替补窗口（`:343-359`）、分配器候选（`tasks/index.ts:36-38`）、拥堵记录（`trafficMonitor.ts:39`）、动作速率（`economy/model.ts:123`）。验证：typecheck 绿；roster-probe 中单位外出期间不触发重孵；grep 复核再无「遍历 `world.rooms[*].creeps` 来数单位」的用法（空间查询除外）
- [ ] 1.6 回归：boot-from-scratch 3/3、rcl-sprint 指标与 CPU p95 不低于变更前基线（两场景单位不跨房，行为应不变）。验证：报告 JSON 逐项对照留档

## 2. 多房 Intel

- [ ] 2.1 `utils/roomName.ts`：房名解析 + `roomKind(name)` + `INTEL_CONFIG.kindOverride`。验证：typecheck 绿；node 直跑用例覆盖 W/E/N/S 四象限、坐标 10 的倍数、(5,5) center、(4..6,4..6) keeper、覆盖表优先
- [ ] 2.2 schema v10 → v11：`RoomIntelRecord` 可选字段（docs/24 §24.6.1）、`Memory.Nexus.remotes` 子树、`UnitRecord.remote`、`RoomThreatRecord.scope`；`migrateV10ToV11` 补 `kind`，并把 `OutMineData[home].energy` 中的房迁为 `remotes[home].rooms[room].manual = "pin"`（`centerRoom` / `RoadData` / `highway` 不动）。验证：typecheck 绿；迁移用例 node 直跑（空数据 / 旧数据 / 合法保留 / 坏条目 / 幂等 / OutMineData 迁移 / highway 原样保留）；boot 场景 dump-memory 观察迁移执行
- [ ] 2.3 perception 对 `visible` 房增量写 Intel（值变化才写）；`intelState(record, field, now)` 三态读取。验证：typecheck 绿；三态用例 node 直跑；dump-memory 观察外矿房 Intel 字段出现且未见期间不被改写
- [ ] 2.4 有界清理：`forgetTicks` 与 `maxRooms`（己方房、外矿房不参与淘汰）。验证：用例 node 直跑；30k 场景 `rooms` 条目数有界

## 3. 侦察

- [ ] 3.1 scout 可孵化：`SpawnUnit` / `ECONOMY_ROLES` / BodyFactory 加 `scout`（单 MOVE），`unitForTaskKind` 补 `scout → scout`。验证：typecheck 绿；有 scout 任务时 dump-memory 出现 scout 单位
- [ ] 3.2 scout 任务由 Intel 驱动：只为候选房中 Intel 未知或过期者生成，dedupeKey `remote:scout:<home>:<room>`，带 `deadline`。验证：dump-memory 中 scout 任务数 ≤ 未知 / 过期候选房数，到期未认领者被对账取消
- [ ] 3.3 scout 到达目标房中心 3 格内 `board.complete`。验证：每个候选房的 scout 任务只完成一次，Intel `lastSeen` 随之刷新；无循环派遣

## 4. 外矿选点

- [ ] 4.1 `config/remote.ts`：`INTEL_CONFIG` 与 `REMOTE_CONFIG`（docs/24 §24.14），每项注释含义与单位。验证：typecheck 绿；grep 复核新模块零散字面量阈值
- [ ] 4.2 净收益估算纯函数（docs/24 §24.7.2）：输出 `net` 与 spawn 占用 `s`。验证：node 直跑用例（预定前后产能翻倍、能量容量 < 1300 不开预定、路程增长使 net 单调下降、net ≤ 0 边界）
- [ ] 4.3 状态机纯函数：转移表 + 最小驻留 + 原因字符串；威胁暂停不受驻留约束；pin 跳过净收益门槛与亏损剔除、不跳过安全规则；ban 永不准入。验证：node 直跑用例覆盖 docs/24 §24.7.1 每条转移
- [ ] 4.4 `modules/economy/remote/` 的 `remote-planner`（planning 阶段，规划 P2 / 评估 P3，注册在 `economy-planners` 之后）：开闸条件（档位 `remoteMining`、母房有 storage、非 survive）、候选生成（`describeExits` + kind + 路线长度 + pin）、PathFinder 路程缓存、按 `net/s` 降序准入至 `spawnShareCap`、一房一殖民地。验证：typecheck 绿；remote-mine 场景 `remotes` 状态序列为 candidate → scouting → evaluated → active，`reason` 引用量化输入；去掉 storage 的对照场景不开闸
- [ ] 4.5 控制台迁移：`Nexus.remote.pin / ban / clear / list` + `Nexus.remotes()` 查询 + HUD 每殖民地一行；`mine.add / adds / remove / list` 在帮助中标注由 `Nexus.remote.*` 取代（文件本身收尾时删除）。验证：sim noErrors（面板路径执行）；控制台命令写入 `manual` 后下一次规划生效

## 5. 外矿能源闭环

- [ ] 5.1 经济规划器清扫豁免：`economy/planners.ts:286` 跳过 `remote:` 前缀任务。验证：typecheck 绿；dump-memory 中 `remote:*` 任务 id 跨 tick 稳定（对照 0.2）
- [ ] 5.2 `world/worksite.ts` 支持无视野房（源坐标取 Intel）。验证：外矿源工位在首次可见前可算
- [ ] 5.3 容器工地放置（沿用 planner 放置写法）+ `remote:build` / `remote:repair` 任务。验证：每个 active 外矿源旁出现且仅出现一个容器；hits 低于阈值时出现 repair 任务
- [ ] 5.4 外矿采集 handler：到岗 → 有工地先建 → 采集卸入容器 → 容器低血就地修；不再往返母房。验证：sim 意图分布中外矿 harvester 无跨房 transfer
- [ ] 5.5 外矿 `haul` 进 quota 主干，`destId` 只在母房；交付量记 `ledger.rates["remote:<home>:<room>"]`。验证：dump-memory 中该键 delivered EMA > 0；`room_energyStructures_findSpawn` 外矿交付路径退役
- [ ] 5.6 预定：ActionBroker `reserveController`；`reserver`（unit code `RSV` 已存在）进 `SpawnUnit` / BodyFactory（≥ 2 CLAIM）；`unitForTaskKind` 补 `reserve → reserver`；`remote:reserve` 按条件生成。验证：外矿房出现本方预定且持续增长；能量容量 < 1300 的场景无预定任务
- [ ] 5.7 单位隔离：孵化外矿单位写 `UnitRecord.remote`；Allocator 资格按 docs/24 §24.8.3（`remote:` 任务只给同殖民地带标记单位，家内任务只给无标记单位）；跨房路程读 `pathLength`。验证：typecheck 绿；走查 `canExecute` / `travelCostOf` 对照 spec；sim 中家内 harvester 不接外矿任务、外矿单位不接家内任务
- [ ] 5.8 定编：`unitTargets` 追加外矿编制（docs/24 §24.8.4），在岗计数按标记分开抵扣；BodyFactory `remote` 体型提示。验证：无外矿场景（boot / rcl-sprint）孵化序列与变更前一致（dump-memory 对照）
- [ ] 5.9 删除 `economy/remoteMining.ts` 及其引用。验证：typecheck 绿；grep 无残留

## 6. 外矿安全

- [ ] 6.1 `updateRoomThreat` 扩为对外矿集合调用（可见评分、不可见衰减，`proximityFactor` 取 1），写 `scope: "remote"`；`maxThreatScore` 只取 `home`。验证：typecheck 绿；remote-threat 场景外矿房有 threat 记录，全局姿态与家内 defender 编制不变
- [ ] 6.2 暂停 / 撤回 / 恢复（docs/24 §24.9）。验证：状态机用例 node 直跑；remote-threat 场景该房 `paused` 且 `reason` 正确，外矿任务取消，载货单位先交付
- [ ] 6.3 剔除条件：invader core / 他人占有 / 他人预定 / 敌对结构 → `rejected`。验证：用例 node 直跑；放置敌方结构（`enemy: true`）的邻房不进入 active

## 7. 收益反馈

- [ ] 7.1 每 `foldInterval` 折叠 `measured.netEma`。验证：dump-memory 中 active 外矿房有 `measured`，与 delivered EMA 同量级
- [ ] 7.2 持续亏损剔除（`lossWindow`，pin 只告警）。验证：状态机用例 node 直跑
- [ ] 7.3 移除 `prototype/features.ts` 中 `registerOutMineIncomeProvider` 的注册。旧孵化链的 `estimateRoomEnergyIncome` 因此回到回退估算（`roomWorkforce.ts:427-428`），影响旧链的升级插队判断。验证：typecheck 绿；boot / rcl-sprint 报告对照，若指标回退则在本条记录并请维护者裁决（保留注册但返回 0，或接受变化）

## 8. 集成回归与文档

- [ ] 8.1 全量门禁：typecheck 0 错误 + lint 0 错误 + race / season 变体构建过。验证：命令输出留档
- [ ] 8.2 remote-mine 场景：dump-memory 核对外矿房 active、预定存在、`remote:*` delivered EMA > 0、外出单位记录全程保留。验证：报告 JSON + dump-memory 留档
- [ ] 8.3 新增 `sim/remote-threat.sim.ts`：一个邻房放置敌方单位、一个邻房放置敌方结构。断言 noErrors / cpuP95，dump-memory 核对两房均未进入 active、`reason` 正确、全局姿态未切 war。验证：报告 JSON 留档
- [ ] 8.4 防回退：boot-from-scratch 3/3、rcl-sprint 指标不低于变更前基线。验证：两场景报告逐项对照留档
- [ ] 8.5 文档同步：docs/14 Phase 4 状态；docs/20 C5 依赖改为「docs/10 已落地（docs/24）」；docs/22 §22.2 数据所有权表增补；docs/25 B2 勾销、§25.3 外矿与名册相关行更新；docs/bugs 第 0 节条目勾销附 sim 证据；配置校准结论回写注释。验证：文档与代码一致
- [ ] 8.6 私服实测（可选收尾）：SK / 高速路邻房被识别并排除；钉选房生效；外矿房预定与容器建成；实测净收入为正；invader 出现时暂停与恢复；编队单位跨房后记忆保留。验证：`Nexus.remotes()` 取证记录回填 docs/bugs
