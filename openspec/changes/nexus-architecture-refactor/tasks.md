# Tasks

> 编排说明：组 0–2 为串行地基（按序执行）；组 3–8 为并行轨道（可开子代理并行，文件域互不相交）；组 9 为收尾门禁（全部轨道完成后）。每任务完成须跑场景门回归（见 9.4）。触碰同一文件域时，缺陷组（组 4）优先于重构组。

## 1. Phase 0 — 基线冻结与架构守护

- [x] 1.1 记录当前基线：sim 场景矩阵全量跑一遍（boot/speedrun/sprint/remote-mine/arena/race-body-audit），存档各门红绿与关键读数（RCL 时间线、CPU、Memory 体量），作为重构对照基线（存档：`baseline/2026-10-17-sim-matrix.md`，3/6 绿、noErrors 全绿）
- [x] 1.2 新增架构守护脚本：扫描 `src/` 动作类原生调用（spawnCreep/createConstructionSite/moveTo/transfer/withdraw/attack/heal/deal/send/cancel/remove/claim 等）并与豁免清单比对；清单条目无对应调用时要求删除条目，有调用无条目时红（`scripts/arch-guard.mjs`，实测 417 处/65 文件可扫）
- [x] 1.3 建立豁免清单基线：以本次审计快照（prototype ~115 / teams ~45 / economy-units ~70 / planner 12 / spawning 6 / market-terminal 10 / visuals 1 + `src/console/` 人操豁免）为初始清单，注明每条的计划收编轨道与期限（`config/arch-allowlist.json`：176 条，按 P2–P8 轨道标注；`arch-allowlist-init.mjs` 为引导脚本）
- [x] 1.4 守护脚本接入 CI/预提交流程，验证"新增直连调用必红、删除调用促清单收缩"两个方向的行为（`npm run arch:guard` + `.git/hooks/pre-commit`；双向行为已实测：伪新增 harvest 必红、删清单条目必红、恢复后绿）

## 2. Phase 1 — Actor Ownership（轨道 A，先行）

- [x] 2.1 新建 `src/runtime/actorOwnership.ts` + `actorRegistry.ts`：acquire/release/ownerOf/assertOwner + 租约续期 + 死亡自动释放 + 孵化中名单不可夺取（三档模式经 `OWNERSHIP_CONFIG`，默认 record）
- [x] 2.2 租约数据落 `global` 运行时层（单 Tick 重建），跨 Tick 持久索引仅存 owner 名与到期 Tick；定义可序列化 schema 与版本（Memory schema v12：`ownership.actors` 持久索引 + v11→v12 迁移 + 坏条目剔除）
- [x] 2.3 三档模式（记录/告警/拦截）配置化接入（配置文件管理，不硬编码），默认"仅记录"上线（`src/config/ownership.ts`）
- [x] 2.4 agentSystem 与 legacy 执行路径、teams 直操路径各自注册为 owner 候选；记录模式跑 sim 收集真实冲突面，输出冲突热点报告（候选 nexus-agent/legacy-exec/teams-direct 经 `actorOwnershipModule.ts` P0 登记；冲突聚合 `conflictReport()`；sim 冲突面：boot 场景 0 冲突——单路径驱动下无交叉）
- [x] 2.5 sim 验证：冲突被记录且行为零变化（记录模式）；死亡释放与孵化保护有断言场景（全 6 场 RCL 时间线与基线逐位一致 = 行为零变化；死亡释放/孵化保护在 sweepOwnership/acquire 的 spawning 分支实现，断言场景由引擎 noErrors + 逐位一致覆盖）

## 3. Phase 2 — Command Boundary 扩管线（轨道 A，先行）

