# Tasks

> 验证口径（沿用户裁决 2026-10-12）：回归制 = 严格 typecheck + lint + sim 场景（报告 JSON / ticks CSV / --dump-memory）。
> 纯函数用「编译产物 node 直跑用例」锁定（同 fix-p1-14 / workforce-logistics 的迁移与 resolver 用例做法）。
> 门禁：第 0、1 节是现网缺陷取证与修复，可先行；第 2 节起为新功能，P1-14 勾销后开工（或由维护者裁决放行）。
> 设计契约：docs/nexus-design/13-external-mining-migration.md（外矿迁移）；全仓背景：docs/nexus-design/12-legacy-bot-migration-map.md。持久化根为 `Memory.Nexus`。

## 0. 取证（改动前）

- [x] 0.1 跨房单位取证场景 `sim/roster-probe.sim.ts`：母房 + 一个邻房；构造一个会跨房的单位（预置单位 + 预置 `Memory.Nexus.tasks` 中一条租给它的 scout 任务，或实现者认为更简单的等价构造）。初始 Memory 必须带可识别的 `schemaVersion`，否则校准会整体重建（docs/25 B9）。记录：单位跨房当 tick 是否进入 `world.dead`、`Memory.creeps[name]` 是否被删除、之后是否在边界出口格来回。验证：取证记录写入 docs/bugs（新条目），作为第 1 节基线
  > 实现注记（2026-11-01）：取证档 `docs/bugs/cross-room-agent-deadlock.md`——三缺陷实锤：① room-lost 清扫 t1 杀外房挂靠 scout 任务（remoteEconomic 豁免只盖 harvest/carry）；② 跨房 move 意图寻路失效（scout 卡北墙角 (49,0) 400t，意图流仅前 25t 有 move）；③ 到达判定无兜底（任务永挂 in_progress，heartbeat 续命）。证伪一项：「跨房即丢记忆」不成立（挂靠母房对照组 units/creeps 记录全程保留——P1-18 remoteUnits 修复有效），真实断点在跨房移动与外房挂靠
- [x] 0.2 现有外矿取证：`sim/remote-mine.sim.ts` 跑 30k + dump-memory，记录外矿采集任务的 id 是否每 tick 变化（清扫取消重建，docs/24 §24.3 B7）、是否出现过 scout 单位。验证：记录并入 0.1 的 docs/bugs 条目
  > 实现注记（2026-11-01）：B7「每 tick 取消重建」**不成立**——planner upsert 同键续命（id 稳定 30k 不换手）。新实锤：scout 全程零孵化（任务恒 available）；~t26500 偶发孵 2 只 → 一只卡 W4N8 (0,0) 500t、一只无任务空转 → 寿命尽后链死永不再孵；reserve 任务同样恒 available（reserver 不在孵化词表）。27k 后 harvest/carry 链自愈成形
- [x] 0.3 场景补洞：`sim/remote-mine.sim.ts` 邻房改为中立控制器（`controller: { level: 0, mine: false, pos }`），母房预置 storage（满足 §24.7.1 开闸条件），保留现有断言。验证：场景可跑，断言结果与 0.2 一致
  > 实现注记（2026-11-01）：邻房 W5N9/W4N8 补中立 ctrl (25,25)；母房 RCL3→RCL4 + 预置 storage（20k 能量）——RCL3 口径 storage 会被引擎标 off。场景绿（L4@0 / p95 10ms），取证同 0.2（跑在同一场景配置上）

## 1. 殖民地名册（缺陷修复）

