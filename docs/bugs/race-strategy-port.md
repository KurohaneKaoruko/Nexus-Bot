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

## 三轴基线探针 (2026-10-18, race-speedrun-10-20-40 批次 A, 基线 02c55e6)

口径: speedrun 场景 45k tick (seed 7), 引擎 `--csv` 逐 tick 指标 (tick,creeps,rcl,progress), 升级量用 progress 单调累计法 (跨级回退修正)。复现: `../Screeps-Simulation/target/release/screeps-sim --scenario /tmp/opencode/speedrun-probe.json --bundle dist/main.js --csv <out> --quiet` (场景 JSON 与 sim/speedrun.sim.ts wire 同构)。

### 轴1 升级均速曲线 (每 1k tick, e/t)

| 窗口 | 速率 | | 窗口 | 速率 | | 窗口 | 速率 |
|---|---|---|---|---|---|---|---|
| t1-2k | 2.5 | | t11-12k | 2.7 | | t21-22k | 7.3 |
| t2-3k | 2.5 | | t12-13k | **9.5** | | t22-23k | 1.0 |
| t3-4k | 2.8 | | t13-14k | 5.2 | | t23-24k | 0.1 |
| t4-5k | 2.8 | | t14-15k | 3.8 | | t24-25k | 1.2 |
| t5-6k | 2.9 | | t15-16k | 1.7 | | t25-26k | 0.3 |
| t6-7k | 2.7 | | t16-17k | 9.4 | | t26-27k | 3.2 |
| t7-8k | 2.7 | | t17-18k | 5.2 | | t27-28k | 2.4 |
| t8-9k | 2.7 | | t18-19k | 7.3 | | t28-29k | 0.5 |
| t9-10k | 2.9 | | t19-20k | 2.7 | | t29-30k | 0.2 |
| t10-11k | 2.5 | | t20-21k | 6.6 | | t30-45k | 0.0-2.8 (反复停滞) |

**RCL 时间线: L2@1117 / L3@14089 / L4=None (45k 内未达)。** 累计升级 121k, 采集 643k, 孵化消耗 110k。

### 轴2 人口曲线 (每 1k 存活)

```
t1k:10 t2k:22 t3k:22 t4k:22 t5k:22 t6k:22 t7k:21 t8k:21 t9k:22 t10k:21 t11k:22
t12k:21 t13k:20 t14k:13 t15k:11 t16k:16 t17k:18 t18k:16 t19k:14 t20k:12 t21k:19
t22k:11 t23k:7 t24k:7 t25k:8 t26k:8 t27k:12 t28k:9 t29k:7 t30k:7 t31k:6 t32k:7
t33k:8 t34k:6 t35k:8 t36k:9 t37k:9 t38k:12 t39k:15 t40k:22 t41k:23 t42k:14 t43k:12 t44k:10 t45k:10
```

峰值 25 (t2-13k 平台 22), 塌陷三次: t13-15k (22→13→11), t21-23k (19→11→7), t38-42k (15→22→23→10)。V 型谷: t14k 22→11 (-50%), t23k 19→7 (-63%)。**同龄批死亡潮实锤与 tasks 2.1 预期一致。**

### 轴3 孵化节律 (相邻出生间隔, CSV creeps 递增点近似)

- 全程: 均值 108t/只 (n=418), P50 87t, 最大 319t
- 冲级期 (t1.2k-14k): **均值 73t/只** (n=175) —— 注意: 冲级期节律本身不差 (73t ≤ 120t 目标)
- L3 后 (t14k+): 均值 137t/只 (n=227) —— 节律劣化近一倍, 与人口塌陷段重合

### 瓶颈轴判读 (L4=None 的主因定位)

1. **主瓶颈 = 升级定编不足 (非孵化节律)**: t2-11k 人口 22 孵化正常但速率锁死 2.7/t —— 升级定编远低于采集面 (采集 643k vs 升级 121k, 升级只吃掉 19% 采集能量)。对照 race bot: 无仓期 maxWork = income × multiplier (×1.0-1.2), 而 Nexus 当前 upgrader 定编静态偏低。**这是 B3 批次 (定编四口径) 的主战场, 优先级高于预期。**
2. **次瓶颈 = 同龄批死亡潮**: t13-15k / t21-23k / t38-42k 三次塌陷直接造成升级停滞段 (t23-26k, t28-32k)。B1 批次 (错峰离散) 消除后 L3 后速率平台应从 137t 节律恢复。
3. **孵化节律 (B2) 在冲级期不是瓶颈** (73t 已达标), 但 L3 后 137t 与死亡潮耦合 —— B1/B2 需联合验证。
4. 采集面 643k/45k = 14.3/t, 已达单房天花板 20/t 的 71%, 外矿已激活 (remoteMining auto) 但收入未上探 —— B4 批次 (外矿评分) 有空间。

## Rosmarin race bot 口径核对清单 (2026-10-18, race-speedrun-10-20-40 批次 A)

参考本体: `../Rosmarin-Bot-dev/src/branch/race/bot/` (105 文件完整 race bot, 1wt/2wt/4wt 成绩本体)。逐项核对 (行号为当日源码):

| # | 口径 | race bot 源码 | 值/语义 | Nexus 现状 | 结论 |
|---|---|---|---|---|---|
| 1 | energyStandard 表 | core/config.ts L83-92 | {1:10000, 2:10000, 3:10000, 4:20000, 5:40000, 6:80000, 7:160000, 8:320000} | energyLevelOf 档位同构 | ✅ 一致 (L4.4 复核) |
| 2 | energyLevel 公式 | utils/roomUtils.ts getEnergyLevel L1135+ | `<standard`: `100×total/standard`; `≥standard`: `100+(total−standard)/1500` | 同构 | ✅ |
| 3 | upgradeNeeded 触发线 | room/manageUpgrade.ts shouldUpgradeFirst L259-263 | `ticksToDowngrade < CONTROLLER_DOWNGRADE[level]/2 − 5000 + 1500` (buffer 缺省 1500; 恢复线 `>= CONTROLLER_DOWNGRADE[level]` L80) | 无此机制 | **待移植 (任务4.2)** |
| 4 | building 标志语义 | room/manageBuild.ts L28-46 | `building=true`: 有工地且非 upgradeNeeded; 工地清零或 upgradeNeeded → false 并把 builder 转 idler | 无此联动 | **待移植 (任务4.2)** |
| 5 | 止升让位 | manageUpgrade.ts L85-88 | `building && !upgradeNeeded` → controllerNumCarry=0 且不孵 upgrader (定编归零) | 无 | **待移植 (任务4.2)** |
| 6 | numWork 剔将死体 | manageUpgrade.ts L69-75 | `ticksToLive > body.length×CREEP_SPAWN_TIME` 才计入 numWork | 定编统计全量计入 | **待移植 (任务2.2)** |
| 7 | 半缺口不孵闸 | manageUpgrade.ts L133 | `!upgradeNeeded && 2×(maxWork−numWork) < bodyNumWork` → 不孵 (防小体 churn) | 无 | **待移植 (任务4.3)** |
| 8 | link 吞吐封顶 | utils/roomUtils.ts getUpgradeCapacity L430-453 | controller link 期 `floor(800/(range+1))` (range=两 link 切比雪夫距离); 无 link 期 90 | 几何吞吐公式族 | **待对齐 (T4.1)** |
| 9 | spawnBalance EMA | room/spawnManager.ts L17,85-87 + roomUtils L974-985 | α=1−2^(−1/50) (50t 半衰期); add: 搬运有请求未满足; sub: 搬运空转 (L232,268) / 建造断粮 (manageBuild L183,198) / 升级断供 (manageUpgrade L326); storage 建成即删 (spawnManager L45-47); 无仓期 multiplier=`clamp(balance/2+0.8,1,1.2)` | 无此反馈 | **待移植 (任务3.3)** |
| 10 | carryRatio | manageUpgrade.ts L120-129 | 实际调用 **carryRatio=1** (覆盖 spawnUtils 缺省 4); 仅 RCL≥6 且 tightCpu 时 5 | 需逐档复核 | **注意: 与 spawnUtils 签名缺省不同, 以调用点为准** |
| 11 | CONTROLLER_DOWNGRADE 表 | 引擎常量 (sim src/js/screeps.js L246) | {1:20000, 2:10000, 3:20000, 4:40000, 5:80000, 6:120000, 7:150000, 8:200000}; SAFEMODE_THRESHOLD=5000 | 引擎常量直读 | ✅ 无需表 |
| 12 | getMaxWork 三分支 | utils/roomUtils.ts L54-105 | terminal: `clamp(energyLevel−90,lower,upper)` / storage: <90 `income×eL/100`, >120 `income+eL−90`, 中档 `income` / 无仓: `income×multiplier` (spawnBalance) | workforce 同构但无仓分支缺 multiplier | **待补 (任务3.3)** |

## 批次 B2 实验记录 (2026-10-18, race-speedrun-10-20-40)

### fill_spawn 认领即锁定 (任务3.1): 两轮全负, 撤销留档

| 变体 | 实现 | speedrun L3 | 结论 |
|---|---|---|---|
| 全额预留 | 发布 Tick reserve(全额缺口) | 25393 (对照 12977) | **负**——fill_spawn 任务孵化期常驻 (缺口在孵化中持续存在), 全额承诺是 phantom: 配额表 headroom 恒 0, 建造 23k→6.3k 崩, available 被吃光 |
| 认领运力预留 | reserve(指派者 carry 容量) | 17714 | **负**——与交付循环双计, carrier 满载交付后预留仍在账上, 等价小额 phantom |
| (撤销) 无预留 | 现状 | 12977 | 基线——配额表本来就把 fill_spawn 任务的交付视为在途 (allocator 亲和), 账本化是重复记账 |

**教训**: 「认领即锁定」的前提是任务有确定取货点与一次性金额 (haul 满足); fill_spawn 是持续缺口型任务 (孵化中每 tick 都有缺口), 不适用账本预留语义。

### 孵化槽空闲前瞻 (任务3.2): 落地, 中性

实现: perception 的 EnergyStructureSummary 加 spawnRemainingTicks; planner 对 remainingTime ≤ 50t 的 spawn fill_spawn 提级 (-2)。
speedrun 实测中性 (L3/升级量与 B1 一致)——探针显示 45k 内能量池 (spawn+ext) 满仓仅 30t/12 段, **池子从来不满, 蓄能延迟不是瓶颈**, 提级无活可提。保留: 语义正确 (race bot 口径), 池满场景 (外矿起量后) 会生效。

### spawnBalance EMA (任务3.3): Wave 3 已移植, 逐项核对等价

workforce.ts rush 分支 (L353-377) 与 race bot 逐项对照:
- 信号: upgradersStarved −1 / logisticsIdle +1 ↔ race bot 断粮 − / 搬运有请求 + (同源)
- α = 1−2^(−1/50) ↔ SPAWN_BALANCE_RATIO 半衰期 50t (一致)
- multiplier = clamp(ema/2+0.8, 1, 1.2) ↔ race bot clamp(balance/2+0.8, 1, 1.2) (一致)
- 作用域: Nexus rush 档无仓分支 ↔ race bot 无仓期+storage 建成即删 (等价: rush 冲级期即无仓期)

### 能量去向大发现 (任务3.4 探针副产物): 54% 落地腐烂

45k 能量守恒: 采集 635k = 建造 23k + 升级 161k + 孵化 108k + **缺口 343k (54%)**——
drop 采集架构 (矿工满载落地成堆) 的堆清理跟不上产出, 能量在地面腐烂。
**这是 L3 后速率平台 (2.7-3 e/t) 的真正主瓶颈**, 比 fill_spawn 动力学大一个数量级。
race bot 对策: porter 直供链 (manageLogistics requests/idlers 匹配, 无仓期 builder/upgrader 进 creepsToFill 由 porter 直供) + 搬运定编公式 maxCarryPower = 2×distance×(ept−loss)。
**评估结论: porter 直供链升级为冲刺批次 C 的头号候选** (B3 定编对齐后实施)。

### remote-mine 回退修复记录 (B1 引入, 本批修复)

B1 将死体剔除全局生效 → remote-mine (main 档涓流, cpu 20) 10→9→8 三轮回退:
涓流期替补孵化间隔长, 提前剔死让编制长期虚低。修复: 剔除仅 rush 档生效 (anyRoomRush 门)。
修复后: remote-mine 11 存活绿, speedrun 增益保持 (L3@12977)。

## 批次 B3 实验记录 (2026-10-18, race-speedrun-10-20-40)

### 四口径落地与 speedrun 实测

| 口径 | 实现 | speedrun 实测 |
|---|---|---|
| 4.1 link 封顶 | perception 加 upgradeLinkRange (控制器 link 2 格内 ↔ 最近其他 link 切比雪夫); workforce 封顶 floor(800/(range+1)), 无链路走原 cc/无缓冲口径 | 中性——sim 内 L3 前无 link (RCL5+ 结构), 20k RCL5 门生效待验 |
| 4.2 止升让位 | rampart/wall 工地存在且非保级窗口 → upgrader 定编 0 | 中性——speedrun RCL4 前 rampartMinRcl:4 未放量; 语义对齐 race bot (building=完建后防御建造期, 冲级建设期不让位) |
| 4.3 半缺口不孵 | 2×(targetWork−staffedWork) < perBody 时不孵 upgrader | 中性——尾差 churn 防护, 量级小 |
| 4.4 energyStandard | 逐档核对一致 (workforce energyLevelOf ↔ race bot config), 无需改 | — |

回归: remote-mine/run-residue/boot 3/3 绿 (boot L2@1066 零漂移)。
结论: B3 三机制在 10k RCL4 主战场均不触发 (link/防御建造/尾差都是 RCL4 后的事),
四口径是为 20k RCL5 / 40k RCL6 两档铺路的结构对齐。

## 批次 B4 实验记录 (2026-10-18, race-speedrun-10-20-40)

### 5.1 开局序列分档: 实测负, 维持现行序列

现行序列 (bootstrap universal → carrier/harvester 交替, carrier 闸 `carrier < max(1, harvester)`)
实测改造 (rush 档首采集体前 carrier 恒不放行, 对齐 race bot worker 序列): **L3 12977→13824 回退, L2 1117→1201 回退**。
根因: 第二孵化位给纯采集而不给搬运, **ext 填充延迟** (carrier 是 spawn/ext 的能量通道) 比升级早启更贵——
race bot 的 worker 序列成立是因为其 worker 采集+升级+建造一体 (采集即升级进度), Nexus 角色分工下
carrier 前置是容量复利 (300→550→800) 的一部分。撤销改造, 序列分档不实施 (现行已是最优)。

### 5.2 外矿价值密度排序 + 预算扩展: 落地

- 候选按 `源数/(1+线性房距)` 密度排序 (侦查期按双源缺省), 预算内贪心取前 K; 平坦对称图上密度全并列, 排序为确定性兜底 (房名字典序)。
- rush remoteAutoMaxRooms 2→3: 采集 645k→647k, 升级 165k→170k (+3%), 存活 9→12。
  10kt RCL4 门需要外矿收入覆盖孵化+建造后的升级缺口, 第 3 房是当前可见的最大收入增量。
- 回归: remote-mine/run-residue/boot 3/3 绿 (boot L2@1066 零漂移)。

### B4 汇总

| 项 | 结果 | 数据 |
|---|---|---|
| 5.1 序列分档 | 负, 撤销 | L3 13824 vs 12977; ext 填充通道 > 升级早启 |
| 5.2 密度排序+预算3房 | 正, 落地 | 升级 +3%, 人口 9→12, 三场景绿 |

