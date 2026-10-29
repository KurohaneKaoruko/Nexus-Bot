# legacy-consolidation 摸底留档 (任务 0.3, 2026-10-24)

> A/C 波各切片的引用凭据源。基线 commit `4a3ee14`，bundle 为摸底专用插桩版（已还原）。
> 方法：静态全仓扫描 + sim 四场景（boot/sprint/remote-mine/arena）Memory 落盘画像（`--dump-memory`）+ roleRegistry 运行时插桩（probe 版 bundle 跑 boot/sprint，读数以角色分布互证）。

## A. sim 运行时画像（结论：legacy exec 路径 sim 全程 0 调用）

四场景落盘 Memory 的存活单位角色分布：

| 场景 | 出现角色 | 与 legacy executor 集合交集 | MissionPools 池内任务 |
|---|---|---|---|
| boot (20k) | carrier/harvester/upgrader/worker | **∅** | 7 池全空 |
| sprint (50k) | carrier/harvester/upgrader/worker | **∅** | 7 池全空 |
| remote-mine (30k) | carrier/harvester/upgrader/worker | **∅** | 7 池全空 |
| arena (40k) | carrier/harvester/upgrader/worker/reserver | **∅** | 7 池全空 |

- `NEXUS_TASK_DRIVEN_CODES` = {harvester, carrier, upgrader, worker, universal, rush-courier, defender, scout, claimer, reserver}；四场景出现的全部角色都在集合内（reserver 也在）。
- **7 个池（transport/build/repair/terminal/spawn/mine/boost）全程空**：updaters 在 sim 的 RCL≤3 房间条件下不产单（能量/结构门槛未到，或 UpdateSpawnMission 已退役）。
- roleRegistry 15 handler（manager/miner/transporter/aio/double-*/one-ranged/pcHeal/defend-*）在 sim **零孵化零调用**——与 `role-registry-executor-gap.md` 既有结论互证：manager/miner 结构性不出现（RCL≤3），deposit-*/power-* 只在 mineMission 人操链激活，warSpawn 旗标族只被人操触发。
- sprint 任务板快照（50k 末）：42 任务，kinds={harvest:8, build:9, scout:2, reserve:1, upgrade:6, carry:8, fill_spawn:5, repair:3}——**任务板已独立承载全部 sim 工作语义**。
- 插桩结论注意：boot 有一只 carrier 短暂无 taskId（`C-197B`），但 carrier 在任务驱动集合内 → 走快递/空闲分支，不落入 exec()。

## B. MissionPools 读写点（全量清单）

写池（addMissionToPool）：
- `manageMission.ts:319` → transport 池 `'manage'` 型（manager 调拨单）
- `manageMission.ts:339,371` → terminal 池 `'send'` 型（终端发送单）
- `mineMission.ts:377,394` → mine 池 `'power'`/`'deposit'` 型（人操外矿单）
- `spawnMission.ts:60,62` → spawn 池（**已退役**：features.ts 注释实证 UpdateSpawnMission 链 5.6 批次二删除，仅剩类文件与 Getter 残留）
- `transportMission.ts`/`workMission.ts` → transport/build/repair 池（存量维护）

读池（消费方）：
- `economy/units/manager.ts:213` → `getManageMission()`（manager 取调拨单）
- `industry/controls/terminalControl.ts:16` → `getSendMission()`（终端发送执行，Industry 域活代码）
- `manageMission.ts:115` → `getSendMissionTotalAmount()`（发送总量对账）
- `proto/Creep/function/boostFunction.ts:236,450` → boost 池（boost 分配）
- `economy/units/transporter.ts:28`、`mission/updaters/workMission.ts:350,355` → transport/build/repair 池

**关键依赖链**：terminalControl（Industry 主线活代码）消费 terminal 池 → 域 3 删除时必须先把 send 语义迁任务板；manager 消费 transport 池的 manage 型 → 域 1 迁移时一并断。

## C. mineMission 活语义清单（域 2 迁移对照源）

- **UpdateMineMission**：元素矿/沉积矿定编（PA/PH 成对下蛋保原子性：`directSpawn` ×2 同 tick、freeSpawns≥2 门槛、boost 对偶 `assignPowerBoostTasks`、PR ranged 补位、count/max 定编簿记 `Memory.Nexus.OutMineData[room].count`）。
- **UpdateHighwayScan**：`OUTMINE_CONFIG.LOOK_INTERVAL` 分帧轮询 `OutMineData[room].highway` 名单 → `observeRoom` 回调 → PowerBank/Deposit 侦测 → mine 池发单。**依赖人操目标名单**（`OutMineData.highway` 由 console `mine.ts` 写入）+ `RoomData.outminePower/outmineDeposit` 人操开关 + 能量 ≥50000 门槛。
- **BOOST_POWER/LAB_PRODUCTION 常量缺失**：bundle 检查告警实证 mineMission 链引用的常量在官方常量表不存在（拼写错误，运行时 undefined）——该链从未在 sim 正常运转，属「写死但坏」状态。

## D. rooms[].energyState 活消费方（5.1 处置输入）

- 写：`proto/Room/function/baseFunction.ts:286-324`（updateEnergyState，features.ts 每 tick 调）
- 读（活）：`core/statistics.ts:335,428`（统计展示）、`utils/rush.ts:393`（race 档位）、`visuals/roomVisuals.ts:410`（可视化，读的是 room.energyAvailable 非 memory 字段——不计）
- 读（随域消亡）：`mission/updaters/transportMission.ts:441`（域 3 删）、`external/mine/state.ts:136`（C 波删）
- **初步结论**：energyState 有 2 个跨域活读口（statistics/rush），倾向「保留为 RoomFeatures 基础状态」；5.1 按此裁定。

## E. 休眠对象清单 7 项三口径凭据（C 波引用）