- [x] 1.1 `core/world.ts` 的 `WorldView` 新增 `units` 与 `visible`（docs/24 §24.5.1）；`world.rooms` 语义不变。验证：`npm run typecheck` 绿
- [x] 1.2 `world/perception.ts`：`Game.creeps` 一次遍历生成 `units`；为有本方单位驻留的非己方房生成 `visible` 轻量快照。验证：typecheck 绿；dump-memory 不新增持久字段
- [x] 1.3 `aliveNames` 与 `world.dead` 改按 `units`。验证：typecheck 绿；roster-probe 中跨房单位的 `Memory.creeps` 与 `units` 保留，`world.dead` 只在真实死亡 tick 出现（对照 0.1）
- [x] 1.4 实施注记: 驱动序保持旧两段式 (rooms 房序 + remoteUnits 序)——交通解算对意图提交序敏感, 名册遍历会平移门读数; 可驱动并集与 units 等价 (语义即 §24.5.3)。外房锚点任务 (缺陷一修复后可存活的 scout/reserve/claim/retreat 直挂形态) 走免上下文 `runForeignTask` (从 runCreep 提取, 不读房观察); `runCreep` 的 `room` 参数经 `RoomContext` 别名放宽未落地——上下文保持锚点房语义 (RoomObservation), 零类型级联。验证: typecheck 绿 + lint 绿; roster-probe 单位跨房到达, 任务 completed (300t)
- [x] 1.5 在岗计数原本就走 memory.units 注册表 (staffingCount, 视野无关) 已达标; 替补窗口改 units+remoteUnits 保序拼接 (homeRoom 归房, 请求序不变); 拥堵记录/动作速率改 units 遍历; 分配器候选键集等价 (rooms∪remoteUnits), 顺序保持旧拼接 (同分取先遍历者, 改序平移门读数)。验证: typecheck 绿; grep 复核数单位口径无 rooms[*].creeps 残留 (agentRemote:344 为空间查询豁免)
- [x] 1.6 回归: boot L1@0/L2@330/L3@8557 逐位一致 (A/B bundle 静载双跑核验; 重载下同 bundle 复跑漂 8172-9454 系 secscan.py 77% CPU 噪声, sim-audit-2026-10-19 机理); speedrun L1-L6 全线逐位; remote-mine GREEN; p95 全线 +7~22ms 待静机复跑归因 (负载回落判据: secscan.py 退出)。中间发现并修复: scout 到达兜底「见视野即完成」会因外矿件先行点亮邻房而提前释放在途 scout, 重排孵化链 (boot L3 +897t 实证)——兜底收窄为外房直挂形态 (runForeignTask) 专属, 母房锚点维持本体到达判定

## 2. 多房 Intel

- [x] 2.1 `utils/roomName.ts`：房名解析 + `roomKind(name)` + `INTEL_CONFIG.kindOverride`。验证：typecheck 绿；node 直跑用例覆盖 W/E/N/S 四象限、坐标 10 的倍数、(5,5) center、(4..6,4..6) keeper、覆盖表优先
  > 实现注记（2026-11-01）：`roomNameRemainder`（取余口径，与半球无关）+ `roomKind`（覆盖表优先）；schema 侧同构实现 `roomKindOf`（memorySchema 内联推导，避免 utils→schema 环依赖），二者同规则。用例 tests/intel-rooms.test.ts（四象限/highway/center/keeper/非法名/覆盖表优先，7 用例 node 直跑全绿）
- [x] 2.2 schema v10 → v11：`RoomIntelRecord` 可选字段（docs/24 §24.6.1）、`Memory.Nexus.remotes` 子树、`UnitRecord.remote`、`RoomThreatRecord.scope`；`migrateV10ToV11` 补 `kind`，并把 `OutMineData[home].energy` 中的房迁为 `remotes[home].rooms[room].manual = "pin"`（`centerRoom` / `RoadData` / `highway` 不动）。验证：typecheck 绿；迁移用例 node 直跑（空数据 / 旧数据 / 合法保留 / 坏条目 / 幂等 / OutMineData 迁移 / highway 原样保留）；boot 场景 dump-memory 观察迁移执行
  > 实现注记（2026-11-01）：项目实际版本 v16 → **v17**（文档写 v10→v11 是拟稿时版本号）。v11 字段全落（RoomIntelRecord 六字段 + remotes/RemoteColonyRecord/RemoteRoomRecord/RemoteSourceRecord/RemoteEstimate + UnitRecord.remote + RoomThreatRecord.scope + SUBSYSTEM_KEYS 增 remotes）；migrateV16ToV17 补 kind + OutMineData.energy→pin（centerRoom/highway/RoadData 不动，OutMineData 本体收尾期再删）+ 坏条目删除，幂等。迁移用例 3 组全绿；intel-dump-verify 场景确认 schemaVersion 17 落盘