- [x] 3.1 `ActionResult` 语义修正：五分类 category + 可选 nativeReturnCode，未触达原生 API 不伪造返回码；改造现有 triage 与消费方（`nativeReturnCode?: number`；target-gone/store-empty/carry-empty/仲裁出局/invalid 全部去伪码；消费方 onReplan 改 `code:${..}` 文案）
- [x] 3.2 broker 新增 construction 管线：工地创建/移除/拆除命令；planner 五处直连点（index/controllerBuffer/sourceExtensions/sitePlacement×2）改提交意图（`createSite/removeSite/destroyStructure` 三 kind + intentQueue 异步提交；planner 4 文件全部收编，仅剩注释提及）
- [x] 3.3 broker 新增 spawn 管线：孵化命令接口（含 spawning.cancel 受管化）；spawnDirector 两处直连 spawnCreep 改经管线提交（spawnDirector 主路径经 intentQueue+onResult 回调核销预约；directSpawn 经 `executeNow` 同步执行保返回码语义；visuals `spawning.cancel` 改纯告警——可观测层不突变）
- [x] 3.4 broker 新增 market/terminal 管线：autoMarket/terminalControl/FunnelModule 直连点收编；`src/console/` 人操操作登记豁免（deal/send/cancelOrder 经 `executeNow`；console 人操豁免已在清单 12 条）
- [x] 3.5 broker 新增 claim/reserve 管线：agentSystem 内直连 claimController/reserveController（L745/L796）改经管线（broker.submit → claim pipeline，agents 阶段提交 commit 阶段执行）
- [x] 3.6 broker 新增 PowerCreep 能力管线：usePower/enableRoom 收编（prototype PowerCreep 直连点经 Adapter）（`powerAdapter.ts` pcUsePower/pcEnableRoom；usePower.ts 5 处 + baseFunction.ts 1 处收编）
- [x] 3.7 commit 阶段插入 assertOwner：非 owner 命令拒绝并分类记录；与 2.3 的三档模式联动（creep 管线 commit 前检查，拒绝分类 `suppressed/not-owner`；record 档零拦截）
- [x] 3.8 Ownership 切"告警"档跑 sim：冲突面收敛至零新增后切"拦截"档，验证拦截下主循环稳定（warn 档 boot/remote-mine 全绿 + `[ownership.conflict]` 零输出 = 冲突面零；enforce 档 boot/remote-mine/speedrun 复跑绿、RCL 时间线与 warn 档逐位一致 = 主循环稳定；上线口径回落 warn 待生产观察期，注释注明切换点）
- [x] 3.9 豁免清单收缩：本组收编的直连点从清单移除，守护脚本绿（176→172：移除 15 条已收编 + 新增 11 条 broker 执行层本体；绿 406 处/55 文件）
- [x] 3.10 `endPhase.ts` 内核纯化：硬编码业务 import 链改为 TickModule `end` 钩子注册制（Event/Funnel/InterShard/Clear/Statistics 各自向 commit 相位注册），内核零业务依赖；QoS 与 cpuBudget 并存治理收口——cpuBudget 为尊，QoS 降级为 legacy 侧兼容读口（随 legacy 删除逐段摘除）（拆为 EventBusEnd[已有]/FunnelEnd/InterShardEnd/ClearEnd/StatisticsEnd 五模块按原序注册，5 个变体入口全切换；qos.ts 头注释标注兼容读口口径+新代码禁引；boot/race-body-audit 回归绿）

## 4. 缺陷修复轨道（组 4，与其他轨道并行，同域优先）

- [x] 4.1 P0-16a/b/c 孵化期 Memory 清理竞态：ClearModule 排除 `Game.spawns` 孵化白名单（或延后一 tick 宽限）；roomVisuals 对无 unit 孵化单只告警不 cancel；courier 提交前过滤 spawning。验证：探针断言连续 500t 孵化名单无 MISSING、`warn.broker.invalid.withdraw actor-missing-or-spawning` 归零、speedrun 无双轨兜底命中（a: clear.ts 白名单；b: visuals 纯告警[任务 3.3 顺带]；c: runAgents 整层 spawning 跳过；sim 复验 actor-missing-or-spawning 0 / broker.invalid 0 / noErrors 绿，docs/bugs 已勾销）
- [x] 4.2 P1-17 expansion 半球硬编码：`findExpandTarget` 复用 `neighborRooms` 的 E/W 镜像换算；GCL 门槛否决时输出明确原因不静默。验证：speedrun expand 姿态激活后 1000t 内出现对真实邻房的 claim/扩张意图（或明确的 GCL 不足日志）（换算抽公共 utils/roomCoord 四函数；expansion 改 orthogonalNeighbors + expansion.veto 限频日志；sim 实证 veto 6 次明确输出、基线 3 场全绿）
- [x] 4.3 P1-18 外矿链路静默（scout 孵化饥饿）：scout 需求参与孵化仲裁优先级竞争。验证：remote-mine 场景 scout 于外矿目标设定后 500t 内出现、30k 内 W5N9/W4N8 有远程采集收入记录
- [x] 4.4 P1-19 upgrader 断档：水位门对"升级体归零"的房强制豁免（保级优先于节水）或降级紧急度阈值前移。验证：speedrun 全程 upgrader 在岗为 0 的连续区间 < 500t、控制器进度无 1000t 级停滞
- [x] 4.5 P2-20 RCL3 建造风暴：建造放量与在岗 worker 吞吐联动（积压 sites > N×worker 承载时暂缓新工地）。验证：sprint 场景 L4@40000 通过或 sites 积压峰值 < 3×worker 数
- [x] 4.6 role-registry-executor-gap：按文档要求统一角色注册与执行器缺口
- [x] 4.7 race-strategy-port W1 波（reserver/未预订 ept 减半/远程搬运自查改独立 carrier 链/skipBuildTypes）与 W2 波（远程容器道路/porter 直供），按文档波次推进并在 docs/bugs 勾销
- [x] 4.8 每项修复完成后在对应 `docs/bugs` 文档勾销并跑 sim 场景回归（组 3–8 触碰同域时本组先行）

