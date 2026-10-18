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