| 对象 | ①无挂载/无调用 | ②仅残留声明/人操 | ③sim 不触发 |
|---|---|---|---|
| `external/mine/*` 全链 | `room.outMine()` 调用点全仓 0（features.ts:51 勘误注释互证）；`mine/` 目录仅被 `externalMine.ts` re-export，无外部消费 | 声明 `room.interface.d.ts:662`；console `mine.ts` 人操入口读 `OutMineData` | 四场景 RCL≤3 + 无 highway 名单 → 0 触发 ✓ |
| `proto/PowerCreep/mode/assist`（非 assistHeal） | `execute.ts` 按旗标/记忆触发（`-assist` 旗或 assistTargetRoom 记忆）——**触发条件存在但依赖人操旗标**；`assist.ts` 内含 `directSpawn`（pc-heal 孵化） | 人操旗标链 | sim 无 pc 孵化条件 ✓ |
| `PowerCreep/mode/operate` | `execute.ts` 无旗时 fallthrough 调 `runOperate`——**活路径**（pc 在场自动运营） | — | sim 无 powerCreep ✓（引擎不生成 pc） |
| `visuals/highwayMine.ts` | console `mine.ts:229-237` 人操启用（enable/enableAll/run）——**人操入口活** | 人操 | sim 0 触发 ✓ |
| `core/qos.ts` 兼容读口 | legacy 消费方 = mission/index.ts（qos.getQoS）+ outMine.ts——前者域 3 删、后者 C 波删 | — | — |
| `accessor.ts` legacy getter | `getOutMineData` 读点：statistics.ts:315、console mine.ts、mineMission.ts（domain 2/C 波各自处置） | — | — |
| 词表死角色 | `role-registry-executor-gap.md` 已摸底：真死 = out-*×9 零孵化源（ExternalMineSpawner 休眠）；warSpawn 族（attack-claimer/logistic/dismantle）人操保留 | ✓ | ✓ |

**C 波处置预判**（正式决策在各切片执行时引用本档）：
- `external/mine/*`：三口径齐 → 退役 ✓
- `mode/operate`：**不是休眠**（无旗 fallthrough 活路径）→ 保留，仅随域 4 直驱化移位
- `mode/assist`：人操旗标链 → 按人操豁免定性（同 warSpawn）
- `highwayMine.ts`：人操入口活 → 随 `OutMineData` 域处置（console 入口删除时一并删，或定性保留）

## F. 孵化源画像（词表三方一致断言的初始数据）

directSpawn 调用点（spawnDirector 外）：
| 调用点 | 角色 | 定性 |
|---|---|---|
| `mineMission.ts` ×6 | power-attack/power-heal/power-ranged/deposit-harvest/deposit-transfer | 域 2 迁移（人操外矿链） |
| `ExpandController.ts` ×4 | claimer + aid 族 | 活代码（expansion 主线） |
| `TeamSpawner.ts` ×1 | 编队角色 | 活代码（teams 主线） |
| `warSpawn.ts` ×5 | attack-claimer/logistic/dismantle | 人操豁免保留（域 7） |
| `industry/console/spawn.ts` ×4 | pc 系 | 人操 |
| `PowerCreep/mode/assist.ts` ×1 | pc-heal | 人操旗标链 |

spawnDirector 需求源 standing 定编（`SpawnUnit` = universal/harvester/upgrader/worker/carrier/manager/transporter/miner/rush-courier/scout/defender/claimer/reserver）：manager/transporter/miner 在 `unitTargets` 有定编入口但 sim 从未触发（与 A 节互证）。

## G. 旧池任务产出快照（映射表对照程序基准）

boot + sprint + remote-mine + arena 四场景 7 池全程空 → **旧池在 sim 的任务产出 = ∅**。
映射表对照程序的「旧语义缺失」判定在 sim 域自动满足；真正的等价性风险集中在 sim 不可达域（manager/miner/mine 人操链），由 B/C 节的静态语义清单 + 域切片单测承担。

## H. 域 7 warSpawn 定性补充取证（2026-10-25）

- warSpawn 旗链（AIO/CLEAN/ACLAIM/DIS/LOOT 前缀）孵化 6 角色：aio/cleaner/attack-claimer/dismantle/logistic/one-ranged（`getFlagSpawnLoad` + `directSpawn`）。
- **执行缺口实证**：attack-claimer/cleaner/dismantle/logistic 的 `executor` 声明在 roleRegistry **无 handler**（摸底 A 节 0 调用互证）；`attackController`/`dismantleMode` 全仓无消费点——这四个角色孵出后即空转（人操链语义已坏，仅 aio 有 teams handler）。此缺口由域 6 词表裁撤处置（人操豁免定性的是 warSpawn **孵化链**，坏角色的词表条目仍按三方一致断言清理）。
- 豁免清单 `warSpawn.ts::remove` track 已改「人操豁免 (warSpawn 旗标战争孵化, 域7定性保留)」，arch:guard 绿、128 条不变。

## I. 域 4 直驱化前置调研（2026-10-25，只读取证）

**defense 族（defend-attack/defend-ranged/defend-2attack/defend-2heal）**：
- 孵化源 = **零**。主线只孵 `defender`（任务驱动，`demandSources` 定编 + `unitForTaskKind("defend")→"defender"`）；defend-* 四角色全仓无 directSpawn/需求源调用（仅 boostFunction boost 表与 combatHeal 工厂引用）。
- handler 本体是**算法资产**：defendSingle/defendDuo（坡位选择/锁定/近远切换）+ combatHeal 工厂——动作已 8.1 经 combatAdapter 提交。
- 直驱化处置：无孵化源 ⇒ 无「已孵化待执行」单位 ⇒ **不需要直驱运行时**；真正的处置 = 词表条目归域 6 裁撤判定（零源死角色），handler 算法资产（defendSingle/defendDuo）保留待 defense 域后续复用或随孤儿清理。域 4.1 的实际工作收缩为：registry 摘除 defense 族三行绑定（defend2Attack/defendAttack/defendRanged）+ defend-2heal 工厂绑定，随域 5 删除 registry 一并完成——**无需新增 Defense 直驱代码**。

**teams 族（aio/double-attack/double-dismantle/one-ranged）**：
- 孵化源 = TeamSpawner（编队运行时）+ warSpawn AIO 旗（aio）。编队单位由 Teams 域自身消费（TeamController 驱动编队），exec() 路径对这些角色是**备用通路**（编队失管时兜底）——摸底 A 节 sim 0 调用。
- 直驱化处置：Teams 域已在驱动（TeamController/TeamAction 经 Adapter），registry 的 teams 绑定随域 5 删除即可，无新增工作。

**pcHeal**：PowerCreep 域自身驱动（PowerCreeps TickModule 的 pc.exec() 调用链），registry 的 pc-heal 绑定是 creep 侧孵化 pc-heal 后的执行入口（mineMission 人操链孵化）。随域 2 迁移后由 economy 驱动路径接管，registry 绑定随域 5 删。

**域 4 结论修正**：原任务书「defense 族改 Defense 模块直驱、teams 族改 Teams 运行时直驱」的前提（存在 exec() 活跃调用面）不成立——sim 与静态双证据显示 registry 15 绑定中 13 个零调用（唯 manager/transporter/miner 走 exec，但 sim 亦零孵化）。**域 4 的正确实现 = 摘除绑定（随域 5 删 registry）+ 词表孤儿移交域 6**，不新增直驱运行时。此结论将回写 tasks 4.1。