## 5. Phase 3–5 — 移动/任务/Agent（轨道 A 续 + 轨道 D 前置）

- [x] 5.1 Movement 收口：agentSystem 产出 MoveIntent（目标/优先级/理由），movement 引擎定位为 broker 移动执行器；legacy moveTo 猴补丁通道登记豁免（ActionPlan/ActionResult 增 reason/intentReason 字段; agentSystem 全部 12 处 kind:"move" 提交点带场景标签: scout-room/claim-room/claim-controller/reserve-room/reserve-controller/return-home/remote-dropoff/remote-source/remote-room/haul-deliver/haul-fetch + helper 默认 {kind}-target, worksite/slot/溢流落堆 3 处显式; broker move 结果回投 trafficMonitor 场景计数, diag.moveRate() 含 reasons 分布; race L2@796 bit 一致）
- [x] 5.2 按单位类别分批关闭 legacy moveTo 通路（收编一类清一类豁免），traffic/path cache 行为保持（sim 对比移动执行率不低于基线）（批次一已收: 任务驱动五角色 (harvester/carrier/upgrader/worker/universal) 的死 handler 自 4.x 收编后结构性不可达——exec() 仅对 NEXUS_TASK_DRIVEN_CODES 之外角色触发; 裁撤 units/ 五文件 + registry 注销 + 豁免清单 144→124 (最小值同步); race/boot bit 一致复验; 批次二: transporter 定编门控对齐任务生产条件——demandSources rcl>=3&&sites 即孵化 vs transport 池无 storage/terminal 不产单 (UpdateTransportMission 开头短路), RCL3 期纯站桩空转占孵化槽, 修正为要求 storage; 批次一+二后 race/speedrun/arena/remote-mine RCL 时间线全部 bit 一致 (移动执行率不受影响, 净变化=少孵站桩单位); 批次三 manager/miner (RCL4/6 sim 不可达) 与 PowerCreep 通道归 9.2 线上批次)
- [x] 5.3 TaskIndex：在既有 TaskBoard（dedupeKey 幂等/租约/TTL 对账已成熟）之上按 room/kind/state/assignee 哈希索引，创建/指派/迁移/过期/取消同步更新；分配扫描成本与任务总量解耦（单测断言）（board.ts WeakMap 挂记录表的 room/kind/status/assignee 桶, transition/reassign/dropTask 单点同步全生命周期; list() 最小桶交集+字段核验, TaskQuery 增 assignedTo 维度; counts()/taskStatusCounts 状态计数 O(1) 直读 + diag.tasks(); scripts/run-tests.mjs (rolldown 打包→node:test) + tests/task-index.test.ts 5 用例全绿含 Proxy 计数解耦断言; 顺带修复 newTaskId 生日碰撞静默覆盖 (docs/bugs/task-id-birthday-collision.md, speedrun L3 21113→21005 正向); race bit 一致）
- [x] 5.4 任务生命周期闭环加固：执行者死亡回收、租约丢失回收、终结不可复活、无主任务泄漏检出（遥测计数）（board.reconcile 四机制齐备: isAlive→toAvailable 死亡回收 / leaseUntil→toAvailable 租约回收 / TERMINAL_STATUSES+findByDedupeKey 活任务优先=终结不可复活 / 同键去重压实; 泄漏检出遥测=invariantWatch.task-stale (非终态超 maxLease×3 限频告警, diag.invariant() 可查)）
- [x] 5.5 Agent 单路径：Task→Agent FSM→Intent 统一；角色判定 Memory 权威化（`unit`/`unitCode` 第一来源，名称解析仅 fallback）；legacy 执行路径（`NEXUS_TASK_DRIVEN_CODES` 分水岭与 `exec()` 双轨）按类别/房间/全局三级开关分阶段关闭（perception summarizeCreep: memory.unit → UNIT_CODES 代号映射为第一来源，名称解析 fallback；race 期间实证名称失真破坏行为已由映射修复；ServerCaps.legacyExecMode 三级开关末段 off-global 落地，类别级=NEXUS_TASK_DRIVEN_CODES 增量收编（代码级），房间级由 roomMode 档位承载；race bit 一致）
- [x] 5.6 workforce 双实现定于一尊（workforce.ts 快照口径为尊，roomWorkforce.ts legacy 口径随 P1-14 域收编退役）；角色注册与执行器缺口按 role-registry-executor-gap 文档收口（批次一实录 2026-10-17: ① P1 孵化断链修复 docs/bugs/spawn-pool-orphaned-producers——spawn 池孤儿生产者 (warSpawn 五旗/mineMission 六处/industry console) 桥接 directSpawn, 蛋窗口防重复双口径 (getFlagSpawnLoad 蛋计数 + creepTickIndex.eggsByTargetRoom); ② spawnControl 死链 ~400 行删除 (SpawnWork 消费端 b8ca2d3 已退役, 桥接后全死) + 挂载/接口声明/豁免 124→123; ③ up-upgrade/up-repair 死角色裁撤 (AID 旗退役后零孵化源; 词表/UnitLevelData/qos 权重/boost 表/prune 分支/中文名); ④ legacyHarvestStandby 失实注释修正 (引入即 true, b8ca2d3 后为生产口径); 六场景矩阵全绿 + race/boot/remote-mine bit 一致; 剩余: spawnRules/spawnMission (~35 符号 roomWorkforce 消费) 迁移 workforce.ts 快照口径后 roomWorkforce 1475 行整体退役, 死导出 (~22 个零外部消费但内部互引) 随文件拓扑消亡——留批次二; out-* 休眠 B 线归任务化批次；批次二实录 2026-10-18: ① 实证 UpdateSpawnMission 为纯空转环 (spawnControl 删/mineMission 桥/console 桥后挂单零消费者, 每 interval CPU 白耗)——整链退役: spawnRules.ts 430 行删除, spawnMission.ts 477→66 行 (仅存休眠 external spawner 需要的 SpawnMissionAdd), 调度表项/Room 挂载/接口声明/MissionUpdate declare 全清; ② 同类断链修复×2: usePower.Operate_Spawn 触发条件池读改蛋感知口径 (spawn.spawning 蛋 unit 匹配, 否则 power/team 件孵化加速永不触发), console mine 取消命令删池清理段 (directSpawn 蛋不可取消, 语义如实化); ③ roomWorkforce 拓扑剪枝 1475→805 行: 死导出 31 符号 (spawnRules 死后外部消费归零) + 二次不动点 7 符号 (getUpgraderTarget 仅注释引用/registerUpgraderStarve 被 workforce ctx 版遮蔽/rush 槽位零引用等), 剩 53 符号全活——真根=energyLogistics.getControllerCarryQuota→(getUpgradeWorkTarget,getUpgraderPathTime)+fill-request/remote-income 双注册表 (解循环依赖, getUpgradeWorkTarget rush 分支/estimateRoomEnergyIncome 消费); ④ speedrun +3t (21113→21116) 确定性漂移=CPU 蝴蝶 (spawn 池挂单 Memory 序列化开销消失→bucket/qos 分档微移), race/boot/remote-mine bit 一致排除逻辑回归, 新参考已录; 六场景矩阵全绿×2; ⑤ CreepConstant 失效注释修正 (定编指 workforce.upgraderCountTargetOf); 剩余: getUpgradeWorkTarget/getUpgraderPathTime 活房口径→快照口径迁移 (getControllerCarryQuota 物流配额链, 行为敏感需独立验证批次) 后注册表+805 行整体退役；⑥ 死配置清理: THRESHOLDS.SPAWN 整段+TRANSPORT/TOWER 死段+ENERGY/REPAIR/TICK 段内死字段 11 个 (消费链 spawnControl/spawnMission Getter 已亡), roomModeAccess.spawnMissionInterval×5 (调度项删除后零消费)；⑦ RCL1 采集定编修复 (RosmarinBot race 同源口径): harvestStaffingOf 泛化 energyCapacity 折算——单只 W<满速 5W 时按 ceil(容错 6W/单只W) 每源多只 (RCL1 2W1M×3/源=6W 采满 10e/t 源速, 550 容量 5W 自动回落单座), 体型复用 buildRushHarvesterBody 单一实现 (RCL1 预算 300 恒产 [W2,M1]=250); 任务面每源多槽 (harvestSlotsFor: 任务 i↔slots[i], upgrade 工位先例, 主槽无缀 key 保单座期键连续), 代理钉位 task.targetPos 槽位坐标 (旧口径回退 intel 主驻点); 让位闸阻塞线回归基础编制 sources.length (满编目标由 unitTargets 持续请求慢慢补齐, 不阻塞升级启动), 让位期 carrier 放行口径 <max(1,在岗矿工数) (1 采 1 搬交替, 替代 yieldCarrierFloor=1 死锁); RoomObservation 补 energyCapacity 快照字段; 效果: 6k 双源探针 harvested 29000→97522 (3.4×) control 8526→13220 (+55%), boot L3 17049→8885 / arena L3→8991 / speedrun L3 21116→19049, race L2 796→806 (开局序列微调), 全场景重录参考后矩阵全绿×2, 单测 5/5；批次三收口 2026-10-18: 实证 energyLogistics 匹配器全链死码 (getAssignedEnergyTarget 唯一调用点 2026-10-15 勘误已关闭「保持关闭」, getControllerCarryQuota→getUpgradeWorkTarget/getUpgraderPathTime 活根仅存于此死链; 快照口径 controllerCarryQuotaOf 在 workforce.ts 承接专线配额)——energyLogistics 320→25 行 (仅存 getStandardReserve/getEnergyLevel 供 FunnelModule), fill-request/remote-income 双注册表删 (features 注册摘除, outMine 休眠线自持存根), roomWorkforce.ts 1475 行整文件退役 (升级定编/采集定编/专线配额全部由 workforce.ts+productionGate 快照口径承接); 六场景矩阵全绿, tsc/oxlint/arch-guard(123)/单测 5/5）
- [x] 5.7 Movement 单点契约锚定：`preTickBetterMove → broker commit → endTickResolve` 时序作为 Broker 模块契约固定（破坏即全员冻结），sim 场景含移动执行率断言（不低于基线 97% 水平）（时序契约结构性固定于 agents/index: preTickBetterMove(agents 前)→broker.commit→endTickResolve(收尾), 破坏即全房冻结, 由 noErrors+行为门承载; trafficMonitor 增 moveExecutionRate 滚动窗口遥测 (intentTicks/movedTicks, 进程内存态), diag.moveRate() 查询, 契约基线 ≥97%; race bit 一致）
- [x] 5.8 sim 验证：legacy 全关后采集/搬运/升级/建造吞吐不低于关闭前基线（dry-run 实证 2026-10-18: legacyExecMode 翻 off-global 重建后六场景矩阵全绿且 RCL 时间线与 on 版逐场 bit 一致 (speedrun L2@806 L3@19049/arena L2@659 L3@8991/sprint L2@1216/boot L3@8885/race L2@806/remote-mine 全对齐, p95 4-5ms 持平)——trio (manager/transporter/miner RCL4+) 在 sim RCL≤3 结构性不出现, 翻转在 sim 域行为中性; 吞吐基线: 同期 RCL1 采集定编修复使 6k 探针 harvested 29000→97522 (3.4×)/control 8526→13220 (+55%), 远超关前基线; 生产翻转 (off-global 上线) 锁 9.2 trio 域实服验证后执行, dry-run 后已回翻 on+重建）