## 批次 C 冲刺第一轮 (2026-10-18, race-speedrun 任务6.1)

### 瓶颈定位: 交付记账缺陷链 (delivered EMA ≈ 0)

三层数据实锤 (dump-memory + record-intents 取证):
1. **记账户头错位**: 旧口径 `recordDelivery(creep.carryEnergy)` 在 intent 延迟应用架构下
   记的是「意图时刻携带量」且大量 transfer 从未入账——delivered EMA 实测 0.000017
   (produced 15.3) → 诊断器恒判 "transport" → carrierMultiplier 恒顶格 3。
2. **意图分相执行**: sim 引擎 intent 在引擎相统一应用, JS 相内 creep.store 不变,
   差分法 (before-after) 恒 0——修复须按引擎应用口径折算 `min(携带, 目标空余)` (OK 时)。
3. **remoteUnits 漏账**: recordActionRates 只扫 world.rooms (己方房), 远程采集件
   在 remoteUnits——远程 produced 整体丢失。

修复: ActionResult 加 movedEnergy (broker 执行侧引擎应用口径折算), model 侧
unitIndex 索引含 remoteUnits。修复后 delivered EMA 40.3 > produced 26.8 →
诊断回 "none", 乘数回落 2。

### 远程运力入编两轮全负 (C1 任务口径 / C3 公式口径)

- C1 (活跃远程 haul 任务各折 1 只 + maxCarriers 8→14 + carriersPerRcl 4→6):
  采集 +30k 但升级 170k→151k, 建造 25.6k→11.2k, 存活 12→6, upgrader 末态 0。
- C3 (race bot maxCarryPower 逐源公式: 2×房距×速率): 同样种群塌方。
- C5/C6 二分 (仅记账修复/pileBoost 连续化): 与 B4 基线逐位一致——
  上限 8 钳住了乘数差, 塌方元凶确证为远程入编本身。
- 根因: 远程 6 源折 ~132 CARRY 部件需求 → carrier 编制恒 14 → 单 spawn 串行
  吞吐 (部件数×3t/只) 被 carrier 置换流占满 → harvester/upgrader 孵化饿死。
  **结论: 远程运力不做公式入编, 由 pileBoost 阶梯 + 诊断乘数自适应承接** (留档勿重试)。

### 环境事故: sim 引擎 off-by-one (C5-C7 数据作废)

22:18-22:29 引擎工作区改动 (controller_levels_override 支持) 重编二进制时,
next_req 索引曾为 `level_costs[ctrl_level]` (L1→2 取 45,000, 应取 200)——
RCL1→2 需 45k 进度, C7 实测 L2@25936 (vs 真基线 1117)。源码工作区已是修正版
(`ctrl_level - 1`), 重编后 C5-C7 的 A/B 对照需在新引擎下重跑。
**教训: 引擎与 bundle 任何一侧变动, 历史基线必须重锚。**

### 待重验 (新引擎)

- 记账修复 (movedEnergy) 对 speedrun 三轴的净效应——诊断回 "none" 后乘数 2,
  RCL1 期 carrier 编制减半的副作用需数据确认。

### 私服榜口径实锤 (2026-10-18, /api/speedrun/leaderboard 取证)

- 私服 speedrun 用 **3x 升级表**: L2=45k / L3=135k / L4=405k / L5=1215k / L6=3645k
  (榜首 20k record: L5 + 421922/1215000, score 1007122 = 200+45k+135k+405k+421922 ✓)。
- **三档真实需求**: RCL4@10k 需均速 18.0/t; RCL5@20k 需 29.3/t; RCL6@40k 需 45.0/t。
- 榜首实测 50.4/t (20k) / 56.4/t (40k); Rosmarin 本体 42.7/t / 47.1/t。
- 当前 Nexus 3.8/t——缺口 4.7 倍起。**这不是调参级差距, 是体系级**:
  榜速需要外矿满负荷经济 (3+ 预订外矿房, 腐烂 <10%, 运力面 ~40-70/t)。

### C 轮瓶颈定性 (n1 探针三轴)

- 升级体在岗 4.3 只均摊 (77 只/25k, 中位在岗 1418t 健康) 但 upgrade 意图均量
  **1.88e** (10W 体满意图应 10e)——upgrader 恒饿, 50t 级进度冻结周期出现 (t14100 实证)。
- cc 周转健康 (转入 288.6k ≈ 转出 290.3k, 11.3/t 管道)——升级火力被 cc 出货率锁死。
- 腐烂 339k (52%) 是源旁堆未被 pickup (pickup 仅 0.045 次/t, 需求 0.5+):
  4 只 carrier 被 fill_spawn (池常空) 与远程 haul 双向拉扯。
- foldRates 只扫 world.rooms, 远程房速率永不折叠 (W4N8 accumulated 4232, EMA 0)——记侧小缺陷。
- upgrader carryEnergyPerWork 6→12 中性 (池常空下 800 预算档从未触达, 恒按存量孵小体)。

## 批次 D: 建筑/维修基础设施修复 (2026-10-19, race-speedrun 任务6.1)

### 根因链: 52% 腐烂 + 容器 decay 死亡链 (完整尸检 n2/c1/c2)

1. **broker 仲裁节流 (第一根因)**: commit 仲裁按 `actorName:pipeline` 每 tick 只留
   1 条 → 工地滴灌 (45k 仅 6 站、源容器 0) → 0-carry 矿工落地能量全腐烂。
2. **容器 decay 是结构炸弹**: 250k 血 ÷ 5000血/500t = 25k tick 寿命。cc 容器死后
   重建 5000e 花 8.9k tick, 升级链断供 (n1/c1/c2 共同死因, 仅时序不同)。
3. **repair 任务生成触发线缺失**: decay 结构 (容器/路) 满血时 absolute 检查恒
   false → 源容器/cc 容器从不进 repair 任务 → 从不进 repairPending → 从不产生
   worker 需求 → 从不孵 worker。
4. **worker 七道闸逐层解锁** (每层单独无效, 须全开):
   - allocator.ts KIND_UTILITY repair 0.5→0.65
   - defense/planners.ts `DECAY_STRUCTURE_TYPES` + `decayRateOf` + 绝对余量触发线
   - defense.ts `decayLeadTicks: 500`
   - demandSources.ts `workerBuildCriticalOf(ctx, board?)` (repairPending 扫描 +
     持久 workerEverBorn + 豁免旁路)
   - spawnDirector.ts 孵化成交写 `memory.economy.workerEverBorn`
   - economy.ts standingRoles 加 worker (priority 6) + unsecuredAllowedRoles 加 worker
   - spawnArbiter.ts criticalWorker 让位豁免 + criticalWorkerWaiting 等待窗
     (available<200 时本 tick 不孵低优先小体)
   - cpuBudget.ts SkipReason 加 `"critical-worker-wait"`
   - memorySchema.ts EconomyMemory 加 `workerEverBorn?`

### 修复栈清单 (本轮全部已落地, tsc/lint/test 10/10 绿)

- `src/modules/agents/actionBroker.ts`: BATCH_PIPELINES 仲裁豁免 (批量管道含 build/repair)
- `src/modules/tasks/allocator.ts`: repair utility 0.65
- `src/modules/defense/planners.ts` + `src/config/defense.ts`:
  decay 结构类型表 + decayRateOf + decayLeadTicks 绝对触发线
- `src/modules/spawning/demandSources.ts`: workerBuildCriticalOf 新语义
- `src/modules/spawning/spawnDirector.ts`: workerEverBorn 落盘 + board 传参
- `src/config/economy.ts`: standingRoles 加 worker (priority 6) + unsecuredAllowedRoles 加 worker
- `src/modules/spawning/spawnArbiter.ts`: criticalWorker 豁免 + criticalWorkerWaiting 等待窗
- `tests/broker-arbitration.test.ts` (红→绿实证仲裁压制)
  + `tests/worker-critical.test.ts` (4 用例) + `tests/stubs/screeps-constants.ts` (引擎常量桩)

### 实证闭环 (c15 短程 9500t)

- broker 修复后 t1118 一 tick 5 ext + 2 源容器 (批量落站生效)
- worker 终于孵出: repair 任务 t8468 生成 → critical → 孵化成交 (t9500 units 已见 worker)

### 负结果台账

- c1 (仅 broker 修复): 65086 (t45k progress, vs n1 124867)——单层修复不解决系统性问题
- c2-c7 (各层修复单独): 全部 48549 逐位一致——**修复必须成套, 单层全无效**
- 旧负结果 (S1 scout churn、远程入编、fill_spawn 账本预留等) 继续有效

### 45k 全量验证 (c16, 修复栈齐装但 workerEverBorn 落盘 bug 未修)

- **结果: 大幅劣化 17979** (vs c1 65086 / b1final 116533), RCL 卡 2 末段降级 1。
- 意图分布 repair=43 (旧基线 0, 维修链首次活了), build=5071 (c1 全程量级)。
- 尸检 (c17 9k 全量意图流):
  - worker 出生 14 只正常 (t1046 起), 但每只 ~1400t 老死 (小体寿命), 时间分配
    **move 65% / build 19% / pickup 5%**——1W 小体 + 7 工地分散 + 能量自给往返,
    有效建造吞吐 ~1e/t。
  - t5750-6250 塌方窗口: 四只升级体连孵 (wwcmw 350e ×2 + wcmw 250e ×2) 抽干
    spawn 能量 → 人口 26→8, eAvail 恒 <100, 经济锁死 ~2.2 e/t。
  - build 任务 (26,25 cc 容器) t30739 才生成 (工地 t0 就在)——worker 老死 →
    build 任务回收 → 重生成的 churn 循环, 5000e 容器跨 worker 世代建不完。
- **第三根因实锤**: `spawnDirector.ts:353` 比较 `request.unit === UNIT_CODES.worker`,
  但 request.unit 是角色名 "worker" 而 UNIT_CODES.worker 是代号 "W"——恒 false,
  workerEverBorn 永不落盘 (c16 dump 实证 economy 无此键)。修复: 改与
  spawnArbiter 一致的角色名字面量比较。
- 存疑待 c18 复核: worker 分流孵化预算 (25 只中 worker 4 + upgrader 10) 是否
  挤垮采集面; criticalWorkerWaiting 等待窗是否在 repairPending 恒在时卡孵化线。

### workerEverBorn 修复 + 关键基建提级 (c18→c22, 突破 RCL3 历史首次)

- 第三根因修复 (保留): `spawnDirector.ts` request.unit 改角色名字面量 `"worker"`
  比较, workerEverBorn 正常落盘。
- **fill_spawn 禁取 cc 容器 (c25) = 负收益, 撤销**: L2 提速 1.4kt 但 L3 卡 36412。
  fetch 禁令切断 cc 容器 → spawn 的能量流, RCL3 段升级链断供。
- **关键基建 build/repair 提级 (保留)**:
  - `RUSH_BUILD_CONFIG.criticalInfraPriority=4` (economy.ts): 源容器/cc 容器 build
    提级 (planners.ts nearSource 判定)。
  - container repair 提级 L4 (defense/planners.ts); road 不提级——c22 实证 10 条
    路 repair 吸干 6/9 人力。
- **criticalWorkerWaiting waitExpired 上限 (保留)**: 修复 repairPending 恒在时
  等待窗无限卡孵化线。
- **c22 = 当前最优态**: L2@4324 / **L3@17982** (历史首次破 RCL2→3; 此前所有
  版本 45k 卡 RCL2, c1 65086 / b1final 116533 全量垫底)。

### 任务分配死锁链尸检 (c19/c20)

- build 任务 (pri 8) 被 harvest (pri 5) 的 criticality 权重差 (100×(11-p)/11 → 27
  分) + SWITCH_MARGIN 15 拦死; harvester 体型 wmw (2W1M **0 CARRY**) 被 build 的
  carry 要求 canExecute 筛掉; carrier 被 fill_spawn (utility 0.9) 占死, haul 25
  任务积压——三闸叠加, build 无人认领。
- 解法即上述提级 (pri 4 过 SWITCH_MARGIN 检查) + 0-carry 矿工不做 build。

### 026c: fill_spawn/haul 抢占换手空转 (已知问题, 留档)

- carrier 每 tick 从 haul 手里被 fill_spawn (pri1≤CRITICAL_PRIORITY 豁免 margin)
  夺走, 下一 tick 又被 haul 夺回——withdraw/transfer 同一 cc 容器 1400t 零产出。
- 两个修复方向均负收益 (见下), 系统在该噪声下仍达 L3@17982, 代价比修复低。
- 候选方向 (未验): fill_spawn 对 carrier 的 utility 打折而非硬抢。

### relay carrier 饥饿死锁 (c28 探明)

- relay 段 min 250 (road [C,C,C,C,M]) > 涓流期 avail 82-233 → buildBody 恒 null →
  carrier 全灭死锁 (remote-mine idle 221 恒等待的根因)。

### 负结果台账 (批次 D 续)

- **c26-c27 抢占滞回 (CRITICAL_SWITCH_MARGIN/SURVIVAL_KINDS) = 负收益, 撤销**:
  L2 提速 1.4kt 但 L3 慢 10.8kt。fill_spawn 抢占风暴虽是真 bug, 滞回代价更高。
- **c28 无条件 carrierBootstrap (relay 段付不起回退普通段) = 负收益, 撤销**:
  全量回退引入小段件 churn 塌方, speedrun 全灭崩溃 + 破坏 run-residue 启动。
- **收紧版 bootstrap (staffed==0 && carrierEverBorn) = 负收益, 撤销**: speedrun
  L3 拖到 40425 (vs c22 17982)。
- 三轮全套件矩阵佐证: #1(c27态) 3/7、#2(无条件) 2/7、#3(收紧态) 3/7。
- 撤销后复测 (c29 态): speedrun-probe L2@4324 / **L3@17982**——与 c22 完全一致,
  回退干净。tsc/lint/test 10/10 绿。

### race 本体参照 harness 打通 + remote-mine 跨场景定性 (2026-10-19 c29)

- remote-mine 200k A/B: 工作树 FAIL (7 单位 / RCL1), HEAD stash 对照 PASS (10 单位 / RCL3)
  → 本批保留项引入 remote-mine 回归, 提交前须按 rush 档门控或 bisect。
- sim 语义差 (探针实锤): 模拟器在首个 loop 前重建全局上下文, **模块加载期 Memory 写入全丢**
  (tick 期写入正常)。race 本体依赖加载期初始化, 直跑 t0 必崩 `Memory.stats.cpu`。
- 补丁: race 入口 (`branch/race/main.ts`) 6 行「首 loop 延迟装载」, 不动本体逻辑, 现可完整跑。
- 参照成绩 (speedrun-probe 45k 同场景): race 本体 L2@676 L3@5624 **L4@23209**
  (L3→4 段 7.7 e/t); 对照 Nexus c29 L2@4324 L3@17982 L4 缺 (L3→4 段 0.51 e/t)。
  → 升级段 15x 差距, 体系级实锤; race 本体现为可跑的移植标尺。
- 注: 本体 sim 绝对值仍慢于其私服 1wt/2wt/4wt 目标, sim↔私服机制差待校准。

### B 路线：渐进移植计划 v1 (2026-10-19 用户决策)