## J. 域 3.1 剩余行映射核对（2026-10-25，静态取证）

**spawn 池（`spawnMission.ts`）**：与 MissionPools 共栖但**不在 8 域退役清单**——它是孵化队列实现（`SpawnMissionAdd` 发单 → spawnDirector 经 spawn 池消费），主线孵化仍在用（`utils/rush.ts:380` 读 spawn 池做 rush 仲裁、`statistics.ts:338` 读队列长度、`spawnLoad.ts:48` warSpawn 族共享载载计数）。**处置：随域 5 孵化链收编（spawnDirector 已是主线，spawn 池是它的一部分），不属 mission pool 退役域**。

**transport 池 transport 型（`UpdateTransportMission`）**：消费方三处——① `transporter.ts`（域 1 退役）② `MissionSubmit`（通用锁单面）③ 发单方 = **`console/resource.ts:117` 人操资源调拨** + **`boostMission.ts:123` boost lab 清理/填充回运**。人操发单链随 boost 切片与 console 永久豁免处置；boost 发单随 boostMission lab 管理迁 industry planning 统一收口。**处置：发单方随 boost 切片迁移 + console 人操豁免保留，transport 池在域 3.4 删除**。

**manage 池 'manage' 型（`UpdateManageMission`）**：发单逻辑 = storage↔terminal 资源平衡（域 1 子代理在迁）；'send' 型由 terminalControl 消费（Industry 活代码）——**send 语义已在 boost 分歧裁决中并轨：terminal 发送语义独立成 terminal 切片，先于域 3.4 删池**。

**work/buildRepair/wallRepair 池**：消费方全仓零命中（`getWorkMission`/`getWallRepairMission` 无调用点）——updater 自产自销写占位单，board 的 build/repair kind 已覆盖（`planEconomyRoom`/`planDefenseRoom` 每拍产出）。**处置：纯死写，域 3.4 随 mission 目录整体删除，无语义损失**。

**`TransportMissionCheck`/`BuildRepairMissionCheck`**：锁单有效性巡检（bindCreep 存活/target 容量仍在）——board 的 TTL/租约对账机制同构承担（tasks/index.ts maintainLedger + leaseTicks）。**处置：board 对账承担，随域 3.4 删除**。

**`UpdateHighwayScan`**：活语义（highway 轮询 + power/deposit 侦测 + observeRoom 回调）已由域 2.1 `mineralWork.ts` 逐条搬运（对照表 14 条）。**处置：随域 2.3 删 `mineMission.ts` 一并消失，无遗留**。

**`usePower.ts:72` 读 mine 池**（`checkMissionInPool(mine)`）：PC 放 power 判定「有矿有蛋」——**新发现**。mine 池删除后此判定回落 false → PC 不放 power 技能（人操 assist 链）。处置：随 boost/terminal 切片的簿记迁移一并改读 `OutMineData` 簿记（`powerMine` 键非空即有矿），域 3.4 删池前落地。

## K. 3.3/3.4 耦合关系核定（2026-10-25）

`Memory.MissionPools` 实驻 `Memory.Nexus.MissionPools`（`getBotMemory()` 即 `Memory.Nexus` 视图，accessor.ts:16-20 + `getMissionPools`）。池 API 全部走 `??=` 惰性重建——**迁移函数若先于 updaters 删除落地，活 updater 当拍即重建池键，迁移无效**。故 3.3（v13 迁移）与 3.4（删 mission/ 目录 + 调度入口）必须同一切片落地：先删代码（调度入口 + updaters + 池 API），后写迁移（v14→v15 清六池残留、保 spawn 键）。spec 的「v13」是 A 波目标版本号名义值，实际注册表已到 v14（carry 词表迁移占用了 v14），MissionPools 清理迁移将落 v15 并在 spec 内登记版本号勘误。

## L. 域 6 词表裁撤候选盘点（2026-10-25，静态扫描 + 交叉验证）

**口径**：孵化源 = demandSources/spawnDirector/warSpawn/externalScheduler/ExpandController/mineralWork/TeamSpawner(TeamConfig member 推导)/spawnMission 的发单面；任务驱动 = NEXUS_TASK_DRIVEN_CODES。

**真·零孵化源候选（30 个）**：attack-claimer、cleaner、defend-2attack、defend-2heal、defend-attack、defend-ranged、deposit-attack、deposit-harvest、deposit-heal、deposit-ranged、deposit-transfer、double-attack、double-dismantle、double-heal、one-ranged、out-2attack、out-2heal、out-attack、out-build、out-defend、out-invader、out-mineral、out-ranged、out-repair、pc-heal、power-attack、power-carry、power-heal、power-ranged、dismantle（warSpawn DIS 旗孵化源在，**保留**——见修正）。

**修正项**（初版扫描遗漏，人工核证后剔除/保留）：
- team-attack/team-dismantle/team-ranged/team-heal：TeamConfig `member()` 按体型首部件推导（A→team-attack、W→team-dismantle、R/H→team-ranged/team-heal）——**有孵化源，保留**
- dismantle：warSpawn `DIS/` 旗 directSpawn（`UNITS['dismantle']`? 核证：warSpawn.ts 引用的是 `UNITS['cleaner']` 与 `dismantleMode` 记忆字段；DIS 旗实际孵 cleaner+dismantleMode）。dismantle 角色待域 6 实施时按 warSpawn 逐旗核证
- out-* 族：externalScheduler.ts:76-77 引用 out-build/out-mineral（休眠链挂载点），outMine 人操链的活发单面——**C 波休眠链处置时一并裁定，域 6 不动**
- power-*/deposit-* 族：mineralWork（域 2 迁移后）经 directSpawn 桥接孵化——**有孵化源（人操链），保留**
- rush-courier：courier.ts 专线孵化——**有孵化源，保留**

**结论**：真裁撤候选 = defend-* 四件 + double-* 三件 + one-ranged + attack-claimer/cleaner/logistic 待 warSpawn 逐旗核证 + pc-heal（PowerCreep 链孵化源待核证）。域 6 实施时以 structure-guard 断言⑤采集器自动化此盘点。

## M. 域 8 proto 角色行为库残留面初盘（2026-10-25，只读）

