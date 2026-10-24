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