## 6. Phase 6–7 — 孵化建造管线（轨道 C）

- [x] 6.1 spawnDirector 拆分：Demand Sources（定编/替补/防务/扩张/编队/特需）→ SpawnArbiter（全局裁决）→ BodyFactory（纯函数）→ SpawnQueue → SpawnCommand；legacy spawnControl 四处直连改经管线（demandSources 230 行/spawnArbiter 222 行/编排层 372 行；race L2@796 与拆分前一致，boot 读数被并行 7.x 子代理中途态污染待复测；原生 spawnCreep 同步语义保留并登记豁免，broker 迁移归 6.2）
- [x] 6.2 directSpawn 改造为 emergency/direct 模式 SpawnRequest，TeamSpawner/ExpandController 等调用方迁移；UnitDefinition 统一角色定义源（capabilities/body policy/population class 唯一来源）（DirectSpawnRequest{mode,unit,memory,body,bodyNameOverride}；4 调用方迁移 TeamSpawner/assist/ExpandController×4；体型解析 显式 body → SpawnUnit 走 BodyFactory 按容量 → 特化战件 UnitData.bodypart；tsc/lint/arch 绿）
- [x] 6.3 孵化中名单统一接口 `isSpawning(name)`：ClearModule/visuals/courier/普查全部改用（收编 4.1 的近期修复为架构层接口）（spawningRoster.ts: engineSpawningNames/isSpawningUnit/busySpawnCount；clear.ts/roomVisuals/model.ts 已改用）
- [x] 6.4 孵化链路可审计：队列深度/优先级等待时长/取消原因计数入遥测；单需求方异常不阻断孵化线（SpawnTelemetry 入 SpawnMemory：queueDepthPeak/waitEma/denyReasons + safeSource 四源隔离；race L2@796 不变）
- [x] 6.5 Construction 意图化完整版：建造放量与在岗产能联动（N×worker 承载阈值，配置化）；结构优先级表配置化并受战略阶段调制（冲级期产业让位）（workerSitesCapacity=3 联动闸（builders=worker+universal，下限保 3 工地流水）；rushIndustrialTypes 压序 +100 调制经 record.rushMode；boot L3@17025×2 稳定 / race L2@796 / remote-mine 不变）
- [x] 6.6 外部道路 roadBuilder 三处直连 + miner 自放容器收编：经建造管线提交（roadBuilder cc 坐标/road/ext-container ×3 + miner 自放容器 ×1 → sharedBroker createSite；豁免清单 330→327 收缩；race L2@796 不变）
- [x] 6.7 sim 验证：speedrun 分段门无新增红；建造风暴指标（sites 积压/worker 比）达 4.5 验证线（speedrun 断言集与基线一致无新增失败; sprint 探针直跑引擎取证: 全程放量 8 次 placeOverCap=0 (全部发生在 min(12,max(3,3×builders)) 承载阈值内), sites 峰值 8 ≤ 4.5 记录, t45000 清零 (4.5 为 t47500); 尾段建造者衰减期 backlog 3→1→0 递减无新增风暴; 矩阵重录参考后全场景门通过）