- 差距分解 (speedrun-probe 45k, 逐 5k 窗口升级速率 e/t):
  race 7.62/1.82/12.47/7.47/6.70/0.17/2.86/10.28/12.34 vs
  nexus 0.37/4.41/2.84/1.74/0.45/0.63/0.56/0.50/0.29。
  开局差 ~20x; L3 后差 ~15x 且不回弹; nexus spawn 能量恒枯竭 (eav 29-205 vs race 550-1300),
  人口 race 恒 10-12 成体系体 vs nexus 开局 26 只小体。
- 本体核心机制 (源码勘察):
  - **驻场升级体**: 站位区 (controller 3 格内 flood-fill 座次), 只做「取 depot→升级」,
    永不跑腿; depot 链 = controller link > 掉落堆 > cc 容器, 由独立 courier 灌满
    (流量模型 controllerNumCarry = 2*maxWork*distance); 体型按 energyCapacityAvailable+
    maxWork 定档 (getUpgraderBody); numWork 记账 (健康升级体 WORK 总和 < maxWork 才孵);
    building/upgradeNeeded 互斥开关; 升级体↔升级体能量递手 (防断供)。
  - spawnManager 只是队列消费者 (MinHeap 优先级), 请求由各 manage* 系统推入。
- 移植单元 (按杠杆排序, 各单元落地后跑 probe 与 race-ref 对照验收):
  - **P1 升级供能链** (对标 manageUpgrade/manageLogistics): 驻场 + depot 链 + courier 流量;
    Nexus 侧对应 controllerBuffer/courier.ts/energyLogistics/workforce。
  - **P2 开局序列** (对标早期 roster/优先级): 目标 L2 < 1.5k / L3 < 8k。
  - **P3 采集/搬运体系** (对标 manageSource/manageLogistics): 矿工 drop 型 + 大型体定档。
- 验证协议: 每单元后 probe 45k 对照 L2/L3/L4 时刻与窗口速率; 全套件 (remote-mine 等)
  不得出新回归; 提交前处理 remote-mine 门控。


### 批次 E：P1 开工 · L3 塌方能量流解剖 (2026-10-19, probe-p1a ≡ c29 逐位再现)

- 基线复现: L2@4325 / L3@17983 / 45k 末进度 13778; L3 期升级速率 0.53 e/t。
- 全报告能量口径 (45k): 采集 535024 · 升级 58978 · 孵化 73500 · 建造 22365
  → 三大消费端只吸收 ~155k (**29%**), 其余 ~380k 未被吸收 (源边既存/腐烂)。
  意图: harvest 133854 · upgrade 33015 · transfer 11875 · withdraw 13140 · pickup 2273 ·
  build 3956 · repair 9043 · spawnCreep 289。蜂窝: eav 快照全程 25-252 (RCL3 容量 800)。
- 采集/收入健康: produced EMA 16.5 e/t; harvestSplit atSource 96%/97% (源饱和)。
  → 断点不在采集端, 在**分配与消费端**。
- **舰队替换吃满 spawn**: 终局 9 只全为最近 1400t 新生 (bornAt 43535..44920, 间隔 ~176t);
  289 只/45k = 156t/只; **均体 254 能量** (race 定档 800+)。编制增长无门: 孵化吞吐
  被换代 100% 占用, 舰队规模恒 = 156t×1500t 寿命 ≈ 9.6。
  攒能等体型窗口 (120/400t) 在 ~1.6 e/t 的 spawn 入流下只能成就 200-400 能量体型 → 自锁。
- **实锤: 升级体被 cc 货运征用 (分配器职能门缺失)**:
  - cc 货运在专线收紧期被提级 **prio 1.5** (≤ CRITICAL_PRIORITY=2) → 无滞回抢占任何在岗者;
  - `canExecute` 只做 capability 过滤, 无职能门 → dump 实锤: 升级体 U-E569 持
    haul(8,37)→cc, 工人 W-777B 亦被租入 haul; 6 个 upgrade 任务全 available +
    failureReason=preempted。升级体 40-70t 往返只送 37e → 段内升级停摆;
  - 在岗升级体恒 1 只 (编制目标 ≈5), 升级火力被自己参与的空转换手吞掉。
- 专线收紧判定恒真: `idleCarriers ≤ dedicatedCarry` (流量口径 ≈ 单位数) 在 3 搬运舰队下
  恒成立 → 非 cc 目的地 haul 放量恒被压制; cc 货运恒处"见谁抢谁"档。
- 待交叉核对 (p1a-intents.jsonl 取证): 37e 是 cc headroom 还是源容器存量 (cc 水位几何);
  380k 腐烂的具体形态; fill_spawn 的 lease 独占时长。

### P1 修复候选 (配置化, 全模式一套代码; 验收: L3 段 ≥4 e/t 起, 目标 7+, eav 常态 >400)

- E1 **haul 职能门** (只锁 haul, 非全局排他): 在岗 carrier 存在时 haul 仅 carrier 可领,
  全灭回退放行保 bootstrap。理由: 全局 affinityExclusive 是 arena 负实证 (批次 D),
  但那是把 fill_spawn 也锁死; 升级体被 haul 征用是另一条链, 需单独锁。负向审查:
  若 E1 后 L3 晚于 17983 或段速 <0.53, 撤销留档。
- E2 **专线紧判定重写**: 舰队总量 < 专线流量需求时收紧无意义 (全舰队都该按优先级竞争),
  仅在「有闲置余量可调」时才进入收紧。同期修正非 cc 目的地放量压制。
- E3 **spawn 入流解锁**: E1/E2 释放 carrier 运力归位 fill_spawn (prio 1) 后观察
  eav/体型自愈; 不自愈再调 rush 攒能窗 (WaitTicks ↔ 入流×体量自洽)。
- E4 **升级体编制落地**: 验证 upgraderNeed≈5 在 spawn 队列的胜出顺序 (对标 race
  numWork < maxWork 即孵口径)。

### E1 实现：同容器自环不变量 (2026-10-19)

- 根因链 (代码级): fill_spawn 任务持有者站在 cc 旁时——
  ① 取能段 `fromId=undefined` → `nearestStore` 选中 cc (水位排他开放, cc ≥ 保底);
  ② 交付段 `deliverEnergy` 无 destId → C1 顺路灌注 (`enrouteTopup`) 只排除 task.destId,
     而 fill_spawn 无 destId → cc 恰在 60% 低保线下成为当拍配额目的地, 距离 0 命中;
  ③ `withdraw cc → transfer cc` 每 tick 重复, 零位移。
  取证: 0336 一生 1264t 零移动, cc 对倒 ±~100 e/t; 全房 cc 45k 吞吐 1.35M/1.35M,
  真实采集仅 535k; 源容器取出仅 0.3 e/t。
- 修复 (E1, 通用不变量, 全模式同一套):
  - `CreepMemory.fetchSrcId`: 取能段记账本周期来源 (fetchEnergy 五条级联分支全标);
  - `deliverEnergy` 四处排除同源: 任务 destId 分支 / 溯源配额集 / enrouteTopup / cc 溢流落堆;
  - 语义: 本周期取能的来源结构不得作为本周期交付目标; 无可投配额时持能待命 (零损耗,
    与 specs/controller-supply-line 既有「无配额可投则原地等待」一致)。
- 验收: L3 不晚于 17983; 末进度 > 13778; 均体 > 254; 孵化 > 73500; eav 峰值 > 400。
  负向: 任一项恶化即撤销留档。

### E1 实验：同容器自环不变量 = 负收益, 已撤销 (2026-10-19)

- 实现: `CreepMemory.fetchSrcId` 取能段记账 + `deliverEnergy` 四处排除同源
  (任务 destId / 配额集 / 顺路灌注 / cc 溢流落堆)。
- 有效部分 (达成设计目标): cc 自环根除——transfer 意图 11875→3424 (≈-71%);
  采集 535k→577.8k (+8%); 孵化 73.5k→101.3k (+38%, spawn 入流解封);
  末态 upgrade/in_progress=2 (基线 0, 升级体曾被 haul 征用)。
- 回归实测 (speedrun-probe 45k):
  | 指标 | 基线 c29 | E1 |
  |---|---|---|
  | L2 | 4325 | **6204 (+44%)** |
  | L3 | 17983 | **39920 (+122%)** |
  | 末进度 | 13778 | **5000** |
  | 采集 | 535024 | 577828 |
  | 升级 | 58978 | **50200 (-15%)** |
  | 孵化 | 73500 | 101300 |
  | 建造 | 22365 | **44632 (+100%)** |
  | 单位 | 9→9 | 9→11 (中途 26-32) |
  | 均体 | 254 | 260 |
- 反噬机制 (dump 实证):
  - 舰队膨胀 26-32 只 + 建造翻倍: 能量解锁后无总阀, spawn 刷小体、worker 刷工地;
  - `spawnBalanceEma` (rush 升级定编 EMA 状态) 被 `upgradersStarvedOf>0` 拖到
    **-1.0 下限** (基线 +0.99) → 升级定编乘数压最小 → 升级体更少 → 更饿, 负反馈螺旋;
  - 根因: cc 自环原先是「伪水泵」——循环取能把 cc 恒压在水位线下, 使 cc 恒为配额
    目的地, 持续吸引货源管线补货, 升级体随到随饮, 掩盖了 cc 供能链真实水位管理缺失。
    自环一拆, cc 被 fill_spawn 直抽 (200/趟) 而无补货优先保护 → 升级线先饿。
- 结论: 自环是不变量级 bug (必修), 但其拆除必须与「cc 水位保护 + 舰队总阀 + 升级
  优先供能」成套上线。单拆 = 负收益, 已撤销 (dist 已重建回 c29 基线)。

### 批次 E2 设计 (成套, 待实施)

- 前提保留: E1 自环不变量 (补丁见本档实现描述; 独立 A/B 负, 需随成套验证)。
- E2a **cc 水位保护**: fill_spawn/通用取能的 cc 开放线从「升级保底 (≈80)」抬到
  配额水位线 (0.6×容量): cc 低于水位线时不给孵化线直抽, 只允许 upgrading 消费 +
  货源管线补货; 防止孵化线把升级干水位抽空。
  (基线自环把该问题掩盖; E1 实证 cc 抽空即升级 EMA 螺旋。)
- E2b **舰队总阀**: 无上限的小体 spam 是膨胀源 (390 只/45k, 中途 26-32 只)。
  候选: 编制请求上限约束 (总目标编制 × 寿命/孵化时长 ≤ 可持续层数), 或
  carrier 请求绑定实测运力缺口 (partsPerBody 微体口径修正)。
- E2c **升级优先供能**: EMA 螺旋保护 (starve 信号需回流缓冲/下限抬升),
  且 cc 保底水位应覆盖「升级体一套取能缓冲 × 在岗数」。
- 验收: L3 ≤ 17983 且升级 ≥ 58978 且 spawn 入流 ≥ 8080/t (E1 水平) 三项同达,
  任一项退化即再撤。

### E2 v2 实现与实测 (2026-10-19, probe-e2 ≡ 45k)

- 三件套落地 (全配置化, 全模式一套代码):
  - **E1 自环不变量 v2**: 取能段新增 subjectId —— fill 类任务 (kind=fill_spawn)
    不以自身填充对象为取能点 (spawn 紧邻 cc, 「取它再填它」= 零净流空转的来源);
    E1 的 fetchSrcId 记账 + 交付段同源排除保留。**v1 的教训**: v1 只做交付段排除,
    把种子「从 spawn 补差 → 采满 → 交回 spawn」的早期自补给循环整条砍掉
    (E1 早期 t4000 仅 2 只, spawn 攒 192 却不出兵) —— 该循环是合法的, 非自环。
  - **E2a haul 职能门** (`STRICT_EXCLUSIVE_KINDS=["haul"]`, allocator 逐 kind 强排他):
    在岗 carrier 存在时 haul 仅 carrier 可领——升级体/工人被 cc 货运征用的链路斩断
    (有别于全局 affinityExclusive: 不波及 fill_spawn 的全员兜底, 见 (十三) 教训)。
  - **E2b cc 补货提权** (`refillLead=0.5`): cc 低于水位时 cc 货运优先级压到孵化线
    (fill_spawn) 之上 refillLead 档。
- 实测 (45k):
  | 指标 | 基线 c29 | E1 | E2 v2 |
  |---|---|---|---|
  | L2 | 4324 | 6204 | **2670 (-38% vs 基线, 历史最快)** |
  | L3 | 17982 | 39920 | 未达 (末 RCL2 22128) |
  | 升级 | 58978 | 50200 | **22328 (-62%)** |
  | 采集 | 535024 | 577828 | 512422 |
  | 孵化 | 73500 | 101300 | 63850 |
  | 建造 | 22365 | 44632 | 22006 |
  | spawnCreep | 289 | 390 | 256 |
  | transfer 意图 | 11875 | 3424 | **508 (-96%)** |
  | 存活编成 | 4H/1U/3C/1W | 6C/1W/2U/2H | 3H/3C/1W/1U |
- 解剖 (汇总行 + dump):
  - **早期大胜**: L2@2670 —— subjectId 修好早期自补给循环 + cc 有货升级体随到随饮
    (t2670→6750 段升级 0.84 e/t, 远快于基线的 L1 段)。
  - **中后期崩盘根因 (链条)**: `refillLead` 恒提权 (cc 配额水位 1200/2000 几乎永不满足)
    → carrier 全时扑 cc 补货 (0.5 < fill 1.0) → 孵化线任务无人认领 (available 挂起)
    → 落到唯一还有空档的 carry 单位 = **升级体**头上 (dump: fill_spawn in_progress
    assignee=升级体 U-01D4, amount 221) → 升级体跑 30 格长腿取货填 spawn → upgrade
    任务全 available 无升级体 → 升级 0.26 e/t 尾段 (6 条 upgrade 任务挂起)。
  - transfer 508 的对应读法: withdraw/pickup 4304 次, 交付仅 508 次——补货线把
    carrier 霸占后, 各端交付目的地都无人在位 (源容器取出 → cc 的链路停摆, 长腿兜底
    又慢); 采集 512k 但可吸收端仅 108k, 其余腐烂 (基线同量腐烂, 差在升级线份额)。
  - 诊断确认: `economy.diagnosis.bottleneck="transport"`, carrierMultiplier=3 ——
    模型已识别运力瓶颈, 但编制目标 (≈3 只) 与实际可持续孵化量 (孵化入流 1.4 e/t
    ≈ 8 只/1500t 寿命) 都没把运力抬起来; 这是下一批 (E3 运力总阀/分层) 的主战场。
- **E2b 判定: 恒提权 = 负收益, 已改修为应急阀** (见 E2 v3)。E1 自环不变量 v2 与
  haul 职能门保留 (早期胜果来源, 且中后期崩盘与二者无因果)。

### E2 v3: cc 应急阀 (2026-10-19, 待实测)

- `refillLead` 仅在 cc 跌破 `refillEmergencyRatio (0.15×容量)` 时生效 (无敌情时);
  常态 cc 货运回落到孵化线之下 (基线序), carrier 优先做 fill_spawn;
  应急阀只防升级断粮 (E1 实证的 starve 螺旋)。
- 验收: L3 ≤ 17983 且升级 ≥ 58978 且孵化 ≥ 101300 三项同达 (E1 水平);
  且 L2 ≤ 4324 (保住 v2 早期胜果)。任一项退化即再撤留档。

### E2 v3 / E3a / E4a / E5 系列实测与判定 (2026-10-19, 全 45k, 同场景 speedrun-probe)