`src/proto/Creep/function/` 10 文件 3570 行、65 个 override 突变方法。modules/console 侧直接引用 ≈ 0（workFunction 1 处待核证）——**残留面全部经 Creep 原型继承链被动可达**（exec() 角色调用）或纯死代码。域 8 实施时的处置依据：exec() 退场（4.2）后这些方法失去调用方，逐文件判定「纯库函数导出（cacheFunction/boostFunction 的 getBoostCache 等）↔ 死代码删除」。**依赖顺序锁定：域 8 必须在 4.2 删 exec() 之后实施**（当前顺序 4.5 已正确）。

## N. 域 1.1 供给落档（2026-10-25，实现交付）

**linkQuota.ts**（link 调拨供给）：manager 的 planLinkTransfer 语义纯核搬运——分区（源 link 2 格内排除/控制器 link/中心+storage 邻域管理 link/普通）、水位（兄弟饥饿 <400 触发 fill 且管理 link free≥100 短路、无饥饿 drain >0）、dedupeKey `carry:link:{room}:{linkId}` 方向翻转同键幂等。7 单测逐条对照（含饥饿线边界/无 storage 短路/方向翻转）。

**manageQuota.ts**（terminal 平衡供给）：checkTerminalResourceBalance 语义纯核搬运——发送簿记优先（energy 50k/矿物 10k 总量夹逼）、无请求按目标水位补（energy 25k/power 5k/lab·bar 3k/goods 1k/默认 3k 档，LabMap/BarList/Goods 分类）、溢出线转出（30k/5k/3k/3k/1.2k/4k）、`_terminal_clear` 旗标全清、storage↔terminal 邻域门。7 单测。`terminal_transfer` 不在 PLANNED_KINDS 清扫口径，模块自有键前缀自取消。

**executor 可执行面补齐**（fetchEnergy/deliverEnergy/hasFetchTarget）：link/terminal 不在感知快照 stores/energyStructures 内——三处加 `Game.getObjectById` 原生结构兜底（energy 口径），link fill 方向与 terminal energy 方向真正可执行；planners 提交阶段读原生房（Game.rooms 先例）。

**allocator 闸**：矿物方向 `terminal_transfer`（resourceType ≠ energy）挂 canExecute 拒绝——carry 执行分支是能量口径，通用件领矿物单只能空转；与矿物 harvest 同款处置，待矿物搬运执行分支落地放行。

**manage 型差集登记（域 3/industry 收口点）**：
- factory 平衡（`checkFactoryResourceBalance`）：industry 活代码 `factoryControl.ts:43` 经 `ManageMissionAdd` 写 transport 池——**industry 域对 transport 池的残留依赖**，域 3 删池前 factoryControl 需改任务板 carry；
- powerSpawn 平衡（`checkPowerSpawnResourceBalance`）：同上结构，`powerSpawnControl` 消费面待域 3 核证；
- boostLabWork（域 2 boost 切片新模块）的 lab 搬运发单仍走 transport 池（`addTransportMission`）——transporter 退役（1.3）后无人执行，域 3 统一收口为任务板 carry（**已知中间态窗口**：lab 为 RCL6+ sim 不可达域，实服待补）；
- **矿物搬运执行分支缺位**（P2，实服待补）：carry/terminal_transfer 执行均为能量口径，矿物方向靠 allocator 闸拒领——lab 矿物填充、terminal 矿物平衡、boost 矿物搬运在实服 RCL6+ 需矿物执行分支（generalize fetchEnergy/deliverEnergy 至 task.resourceType 或专职 handler）后方可真正运转。

**transporter 点对点（transport 型）结论**：已有覆盖 + 差集登记——fill_spawn/carry 配额 + industry 控制（lab/boost/nuker/powerSpawn/tower）承担其供给面；transport 池任务在 transporter 退役后无执行体（同上域 3 收口）。

## O. 域 1.2 切换验证落档（2026-10-25，合并门）

**切换**：`NEXUS_TASK_DRIVEN_CODES` 加入 manager/transporter（agentSystem L1621 词表），exec() 双轨对两族角色关闭，进任务驱动装配路径。

**合并验证门（1.1 供给 + 1.2 切换，bundle 05:22 重建含全部符号）八门全绿**：
- 三绿门逐位一致：boot L3@8889 / race-body-audit L2@458 / remote-mine L3@0（p95 7/7/5ms）
- 三分段门时间线逐位一致：speedrun L4@28316 / arena L3@11629 / sprint L3@35645（p95 8/7/7ms，speedrun +1ms 容差内）
- run-residue L2@1059 p95 4ms、stronghold-door L8@0 p95 5ms 逐位一致

**绿门构造性一致依据**：三门 RCL≤3 无 storage——manager 定编门（RCL4+storage）/transporter 定编门（storage+sites）不触发；sim 无 link/terminal（RCL5/6 建筑），1.1 新增供给零产出。切换的运行时行为差异（exec() 路径 vs 任务认领路径）在 sim 域不可达。

**随行缺陷修复**：sendLedger `pruneByRoomStock` 移植偏差（原 getSendMissionTotalAmount L419 原地删池单，移植版只过滤——已改原地 splice）+ 两处测试断言笔误（bugs/unit-test-awk-masking.md：单计数 awk 汇总掩盖 3 处失败，3.2a 的「20/20 绿」记录勘误）。sim 惰性域（sends 簿记 sim 恒空），无门效度影响。

**1.3 删除面预研（门后执行）**：units/{manager,transporter}.ts（468 行）+ economy/index.ts 两导出行 + registry 两绑定 + UnitData 两 executor 字段（transporter/manager——摘字段后 exec() 静默跳过，无 missing-handler 告警）+ arch-allowlist 8 条 P7 条目收缩。**范围修订**：`utils/moveWork.ts` 挪 2.3——其消费者是 miner.ts+manager.ts，1.3 删 manager 时 miner 仍活（跨域纪律）；`console/function/resource.ts` 的 `TransportMissionAdd`（人操 task 命令）留域 3 池 API 全删时按 spec「迁任务板语义不变」改写（池未删不构成悬挂写入）。孵化侧定编（demandSources manager/transporter 行）不动——切换后是活的任务驱动件，非退役面。

## P. 域 3.2 门读数与 sprint +526t 归因（2026-10-25）

**门读数**：五 GREEN + sprint WARN（L3@35645→36171，+526t/1.5%，分段门漂移仅告警，门判定通过）。三绿门逐位一致（boot/race-body-audit/remote-mine），run-residue/stronghold-door 未受影响。

