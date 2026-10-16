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