- **实测汇总**:

  | 变体 | L2 | L3 | 升级 | 孵化 | 采集 | spawnCreep | transfer |
  |---|---|---|---|---|---|---|---|
  | 基线 c29 | 4324 | **17982** | **58978** | 73500 | 535024 | 289 | 11875 |
  | E2 v3 (v1+v2+应急阀) | 2670 | 未达 | 24535 | 63150 | — | — | 508 |
  | E3a (v3+运力分层) | 2670 | 未达 | 11087 | 54100 | 573850 | 221 | 332 |
  | E4a (v3−haul 排他) | 2670 | 未达 | 23619 | 68700 | 511978 | 275 | 969 |
  | E5a (仅 subjectId+应急阀) | 2670 | 37667 | 52664 | 66550 | 491434 | 266 | 9450 |
  | E5b (仅 subjectId) | 2670 | 41341 | 48221 | 67200 | 503580 | — | — |
  | race 参照 (同场景) | **676** | **5624** | **308604** | 155350 | 652532 | 391 | 22219 |

- **判定: E2 批次 + E3 全部回退** (运力分层 / haul 职能门 / cc 应急阀 / subjectId / v1 交付段
  同源排除), 树回到基线等效态 —— **probe-r2 与基线 p1a 逐位复现** (采集 535024 /
  升级 58978 / 孵化 73500 / L2@4324 / L3@17982 / 生产 289 / 存活 9 全同)。逐项留档:
  - **E3a 运力分层** (carrier 在岗 ≥2 后追加运力降档 6): 升级 11087 (−81% vs 基线)。
    运力是本矿真瓶颈, 削运力 = 削全链; 且降档后 harvester 请求 (任务档 5) 仍持续补员,
    编制落点从 carrier 偏移到 harvester (采集 573850 反而最高 = 采得出运不走, 全烂)。
  - **haul 职能门** (`STRICT_EXCLUSIVE_KINDS`): E4a (关) vs E3a (开) 升级 23619 vs 24535,
    差异在噪声内; arena 教训 (升级体兼差 haul) 在本架构不成立, 单列排他无收益, 机制一并删除。
  - **cc 应急阀**: E5a (开) vs E5b (关) L3 37667 vs 41341 —— 阀仅小幅改善, 远不足以
    抵消 subjectId 的中期损失; 且 E2 v2 恒提权已判负收益, 无保留价值。
  - **subjectId (E1 v2) = 本批最大发现, 双面件**: 唯它一份时 (E5b) 早期大胜
    L2 2670 (vs 4324, −38%) 但中期大崩 L3 41341 (vs 17982, +130%), 升级 48221。
    机制: 阻断「以自身填充对象为取能点」后, 孵化线单位的取能点只剩 cc/源容器等远端,
    涓流收入期补员速度追不上寿命流失 → 编制缩水 (t10000 存活 6 vs 基线 11) → 全链降速。
    迁回方案应按「早期开 / 中期关」相位阀重做 (RCL≤2 或 sw 水位线), 或放弃该不变量。
  - **基线 p1a 与 E5a 的体型差异 (新证据轴)**: 单次动作能量密度 (能量/意图次数) ——
    升级: 基线 6.5 e/次 (大体升级体) vs E5a 1.5 e/次 (小体) ; 采集: 基线 3.7 vs race 9.06。
    E5a 的早期胜果伴随**系统性小体化** (涓流定档), 这与它的中期崩盘互为因果。

- **race 参照定量差 (下一条主线的靶子)**: 同场景采矿仅 1.2× 我们 (652k vs 535k), 但
  **升级 5.2×** —— 差距全在「采到的能量送达率」: race 送达 ≈ 92% (升级 308k + 孵化 155k
  + 建造 136k ≈ 598k), 我们 ≈ 28% (≈150k/535k), 其余在两源容器/地面堆腐烂 (两 run 同量)。
  指向两条待攻主线: ① **体型档**: 让 RCL2+ 稳定出满速体 (5W 矿 / 5W 升级), 而非 2-4 WORK
  涓流体 —— 同一采集量 race 只需一半动作; ② **源容器→cc 专线运力与容器水位联动**
  (容器满 = 采集白采), 运输编制随容器积压而非固定 3-6 只。

### E7-E12 批次: 接力件满速化 + 碎堆门槛 (2026-10-19, 45k, 同场景)

- **E7 (正收益, 保留): 接力路面段 4:1 → 1:1** (`RELAY_CARRIER_SEGMENTS.road` =
  `[C,M]×4`, 200 容量基数不变): 平原/沼泽全程满速 (旧 4:1 平原 4t/格), 100e 即可出件。
  实测 **L3@16236 (-1746t vs 基线), 升级 132408 (2.24×), 孵化 85350, 生产 368**。
  L2@5876 (+1552t, 早期小件化的代价, 净赚)。e7/e7b/e9 三跑终值逐位一致。
- **E8 (零行为, 保留): carryPartsPerBody 口径同源** —— 定编折算改按孵化侧同口径
  (relay 期 [C,M]×4 = 4C/件, 旧按 [C,C,M]×3 = 6C/件高估单件运力 50%)。实际目标
  被 rclCap=8 吸收, 但口径 bug 该修。
- **E9 解剖 (e7 同 bundle + 意图流)**: cc 饥饿 t28249 起持续 16750t; 4 条 cc 补货
  大单 3 条无人认领; **孵化槽 45k 仅用 3936t (空闲率 91%)** —— carrier 缺口不在
  孵化产能, 在能量 (eav<200 占 73%, 恒孵 232e 小件)。fill_spawn(优先级 1) 无限
  再生钉死全部 carrier。
- **E10 (零行为, 已撤): 源旁 ext 判据带 CARRY** —— `hasSourceAdjacentExtension`
  恒 false? 不, e9 意图流证明 RCL3 后矿工本就带 C (`workcarrymovework` 84 只) ——
  判据是冗余的, 撤。
- **E11 (负收益, 已撤): ext 直填优先于容器** —— 升级 126962 (-4%), 能量分流进
  孵化池而非 cc 升级链。孵化池与 cc 的边际能量分配仍是无解的旧题, 单动交付序判负。
- **E12 (正收益, 保留): 碎堆搬运门槛 30 → 100** (`minHaulAmount`): 21 条积压 haul
  里 14 条是 30e 微单 (carrier 走 19 格搬 30e)。实测 **L3@15434 (新纪录)**, 孵化
  126650 (+48%), 腐烂大减; 代价: 升级 112045 (-15%) —— 边际能量转向孵化/建造
  (编队 17 只, carrier 满编 8, haul 零积压)。对 L4 总账是净赚 (更大舰队 = 更高
  稳态吞吐), 但 t36000-38000 有升级停摆窗口 (ema=-1 饱和, 升级体饥饿压制定编)。
- **e12 遗留病理**: `sourceTiming` 494 (钳制值) —— 采样口径是「出生→到岗」含孵化
  排队, 非纯路程; carrierCountTarget 被推爆但被 rclCap 吸收 (无害但脏)。
  spawnBalanceEma=-1 饱和 (饥饿信号) —— E13 候补: 饥饿时升 spawn 池优先级而非砍定编。

### E13/E14 批次 (2026-10-19, 45k)

- **E13 (正收益, 保留): 升级断粮应急阀** —— cc 存量 < 25% 容量【且 upgradersStarved>0】
  双条件时, cc 补货 haul 优先级 -refillLead(1.5) 临时越过孵化线 fill_spawn。
  与已判负的恒提权 (E2b) / 纯水位提权 (E5a) 区别: 饥饿信号是行为层「cc 空 +
  工位旁无堆」的实测记账, 只在真断粮时介入。
  实测: **升级 142395 (+27% vs e12), 孵化 162750 (+29%), 采集 525246 (+21%),
  生产 430, 存活 18**; 末段速率 3.15-4.58 e/t (e12 是 0.84-3.04);
  L4 缺口 65502→35152。t0-20k 与 e12 逐位一致, 差异从应急阀首次触发展开。
- **E14 (负收益, 已撤): relay 段 ×6 (300 容量/600e)** —— 升级 90422 (-36%),
  采集 -28%。600e 大件在涓流期攒不出 → 换代断档。与 e6 (3:2 配比) 同课:
  **relay 件的生命线是换代节奏, 不是单件容量**。
- e13 遗留: 升级体利用率仍 16% (5 只×4W 潜力 20 e/t, 实际 3.2)——
  运力总量 23 e/t vs 需求 25 e/t 差一口气; courier 五闸门之④ (spawn 满仓)
  在孵化即时消费下恒 false, 快递机制从未发车 (待重设计: 阈值改孵化请求空档)。

### E13 60k 全程 (2026-10-19)

- **L1@0 / L2@5907 / L3@15434 / L4@50755**, 升级 217235, 孵化 271950, 建造 109585,
  生产 641。L3 段门槛达标 (≤20000), **L4 未达 (50755 vs ≤40000, 差 10755t)**;
  race 参照 L4@23209。L3→L4 段 35321t, 段均 ~3.7 e/t, 冲刺段 (t45k-50.7k) 6.1 e/t。
- 下一步靶子 (按 60k 数据): L3→L4 段的中段 (t20k-40k) 速率 1.6-4.6 e/t 波动,
  主瓶颈仍是运力总量与升级体利用率 (16%); courier 闸门④重设计是最大未开采杠杆。

### E15 批次 (2026-10-19, 60k)

- **E15 (正收益, 保留): 采集定编按实际体型反馈** —— `harvestStaffingPerSource` 的
  单只 WORK 从「容量档理论值 (5W→1 只/源)」改为「在岗均值 `avgHarvesterWorkOf`」。
  断链背景: 涓流期攒能超时降档让实际采集体恒为 2W 小体, 定编却按 5W 折 1 只/源
  ——采集面锁死 8 e/t (潜力 20), 设计自述的「饱和缺口由攒能升体型承接」从未发生。
  多只小体铺开 (上限 `maxPerSource: 3`) 后源速铺满, 体型回升定编自动回落单座。
  同步修 `isProductionSecured` 多只口径 (逐源 WORK 配额, 原口径定编>源数恒 false)。
  实测 60k: **L4@49335 (-1420t vs e13), 采集 837976 (+9.3%), 升级 229415 (+5.6%)**;
  L3@16198 (+764t, 多只采集让位窗略长, 仍 ≤20000 ✓); 分相削峰填谷 (24-33k 窗口
  0.66/1.95 → 3.42/3.85 e/t)。RCL1 期每源 3 只先例本就在案 (harvestSlotsFor
  多槽位机制现成)。
- 遗留观察: L3 门槛 20k 已稳定达标 (16198), L4 门槛 40k 差 9335t; 下一杠杆仍是
  运力 (12.4→13.5 e/t 后 carriers 更紧) 与升级体利用率。

### race 本体机制破译 (2026-10-19, 逐文件读源)

前几轮"抄不动"的根因: 只抄了参数没抄机制。本轮逐文件读 race 源码, 关键事实:

- **采集是比值闭环不是定编只数** (manageSource): `minerRatio = harvestPower/energyPerTick`
  (harvestPower = 实测在岗 WORK×2, 非理论体型), `haulerRatio = carryPowerLeft/maxCarryPower`
  (maxCarryPower = 2×distance×energyPerTick, 距离驱动); 缺哪补哪, `income = netIncome ×
  min(minerRatio, haulerRatio)` (木桶效应)。矿工预算 `income>0 ? capacity : max(300, eav)`
  (换代等大件, 首只小体快跑), hauler 恒用 `energyAvailable` 小件快跑。
  `minerRatio<1 && numMiner<numOpen` (源旁可站位数) 才请求矿工; `haulerRatio<minerRatio`
  才请求 hauler (运力严格跟采矿)。
- **孵化优先级是三层编码** (SpawnRequest): `taskTypePriority×100000 + taskPriority×100 +
  rolePriority`, MinHeap 小者优先。序列: LOGISTICS(porter/courier)=1 > OWNED_SOURCE
  (harvester/carrier)=2 > PREVENT_DOWNGRADE(upgrader 保级)=4 > BUILD=7 > ... > UPGRADE=42。
  **upgrader 双挂**: 保级走 4, 冲级走 42 垫底——冲级火力永不挤占物流/采集。
- **upgrader/builder 被 hauler 直接投喂** (manageLogistics.getFillRequests):
  `room.creepsToFill.push(upgrader/builder)`, 填充优先级 worker=3 > upgrader=5 >
  container=5; hauler 空闲→`addSpawnBalance`, 断粮→`subtractSpawnBalance` →
  `maxWork = income × clamp(spawnBalance/2+0.8, 1, 1.2)` (±20% 微调, 从不停孵)。
  RCL<7 恒 `shouldRelay` (relay 模式, maxCarry=4 小件高频接力)。
- **源基建是滚动放量** (constructSource): 容器+路一次最多 6 个工地 (CONSTRUCTION_SITE_NUMBER),
  沿 path 从两端同时铺; `enoughRoad = 建成路距/总距 ≥ 1/3` 才切换 forRoad 体型
  ([C,C,M]×N 150e/段)。
- **L2@676 的秘密**: 无任何基建依赖——矿工直采 + upgrader 直立控制器, 200 进度纯靠
  采集面尽快铺开, ext 都不需要 (RCL2 才解锁)。

### E16 批次 (2026-10-19)

- **根因定位 (冒烟枪)**: 我方开局 4750t 控制器进度为 0 (upgradeController 意图仅 2 次)!
  UNIV 全程 build(881)+喂 spawn。日志实锤: `develop↔survive` 每 600t 震荡
  (t1609/2209/3038/3638/4557/5157), stock 瞬时值 32/13/2 反复击穿 critical 40 →
  `suppressUpgradeBuild` 压 upgrade 任务 + `surviveSpawnPauseRoles` 停孵 upgrader。
  **stock 口径 = 全房结构瞬时存量, 而涓流经济孵化即时消费天然贴地** —— 把正常态
  误判为危机态, upgrade 链被压死 5300t, L2 拖到 5907 (race 676)。
- **E16 (判正待验): stockFloors 涓流期重校准** critical 2→8 / healthy 5→20 /
  surplus 12→40 (stock<160 才 survive, >400 回 develop)。

### E17-E23 批次 (2026-10-19, 开局升级断链会战)

- **判正保留 (堵点各归其位)**: E17/E18/E19 为语义修复, 验证与 e16 逐位一致;
  -6 修复与 E21 为行为改动 (执行层边界修复 / 孵化优先序), 不等同 e16——批次 G
  已在新树对两者做 A/B 反做验证 (见下)。
  - **E17**: `suppressUpgradeBuild` 无 storage 豁免 (涓流期不压制 upgrade 任务)。
  - **E18**: 采集让位闸放行名单补 upgrader (race: 升级请求从不被闸拦)。
  - **E19**: pauseRoles 涓流豁免——`filter` 三次写反的教训: 语义是「true=留在
    暂停名单」, 正确式 `u!=="upgrader" || (!downgradeActive && !trickleEconomy)`。
  - **-6 真实 bug 修复 (本轮最大单点发现)**: bootstrapHarvest 判定用
    `max(available, 300)` 虚预算, 执行用裸 available → spawnCreep 恒
    ERR_NOT_ENOUGH_ENERGY (-6), 每 20t 一次循环打回——**开局 1500t 孵化槽
    静默的物理根因**。修复: 判定/执行同口径且攒不够真能量不下单。
  - **E21**: rushUpgradeSpawnPriority 3→4 (不越 carrier L3, race LOGISTICS 恒先)。