**sprint 漂移二分归因（三组对照实验）**：
1. 2.3 提交树（0f29565）跑 sprint = L3@35645 逐位（漂移非环境/非引擎抖动）；
2. 3.2 工作区去掉 features.ts 改动（只留 console/v15）= 35645 逐位 → **漂移源唯一锁定 features.ts 的 MissionUpdate 摘除**；
3. 插桩版（MissionUpdate 保留 + 每 5000t 采样池状态）= 35645 逐位，且 **50k tick 七池零写入**（probe3 无一次输出）。

**机制结论**：MissionUpdate 在 sprint（RCL3）对池的净写入为零，但摘除仍致 +526t——静态分析六 updater 在 RCL3 的可达路径全部短路或死写（transport/manage/storage·terminal 短路、powerSpawn/nuker RCL8 短路、build placeholder 死写无人读、wallRepair 死字段）。唯一存活性差异在**间接效应**：MissionUpdate 每拍触发 workMission 的 `hasRepairTarget()`/`getOwnedConstructionSites()`（`find(FIND_STRUCTURES/FIND_CONSTRUCTION_SITES)`）与各 updater 的 structureCache getter 惰性扫描（room.storage/terminal/factory/structures），这些扫描预热 structureCache 的 tick 缓存与堆索引——摘除后主线同拍读这些索引时的扫描时序改变（structureCache「新对象需 update() 刷新索引」的增量语义下，新放置工地的可见时点可滞后），建造链开工延迟的微扰复利出 +526t。精确行级定位需插桩 structureCache 全 getter，成本高于收益，按「分段门漂移=趋势观察项」口径接受。

**处置**：不回退（WARN 级未触回退线；绿门逐位不受影响）；漂移留档本节；后续 3.4 删 workMission/transportMission 文件后该间接效应自然消解（扫描不再存在），sprint 时间线预计再漂移一次（同方向，趋势观察）。

## Q. 域 3.4 六池全链删除落档（2026-10-25，实现交付）

**删除面**：`mission/index.ts`（Mission 调度壳）+ updaters 四件（transportMission/manageMission/workMission/boostMission）+ MissionSubmit 的 transport/mine 提交方法 + MissionPools 六池死函数（getMissionFromPool 系/lock·unlock/update/check/submit/init）+ 本地词表与 TASK_TYPE_TO_POOL 双源副本 + 死缓存（spawnMissionNumCache/Tick 只删不写）+ `mission.interface.d.ts` 死方法/死类型（638→~225 行：TransportTask/BuildTask/RepairTask/ManageTask/SendTask/BoostTask 及全部池 API 声明）+ accessor TASK_TYPE_TO_POOL/sanitize/createEmpty 七池形状收缩 + creep-cache 死字段（task/wallTask 零读写）+ proto/Room extends 8→2（MissionSubmit/SpawnMission）+ spawning/index 死导出。

**保留面（spawn 池链逐点核证）**：MissionPools.ts（add/delete/getNum/getAll/getById + getRoomMissionPools 形状校验——残留六池键视为非法形状触发 sanitize 回收，v15 迁移防线补充）、MissionSubmit（submitSpawnMission/deleteSpawnMissionsByRole——external/mine:459 活用）、spawnMission.ts（SpawnMissionAdd——TeamSpawner/external 发单面）、MISSION_POOLS.spawn 键。消费面：spawnLoad/statistics:338/rush:380/roomVisuals:383/ExpandController（含 cleanupExpandSpawnMissions）/external-mine spawner×N——全部只读 spawn 池。

**三处池活写入改任务板（dedupeKey 幂等 upsert）**：
- boostLabWork lab 填充/清理：`carry:boost:{room}:{labId}:{res}`——能量向可执行（executor 原生兜底覆盖 lab），矿物向 allocator 闸拒领（N 节登记缺位）；
- factoryControl 产出回灌：`carry:factory:{room}:{product}`（factory→storage）；
- console resource.task 人操：`carry:manual:{room}:{src}:{dst}:{res}`。
Industry run 链加 `createTaskBoard(ctx.memory.tasks)` 透传（economy 先例）。

**structure-guard ⑥ 断言启用**：六池退役符号全仓扫描（56 符号，spawn 链 5 文件豁免）——首次跑出 7 处注释迁移溯源残留（AGENTS.md「注释不述来源」双重违规），已全部改写为功能描述。断言随本切片入守护主线。