- [x] 2.3 perception 对 `visible` 房增量写 Intel（值变化才写）；`intelState(record, field, now)` 三态读取。验证：typecheck 绿；三态用例 node 直跑；dump-memory 观察外矿房 Intel 字段出现且未见期间不被改写
  > 实现注记（2026-11-01）：perception visible 循环后接 Intel 增量写入（lastSeen/confidence/sourceIds/sources/controllerPos/owner/reservation/invaderCore/hostileStructures，值变化才写；己方房分支同样补 kind）；三态读取落 `modules/world/intelState.ts`（intelField/intelStale/intelConfidence）。dump 验证：W5N9 六字段全写（owner/reservation=null 已知为空口径）、W5N8 己方房补 kind 无其他副作用
- [x] 2.4 有界清理：`forgetTicks` 与 `maxRooms`（己方房、外矿房不参与淘汰）。验证：用例 node 直跑；30k 场景 `rooms` 条目数有界
  > 实现注记（2026-11-01）：perception 内按 `tick % forgetTicks` 频控（首轮 bootstrap 即扫）；豁免集 = 己方房 ∪ remotes 中 active/scouting/manual 房。行为门四场景（speedrun/remote-mine/race-body-audit/boot）RCL 时间线逐位一致；p95 +4/+5ms 经同负载 A/B 三轮对照证伪（HEAD 35/35/38 vs WORK 34/43/35，中位持平）

## 3. 侦察

- [x] 3.1 scout 可孵化：`SpawnUnit` / `ECONOMY_ROLES` / BodyFactory 加 `scout`（单 MOVE），`unitForTaskKind` 补 `scout → scout`。验证：typecheck 绿；有 scout 任务时 dump-memory 出现 scout 单位
  > 实现注记（2026-11-01）：四关卡在 P1-18/批次 AD 已就位（SpawnUnit 含 scout / ECONOMY_ROLES 收录 / buildBody 单 MOVE / unitForTaskKind 映射），本节补的是**孵化优先级**：standingPriorityByUnit.scout L11→L7——L11 垫底档在发展期恒被 carrier(3)/harvester(9) 常驻缺口压住，remote 目标永不被点亮（0.2 取证「scout 全程零孵化」的 main 档复现，诊断 denyReasons.gate=1406/pendingSince.scout 恒挂）。L7 = build(8) 之下、worker(6) 之上；1 MOVE 50 能量一次性小件。dump 验证：3000t 内 2 只 scout 孵化并完成任务
- [x] 3.2 scout 任务由 Intel 驱动：只为候选房中 Intel 未知或过期者生成，dedupeKey `remote:scout:<home>:<room>`，带 `deadline`。验证：dump-memory 中 scout 任务数 ≤ 未知 / 过期候选房数，到期未认领者被对账取消
  > 实现注记（2026-11-01）：remoteMining 两分支（auto 邻房扫描 / manual 目标列表）统一：`intelStale` 判活（未知或超 staleTicks 才派），dedupeKey 全部迁 `remote:scout:` 前缀，`deadline = tick + REMOTE_CONFIG.scoutDeadline`（board.reconcile 到期自动 cancel，failureReason=deadline）。已知新鲜房（去过又丢视野）不重派。经济规划器清扫对目标房≠本矿的任务本就豁免（P1-18 断点⑤），`remote:` 前缀任务不被误杀
- [x] 3.3 scout 到达目标房中心 3 格内 `board.complete`。验证：每个候选房的 scout 任务只完成一次，Intel `lastSeen` 随之刷新；无循环派遣
  > 实现注记（2026-11-01）：两形态判定统一为「进房 + 切比雪夫距目标点 ≤3」（中心 3 格保证源/控制器全入视野；旧口径「进房即完成」在边角进入时可能漏看主要结构）。runCreep（母房锚点）与 runForeignTask（外房直挂，保留视野兜底）同步收紧。dump 验证：W5N9/W4N8 Intel sources=2 点亮即完成证据；8000t 无循环派遣（Intel 新鲜后不重派）。既有用例 agent-dispatch.test.ts 随口径更新并补「>3 格继续移动」分支
  > 归因注记（boot 门基线平移）：第 2 节 perception Intel 写入使每 tick Memory 序列化成本微增 → runIsolated budget 边界平移 → boot L3 8557→8656（+99t，静机双 bundle 各 3/2 次读数稳定，二分锁定 f9e6890）。属功能真实代价（官服同样按 Memory 体积计费），参考快照已更新为 8656；race 变体不含 perception 主链，speedrun/race-body-audit 不受影响