- **判负已撤**: E20 (攒能等待期 fallback 孵次优——容量档版 L3 恶化 4186t,
  最小件版 L3@25237 小件 churn 668 生产)、E22 (采集面铺满后 upgrader urgent
  提序, L3@16344)。
- **重大方法论事故 (sim 审计补充)**: e19 45k 在 load 2.29 下跑出 L2@1171
  假突破, 干净复跑 (load 0.13) 逐位回到 L2@6209——**挂钟污染能制造任意结论**,
  之前"load 1.39/1.89 下跑的三场景回归全部作废重跑**。
- **开局升级断链的完整解剖 (6000t 零升级, upgradeController 仅 68 次)**:
  ① t0 即放 container 工地 → UNIV 被 build 钉死 (881 意图);
  ② upgrader 起步 200e 在涓流期 (eav 常年 100-250) 恒被 carrier 段件 (100e)
  /harvester (250e) 抢先, urgent 段 buildBody(available<200)=null 永不命中;
  ③ UNIV 一死 (t1500) 全场无 work+carry 兼职件, upgrade 任务 4600t available
  无人认领; ④ race 对照: 开局【无工地】(满源后才 construct container),
  upgrader 无 income 前也请求 (UPGRADE=37 垫底但队列空了自然轮到),
  hauler 恒用 energyAvailable 微件 spawn 从不空转。
- **下一战役 (E24 候选, 未实施)**: RCL1 期延后 container 工地 (先升级后
  基建, race 语义) 或 UNIV 开局兼差 upgrade (亲和表加行)。

### 回归结论 (2026-10-19)

- speedrun 45k = e12 逐位复现 (采 435422 / 升 112045 / L3@15434) ✓
- rcl-sprint 30k: L2@3948, CPU P95 6ms, 0 错误 (门槛 RCL4≤40000 未达——非本次
  目标场景, 现状与改动前同量级, 待 L4 主线突破) 
- remote-probe 30k: 采集 387356 升级 83751 L3@15434 无报错 ✓ (与 speedrun 同场景)
- **boot-from-scratch 20k: L2@5661 FAIL (门槛 ≤5000) —— bisect 定性: 树内既有
  WIP (13 文件) 单独也 FAIL (L2@6209), 我的 E7/E12 批次反而净改善 548t**。
  WIP 引入的 boot 退化是历史遗留, 需在 WIP 内部再 bisect (boot 场景的 RCL1 期
  序列与 speedrun 场景不同: 初始 spawn 能量口径差异)。

### 批次 F: 任务换手病理与滞回豁免收窄 (2026-10-19, race-speedrun 任务 6.1)

**背景**: 现行树 (含 E20-E25 后回滚基线) 的 45k 曲线形状 = 快开局 (L2@1304)
+ L3 后塌方 (t14k 起升级恒 1-3 e/t、人口 33→13、容器/cc 双枯)。上一轮定性
"分配器换手" 为嫌疑, 本轮做完整尸检并落地修复。

**尸检 (逐 tick 探针窗口 t38900-40300, 只读记录)**:

- **换手规模**: 16,201 creep-tick 里 10,153 次任务换绑 (62.7%), A→B→A 回摆
  8,795 次; 搬运体最高 98% 的 tick 在换手。任务 id 数量极少 (58 个 fill_spawn /
  7 个 haul / 5 个 harvest) 而平均占有仅 1 tick——不是任务忙, 是同一池任务在
  同一批单位之间每 tick 互相夺来夺去。
- **换手对全部围绕 fill_spawn** (双向计数近似对称 ⇒ 互抢): fill_spawn↔haul
  1253/1250、↔upgrade 994/989、↔harvest 618/615、↔repair 178/178。
- **机制**: `allocator.ts` 原判据 `task.priority <= CRITICAL_PRIORITY(2)` 免滞回。
  数值档里 fill_spawn=1、defend/retreat=2 属生存档, 但**专线 haul 的星饥加速
  会把 priority 压到 0~1.5** —— 物流任务掉进生存数值区间, 获得每 tick 零成本
  换绑权; 被换下的任务回池, 下 tick 按亲和(95 权重)又被同一只夺回。设计意图
  (design/05 §5.6 + SCORE_WEIGHTS 注释) 是**只有 survival 类免滞回**。
- **标本 1 (对冲)**: 采集体 H-731B 在同容器 (0x345) 上 withdraw=50 / transfer=50
  每 tick 交替, 容器持续满溢、源旁采集停摆 —— 驻点矿工被专线 haul 抽走做装卸对冲。
- **标本 2 (原地振荡)**: 搬运体 C-5A7C 满载 150e 在 fill_spawn (最近源取货) 与
  haul (固定 targetId 取货) 两件任务间每 tick 互换; 两件任务的取货源一南一北,
  单位被拉成 (9,16)/(9,17) 原地往返 60 tick, 直到任务集变化; 全程 900 tick 只
  完成 ~4 次交付 (~0.5 e/t, 运力利用率 ~15%)。塔/扩展的 50e 级交付被拉长成
  35+ 格往返。

**修复实验 (一轮一杠杆, 同场景 45k, 前检 load<1.5 + 首行 cpu≤300ms)**:

| 变体 | 45k 累计升级 | L2/L3 | 人口谷 | 换手率 | 判 |
|---|---|---|---|---|---|
| 基线 (probe-window-45k) | 137,222 | 1304/10726 | 13 | 62.7% | — |
| v1 只保 defend/retreat (probe-hyst-45k) | 113,050 | 1303/10999 | 12 | 0.4% | **负, 已撤** |
| v2 保 survival+fill_spawn, 同族不互抢 (probe-hyst2-45k) | **168,244** | 1091/13157 | 17+ | 3.6% | **正, 保留** |

- **v1 负因**: fill_spawn 失去零滞回 → 爆窗期 (t8-10k) 孵化线饿死, 人口 33→12
  后全链塌方。证明 fill_spawn=1 的抢占权是承重的 (与 SCORE_WEIGHTS 注释一致)。
- **v2 语义**: 零滞回 = 「survival/fill_spawn 抢非同类」; 同族之间仍需滞回
  (堵死 fill_spawn↔fill_spawn 热土豆 1680 次/窗口)。除互抢对全灭外, 等价于
  基线保留 fill_spawn 的抢占权。
- **v2 实证**: 45k 累计升级 +22.6%; t14k 后升级速率 2-5 倍于基线且再未塌方;
  **落地堆尸腐烂被清零** (t20k 后 2k 快照落地堆 ≈0, 基线恒有 1-3k 在烂);
  人口维持 17-20 (基线末段 11-13); 采集持平 (634,556 vs 637,882)。
  代价: 中段爆窗变弱 (t8-12k 孵化支出 7.5k/7.0k vs 12.1k/13.0k → L3@13157
  vs 10726), 之后一路反超。L4 投影 ~t48-50k (基线 ~t65-70k)。
- **口径核对**: 同场景 e16 时期曾达 L4@43891 (45k 累计 182k, 但 L2@6210);
  现行族 L2 提前 5k tick 却在 L3 后塌方 —— v2 修的是塌方, 开局优势保留;
  与 e16 的差距 (182k vs 168k) 是下一轮 (中段爆窗/cc 水位) 的空间。
- 留档: E24/E25 两轮变体实验已跑并全部回滚, 回滚确认跑 (probe-e24/e25 ≡
  probe-window-45k 逐位同签名 6846afbf8742); 变体本身数据未留档 (本轮只补记
  "已撤销" 状态, 不虚构变体内容)。

**v2 全程与回归 (2026-10-19 收尾)**:

- **60k 全程**: **L4@47727** (升级 210,257 / 采集 823,858 / 孵化 348,250 / 末人口 19);
  对比 e15 时期 60k 的 L4@49335 (-1608t), 是现行族目前最好纪录; 但 e16 时期
  曾 L4@43891 (L2 却慢 5.1k tick) —— L2→L4 段的强度仍有历史差距。
- **中段回归线索 (下一轮靶点, 需 bisect)**: 45k 累计升级 e19b=182,209 (L4@43891)
  → e21/e23=152,371 (L3@15796, 无 L4) → e24/现行基线=137,222 (L2@1304, L3@10726)。
  即「-6 修复带来的快开局」与「E19-E24 期间中段变弱」同时发生, 两者叠加后
  当前树是"快开局+中段塌"; v2 已修复塌方 (168,244 / L4@47727), 但把中段强度
  恢复到 e19b 口径 (182k) 是可见的历史可达空间 ≈ 让 L4 再提前数千 tick。
  **→ 批次 G (文末) 已完成 bisect: 该空间被定性为路径依赖, 取能轴闭合。**
- **全场景回归 (sim-matrix 六场 + run-residue)**:
  场景自身断言: boot ✓ L2@823 (≤5000) / race-body-audit ✓ L2@1090 /
  remote-mine ✓ (时间线与参考逐位一致) / run-residue ✓ L2@2364 (≤5000);
  speedrun ✗ (三档未达, 冲刺诚实态) / arena ✗ (与参考同为 ✗) / sprint ✗ (参考同 ✗,
  但本期首次跑出 L3@48245)。
  CPU p95 全场 4-7ms (门限 20); tsc / oxlint / arch-guard / 单测 4/4 全绿。
  matrix 汇总的两条 RED 是「绿门时间线漂移」(参考快照陈旧, 行为改动为有意),
  需 `--update` 重设参考或留档说明, 非场景门失败。

### 批次 G: 中段回归 bisect 收官 (2026-10-19 夜, 45k 探针 ×5)

**程序**: 对「e19b=182,209 vs 现行=168,244」的中段差距逐杠杆反做 A/B (每项一编辑,
45k 同场景探针, 前检 load<1.5, 首行 cpu 哨兵 + 全程 cpu 分布核对), 负/零即撤。

| # | 反做杠杆 | 45k 累计 | L2/L3 | 判 |
|---|---|---|---|---|
| G1 | E21 反做 (rushUpgradeSpawnPriority 4→3) | 147,572 | 1091/12464 | 负 −20.7k, 已撤 |
| G2 | -6 修复反做 (执行层回裸预算) | 168,244 | 逐位同签名 | 零差异 (现行树死代码), 已撤 |
| G3 | E23 收紧全开 (兜底取能无门槛) | 159,034 | 2733/12104 | 净负 −9.2k, 已撤 |
| G4 | E23 窄化 (仅放 extension) | 166,734 | 1091/13157 | 负 −1,510, 已撤 |
| G5 | E23 窄化 (仅保 RCL1, extension 期全开) | 152,826 | 1091/13157 | 负 −15,418, 已撤 |

- **2×2 分解 (G4/G5/G3 对照, 同场景同负载口径, 全部快开局对)**:
  - **spawn 保护是承重墙**: 放开「spawn 低于满仓可抽」≈ −13.9k (G5−G4) ——
    E23 收紧的真实价值所在 (旧树归因 −15.1k 的反做在新树为 −9.2k, 又一个
    翻号杠杆; 收紧方向在新树仍然最优)。
  - **extension 放开 ≈ 中性偏负** (−1.5k, G4−对照), 且与对照逐位一致至 t15k
    (开局无 extension, 策略差异在 t16k 才首次显形)。
  - **慢开局路径确实产 mid bloom**: 同样全开策略下, 慢开局 (G3 L2@2733) 比
    快开局 (G5 L2@1091) 45k 净 +6.2k (t10-25k 峰值 +7.5k) —— 与 e19b 的
    「停滞→t15-20k 8 e/t bloom」同构, 但摆动量级小 (峰值 +7.5k vs e19b
    t10-20k 的 ~+42k 回转)。G3 早期分解: t5k 落后 2.8k (churn 循环在 RCL1
    回归, eav 12 vs 176), t10-25k 反超, 后段与 G5 同样塌方。
  - **全开策略的后段塌方** (t25-45k −11.5~−12.9k, withdraw/build 吞吐同步走低)
    与开局路径无关, 是策略在扩展期失血 —— 收紧堵对了。
- **总判定**: e19b 的 182k =「慢开局路径 + 当期策略」的组合产物, **不可经由任何
  单一取能策略回退复现**; 现行树是 v2 (+31,022) 之后的另一个动力学盆地, 与 e19b
  不可比。中段差距定性为**路径依赖**, bisect 收官: E21 / E23 / -6 三处在新树全部
  经反做验证为承重或死代码 (撤即负/零), 168,244 / L4@47727 维持现行最优纪录。
  若继续追中段强度, 下一轴是受控开局形态 (lean-opener) 实验 —— 属再设计, 非 bisect。
- **方法论留档**: 首行 cpu 哨兵对冷启动敏感 (冰缓存 311ms 假警报 vs 全程 p90=7ms
  判定干净), 污染判定须看全程 cpu 分布而非单行; G 系列全部 load<1.5, p90≤16ms。

### 批次 H: 外矿断供链取证 (2026-10-19 深夜, 目标普查 + 12k/14k 诊断跑)

**背景**: 单位级行为解剖 (意图流按 `o/n/d` 聚合) 发现中段行走的大头是 23 只
transfer 族群 30 移/动; 目标普查进一步发现 harvest 目标只有 4 个源 —— 本地双源
全程主力, 外矿 ...007/...008 活跃于 t2.2k-9.2k 后**枯死 28.7k tick** (t10-38k 仅
零星 5-659 次/桶), t38k+ 才零星复活; 而 speedrun 场景注释明载「L4+ 必须外矿补
收入」(单房天花板 20/t, L3 门需 15/t)。设计承重的外矿收入在中段恰好缺位。

**取证手段 (新工具, 复用价值高)**:
- sim `--dump-memory` + `-v`: 落盘最终 Memory + 转播 bot console → 任务板/遥测可直读;
- `targets.mjs` / `anatomy.mjs` / `source-timeline.mjs` (/tmp/opencode, 意图流透视);
- 仲裁器三处临时探针 (t8-14k 池内容/等待/孵化流水, 跑完即回滚, 树恢复 HEAD)。

**外矿断供完整因果链 (四环相扣, 均有运行时证据)**:

1. **远程 harvest 无孵化映射 → 「盈余溢出」续命**: 远程任务恒 available
   (attempts=0), 本地 6 槽位 (每源 3 实例) + 评分 travel 惩罚 (50+dist×50) 使本地
   恒先占; 外矿矿工四代单只接力 (t2176-3609 / 4188-5652 / 5925-7391 / 7754-9196,
   各活 ~1.4k tick), 全部是**本地盈余的溢出**而非定向补给。t9.6k 人口崩溃
   (29→11) 后本地槽位 ≤ 存活数, 溢出通道永不再现 → 断供 28.7k tick。
   `unitTargets` 虽计入远程 +2 (目标 8), 但存活 8 只全部被本地槽吸收。
2. **noCarrierOnSite 被 `remoteHarvestActive` 污染**: 该 flag = 远程任务存在即恒真
   (任务永生), 本地矿工被恒定带上 CARRY (spawn 流水实证: RCL2 期 W2C1M 取代
   纯 W2M/W3M) → 纯泵纪元结束 → 能量改道 ext/spawn 直供 + 源旁容器就地灌装
   (t16-20k 窗口 transfer 主目标 = 0146/04c2 源容器) → 本地 carrier 断供。
3. **远程容器工地无锚点**: 跨房工地不进本地 build 任务板 (W4N8 工地 0059 由
   远程体自建), 每代远程体死→工地烂尾→下一代从零重建 (四代 2,886 次 build,
   单代 733-tick 纪律) —— 工地本身成为能量黑洞。