**门读数**：八门全绿——三绿门逐位（boot L3@8889/race L2@458 p95 7ms/remote-mine L3@0）、三分段门逐位（speedrun L4@28316/arena L3@11629/**sprint L3@36171 与 3.2 接受值一致零新漂移**）、run-residue L2@1059/p95 4ms、stronghold-door L8@0/p95 5ms。P 节预告的「删除后再漂移」未发生——+526t 在 3.2 调度入口摘除时已终态，updater 文件删除对时间线零扰动（惰性扫描间接效应归因获实证支持）。参考快照随本次读数推进（sprint 36171 锁定）。N 节 powerSpawn 待核证项关闭（powerSpawnControl 独立自治）。

## R. 域 4.2 exec 双轨删除 + 域 4.3 词表孤儿预盘（2026-10-25）

**exec() 双轨删除（4.1+4.2 合并）**：删除面 = runtime/{registry,execute}.ts + agentSystem exec 分支（NEXUS_TASK_DRIVEN_CODES 13 码）/legacyExecMode 开关 + CreepConstant executor 字段×35/EXECUTORS 派生表 + creep.interface exec 声明。驱动承接全景：任务驱动 13 码（harvester/carrier/transporter/manager/upgrader/worker/miner/universal/rush-courier/defender/scout/claimer/reserver）+ rush-courier 无租约直驱 + TeamController（team-* 4 码）+ PowerCreep 独立链（pc.exec 不在范围）。reportIdleUnit 限频诊断（同名 500t）入 runAgents。

**4.2 门读数**：八门全绿逐位一致——六场景 sim-matrix --build（speedrun L4@28316/arena L3@11629/sprint L3@36171/boot L3@8889/race L2@458 p95 7ms/remote-mine L3@0）+ run-residue L2@1059/p95 4ms + stronghold-door L8@0/p95 5ms。exec 删除对全部场景零扰动——印证摸底 A 节「sim 全场 exec 0 实质调用」（registry 11 绑定中 sim 可达的 manager/transporter/miner 三码已在域 1.2/2.2 切换任务驱动）。

**4.3 词表孤儿预盘（33 角色消费面分类）**：
- **warSpawn 人操链（5）**：aio/cleaner/attack-claimer/dismantle/logistic（LOOT 旗孵 logistic 非 one-ranged）——H 节已定性 attack-claimer/cleaner/dismantle/logistic 四角色 handler 缺失语义已坏（executor 已删无从修复，warSpawn 旗语义随域 6 收口判定：删旗或词表条目）。aio handler 语义完好（teams 行为树），但驱动链已随 exec 退役——AIO 旗孵出的单位将只报「无任务待派」（人操链实服待补验证）；
- **外矿休眠孵化链（13）**：out-build/out-defend/out-2attack/out-2heal/out-invader/out-attack/out-ranged/out-mineral/out-repair + deposit-×5——mine spawner SpawnMissionAdd 活代码（features.ts 已注释休眠：任务板 remoteMining 独家驱动）。原型系 outMine 全链保持休眠（勘误 2026-10-15），词表条目按「休眠链整体处置」留 C 波或启用时核证；
- **防御/编队零源（8）**：defend-×4（I 节零孵化源）+ double-×3 + one-ranged + saio（零引用）——域 6 真孤儿候选（one-ranged 零孵化源核证：全仓无 SpawnMissionAdd/directSpawn/UNITS 引用，仅 boost 表一行）；
- **Power 任务侧（5）**：power-attack/power-heal/power-carry/power-ranged/pc-heal——usePower 派单侧活代码（任务驱动 power 任务→孵化）,pc-heal 由 assist.ts directSpawn 活孵化。**注意**：这些角色 executor 已删但本就无 handler（power-* 原走 mine 池定编，2.3 已迁 mineralWork；pc-heal 原走 registry——assist.ts 孵出后谁驱动？assistHeal.ts:44 只读 memory.unit 做配对，无 run 调用——**pc-heal 孵出即空转**（与 attack-claimer 同型缺口，待域 6 判定）；
- **簿记面**：boostFunction boost 表（one-ranged/double-attack/defend-attack 等 8 行）、qos.ts 冻结权重（cleaner -4 等）、UNIT_BODY_NAMES 中文名 54 行、UnitLevelData 体型表——随词表条目同删。

**域 6 词表裁撤建议档**：真孤儿（零孵化源+零活驱动）≈ double-×3/one-ranged/saio/defend-×4 八件 + attack-claimer/cleaner/dismantle/logistic 四件（warSpawn 旗语义已坏，删词表需同步删旗处理）+ pc-heal（孵化链活但驱动死——修驱动或删孵化）；外矿 13 件留休眠链整体处置（C 波 8.2/8.3）；power-* 四件任务侧活代码保留。合计真候选 ≈ 11-13 件。

## S. 域 8（4.5）proto 行为库收编落档（2026-10-25）

**本批（4.5a）处置面**（Creep 15 + Flag 2 + Room 1 = 18 条 P6 → 0；豁免 98→80）：

- **死文件删除（7 件）**：proto/Creep/function/{workFunction,controllerFunction,collectFunction,haulFunction,buildFunction,doubleAction}（休眠闭环/双人原语——消费方 defendSingle/defendDuo/double-attack/double-dismantle/one-ranged 同批删除）+ teams/units/{double-attack,double-dismantle,one-ranged} + defense/units/{defendSingle,defendDuo}（真孤儿：词表 4.3 已裁撤、无孵化源无驱动、导出零外部消费）；cacheFunction 保留（ensureMemoryCache 是 boost 链基建，4 处活 import）。
- **死方法删除**：baseFunction::TakeEnergy/switchTaskState/yieldSourcePosition（消费链闭环验证：closestSource/getBoundSource 唯一消费方是 TakeEnergy）；moveFuntion::moveToTargetRoom/moveToSourceRoom（零调用）；combatFunction::attackNearestHostile/rangedAttackNearestHostile/autoAttack/fleeFromHostiles/checkBoostReady（零外部调用，aio 内同名局部函数/TeamBattle.autoAttack 是独立实现）；boostFunction::isBoostReady（零调用）。
- **收编面（broker 提交，行为等价）**：boostFunction 3 处 moveTo → submitBoostMove（broker move 管线 + moveOpts 透传）；moveFuntion 6 处 move/moveTo → submitNavMove/submitNavStep；Flag nuke 旗 remove + Flag/utils getSpawnRoomOrRemove → broker removeFlag（flag 管线）；Room ensureControllerBufferSite createConstructionSite → broker createSite（construction 管线）。actionBroker case "move" 扩 moveOpts payload 透传（先例：combatMove）。
- **sourceFunction 纯库化**：删 getBoundSource/resolveSourceByPriority 类挂载（消费链已随 TakeEnergy 断），仅存 evaluateSourceWorkTiles 纯函数导出。
- **interface 同步**：creep.interface.d.ts 删 22 条死声明（go* 系/flee/double 系/TakeEnergy/switchTaskState/attackNearestHostile/autoAttack/fleeFromHostiles/checkBoostReady/isBoostReady/moveToTargetRoom/moveToSourceRoom/yieldSourcePosition）。

**4.5b 待办（PC 域 19 条 P6）**：PC baseFunction 4 + PC doubleAction 2 + PC execute 2 + usePower 1 + assist 5 + assistHeal 4 + operate 1。处置口径同本批：原型方法保留，体内原生调用改 powerAdapter 模式提交（power/move 管线），全部落 actionBroker 既有条目。**注意**：`renew` 不在 broker ActionKind——需扩 kind（净 +1 条目）或复用 move 管线；assist 的 directSpawn（spawnCreep）已有 spawn 管线先例。

**终局算术**：80 − PC 19 + renew 执行器 1 = 62；再收编 P3 planner 2（compute.ts/layoutPlanner.ts 的 site.remove → removeSite kind 既有）= 60 ✓ 达 ≤60 闸门。

**连锁发现（4.5b 一并处置候选）**：makeCombatHealHandler 工厂零消费方（4.3 暂留依据的复活路径已随 defendSingle/defendDuo 删除断链），其 COMBAT_HEAL_POLICIES 表含 defend2-attack 死键；combatHeal 纯函数（combatHeal/combatRangedHeal）仍是 TeamBattle/boundPartner/aio 活消费——工厂删、纯函数留。

## T. 域 8（4.5b）PC 域收编落档（2026-10-25）

- **PC 全链收编**：powerAdapter 由 2 函数扩至 13 函数（pcMoveTo/pcStep/pcTransfer/pcWithdraw/pcRenew/pcSuicide/pcHealerSuicide/pcHealerHeal/pcHealerRangedHeal/pcHealerMoveTo/pcHealerStep/pcFlagRemove + 既有 pcUsePower/pcEnableRoom）；move 管线扩 plainCost/swampCost 透传（PC 链 47 处依赖）；renew 新增 ActionKind+执行器（--allow-growth 决策：净 +1 条目，P6 −19 远大于 +1）；rangedHeal 复用 combatHealAction kind（healMode 判别，语义一致零新条目）。
- **assistHeal.ts 删除**：全仓零引用死文件（pc-heal 的 handler 从未接线——R 节已登记「孵出即空转」缺口，4.2 reportIdleUnit 诊断承接，实服待补）。其 P6 4 条随之清零。
- **planner P3 收编**：compute.ts 两处 + layoutPlanner.ts 一处 remove → submitIntent（removeFlag/removeSite kind 既有），P3 清零。
- **终态**：豁免 60 条 = P8 22 + P2 14 + 人操 13 + P7 4 + 编队 5 + P4 1 + P8 spawn 1。P6/P3 全清。**A 波闸门 ≤60 达成**。
- **makeCombatHealHandler 遗留**：工厂零消费方（defendSingle/defendDuo 删除断链），combatHeal 纯函数（TeamBattle/boundPartner/aio 活消费）保留——待 C 波 8.3 死导出收敛处置。
- **并行工作警示**：src/modules/comms/（b2b 协议三件）系另一会话 13:36 落盘的未完成工作（channel.ts 仍有 tsc 错误），不属本切片，未动。

## U. C 波复核实测总扫描（legacy-consolidation-b 任务 2.1，2026-10-29）

> 方法：全仓符号文本匹配（`grep -rn` over src/tests/sim/scripts/config/docs/openspec）+ 逐条归类真引用/注释文档/再导出穿透 + 场景不触发核对（A 节 sim 画像沿用：mine 链全场景零触发）。漂移裁定规则见 `legacy-consolidation-b/specs/dormant-code-retirement`。

**U.1 external/mine 链（清单第 1 项）——维持休眠判定，可删**：
- 闭包核证：`mine/*` 六文件仅被 `externalMine.ts`（汇出口）import；`externalMine.ts` 仅被 `outMine.ts`（原型类）与 `external/index.ts`（re-export 两行）import；`outMine.ts` 的 `OutMine` 类仅被 `proto/Room/index.ts:18` extend 挂载、`outMine()/EnergyMine()/CenterMine()` 原型方法全仓零调用（唯 `room.interface.d.ts:662` 注释 example）；`externalScheduler.ts` 仅被 `mine/analysis.ts`/`mine/spawner.ts` import。链外活消费 = **零**。
- `registerOutMineIncomeProvider` 存根：唯一消费方 `proto/features.ts:30`（空函数调用，语义为占位）——随链删除。
- `ExternalMineAnalysis`/`ExternalMineSourceStat` re-export（external/index.ts:6）：穿透后无最终消费方——纯再导出穿透死面。
- 场景不触发：A 节四场景 mine 链零执行（沿用）；outMine 原型方法零调用实证。
- **裁定：整链删除**（mine/ 六文件 + externalMine.ts + outMine.ts + externalScheduler.ts + proto/Room extend 行 + interface 声明 + index.ts re-export + features.ts 存根挂载）。

**U.2 `Memory.OutMineData`（清单第 2 项）——活簿记，保留**：
- 活读写面（真引用非注释）：`mineralWork.ts`（highway 轮询 L528 + powerMine/depositMine 簿记 L226-227，economy planning 生产路径）、`console/function/mine.ts`（power/deposit/cancel 人操命令族 + energy/centerRoom 列示）、`road/roadMemory.ts`/`roadVisual.ts`（RoadData）、`statistics.ts:316`（energy 列表 HUD）、`roomVisuals.ts:372`（energy 视觉）、`usePower.ts:72-73`（powerMine/depositMine 非空判定——改蛋感知）。
- **energy 子键写入方唯一**：`mine/state.ts:629-645`（autoAddNearbyEnergyTargets 自动扩图）——链删除后 energy 仅剩 console 人操 `mine.add` 写入（console mine.ts L152-201 域）与读取面。**死子键判定：无**——所有子键（energy/centerRoom/highway/powerMine/depositMine/RoadData/RoadVersion）均有链外活读写方。
- **裁定：OutMineData 与 `getOutMineData` accessor 全保留，不升 Memory 版本、不做迁移**；mine 链删除后 energy/centerRoom 的自动扩图写入面消亡（写入面收敛为人操 + 原有数据驻留），台账登记。

**U.3 PC `mode/assist|operate`（清单第 3 项）——活模式，转显式保留**：
- `PowerCreeps` TickModule 挂载于 main.ts:49（commit 阶段），每 tick `pc.exec()`；`execute.ts` 分发 `runAssist`（`-assist` 旗）/`runOperate`（默认）。**整链是 PC 驱动主径而非休眠面**。
- 函数级复核：`runOperate` 无条件分发（零触发路径不存在）；`runAssist` 的触发条件是 `${pcname}-assist` 旗——console help.ts:324 有登记的人操指引。旧清单「零触发路径部分」实际只有已删的 `assistHeal.ts`（S/T 节：随 4.5b 删除）。
- **裁定：mode/assist|operate 整体转显式保留 + 台账登记（PC 驱动链活模式；-assist 旗为人操入口）**，零删除。

**U.4 `visuals/highwayMine.ts`（清单第 4 项）——活消费，人操豁免保留**：
- 消费方：`console/function/mine.ts` 三处（L227/228/234/235——enable/visualizeOnMap/enableAll/run）。`visuals/index.ts:36` re-export 有最终消费方。
- **裁定：与 console mine 命令族一并登记人操豁免保留**（读 OutMineData.highway 活簿记，无自动调用点）。

**U.5 `core/qos.ts` 兼容读口（清单第 5 项）——部分死，删死留活**：
- 零消费导出（全仓扫描，qos.ts 外零真引用）：`noteTickCpu`、`isCpuBreakerTripped`、`updateQoS`（仅 qos API 对象内自引用）、`isTickAligned`（同）、`ROLE_CPU_FREEZE_PRIORITY`、`shouldSkipCreepInEmergency`——但注意前四者是 `qos: QoSAPI` 聚合对象成员，聚合对象本身 12 文件活消费（`qos.shouldRun` 等），`mountQoS` 挂 globalThis.qos（console 人机入口）。
- 活消费：`getQoS`（6 文件）、`shouldRun`（5 文件）、`qos` 聚合（12 文件）、`mountQoS`（console）。
- **裁定**：API 成员面不动（聚合对象契约 + globalThis 人机面）；独立零消费导出 `ROLE_CPU_FREEZE_PRIORITY`、`shouldSkipCreepInEmergency` 按 2.5 零引用程序复核后删。`getRoomQosLevel` 类读口已不存在（features.ts 注释实证），无处置。

**U.6 `accessor.ts` legacy getter（清单第 6 项）——逐个活，全保留**：
- `getOutMineData`：U.2 活簿记 accessor，保留。全量 getter 扫描（getBotMemory/getRoomData/getLayoutData/getMissionPools/getStructData/getResourceManage/getNukerData/getAutoData/getAutoMarketData/getAutoLabData/getAutoFactoryData/getAutoPowerData/getOutMineData/getTeamData…）：抽样核对 `getMissionPools`（spawn 池链活）、`getStructData`（usePower 活）——均有消费方；`getHeartbeatTick`/`getModeName`/`ensureTeamPendingSpawns` 等哨兵符号在 accessor 内不存在（无死 getter 可删）。
- **裁定：无死 getter，整项零处置**（唯一历史死 getter 已随 A 波各域删除）。

**U.7 `core/ai` 零引用导出（清单第 7 项）——stateMachine/adapters 整体零消费**：
- `behaviorTree`：活（teams/units/aio.ts 全套消费——BtStatus/BehaviorTree/condition/fail/leaf/selector/sequence）。`BtFactory`/`BtNode` 类型导出零外部引用但为 behaviorTree 契约面（库类型），保留。
- `stateMachine.ts`：全符号（StateId/EventId/GuardId/Transition/GuardMap/StateHandler/MachineConfig/StateStorage…）仓内零消费（唯 creep.interface.d.ts 提及 StateId 是类型声明引用——待 2.5 穿透定性）。
- `adapters.ts`：全符号（ensureFsmBucket/createFsmStorage/createLayeredRunner）零消费。
- **裁定：stateMachine.ts + adapters.ts 整文件零引用删除候选**（2.5 执行零引用程序），behaviorTree.ts 保留。

**U.8 死导出收敛（清单第 8 项）**：
- `makeCombatHealHandler` 工厂：T 节已登记零消费（COMBAT_HEAL_POLICIES 含死键），`combatHeal` 纯函数活（TeamBattle/boundPartner/aio）——删工厂+表，留纯函数。
- `statistics.ts` energyState 读口：活消费（HUD L335/428——5.1 台账已裁定保留 energyState），不动。
- console 对已删域读口：mine.ts 读 OutMineData 是活簿记面（U.2），不动。

**U.9 汇总裁定表**：

| 清单项 | 裁定 | 处置 |
|---|---|---|
| 1 external/mine 链 | 真休眠 | 2.2 整链删除（~2939 行） |
| 2 OutMineData | 活簿记 | 保留，不迁移；energy 自动扩图写入面随链消亡（登记） |
| 3 PC mode | 活模式 | 显式保留 + 台账（零删除） |
| 4 highwayMine.ts | 活消费 | 人操豁免保留 + 台账 |
| 5 qos 兼容读口 | 部分死 | ROLE_CPU_FREEZE_PRIORITY/shouldSkipCreepInEmergency 删（2.5）；API 聚合面不动 |
| 6 accessor getter | 全活 | 零处置 |
| 7 core/ai | stateMachine/adapters 零引用 | 2.5 删两文件；behaviorTree 留 |
| 8 死导出 | makeCombatHealHandler 死 | 2.5 删工厂+POLICIES 表；combatHeal 纯函数留 |

**U.10 2.2 删除连带发现（2026-10-29）**：`core/bucketGovernor.ts` 的阈值消费方（externalMine runEnergy/runCenter）随链消亡——governor 本体不在 C 波清单，按「清单外只留档」处置：注释已改写指向本节，模块去留待后续变更复核（候选：随下一波孤儿清理退役或转道供 economy 消费）。

**U.11 2.2/2.5 删除后残留扫描（2026-10-29，删除提交前置扫描）**：
- 全符号（ExternalMine*/getOutmineSourceKey/registerOutMineIncomeProvider/outMine 系方法/ROLE_CPU_FREEZE_PRIORITY/shouldSkipCreepInEmergency/stateMachine 族符号/combatHeal 工厂族）：src/tests/sim/scripts/config 命中为零（文档 survey/台账/openspec 的历史引用按口径豁免）。
- docs 死链：现行设计篇（nexus-design 01–08/README）无 external/mine 引用（唯 10 台账与 09 存档的历史记载，保留）；bugs 目录历史文档引用属时间线记录不改写。
- 活链回归：road 链（CostMatrixCache/PathPlanner/RoadBuilder/RoadMemory/RoadVisual/getBuiltRoadCoverage）消费方完好（proto/Room baseFunction、console mine.ts、teams）；typecheck 绿 + 双守护绿 + lint 仅 speedrun 隔离区既有 warning。

