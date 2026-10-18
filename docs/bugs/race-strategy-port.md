# 冲级效率移植 (RosmarinBot race → Nexus): 差距分析与分波计划

- 优先级: P1 (最终目标: speedrun 榜第一)
- 日期: 2026-10-16
- 来源: 用户指令——参考 RosmarinBot（用户指定的参考库）race 分支移植孵化/建造/升级/外矿/搬运策略, 保留 Nexus 架构
- 规格依据: 临时规格文件 (spec-spawn.md / spec-rush.md / spec-remote.md, 46KB 全量数字)

## 已核实的事实 (与规格逐项对照)

### Nexus 已对齐 Rosmarin 公式族的部分 (无需动)

| 项 | Rosmarin | Nexus 现状 | 结论 |
|---|---|---|---|
| 升级定编公式 | income×multiplier / energyLevel 档位 / rcl1 固定 / rcl8 门控 | workforce.ts upgradeWorkTargetOf 同构 (throttleLevel/surplusLevel/rcl1WorkFloor/rcl8ActiveLevel) | ✅ 已同构 |
| 体型生成器 | getMinerBody/getHaulerBody/getUpgraderBody | rushBodies.ts buildRushHarvesterBody/upgrader/worker + bodyFactory ROAD_SEGMENTS [C,C,M] | ✅ 已同构 |
| upgrader 供给链 | controller link > 掉落堆 > controller container | controllerBuffer + ccUpgradeReserveOf + coreDepot | ✅ 已同构 |
| extension 优先建造 | ECA<800 时 extension 提升为 tower 级 | layoutPlanner (需确认, 但 buildMinLevels road:3 同构) | ⚠️ 需确认 |
| worker 建造定编 | buildPower < getMaxWork | worker = 1 + sites/sitesPerWorker | ⚠️ 相似但简化 |
| 廩存量 energyLevel | energyStandard 表 {1:10000,...8:320000} | energyLevelOf (energyLogistics) | ✅ 同构 |

### 确认的差距 (要抄的清单)

| # | 差距点 | Rosmarin 规格 | Nexus 现状 | 影响 | 波次 |
|---|---|---|---D|---|---|
| 1 | **外矿无 reserver** | RESERVE_POWER_MAX 表 + reservationTickThreshold 2000 + [CLAIM,MOVE]×maxClaim | taskSchema 有 "reserve" kind 但无生产者/无映射/无执行分支 | 未预订源收入减半 (1500 vs 3000) | W1 |
| 已预订 ept | 普通未预订 ept=5 (10×0.5) | remoteMining 按满采上限折算 (harvestIncomeWithRemoteOf 按 10) | 收入高估一倍 | W1 |
| 2 | **远程搬运是"自查式"** | 独立 carrier 链: 源容器缓存 + carrier 直运/接力, maxCarryPower = 2×distance×(ept−loss) | runRemoteHarvest: 远程 harvester 自己搬回家 (harvester 5W 走长途=运力浪费) | 长途往返时间采集面塌陷 | W1 |
| 3 | **远程容器/道路不建** | RCL3 源容器 + 道路 + enoughRoad ≥1/3 + out-build 修路 | 无远程基建 | 掉落腐烂 + 慢速 | W2 |
| 4 | **skipBuildTypes 为空** | ['factory','nuker','terminal','lab','powerSpawn','observer','extractor'] + rampart/wall 禁建 | skipBuildTypes() 返回 [] | 冲级期能量被产业建筑抽干 | W1 |
| 5 | **无 porter/creepsToFill 直供** | porter RCL≥4 基地内搬运 + 无 depot 的 upgrader/builder 直供 | energyLogistics 填充链 (需确认覆盖) | 搬运盲区 | W3 评估 |
|  RCL2-4 controller container | roomManager rcl 2-4 手动放 controller container (无 link 期的升级容器) | controllerBuffer (cc) 机制已有 | ✅ 已有 | - |
| 6 | **外矿激活无背包** | spawnUsage 0-1 背包 (value/weight) 动态取舍 | remoteAutoMaxRooms: 2 固定上限 | 静态上限不如动态背包 | W3 |
| 7 | **rampart/wall 不建** | race fork 全禁 | PLANNER_CONFIG rampartMinRcl: 4 | 期中防御投入推迟 | W1 |
| 8 | **controller link 优先级** | 第 1 个 link = controller link (RCL4) | layoutPlanner link 入队顺序 (需确认) 似已对齐 | - | W2 确认 |
| 9 | **build 止升让位** | building && !upgradeNeeded → upgrader 不孵 (产能让建造) | roomWorkforce 三侧定编相加 | ⚠️ 玀衡点不同 | W3 评估 |
| 10 | 建造节流 | 工地≥5 && random<0.9 停; bucket<1000 倘 | buildSitesLowWater: 12 / maxSitesPerPass: 10 | 相似 | - |