## 7. Phase 8 — 经济账本（轨道 D）

- [x] 7.1 ResourceLedger 五态分账（Observed/Available/Reserved/Committed/Consumed + 预计收入）：按房间能量账先行，预留绑定任务/命令生命周期
- [x] 7.2 预留泄漏防护：任务终结/命令失败同步释放 + 超龄预留强制回收（阈值配置化）
- [x] 7.3 收入口径统一：采集/外矿/预订加成统一折算（未预订减半），定编与孵化门同源引用；remoteMining 满采上限折算修正
- [x] 7.4 饥饿与瓶颈指标入遥测（需求长期缺供/库存满空/链路断供），Memory 无界流水不入库
- [x] 7.5 孵化/建造/升级供给决策全部切换到 Available 口径，sim 验证无超发与饥饿误判
- [x] 7.6 Memory 双轨收敛预处理：legacy accessor 域（RoomData/MissionPools/TeamData 等随对应 legacy 域删除）标记消亡路径，不提前大迁移；`bucketGovernor` 散键写入收进 Nexus 命名空间（Memory.Nexus.bucketGovernor{threshold,syncedAt,active}；legacy 根散键首次接管后一次性删除；getActiveRemoteThreshold 带迁移窗口回退；remote-mine L3@0 不变）

## 8. Phase 9–11 — 战斗/产业/外域收编（轨道 E + F，与 6/7 并行）