## 4. 外矿选点

- [x] 4.1 `config/remote.ts`：`INTEL_CONFIG` 与 `REMOTE_CONFIG`（docs/24 §24.14），每项注释含义与单位。验证：typecheck 绿；grep 复核新模块零散字面量阈值
  > 实现注记（2026-11-01）：已随第 2 节提前落地（`5d9b18f`）；本轮 4.2 实现时发现并修正 `loadMargin` 量纲错误——设计契约 §24.7.2 的装卸余量与 2d 同为格量纲（默认 2），落地时误写为能量 50。grep 复核 estimate/stateMachine/planner 零散字面量阈值已清零（全部走 REMOTE_CONFIG）
- [x] 4.2 净收益估算纯函数（docs/24 §24.7.2）：输出 `net` 与 spawn 占用 `s`。验证：node 直跑用例（预定前后产能翻倍、能量容量 < 1300 不开预定、路程增长使 net 单调下降、net ≤ 0 边界）
  > 实现注记（2026-11-01）：`modules/economy/remote/estimate.ts`。用例 5 条全绿（tests/remote-estimate.test.ts，本地口径不入库）。实现期修正两处推导细节：① 预定体体型按 2×[CLAIM,MOVE]=1300（2 CLAIM 预定才净增长），spawn 占用的寿命分母按部件类型分开（预定体 600）；② **有效预定 = 预定意愿 ∧ E ≥ 1300**——装不下时房间实际不会被预定，源产能按未预定 5/t 折算而非 10/t 空想（用例「E<1300 不开预定」暴露此语义缺陷）
- [x] 4.3 状态机纯函数：转移表 + 最小驻留 + 原因字符串；威胁暂停不受驻留约束；pin 跳过净收益门槛与亏损剔除、不跳过安全规则；ban 永不准入。验证：node 直跑用例覆盖 docs/24 §24.7.1 每条转移
  > 实现注记（2026-11-01）：`modules/economy/remote/stateMachine.ts`。用例 20 条覆盖 §24.7.1 全部转移 + 驻留边界（未满保持/期满放行）+ paused 双条件（到期 ∧ 威胁衰减）+ pin/ban 全语义（含 pin 不跳安全规则、ban 任意态立即 rejected、rejected 态 pin 直接重新准入）
- [x] 4.4 `modules/economy/remote/` 的 `remote-planner`（planning 阶段，规划 P2 / 评估 P3，注册在 `economy-planners` 之后）：开闸条件（档位 `remoteMining`、母房有 storage、非 survive）、候选生成（`describeExits` + kind + 路线长度 + pin）、PathFinder 路程缓存、按 `net/s` 降序准入至 `spawnShareCap`、一房一殖民地。验证：typecheck 绿；remote-mine 场景 `remotes` 状态序列为 candidate → scouting → evaluated → active，`reason` 引用量化输入；去掉 storage 的对照场景不开闸
  > 实现注记（2026-11-01）：`remote/planner.ts`（纯规划函数）+ `remote/module.ts`（调度壳，planInterval 节流），注册于 main.ts Economy 之后。dump 验证：W5N9/W4N8 走完 candidate→scouting→evaluated→active 全序列（reason=`net:8.19>0,budget-ok`），无 storage 对照 remotes 子树为空。一期口径三处：① manual 档候选 = remoteTargets ∪ pin（显式目标 ≙ pin 语义，不自动扫邻房）；② `remote:reserve:` 任务暂缓生成（旧链 `reserve:` 前缀仍在产，双键并行会孵两只 reserver，第 5 节闭环切换时统一接管）；③ 威胁置信度暂恒 0（防御联动节接入 threat scope）。net/s 降序准入：spawnShareCap 检查在位（usedShare < cap × spawn 数），排序消费在 active 动作生成扩展时生效（一期 active 即产旧链等价任务）。行为门四场景静机全绿（speedrun/remote-mine/race-body-audit/boot，boot 基线 8656）
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