**U.12 C 波删除门归因（2026-10-29，删除确认门八门跑档）**：

首轮 6 场景门（03:18 起跑，02:07 构建 bundle=删除前）全红——红线**先于 C 波删除存在**。三重二分归因：

1. **门可信性**：4a3ee14（基线冻结点）worktree 干净重建，boot 精确复现基线 `L3@8889/p95 7ms`（283t/s 快机档）→ sim 引擎、场景、测量路径全部正常；
2. **漂移归属**：HEAD 6856eb6（无 C 波删除）worktree 重建，boot `L3@9639/p95 8ms` → 漂移在 HEAD 已存在，源于基线冻结（10-24）后的 53 提交——race 变体主链化（413d872，speedrun 引擎并入主调度链）+ 重锚定族 5 提交（重摆保活/lane 校验/箱列/块行/槽位探测）+ 其余修复，属合法时间线演进；
3. **C 波零扰动**：工作树（含删除）重建后 boot `L3@9639` 与 HEAD **逐位一致**、race-body-audit `L2@458` 一致 → 删除对行为零扰动（与链运行期不可达的预期吻合）。

p95 全场景 +3~6ms 首轮读数系**并行负载噪声**（跑门期间并行执行了 typecheck/grep/构建；同 bundle 静机复跑 p95 回 7-8ms）。

**处置**（用户裁定）：按 0.2 注记先例路径——HEAD 干净树重冻基线（6 场景静机读数存档 legacy-consolidation-b/baseline/），C 波删除对照新基线验证逐位一致后放行切片。world 世界重摆类的 race 探测提交还会带来 run 间方差（40a2397 记档 +29.4%），分段门场景按趋势观察项口径读。