## 分波实施计划

### Wave 1 — 外矿收入翻倍 + 冲级建造聚焦 (本轮)
1. **reserve 任务链补全** (差距#1): remoteMining 产 `kind:"reserve"` 任务 → spawnDirector `unitForTaskKind` 映射 reserver (需新增 SpawnUnit) → agentSystem `case "reserve"` 分支 (走到 controller → reserveController) → 体型 [CLAIM,MOVE]×maxClaim, 能量攒够才孵
2. **skipBuildTypes 落地** (差距#4/#7): race profile 接入 PLANNER_CONFIG 或 memory.ts skipBuildTypes 按 roomMode=rush 返回禁建表 + rampart/wall 禁建
3. **远程收入口径修正** (差距#1b): harvestIncomeWithRemoteOf 未预订源按 5 e/t 折算 (预订后按 10)
4. **远程搬运链** (差距#2): 引入"远程采集体不带 CARRY 落容器 + 独立 carrier 走跨房任务" (任务化, 对齐 A 线) — 实现较大, 若 W1 容量不够则推 W2

### Wave 2 — 远程基建 (容器/道路/修路)
- 源容器 + 道路修建任务 (out-build 任务化) + enoughRoad 判定 + 容器维修
- controller link 顺序确认

### Wave 3 — 背包激活 + porter 直供 + 止升让位评估
- spawnUsage 背包替代 remoteAutoMaxRooms
- porter/creepsToFill 覆盖评估
- building 开关与三侧定编的取舍评估

## 实施记录 (2026-10-17, 任务 4.7 收口)

### W1 波 (全部落地)

| 项 | 状态 | 实改 |
|---|---|---|
| 外矿 reserver | ✅ (前批次) | reserve 任务产线 + reserver 单位 + agentSystem case + 跨房放行 + 租约 500 |
| 独立 carrier 链 | ✅ 本批次 | REMOTE_HAUL_CONFIG (containerRange=2/haulTriggerRatio=0.3/repairRatio=0.5); runRemoteHarvest 满载优先卸源旁容器 (自回运兜底); planRemoteHarvest 容器存量超阈产跨房 haul; allocator 跨房放行 +4 类; agentSystem runRemoteHaul 跨房状态机 (fetch 容器/deliver 本矿 remoteDropoffFor) |
| skipBuildTypes | ✅ (前批次) | race 分支禁建 factory/nuker/terminal/lab/powerSpawn/observer/extractor/rampart/wall |
| 未预订 ept 减半 | ✅ (前批次) | activeRemoteSourceCount 己订记 1 未订记 0.5 |

### W2 波 (容器/维修落地, 道路/porter 待评估)

| 项 | 状态 | 实改 |
|---|---|---|
| 源容器 | ✅ 本批次 | 远程矿工驻点兼职: 无容器无在建→createSite (broker construction 管线, 无主之地门控), 满载浇工地 (rhb2), 驻点 build (射程 3) |
| 容器维修 | ✅ 本批次 | 耐久 < hitsMax×0.5 即修 (rhr 分支)——sim 实证容器 decay 周期性消失, 不修则 haul 取料点反复重放 |
| 道路 | ⏸ 待评估 | sim 邻房全 flat 地形零收益; 实服沼泽才有价值, 与 P1-14 沼泽低均衡同域 |
| porter 直供 | ⏸ 待评估 | W3 项, 与 spawnUsage 背包替代同批 |

### 排障实录 (修复的断点)

1. 门控反写: 无主之地判定 `liveRoom.controller &&` 把无 controller 房全挡 (sim 邻房无 controller) → 改 `(remoteCtrl === undefined || !remoteCtrl.owner)`
2. build 射程 1: 容器位与矿工工位分居源两侧 (切比雪夫 2), 站点永远无人建→衰亡重放 → 放宽到原生 build 射程 3
3. 满载分支不可达: 「满载且不在本矿→回城」分支在容器卸货/rhb2 之前, 满载即走人 → 已重排 (容器卸货→浇工地→回城)
4. ConstructionSite.my 条件反写 (自家工地被过滤) → 删除
5. 探针勘误: Memory.tasks 实为 Memory.Nexus.tasks; 大量 haul:cancelled 是本房配额 haul 的 deadline 200t 既有机制, 非远程链 churn

### 回归与净效果

- boot L1@0 L2@728 L3@15764 / race L2@796 / remote-mine L3@0 逐位一致 (行为零回归)
- remote-mine 探针: W4N8 容器建成收能 E1850, haul 任务 in_progress + carrier 跨房回运 (C-141F@W4N8 E100) 实证链路通
- speedrun: RCL3@21349 (fail 仅 level-target, 既有状态); 外矿开发 RCL3 后启动 (rcl<3 门), t24000 侦察/采集/容器链已铺开, 31k 截断时尚在建设期
- tsc / oxlint / arch-guard (330 处 / 43 文件) 全绿

## 验证标准
- speedrun sim L3 达成时间显著缩短 (当前基线 L3@28111, 目标 ≤5000)
- boot/remote-mine 回归不红
- tsc/lint/build 全绿

## 实施记录

### Wave 1 (2026-10-16, 已落地, 待回归)

| 项 | 改动 | 文件 |
|---|---|---|
| reserve 任务生产 | manual/auto 两档均产 `reserve:<room>:<target>` 任务; 他人预订不抢, 己方预订衰减到 RESERVE_CONFIG.refreshTicks (2000) 以下重发 | economy/remoteMining.ts |
| reserver 单位 | EconomyRole 增 `reserver` (RSV), bodyFactory [CLAIM,MOVE]×1..3 段 | spawning/bodyFactory.ts, constant/CreepConstant.ts |
| 执行分支 | agentSystem `case "reserve"`: 跨房移动→驻场终身 reserveController 续订; 他人预订即弃 | agents/agentSystem.ts |
| 跨房放行 | allocator canExecute/travelCost 两处 kind 白名单加 reserve | tasks/allocator.ts |
| 亲和表 | UNIT_TASK_AFFINITY 加 RSV→reserve | tasks/allocator.ts |
| 定编/映射 | unitForTaskKind reserve→reserver; unitTargets 按活跃 reserve 任务数定编; 任务驱动代号集加 RSV | spawning/spawnDirector.ts, agents/agentSystem.ts |
| 租约 | LEASE_POLICY reserve: 500 (跨房驻场) | core/store/taskSchema.ts |
| 收入口径 | activeRemoteSourceCount: 己订源记 1, 未订源记 0.5 | economy/remoteMining.ts |
| 禁建表 | race/main.ts configureServerCaps skipBuildTypes 9 类 (factory/nuker/terminal/lab/powerSpawn/observer/extractor/rampart/wall) | branch/race/main.ts, config/capabilities.ts, planner/memory.ts |
| 远程矿工带 carry | 存在活跃远程采集任务时 harvester hint noCarrierOnSite=true (5W 后补 CARRY, 满载跨房自回运) | spawning/spawnDirector.ts |

### Wave 1 实测 (sim speedrun, 31000t, seed 7)

| 指标 | W1 前 | W1 后 | 变化 |
|---|---|---|---|
| L2 | 1057 | 994 | -63 |
| L3 | 28111 | 24671 | **-3440** |
| cpu p95 | 9ms | 17ms* | *与 3 个重构子代理并发跑构建, 不可信, 待独测 |

### 遗留观察 (下一步瓶颈定位)
- L2@994 vs 目标 500: 升级启动慢 (RCL1→2 仅 200 进度), 疑 boot 期升级任务发射/取能链晚热
- L3@24671 vs 目标 3000: 45000 进度的均速仍 ~1.9 e/t, 距双源天花板 20 e/t 差 10 倍; 下一杠杆是 W2 远程容器+道路 (自回运 harvester 往返耗时) 与 L2 期 extension 铺设速度
- speedrun 意图分布统计在引擎日志尾部, 本轮日志被 Tee 截断, 下轮独测补取

## Rosmarin 等级优先级全面移植 (2026-10-18, Wave 5)

### 改动 (等级体系: 小者优先, 档距 1, race 同源)

| 层 | 改动 | 说明 |
|---|---|---|
| 任务等级表 | taskSchema TASK_PRIORITY 全面换档: fill_spawn 1 / defend 2 / upgrade 4 / haul 4 / harvest 5 / reserve 5 / build 8 / repair 8 / scout 9 / claim 10; DOWNGRADE emergency 2 | 旧 0-100 跑步机数值废弃 (85→88→89→90→91→95→96 叠加补丁); 排序语义 = 孵化序 C88>U85>H70 旧实拍序的等价翻转 |
| 角色常驻档 | standingPriorityByRole { carrier 3, upgrader 4, harvester 9, scout 11 }; standing 9 兜底; worker/universal 退出 standingRoles | carrier 先于采集面是本矿 drop 采矿架构的供能约束 (spawn 唯一能量入口); worker 由 build 任务驱动 (开局插队会打断供能泵, sim 实证孵化节律 94t→268t) |
| 孵化序翻转 | spawnDirector 合并取 min/排序 a-b/urgent 门 <=/arbiter 同步 | 涓流钳: 存量 < 容量一半时 carrier desired 钳到微型件档 (max(存量,250)), 高频先建 ext 填充 |
| 替补跟随角色档 | replacement 请求等级 = 角色常驻档 (原恒 11 殿后) | 同龄批集中到期时死亡速率 > 孵化速率 → 人口崩塌 (t12k 22→7 实锤) |
| 让位闸口径 | staffingFloor = harvesterTargetTotal (饱和定编), 原 sources.length | 双源房 @2 只即退出让位 → 采集面锁死 2W 小体 (5/t vs 17/t) |
| 建造等级 | BUILD_PRIORITY_BONUS ext -3 / road +1 / cc -4; 近完收尾 -2 | cc 是升级直供链地基恒最前; 抢先修路/ext 会把 worker 从 cc 引走 (5k 零进度实锤) |
| haul 取消风暴 | inflightHaulSourceKeys 货源口径判活 | dedupeKey 含目的地 id, 目的地轮换 → 在途任务被 subject-gone 误杀 → carrier 半程反复易主 (21 cancelled 实锤) |
| 亲和扩展 | harvester +build (race 换班制); workerBuildCriticalOf 带 worker 出生史门 | 开局无 worker 史时不提级 (worker 插队打断供能泵) |
| 配额/偏置翻转 | SUPPLY_LINE_PRIORITY/quota pickDestination/allocator criticality/postureBias/suppressPenalty 全部换等级语义 | postureBias survive { fill_spawn -1, harvest -1, build +2, upgrade +2 }; suppressPenalty 3; criticality = (11-level)/11 |

### 实测 (speedrun 20k, seed 7)

| 指标 | 基线 | Wave5 后 | 变化 |
|---|---|---|---|
| L2 | 806 | 1117 | +311 (慢) |
| **L3** | **19049** | **14089** | **-4960 (-26%)** |
| 20k 升级总量 | 46.7k | 74.6k | **+60%** |
| L3 后段速率 | ~1.6/t | ~8.8/t | 5.5× |
| 采集 | 340k | 359k | 持平 |
| cpu p95 | 6ms | 6ms | 持平 |

### 矩阵 (six-scenario)

- remote-mine **转绿** (存活 10/10, RCL3 稳, 升级 0→6.7k)
- boot L3 8885→7832 (-1053), arena L3 8991→7951 (-1040)
- **剩 2 红**: boot/race-body-audit 的 L2 时间线 659→1066 / 806→1117 (开局多孵 carrier 致升级启动晚 ~400t)
- **justified**: L2 慢 400t 换 L3 快 1k+ 净收益为正; 若需 bit-identical, 可将 carrier 常驻档改回 harvester 之后仅 rush 档前置 (未做, 待用户裁决)

### 遗留
- speedrun L2 后中段 (t2-13k) 速率仍 ~2.8/t 平台: 同龄批死亡潮 (t13k 人口 22→13) 未根治, 替补错峰 (jitterRatio 0.1) 不足
- main 档涓流场景 (cpu 20) 孵化节律 180t/只 vs 旧体系 94t: 涓流钳已救活编制 (6→10 只), 深层差距在 ext 填充动力学 (fill_spawn 认领延迟), 未动
- remote-mine 场景升级量 6.7k vs 旧体系 18.4k: 仍是上述 ext 填充链