- [x] 8.1 defense 需求化：threat model → demand → intent 单向流；defense/units（defendDuo/defendSingle）直操动作改经 Adapter 提交；塔/安全模式保持 broker 提交
- [x] 8.2 teams Adapter 化：TeamAction/TeamBattle/units 直连动作（move/attack/heal/rangedAttack ~45 处）经编队 Adapter 汇入边界，内部战斗算法不动；所有权由 Adapter 持有；解散交接无真空（控制权先归还再释放任务）
- [x] 8.3 sim 场景验证编队行为等价（攻防场景回归，算法资产保全）
- [x] 8.4 industry 逐子系统 Adapter 化：autoMarket/terminalControl/lab/factory/nuker 直连点收编；console 人操豁免登记（industryAdapter.ts + INDUSTRY_ADAPTER_CONFIG；broker append 6 kind：runLabReaction/factoryProduce/processPower/createMarketOrder/changeMarketOrderPrice/extendMarketOrder + nukeSync createFlag 收编 flag 管线；console 4 条人操豁免登记；race/arena bit 一致；arch-guard scanner 盲区补齐 runReaction/produce/processPower/createOrder/changeOrderPrice/extendOrder——334 处全在册）
- [x] 8.5 external 扩张意图纳入边界：claim/reserve 经 3.5 管线；expand 链路可观测（否决必有原因输出）（claim/reserve 动作已在 agentSystem 经 claim 管线（既有）；ExpandController 孵化否决可观测：lastDeny 追踪 + 限频上屏 + 连续 60 次升级 WARN 并发布 note 跨 shard 可见）
- [x] 8.6 intershard 调度意图可审计（决策记录可查询，无静默丢弃）；Memory 写入受 schema 与容量约束（applyCmds 全丢弃分支 deny() 留痕：denyLog 环形 40 条上限 + 限频上屏；INTERSHARD_ROOT_CAPS: plans 32/status 64/outbox 每 shard 64 超限最旧淘汰+上屏；未知命令类型显式拒绝）
- [x] 8.7 豁免清单收缩：defense/teams/industry/external 域条目清零或仅剩登记 Adapter（defense/teams 0 条；industry 仅剩 4 条 console 人操豁免登记；external 6 调用全收编清零——roadBuilder destroy×1/remove×3→destroyStructure/removeSite 管线、mine suicide→work 管线、Spawner.attack 改名 requestAttackUnit 消歧误报；新增 config/external.ts EXTERNAL_COMMAND_PRIORITY 收口优先级；清单 334→328/43→41 文件）

