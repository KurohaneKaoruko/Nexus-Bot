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