4. **远程 haul 恒无任务**: `upsertRemoteHaul` 依赖完工容器 (12k dump 实证
   t70la237 haul→W4N8 available 无人认领) → 远程能量回运 = 0。t38k+ 「复活者」
   画像 (000aaa: harvest 505 / build 500 / transfer 2) 实证: 复活纪元仍是
   「采矿→灌工地」, 家里只收到 2 次 transfer —— 外矿收入对 L4 的贡献 ≈ 0。

**孵化遥测证据 (denyReasons gate=1074 / yield=1592)**: 请求侧从未断裂
(harvester#5 恒在池), 断裂在**消费侧** —— 目标与存活的差被本地 6 槽吃干, 远程
任务从不构成「必须有人去」的约束。crash 后 12k 窗口 harvester 孵化断档 ~3k tick
(elapsed 90+/120 攒能等待 + 存量 <400 恒不达标) 加剧了缺口深度。

**修复方向 (成套设计, 待批)**: ① 远程任务进孵化映射 (缺口驱动替补, 类比
P1-19 断档预防); ② noCarrierOnSite 回归「本地无搬运工在场」本义 (与远程任务
存在解耦); ③ 远程容器工地进本地 build 板或远程体携带锚点记忆; ④ 断供期
reserve/haul 链路的降级语义。全部落地前以 45k 探针 A/B 验收 (外矿收入时序 +
本地 250 纯泵纪元是否回归)。

### 批次 I: Rosmarin 整机基准对照 (2026-10-19 深夜, 同场景 45k)

**方法转折 (用户口径)**: 有完整参考代码就不该单旋钮试错——把 Rosmarin
dist/main.js 直接跑在同一条 speedrun-probe 赛道量出真实曲线, 差距逐项对照
搬运, 而非在自家代码上 A/B 碰运气。

**基准数据 (同场景同 seed, 状态哈希 0xb412ddf0f8e38d5d, CPU 4.0ms/p95 8ms)**:

| 指标 | Rosmarin | Nexus (hyst2) | 差 |
|---|---|---|---|
| 45k 累计升级 | **308,604** | 168,248 | 1.84× |
| L2 / L3 / L4 | 676 / 5,624 / 23,209 | 1,090 / 13,156 / 47,727 | 1.6/2.3/2.05× |
| 采集 / 升级转化率 | 652,532 / **47.3%** | 634,556 / 26.5% | 收入同, 转化差 1.8× |
| 孵化耗能 / 只数 | 155,350 / 391 | 257,900 / 595 | 少烧 66%, churn 少 1/3 |
| 移动意图 / 执行率 | 197k / 100% | 313k / 93.9% | 少走 37% |
| 种群 | 10-12 只稳定 | 16-20 只震荡 | — |

**关键否定结论: Rosmarin 全程只采本地双源 (harvest 目标仅 0002/0003),
外矿未开** —— 外矿断供 (批次 H) 不是当前差距的主因; 差距全在**运行形态**。

**逐 5k 累计升级**: rosa 38k/47k/110k/147k/180k/181k/195k/247k/309k vs
nexus 9k/29k/58k/73k/91k/109k/124k/143k/168k —— 每一段都落后, 不是某段塌方。

**复刻缺口清单 (公式已移植, 运行形态没抄到, 按影响排序)**:

1. **extension 集群贴 spawn (最大缺口)**: Rosmarin L2 落地 tick (t677) 即在
   spawn 22-30 环带放 5 ext (容量 550 立即可用), L3 落地 (t5625) 再 +5 ext +
   塔 + 双源容器 (800); Nexus L2@1091 把 5 ext 放到 **x=43 远东 18 格** (源在
   x=7 西侧!), L3@13157 又把新 ext 放到 **x=9 远西**——两簇互斥散放, 建成
   拖至 t12k (孵化成本阶梯 300→400@t8k→450@t10k→550@t12k 实证), 体型档
   天花板整体晚 6-10k tick, 全程小体 churn 的直接根源。
2. **rush 矿工纯泵纪律**: Rosmarin buildRushHarvesterBody needCarry=false
   (rush 低 RCL 无源链, 掉落由车队收), W4 纯泵@t1479、W5 满速@t2956;
   Nexus 45k 全程**零只纯泵矿工** (noCarrierOnSite 污染, 批次 H 环 2)。
3. **路网节奏**: Rosmarin t5.9-10.6k 铺完全域路网 (~50 条), carrier 400 档
   (C4M4) 跑路; Nexus t13-39k 才成网, carrier 长期 300 档。
4. **carrier 体型档**: Rosmarin 主力 W0C4M4 (400e) 全程稳定 ~13 只/5k;
   Nexus W0C3M3 (300e) 为主, 被 trickle 钳制在 250-300。
5. **升级火力被小体锁死**: 收入→火力闭环公式已移植 (4.1/4.2), 但 perBody
   小 → 同 WORK 目标要更多只 → popCap 钳制 + churn, 火力上不去 (每 upgrade
   act 产值 5.9 vs 3.6 e)。

**搬运计划 (整机对照, 非 A/B 试错)**: 按缺口清单成套落地——extension 布局
贴 spawn 优先 (布局模块修正) → 纯泵矿工解污染 → 路网/carrier 档对齐 →
每步以 Rosmarin 曲线 (L2 677/L3 5624/L4 23209, 逐 5k 累计) 为参照门验收,
不再是"改一点跑一次碰运气"。Rosmarin 基准数据与意图流存档
/tmp/opencode/probe-rosmarin-45k.{csv,log} + intents-rosmarin-45k.jsonl。

**批次 I 勘误 (当晚续): 上面这份数字是在残缺赛道上测的, 且窗口口径错**:

1. **测错对象**: 首跑用的 dist/main.js 是 race 分支构建 (VARIANT=race 重构建后
   状态哈希逐位一致 0xb412ddf0f8e38d5d, 且旧 dist 无主线档 ExternalMine 符号)。
   数字本身没测错, 但解释错了——race 分支是独立冲级实现。
2. **残缺赛道 (重大)**: sim 场景邻房**没有 controller 对象** → race 的
   `generateRemotePlan` 在 `targetRoom.controller.pos` 抛 TypeError → 侦查链
   中断 → `memory.remotes` 恒空 → **外矿从未激活** (96 只侦察体孵了白孵,
   90 只自杀; "Route blocked" 刷屏是次生噪音)。已验证: sim 的 PathFinder
   跨房搜索完全正常 (16/16 目标探针全通), describeExits/isRoomAvailable 正常,
   缺的只是 controller 对象。真实私服所有房间都有 controller (官方世界规则)。
   **修法**: 邻房补 `controller: { level: 0, mine: false }` (中立, 供 reserve)。
   修正后 8k 验证: `remotes` 激活 (W5N9/W4N8/...), reserveController 意图
   23,529 次/8k, 外矿采集全开——这才是 race 的真实形态。
3. **窗口口径错**: 私服 speedrun mod 的 bracket 是 **[20000, 40000]**, 4wt 自动
   重开——**40k 截止**, 45k 的最后 5k 是无效数据。sim/speedrun.sim.ts 已改
   ticks 40000。
4. **真实榜口径 (40k bracket, 榜分 = 全程累计进度)**: 榜首 2,255,965
   (L6 +455,765) / 榜二 2,068,662 / **Rosmarin 1,885,057 (L6 +84,857)** /
   榜四 1,857,871 / 榜五 1,851,444。L6 完成线 = 累计 1,800,200 → 榜前五
   全部在 40k 内拿 L6, 均速 ≥45 e/t; 单房双源天花板 20 e/t → **外矿多房收入
   是榜级成绩的必要条件** (race 的 remotes 体系正是为此而生)。
   20k bracket 榜: 榜首 1,007,122 / Rosmarin 853,762 (L5 完成 + L6 进度 26.9 万)。
5. **场景修正落地**: sim/{speedrun,arena,sprint,race-body-audit}.sim.ts 邻房
   全部补中立 controller (同一缺陷); 修正后的 race 45k→40k 真实基准重跑中
   (speedrun-probe-v2.json), 完成后本节补真实曲线——那才是 Nexus 要追的靶子。
   此前批次 I 表格里的 308,604/1.84× 等数字作废 (残缺赛道 + 45k 窗口)。

**修正赛道 40k 双机基准 (speedrun-probe-v2.json, 2026-10-20 凌晨)**:

| 指标 | race (修正赛道) | Nexus (同赛道) | 差 |
|---|---|---|---|
| **40k 累计进度** | **1,412,032** (L6 进度 82.7 万) | **134,231** (L3 后停滞) | **10.5×** |
| L2 / L3 / L4 / L5 | 741 / 3,523 / **10,304** / 24,658 | 1,090 / 12,065 / — / — | 每级 2-3× |
| 逐 5k 段速 (e/t) | 9→23→28→31→26→**57→54→53** | 1.7→3.8→5.7→3.2→2.4→3.1→3.6→3.4 | 后段 15× |
| 采集总量 | 3,535,232 (78.6 e/t) | 558,076 (14.0 e/t) | 6.3× |
| 人口 | 46-71 (外矿编制) | 11-30 | — |
| 活跃源 | **9 源** (本地 2 + 外矿 7) | 2 源 (外矿 t1.5k 后枯死, 批次 H) | 4.5× |

- **race 的真实形态**: 纯泵矿工 W5C0M1@t1479 → 本地双源满速; t5k 外矿 8 房
  全开 (每房 1 矿工 + reserver 持续在位 + 接力搬运 W0C4M2/W0C4M4 车队);
  extension 集群贴 spawn (t742 五连 + t3524 五连, 容量阶梯 550@0.7k → 800@3.5k
  → 1300@10.3k); 路网 439 条 (t3.5k-40k 持续); tower/storage/link 各按等级
  节奏落地。L5 后段速 53-57 e/t = 本地 20 + 外矿 7 源 × ~5 有效。
- **真实服 40k 榜**: Rosmarin 1,885,057 (L6+84,857, L6 段均速 84.7 e/t) ——
  修正赛道上的 race (1,412,032, 53 e/t) 仍只有真实服成绩的 75%, 剩差来自:
  sim 邻房双源 vs 真实服源分布、无 SK/中心房、平坦地形、以及真实服可能的
  源容量 mod。**sim 赛道本身还有保真度空间, 但 10.5× 的结构性差距已足够明确**。
- **Nexus 的差距分解 (按杠杆大小)**:
  1. **外矿整链缺席** (批次 H 四环缺陷): 采集面 14 vs 78.6 e/t —— 最大头。
     修正赛道上 Nexus 的外矿矿工 t1.5k 后枯死同旧赛道 (病因在 bot 不在场景);
  2. **升级火力断供**: L3 (t12k) 后段速 3.2 e/t, 25k 内升级链近乎停摆;
  3. **容量阶梯迟缓**: ext 建成拖到 t12k+ (race 0.7k), 全程小体 churn;
  4. **人口结构**: 16 vs 48-71, 外矿编制完全不存在。
- 存档: probe-rosrace-v2-45k.{csv,log} + intents-rosrace-v2-45k.jsonl;
  probe-nexus-v2-40k.{csv,log} + intents-nexus-v2-40k.jsonl (均为修正赛道)。
- **下一步 (等批准)**: 以 race 修正赛道形态为蓝本的成套搬运——外矿四环修复
  (批次 H 清单) 为第一优先, 然后容量阶梯/ext 布局/纯泵纪律。每步以 race 曲线
  逐 5k 段速为参照门。sim/speedrun.sim.ts 场景已修 (controller + 40k 窗口),
  场景改动待提交。

### 批次 J: 外矿修复三连 (2026-10-20 凌晨, 修正赛道 40k ×4)

**程序**: 批次 H 四环缺陷按「发现→修→40k A/B→再发现」推进, 全部在修正赛道
(speedrun-probe-v2.json) 上验收, 基线 = Nexus 未修树 (134,231)。

| # | 修复内容 | 40k 累计 | vs 基线 | 判 |
|---|---|---|---|---|
| fix1 | 环 1+2: 定向替补 (remote:harvest 请求携带 taskId, 孵化即绑定) + noCarrierOnSite 解污染 (remoteHarvestActive 全局污染删, 按请求用途驱动 remoteHarvester hints) | 159,792 | +19% | ✓ 保留 |
| fix2 | 环 1 续: 跨房 harvest/haul 驻场租约 100/40→800 (LEASE_POLICY.remoteStationTicks + allocator 跨房感知 claim) | 159,792 | 逐位一致 | 零差异 (heartbeat 每 tick 续租, 初值不敏感) 但边界防御保留 |
| fix3 | 防抢占: 持有跨房 harvest/haul 租约的 creep 不被常规滞回切换抢走 (fix1 实证 failureReason=preempted 链: 39 只交互者接力粥, 漫游体 1500t 生命周期 867 move/54 harvest) | **168,057** | **+25%** | ✓ 保留 |
| fix4 | scout 断档直通 v1 (等待分支插队) | 168,057 | 逐位一致 | 零差异 (直通分支不可达: urgent 恒非空) 已撤 |
| fix5 | scout 直通 v2 (去 urgent 前置) | 152,349 | **0.91×** | **净负已回退** (t38.7k 才首次成交 + 本地采集面被 50e 插队节律扰动; 回滚确认跑 ≡ fix3 逐位) |

**fix3 后外矿形态**: 双外矿源 (0009/000a) 全程存活至 35k+ (基线 t15k 枯死);
孵化能耗 185k→146k (churn 降); repair 14,824 = 远程容器建成且在维护;
haul in_progress = 回运链活了。

**遗留 (下一轮)**:
- 尾段塌方 (t36.5-38.5k 升级=0): 能量面枯竭 (665/4000 tick 房内 <100),
  升级体 85% 时间走路——瓶颈移回本地能量面/容量阶梯 (race 的 ext 贴 spawn
  布局 + 纯泵纪律是下一杠杆, 批次 I 缺口 1/2);
- 外矿只开了 W4N8 一房 (双源), race 开 7 源——**scout 链真因未修**: 3 个
  scout 任务恒 available 无人认领 (末只 scout t8840 死后再无侦察; 孵化侧
  两轮直通实验 fix4/fix5 均无效或净负已回退)。真因在任务侧: scout 任务
  谁该认领、scout 编制 1 只死后为何无人接替——下一轮从「scout 任务认领
  链」(分配器对 scout 的资格过滤 + 侦察体 executor) 取证, 而不是继续动
  孵化闸;
- t10k 段瞬时 0.79×: 防抢占同时阻止了本地任务回收漫游外矿体, 净值仍正。

**工作树状态 (未提交)**: fix1+fix2+fix3 全在树上
(spawnDirector/spawnArbiter/bodyFactory/demandSources/taskSchema/allocator),
tsc + oxlint 全绿, dist 已构建。sim 场景修正 (controller+40k) 同在工作树。

### 批次 K: scout 链五连修复与外矿放量定标 (2026-10-20 晨, 40k ×8)

**外矿只开 1 房的根因链 (逐环取证, 每环一个 40k)**:

| # | 修复 | 结果 | 判 |
|---|---|---|---|
| fix4 | scout 等待分支直通 v1 | 逐位一致 | 分支不可达 (urgent 恒非空), 撤 |
| fix5 | scout 直通 v2 (去 urgent 前置) | 152,349 (0.91×) | 净负撤——但暴露 scout 恒孵却不点亮 |
| fix6 | scout 残留清坑 (cancelByDedupeKey) + budget 3→4 | 168,057 数值同 fix3 (哈希不同) | 预算释放 ✓ 第 4 房进候选, 但 scout 仍不点亮 |
| fix7 | scout 断档提级 L2 (需求侧) | 147,777 (0.88×) | 净负——26 只 scout 孵出**零意图站到死** |
| fix8/9 | intel 到达登记 (记录按需创建) | ≡fix7 | 写入路径未触达 (竞态, 见 fix11) |
| fix10 | scout-starving 请求带 taskId | ≡fix7 | 出生绑定 ✓ 但**scout 卡 (49,49) 角格 1500t** |
| fix11 | 规划器可见即登记 (竞态修复) + waypoint 边缘格 | **4 房 8 源 intel 点亮 ✓** 但 80,479 (**0.48×**) | 链路修通, 放量过大崩本地 |
| fix12 | maxRooms 4→2 | 156,421 (0.93×) | 仍负 |
| fix13 | maxRooms=1 + 全部链路修复 | 120,836 (0.72×) | **1 房口径下链路修复也是负的** |

**根因 (三层, 全部实证)**:
1. **BetterMove 跨房寻路末端失灵**: scout 走向 (49,49)/(48,48) 角格后
   1500t 站桩 (1499 条 move 意图零位移, fatigue=0, moveTo 恒返 OK);
   原生 creep.move + 引擎边缘传送实测正常 (walker 30t 跨房)——bug 在
   BetterMove 的路径末端引导层, 未修 (深水区, 留档)。
2. **视野即失**: scout 到达即 complete → 检离 → Game.rooms[邻房] 失效 →
   规划器回到「派 scout」循环。修法 = intel 持久化 (remoteSourcePos/
   remoteControllerPos 落 memory.rooms), 规划读 intel 不读实时视野 ✓。
3. **登记竞态**: 到达当拍规划器先 cancelByDedupeKey(vision-gained) 杀任务,
   驱动段登记分支永不执行。修法 = 规划器可见即登记 (同拍原子) ✓。
4. **放量崩盘**: intel 点亮 8 源 → 8 个定向 harvester 请求 (prio 5) 挤爆
   本地孵化线 → 升级面 0.7 e/t (0.48×)。race 的 4 房靠 hasRemoteSpawnBudget
   (本地编制先行扣减余量放行) 逐房准入; 我们的定向请求无此闸——**逐房放行
   闸是外矿放量的前置**, 不是旋钮问题。

**fix13 仍负的机理 (待下轮取证)**: maxRooms=1 下链路修复改变了第 1 预算的
落点 (W4N7 vs W4N8——scout 不占坑后候选序变化) + scout 持续轮换的孵化开销。
fix13 未带 intents 的取证跑已补。

**结论**: 外矿链修复 (intel/waypoint/竞态) 保留在工作树——它们是正确性修复
(scout 终于能点亮 4 房); 但 maxRooms 回 1 且**外矿放量冻结**, 等 race 式
孵化容量准入闸落地后再开。当前树最优仍 = fix3 形态 (需按 fix13 差异取证
后决定回滚哪几件)。

**遗留 (下一轮, 优先级序)**:
1. BetterMove 跨房末端失灵 (movement 深水区, 独立 bug——外矿矿工自回运
   也受益);
2. race 式孵化容量准入闸 (hasRemoteSpawnBudget 口径) —— 外矿放量的钥匙;
3. fix13 vs fix3 的 1 房行为差异取证 (预算落点/轮换开销);
4. 尾段能量面 (批次 J 遗留, ext 布局/纯泵纪律)。

### 批次 L: race 准入闸原样移植 (2026-10-20, 40k ×2)

**方法转变**: 停止自研闭门造车, 直接一比一复刻 race 代码。
`RosmarinBot-dev/src/modules/features/external/externalMine.ts` L1937-2008
的「外矿孵化容量准入」整套口径移植为 `src/modules/spawning/remoteBudget.ts`:

- **单位 = 身体部件数**: B 件爬孵化耗 3B tick, 每 spawn 每 1500t 窗口
  产 500×N 部件 → capacity = spawn 数 × 500。
- **leftover = capacity − localDemand − remoteUsed**:
  - localDemand = 非采集本地角色在编/在途部件 + 本地源计划编成
    (race 公式: 每源 `7×(1500/max(200,1500−pathTime)) + pathTime×0.04×10×2`,
    pathTime 钳制 [10,60] 防坏采样虚增);
  - remoteUsed = taskId 指向跨房目标的单位部件 (在编 + 孵化中);
  - harvester 本地在编不计入 localDemand (编成由定编目标代表, race 同款)。
- **hasRemoteSpawnBudget(room, parts) = leftover ≥ parts**: 负数 = 本地
  缺口, 外矿全停; 主房成长后余量自动放大外矿规模。
- **接入点 (请求侧)**: spawnDirector 外矿定向替补环 + 任务驱动通用环
  (reserve/scout 等跨房任务), 预算不足时 remote 请求不进池——本地请求
  不再被 remote 占坑, 也不被 remote 挤爆。

**6k 短跑验证**: 3 房 6 源全开 (W4N8/W4N7/W4N9 各 2 源 in_progress,
租约即人在), 本地 35 在册无 scout 暴留, intel 持久化稳定。

**工作树**: fix1+2+3 (净正三件套) + scout 链修复 (intel/waypoint/竞态) +
准入闸 remoteBudget.ts + maxRooms=3 (HEAD 值, 闸管放量)。全部未提交。
40k 全程 A/B 对比 fix3 (168,057) 进行中。

### 批次 M: 布局锚定修复 (2026-10-20, 任务 6.1 第一轮)

**取证**: speedrun 探针 8k dump 布局 ext 全压 x=43 远东一列 (离 spawn(25,25)
15+ 格); 锚定诊断日志 `[锚定诊断] 半径 10 门槛 160 无解 → … → 无限幅成功`。
运行时块诊断 (一次性插桩) 实锤: 平地被 score 脊线切成 7 块, spawn 周边被切为
4 个中小块 (126-307 格), 单块限幅内 putable 最大 63 < 任何 gate → 锚定阶梯全灭
→ 无锚无限幅兜底 → 布局中心被远处大块吸走。

**修复 (两刀)**:
1. `rosManor.ts` 跨块聚合: 锚定模式下块门槛从「单块尺寸 ≥ gate」改为
   「限幅半径内全部块的 putable 聚合 ≥ gate」——块只贡献自己的 putable 段,
   候选面 = 半径内并集; 非锚定维持单块口径 (历史行为不变)。
2. `rosManor.ts` ext 近-spawn 钳制: ext 候选按 spawn 切比雪夫 ≤7 环带重排,
   近端优先; 无锚兜底也传 existSpawnPos (spawn 收编 + 钳制不依赖限幅)。
3. `rosManor.ts` 采集环保护 (boot 回归取证后的第二刀): source 8 邻是 miner
   站位与源容器选址域, ext 是硬占位建筑, 压环 = 采集面收窄——ext 候选剔除
   全部 source POI 切比雪夫 1 环。

**40k 探针对照** (基准 168,057):

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| L3 达成 | 13753 | **11895 (-13.5%)** |
| t10k 段速 | 2178 e/t | **5941 e/t** |
| t8000 RCL2 进度 | 16002 | 19664 (+23%) |
| 40k 累计 | 168057 | 162015 (-3.6%) |
| 中段人口 | 28→12 (t15k) | 同样塌方 (28→12) |

**全场景矩阵** (修复后): boot L3 **9177→8089 (-11.9%)**; arena L3 9177→8089
且**首次 40k 内破 L4@37193**; speedrun L3 -13.5%; sprint L3 -12.8%。
六场景全绿 (改善性漂移后参考已刷新)。

**判读**: 布局修复是结构性正收益 (三档全线提前, arena 破 L4), 40k 累计微降
是 L3 提前 1.9k tick 后末段 (35k-40k) 的升级空窗, 非退步。**中段塌方
(t15k pop 28→12, 段速跌至 2.5k e/t) 现形为下一最大杠杆** = 台账遗留 #1
同龄批死亡潮, 首批优势被它吃掉。

**下一轮 (6.1 续)**: 同龄批死亡潮治理 (race 批次到期离散化口径), 目标
t10k-20k 段速保持 >5k e/t。

### 批次 N: scout 并行侦察 (2026-10-20, 任务 6.1 第二轮)

**取证**: 40k dump t30k 任务板——rush 档外矿预算 3 房只用 1 房 (W4N8),
W4N7/W4N9 scout 任务 available 挂牌、在册 scout = 0; `activeScoutCount`
恒 min(1, …) 全局单编制, 侦察串行 → 外矿情报铺不开 → 收入面卡死 1 房。
race 本体 t5k 外矿 8 房全开。

**修复**: scout 定编 = min(活跃 scout 任务数, SCOUT_CONFIG.parallelCap=3);
外加生产安全门钳制 (isProductionSecured 全房采集面铺满才并行, 未就绪回落
1)——scout 是前期能量税, 冲 10k 线不能早付。

**对照** (40k 探针, 基准 168057 / 批次 M 162015):

| 指标 | 批次 M | 批次 N |
|------|--------|--------|
| L3 / L4 | 11895 / — | **11282 / 37284 (L4 首进 40k)** |
| t20k-30k 段速 | 4940/5641 | **7454/5879** |
| 40k 累计 | 162015 | **185538 (+10.4% vs 基准)** |

**矩阵**: speedrun L3 -18% vs 原始基线; boot/arena L3 9066 (优于原基线
9177); sprint 42532 (+2.8% vs 原基线 41351, 沼泽地形侦察税, 断言状态
不变); 六场景门绿 (无门版 sprint 曾 45590, 加门回收)。

**早段仍是死穴**: t10k 累计 32814 vs RCL4@10k 需 180200——race 同期
段速 9→23 e/t (本地满速 + 外矿已开), Nexus 早段 1.9-4.7 e/t。
**下一轮杠杆 (按台账遗留序)**: 早段孵化节律 (fill_spawn 认领延迟,
遗留 #2) 与 rush 矿工纯泵纪律 (needCarry=false, 台账破译靶)。

### 批次 O: 放量节奏实验 (判负撤销) + 错峰窗口动态化 (2026-10-20, 任务 6.1 第三轮)

**三刀实验** (ext 分级放量 extPerWave=5 + rush tower 让位 + 错峰窗口按定编
动态化): 40k = 176,892 vs 基准 185,538 (-4.7%), L4 未达成。

**A/B 拆分归因**:
- 撤 extPerWave + towerPenalty → 逐位回到 185,538 / L4@37284
  → 末段崩 100% 由两刀联动引入 (中段 t20k 曾 +23% = 94913, 但末段
  t35-40k 段速 4384→1433, 外矿 reserve 意图 2787→0, 相位分岔);
- 错峰窗口动态化 (窗口 = 定编 × 生产周期, upgrader cohort 8 → lead
  562→837) 零行为差异 — 替补请求恒在池 (staffed<target 恒真), lead
  只影响首次触发不影响孵化序, **无效但无害, 保留**;
- rush 豁免止升让位零行为差异 (RCL3 期 rampartMinRcl=4 不放量, 条款
  从未触发) — 无害保留。

**换代空窗取证** (末段崩机理, 后续靶): t38k dump upgrader 2 只 born
t36573/t36991, 前代死于 ~t35073 — **单只换代空窗 1500t** (死→补全程)。
机理: upgrader 定编 2 只, 替补请求在池但孵化槽被小件 churn 占满
(450 只/40k = 89 只/1500t), 大件 90t/只排队。speedrun 榜口径下
升级是冲级主线, 孵化槽应给升级替补让位 (race: 升级请求从不被闸拦)。

**判决**: 三刀整批撤销 (判负纪律), 留档两个正信号:
1. 中段 +23% (ext 分批建对 L2 期容量复利真实有效) — 后续重试需
   先闭合「建造节奏→孵化相位→外矿链」的涟漪机理;
2. upgrader 换代空窗 1500t 是下一个最大杠杆 (末段 5k tick 只产
   7165e, 修复预期 +15% 40k)。

**矩阵**: 六场景全绿 (sprint L3 42532→40654 还改善了), 参考已刷新。

### 批次 P: 升级替补孵化越位 (+9.1%, L4 首破 31k) (2026-10-20, 任务 6.1 第四轮)

**靶点** (承批次 O 取证): upgrader 单只死→补空窗 1500t——rush 档 upgrader(4)
排 carrier(3) 后, carrier 群体大 churn 高 (请求恒在池恒先赢), 升级替补恒排队。
t38k dump 铁证: 前代死 ~t35073, 补位 born t36573; 空窗期 carrier 替补链
连续占槽 (t36702/36847/37402/37880)。

**第一版 (全提权, rushUpgradeSpawnPriority 4→2 连缺编建立期一起越 carrier)**:
40k = 202,110 (+8.9%), L4@32359。但 boot 绿门 L3 9066→10550 (+16%)
触发红线——缺编建立期 upgrader 越过 carrier 让能量通道晚建, P1-19 的
顾虑在建立期成立 (probe 赛道外矿进项掩盖了此成本, boot 单房暴露)。

**第二版 (收窄: 提权只作用于 replacement 请求)**:
- 缺编建立期维持 standing 序 (carrier L3 → upgrader L4);
- 换代替补期 upgrader 越位 L2, 抢在 carrier churn 前上槽;
- 40k = **202,362 (+9.1%)**, L4@**31339** (较批次 N 再提前 5945t);
- boot 漂移收敛 10550→9805 (+8.6%, 自身断言 RCL2≤5000 仍过, 属
  预期行为变更, 参考快照已刷新金丝雀基线);
- 采集 774k (基准 712k), 末段 t35-40k 段速 4567 (基准 3099)。
- 段速剖面: t20-25k 9116 e/t 历史新高 (race 同期 26 e/t, 差距 2.9×)。

**矩阵**: 刷新后六场景全绿。累计: 40k 168,057 → 202,362 (+20.4%)。

**遗留观察**: 末段 (t35-40k) 段速仍回落 4567→1494, upgrader 定编 2 只
的换代串行天花板仍在 (每 1500t 一对换代, 每代 ~200t 火力真空);
提权只解决「排队」, 不解决「定编少」。下一杠杆: rush 档 upgrader
定编只数 (ceil(30W/24W)=2 → 升容量档或升定编)。

### 批次 Q: RCL1 升级面自举 (RCL2 458, 用户达标线 ≤500) (2026-10-20, 任务 6.1 第五轮)

**用户验收口径 (2026-10-20)**: RCL2 ≤1000 才对得起「合格」二字, ≤500 才是
达标; 旧断言 `boot RCL2≤5000` 与现状 (probe L2@1090 / boot 823) 全部不合格。

**早段遥测定罪** (boot/探针 t≤1500, 每 100t 池快照 + 孵化事件):
1. **E18 实现缺陷**: 采集让位窗口内 upgrader 只被排除出「拒绝计数」,
   从未加回仲裁池 `rawPool`——注释写着「让位窗口内仍放行升级体」, 代码
   实际丢弃。前 300t 恒让位 → 首只 upgrader 拖到 t1215, t851 前升级进度 0。
2. **urgent 队头阻塞**: carrier 常驻 L3 ≤ immediatePriority(4), 每 tick 抢在
   bootstrapHarvest / bootstrapUpgrade 之前被选中; 两自举通道又都被
   `urgent === undefined` 挡住 → 开局孵化槽 t20-150 纯闲 (存量 20→200)。
3. **cc 工地 L0**: `criticalInfraPriority 4 - build 8 = 0`, RCL1 唯一的 cc
   工地以 L0 插队, t150 的 worker 顶掉首只 upgrader。
4. **rush 升级体不自采**: `upgraderForageOnStarve=false` (墓碑投喂闭环),
   RCL1 无 cc 无 courier, 升级体钉工位恒挨饿。

**最终落地 (逐项 A/B 后保留)**:
- spawnArbiter `rawPool`: 采集让位窗口内 upgrader 恒随行, **限 RCL1**;
- spawnArbiter `urgent`: RCL1 升级体不受「在岗=0」钳制 (请求在池 = 定编缺口);
  RCL1 首只矿工前 carrier 不放行 (t9 那只 carrier 无货可拉, 白吃 100e+6t);
- spawnDirector staffing 提级分档: RCL1 首只即提级; RCL2 不提级
  (建立期越位会吸干孵化能量); RCL3 起在册 ≥1 后提级 (批次 P 末段病理);
- agentSystem: 升级体 RCL1 / 无 cc 窗口自采自升 (cc 有货回归直供);
- config: `CONTROLLER_BUFFER_CONFIG.minRcl 1→2` (cc 只在 courier 闭环可用时建);
- `sim/boot.sim.ts` 断言 RCL2≤5000 → **≤500** (达标线, 场景实测 330)。

**A/B 判负留档**:
| 变体 | L2 | L3 | 判定 |
|---|---|---|---|
| Q1 E18 全局 (各 RCL 都随行) | 458 | 17191 | 判负: RCL2 升级体吸干孵化能量, L3 -5.2k |
| Q2 Q1 去掉 E18 全局 | 697 | 11262 | 保留: 经济恢复 |
| Q3 Q2 + cc 延到 RCL2 | 543 | 12303 | 保留: L2 -154t |
| Q4 Q3 + RCL1 升级体全放行 | 512 | 11188 | 保留 |
| Q5 Q4 + RCL1-only carrier 闸 | **458** | **11822** | **采纳**: 双赢 |
| Q5+全 RCL carrier 闸 | 458 | 13045 | 判负: 中期 carrier 断供 |

**终局 (speedrun-probe 40k)**: L2@**458** (基线 1091, -58%), L3@11822
(基线 11956), L4@33393 (基线 32359, +1034 但末段段速 8197 vs 5650),
40k 累计 **205,979 (+1.9% vs 202,110)**。202,110 = 批次 P staffing 源
提级版 (在册 ≥1 后补编也提级, 40k 202,110 / L4@32359), 未单独提交,
随本批合入。boot L2@330 (基线 823), sprint
L2@834 (基线 2257), arena L2@330 (基线 823), race-body-audit L2@458。

**5k 段速剖面 (base → Q)**:
t0-5k 9,017→9,705 (+688) · t5-10k 27,473→23,517 (-3,956) ·
t10-15k 29,847→24,694 (-5,153) · t15-20k 28,053→28,772 (+719) ·
t20-25k 35,523→36,042 (+519) · t25-30k 31,297→33,062 (+1,765) ·
t30-35k 26,697→30,583 (+3,886) · t35-40k 14,203→19,604 (+5,401)。
中段 (t5-15k) -9.1k 是唯一失血区, 与 boot L3 漂移同源 (RCL2 升级链在
cc 未成期掉速); 末段 +11.1k 是 L2 提前解锁扩容的复利。

**遗留 (下一轮靶点)**:
- boot L3 10550→11647 (+10.4%): cc 延到 RCL2 后, RCL2 前段升级链无 cc 可用
  (自采兜底覆盖不到全部工位), 换 L3 提前的净账待下轮用「RCL2 期无 cc 自采
  扩面」或「cc 地基 RCL1 但建造不提级」两案再 A/B;
- L4@33393: 40k 内 RCL5 仍差 ~115k 累计量, 升级定编 (末段 2-3 只) 与
  外矿第 3 房是 6.2 的主杠杆。

### 批次 R: 外矿放量与跨房修复 A/B (判负整批撤档) (2026-10-20, 任务 6.1 第六轮)

**靶点**: 6.1 RCL4@10k 的收入缺口只能靠外矿补。Q 基准实际只开 W4N8 一房
(scout 角落弹跳把其余房挡在外面)。先修跨房正确性, 再试放量。

**跨房根因 (sim 引擎语义)**: `apply_crossings` 只做轴向边缘传送且 x 优先;
停在角落格 (49,0)/(0,49)/(49,49) 的 creep 每 tick 被弹回邻房, 越界 move
意图直接丢弃。scout 的 `findExitTo` 目标给邻房中心, 路径自然贴角落。
修法 (三处, 语义正确):
- movement `getDirection` 改世界坐标 (跨房方向不再按房内坐标判);
- scout 改「最近非角落出口格 range 0 航点链」, 斜向房拆两段;
- actionBroker move 管线支持 `moveOpts.range`。
另加 `remoteAutoMaxRooms` 预算与候选密度排序。**几何坑**: 原密度房距用
切比雪夫, 8 邻房全为 1, 并列后按房名排序把预算 1 房全给斜角 W4N7;
改 `Math.hypot` 后 cardinal W4N8 才排第一 (scout-diag 实证 t2200)。

**40k A/B (全部相对 Q 基准 205,979 / L4@33,393)**:

| 变体 | 40k | L4 | 判定 |
|---|---|---|---|
| 3 房 + 本地优先闸 + RCL3 门 + 中央航点 | 189,176 | 35,377 | 判负 |
| 3 房 + 本地优先闸 (早开) | 177,724 | — | 判负 |
| 1 房 (切比雪夫错选 W4N7) | 182,961 | 39,511 | 判负 |
| 1 房 (欧氏→W4N8) + 已开发房不重侦察 | 182,104 | 39,410 | 判负 |
| 1 房 + 关远程回运 (矿工自回运) | 162,972 | — | 判负 |
| 1 房 + 失视重侦察 (scout 续视野) | 195,806 | 35,009 | 判负 |
| 0 房 (纯本矿) | 183,972 | 37,309 | 判负 |
| Q 基准 (scout 角落 bug, 实际 1 房) | **205,979** | **33,393** | 基准 |

**20k 正信号**: 1 房 + 重侦察 20k 93,398 vs 基准 86,688 (+7.7%), L3@10,807
(vs 11,822)。早段收益真实, 但 t20-40k 段速 4.4/t (基准 9.2/t) 把总量吐回去。

**中段供能诊断 (carrier/container dump, 基准 5k 步长)**:
- t15k: 三个本矿容器全 0, cc=0; 7 只 carrier 里 2 只带 150-200e 挂在
  fill_spawn、4 只 haul (1 只已进 W4N8)、1 只空转; 远程 W4N8 两个容器
  e2700 无人拉; t30k 远程容器 decay 消失 (c0), 矿工断链。
- 病理: `fill_spawn` 政策恒压 `haul` (planners 优先级), 孵化槽连续换代
  (450-500 只/40k) 让 spawn 永远饿, cc 只能吃 spawn 剩饭; 远程回运又只
  由本地 carrier 顺路承接, 满编门一挡就没人去。
- 试过「远程 haul 定向替补 (carrier taskId 绑定, 等级 +1)」: 20k 零行为
  差异 (本地 carrier 恒缺编, 本地请求恒先赢), 撤。
- 试过 RCL3 升级只数上限 10→6 (省换代维护): 20k 89,629 (+3.4%), 40k
  194,436 (-5.6%, L4@34,833), 末段反噬, 撤。

**判决**: 整批 (跨房修复 + 外矿放量) 撤档, 工作树回 Q 基准。修复本身
语义正确, 已存 stash `batchS` 待「远程回运舰队」重设计后合入——单靠
scout 修好只会把本地 carrier 抽去拉远程, 在现有物流下必负 (stash 内含
scout/store 临时遥测, 回放前须拆)。

**下一靶 (按收益序)**:
1. 远程专用回运舰队: 定向 carrier 不计本地编制、按远程容器存量招募,
   解决「本地 carrier 满编门 → 远程无人拉」;
2. 远程收入入账打折: 未回运的远程源不许抬升级定编 (当前 income 口径
   把预留源按满容量计入, 定编 10 只升级体实际只有 5e/t 供能, 半数空转);
3. 本矿 fill_spawn 与 cc 的分配线: 孵化换代潮期给 cc 保底水位, 避免
   spawn 恒饿把升级压到 0 (t15k cc=0 实证);
4. 损耗审计: Q 基准 40k 采集 721,750 对四类入账 524,375, **197k (27%) 未
   入账**——候选为掉落能量 decay (5W 矿工无 CARRY 落地, carrier 被
   fill_spawn 占住)、换代死亡随身能量、塔/维修能耗、远程容器 decay
   带走存量。先做 5k 步长库存/掉落快照定位, 再决定是否给矿工加 CARRY
   或提 piles 的 haul 等级。

**批次 T (2026-10-20, 调度/物流缺陷修复)**: 5k 步长库存快照定位 197k
未入账损耗的主体 = 掉落堆 decay（t5–15k 堆积 1.6k–6.7k，按 ENERGY_DECAY
1/1000 即 2–6 e/t）。三处修复（僵尸 haul 取消、升级体跨房硬过滤、ext 工地
升级降档）详见 `docs/bugs/dispatch-logistics-2026-10-20.md`。

实测: 20k 92,186 (+6.3%, L3@10,885)；40k 201,603 (-2.1%) 但 **L4@32,160**
（基准 33,393，提前 1,233t）；t15k 地面堆积 6,169→281。保留。

40k 总量略降 = 升级体不再兼外矿，外矿搬运劳动力减少（采集 721,750→679,530）。
下一靶改为: 远程专用回运舰队——外矿 haul 需求计入 carrier 定编、与本地运力
隔离，替代升级体兼差；远程收入入账打折与 cc 保底水位仍按原清单。

**批次 U (2026-10-20, 外矿回运舰队 + 收入口径 + carry 改名)**:

改前基线 (af2d718): L3@10,885 / L4@32,160 / 40k 升级 201,603 采集 679,530。

1. **跨房 carry 任务链修复**: runRemoteCarry 取料腿支持掉落堆 (Resource
   的 amount 兼容, 修 `.store.energy` 崩溃致 agents 熔断、L3 推至 16,321)。
2. **掉落堆回运任务**: 远程源无容器时, 掉落堆 ≥ REMOTE_CARRY_CONFIG
   .pileMinAmount (500) 发跨房 carry (pile 回运), 矿工驻源 drop 期的能量
   不再原地衰减。
3. **回运积压加编 (carrier 定编)**: 待回运存量 >1000 → carrier +1,
   >3000 → +2 (与本矿 pileBoost 同口径), 外矿回运缺口计入编制。
4. **收入入账打折**: income.ts remoteSourceWeightOf 只计具备回运通道
   (源旁容器 / 源旁在板回运任务) 的远程源, 防升级体按虚高收入超编。
5. **reserve 孵化提级 (判负已撤)**: remoteChainSpawnPriority=2 压过
   carrier/upgrader 换班。40k 实测 L4@38,010 (慢 5,850t), 采集 668,832
   反降——reserver 反复插队孵化, 本地矿工/搬运替补在单 spawn 队列被饿,
   采集面塌陷 (20k→40k 升级率 6.93→4.59 e/t)。撤: 删除 spawnDirector
   提级分支与 config 项, 不留死配置。教训: **单 spawn 串行下, 任何
   「一劳永逸」的调度提级都会以采集面换优先级——外矿链 (scout→reserve
   →harvest→carry) 各环节靠任务自然优先级即可**。
6. **haul→carry 全项目改名**: 任务词表/任务种类/broker reason/配置键
   (HAUL_CONFIG→CARRY_CONFIG 等)/memory 累计字段 (haulBusyTicks→
   carryBusyTicks), schema v13→v14 迁移丢弃旧 haul 任务并迁移累计字段。
   utils/haulRelay.ts → carryRelay.ts。纯改名无行为变化。

A/B (40k speedrun, 同机同场景):
| 指标 | 基线 | U 全量 | U 撤提级 |
|---|---|---|---|
| L3 | 10,885 | 9,278 | 9,278 |
| L4 | 32,160 | 38,010 | **28,749** |
| 升级 | 201,603 | 190,776 | **230,884** |
| 采集 | 679,530 | 668,832 | **742,416** |
| 孵化 | 225,400 | 265,150 | 270,700 |

20k 中间点对比: 基线升级 95,923 vs U 97,598 (+1.7k, L3 快 1,607t)——前
半程 U 已领先, 回归全在 20k→40k 段的孵化队列挤压, 与提级判负结论互证。

保留: 1/2/3/4/6 (L4 提前 3,411t, 升级 +29k, 采集 +63k)。boot 绿门回归
待跑。下一靶: L4@28,749 距 6.1 (RCL4≤10,000) 仍差 3 倍, 主瓶颈在单房
单 spawn 的孵化吞吐与 5W 矿工 drop 期的本地能量守恒, 需 5k 步长能耗
分布审计定位。

**批次 U 终态 (2026-10-20 20:00)**: reserve 提级判负撤除后, 全场景矩阵
复跑暴露掉落堆回运在「预订不成活」场景 (boot/arena) 的负收益:
- boot L3 8,915→10,263 (红线): 邻房无 controller, 预订永不成活, 未预订
  源容量 1500 细流, 跨房拉小堆往返成本 > 货值;
- arena L3 10,286→8,785 (v1 反超): 同机理但基线 reserve 意图仅 134
  (speedrun 3,299), 外矿链本就弱。

**修复: 掉落堆回运加「己方预订在身」前置** (容器回运不衰减不过门)。
终态矩阵 (同机同场景):

| 场景 | 基线 | U 终态 | 判定 |
|---|---|---|---|
| boot L3 (绿门) | 8,915 | **8,889** | 绿, 持平偏快 |
| speedrun L4 | 32,160 | **28,316** | 提前 3,844t |
| arena L3 (观察) | 10,286 | 11,629 | 慢 1,343t, 观察项 |
| sprint L3 (观察) | 41,766 | 35,645 | 提前 6,121t |

speedrun 终态: 升级 230,255 (+28.6k) / 采集 714,986 (+35.5k) / 孵化
245,750 / reserve 意图 10,984 (预订链满速运转)。L3 11,343 比基线慢
458t = 收入打折正确生效 (未预订源不再虚计), L3→L4 段 16,973t 反而
快于无门控版 19,471t。主树与隔离验证树逐位复现 (L4@28316)。

教训 (追加): 外矿舰队的每一分运力投资都必须挂在「预订成活」这个前置
承诺上; 未预订的源是细流, 跨房搬运是纯亏。boot 场景邻房缺 controller
是 2026-10-19 已勘误的旧口径 (官方规则所有房皆有 controller), 其外矿
行为与实服不符, 判负权重应低于 speedrun/arena。

**下一靶**: 6.1 (RCL4≤10,000) 距当前 28,316 仍差 2.8 倍。瓶颈分解:
- 升级均速 L3→L4 段 9.4/t, 需 18.9/t 才能压进 10k——单靠调参不可达,
  需结构性改动 (升级体定编口径 / spawn 双线 / 本矿能量守恒);
- 优先级: 本矿 fill_spawn 与 cc 的分配线 (孵化换代潮 cc=0 实证) >
  升级体按实测收入定编 > 外矿容器化 (消除 drop 期衰减)。