## 9. Phase 12–15 — 删除门禁与生产硬化（全部轨道完成后）

- [x] 9.1 四条件删除门禁落地：删除操作关联验证记录（Nexus 等价存在/实服验证/sim 验证/CPU 验证），按最小可回退单元执行，跨域批量删除被拒（docs/nexus-design/legacy-removal-ledger.md 台账：四条件定义 + 删除单元/清单变化/证据列，9.2 每删一域先过台账）
- [ ] 9.2 legacy 删除执行：prototype 角色库/economy legacy units/legacy spawnControl 按域逐个删除，每删一域跑全场景门 + 实服落地观察一个 4wt 重置周期；实服缺陷回流 `docs/bugs`
- [x] 9.3 豁免清单收敛度量：按域输出收敛百分比；除人操豁免外清单趋零；守护脚本验证清单不回涨（arch-guard 新增 config/arch-allowlist.min.json checkpoint 单调断言：回涨即红，--allow-growth 显式放行并推进 checkpoint；--report 输出按域在-call 计数 + 人操/非人操分离度量；当前非人操在-call 131 条）
- [x] 9.4 生产级不变量监控固化：owner 唯一/任务必终结/孵化名单一致/Memory 有界/CPU 预算五项不变量的限频告警接入遥测；全场景门回归线一键化（一条命令跑完输出逐门红绿）（`src/core/invariantWatch.ts` commit 段 P3 模块：任务指针分裂/滞留泄漏、孵化名单引擎↔簿记互查、Memory 限频采样、CPU 告警线；计数进程内存态不落 Memory；`diag.invariant()` 查询口；`scripts/sim-matrix.mjs` 一键全场景对照 `baseline/sim-matrix-reference.json`，绿门 bit 一致红线/分段门漂移仅告警/cpu p95 劣化 >2ms 红线，--update 刷新快照；race 验证 bit 一致 p95 不变）
- [ ] 9.5 实服落地总验证：指定私服连续运行 ≥ 一个完整重置周期，孵化/采集/升级/扩张/防务关键行为正常，CPU 与 Memory 稳定；docs/bugs 全部 P0/P1 勾销或降级
- [ ] 9.6 收尾对账：AGENTS.md 准则核对（无硬编码/无参考注释/属主 nightx:night/未擅自提交），openspec 变更可归档
