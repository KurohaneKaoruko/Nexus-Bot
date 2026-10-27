# round-120 冲级血统同步 (Speedrun-Bot → Nexus race/speedrun 模块)

- 日期: 2026-10-26
- 状态: 已完成, sim 16 组逐位对齐

## 背景

`src/branch/race/speedrun/` 是上游 Speedrun-Bot 单文件 bot 的模块化移植
(7 模块, fork 自 976k 时代)。上游 round-120 更新 (作者 run 107 → 1.072M)
带来 20 处特性, 本次全量同步, 保持 Nexus 模块结构不变。

## 同步内容 (20 特性 → 模块落点)

| 特性 | 模块 |
|---|---|
| HUBS[0] 第7 ext 改 (16,30), openEast 顺序重排 | layout.ts |
| PRIVATE_PROFILE + configure() (profileReady 门) | layout.ts |
| repath (nav 计数) + escapeAfter (堵塞脱困) | traffic.ts |
| plan() ext 边界 min(want, ext.length) | economy.ts |
| roadSafe (路网避开关键格) | economy.ts |
| resRooms claimDisabled 分档 | economy.ts (从 spawning 挪入, 修反向依赖) |
| recoverAlt (开局辅矿堆回收) | roles.ts |
| claimer 角色 (ERR_INVALID_TARGET → claimDisabled) | roles.ts |
| chainFetch (升级工同 tick 补取) | roles.ts |
| towRoom/towHome (拖拽候选扩展) | towing.ts |
| walkToTow (等拖时先走) | loop.ts |
| dropMiners 矿工体型 (省 CARRY) | spawning.ts |
| fillerBody (hub1 filler 免 MOVE) | spawning.ts |
| recoverMiner/urgentNear/succFirst 紧急矿工口径 | spawning.ts |
| claimRooms 分支 (GCL>1 时占外房) | spawning.ts |
| reservedRate/reserver 的 ctrl.my 跳过 | spawning.ts |
| slack 三档 (slackHome/slackReserved/slackUnreserved) | spawning.ts |
| upWorkAvailable/OnPost/Fed 遥测 | telemetry.ts |
| loop configure() 首位调用 | loop.ts |
| 标准房哨兵 (roomOk, 非标准房静默待机) | loop.ts (双仓库同步) |

## 修复的移植断链

- roles.ts 引用 bayStop/bayUnload (定义在 spawning.ts) 未导入——
  K_DEFAULT (renew=0) 下不触发, PRIVATE_PROFILE (renew=1) 下必炸。
  补 import 后闭环。
- resRooms 定义在 spawning.ts 但 economy.ts roadPlan 先用 (反向依赖),
  挪到 economy.ts 导出。

## 构建链路

- `npm run build:race:speedrun` = SPEEDRUN_MODE=1 SPEEDRUN_PROFILE=1 VARIANT=race
  → speedrunEntry 入口 + PRIVATE_PROFILE 无条件烘焙 (私服 GCL<6 账号)
- define 注入走 `transform.define` (rolldown 顶层 define 已弃用)
- sim 构建 (不带 SPEEDRUN_PROFILE) 保留 gcl>=6 自动门, 与上游口径一致

## 验证

- 2000t 冒烟: 与上游 round-120 dist/main.js 逐位一致 (score/harvested/
  built/spawned/rcl 曲线全同)
- 16 组 jitter 全量: mean 1,069,140 / min 1,056,444 / max 1,077,010——
  与上游基线逐位一致
- 服务器: round-120 血统的 run 34 双榜 #1 (20k 1,065,947 / 40k 2,272,219)

## 主代码融合 (2026-10-27)

三线融合, 冲级行为保持等价:

### 布局: planner 静态模板库一等公民

- `src/modules/planner/static/race.ts`: 冲级固定布局注册进主布局库
  (锚点 hub1 容器 17,30; extension 22 项 = HUBS[0].ext(10) + HUBS[1].ext(12)
  建序, container 5 = 双 hub + 升级块三箱, spawn(0,1))
- speedrun/layout.ts 生产档 (BAYS 基准) 从模板派生 (TPL_EXT0/EXT1/
  CONTAINERS/SPAWN); 实验变体 (S27/S26/S29/S29B/SIN/BAYS 关) 保留字面量——
  它们是 __K 旋钮的 sim 实验面, 不入主布局库
- openEast 重排仍由 configure() 运行时应用 (旋钮行为, 非模板数据)
- 等价性: 派生坐标 vs 旧字面量四组逐位核对一致 (ext0/ext1/containers/
  spawn); 2000t 状态哈希同值 `0xe677dd16…`——纯数据搬家零行为漂移

### 命名: 主生成器统一

- spawnIt 接入 `generateCreepName` (中文体名 代号-HEX, 如 `冲级搬运体 HL-72C3`)
- UnitData 新登记冲级专属类型: hauler(HL 冲级搬运体)/tug(TG 拖拽体)/
  paver(PV 铺路体)/spawnFiller(SF 孵化补给体)/hubFiller(HF 枢纽补给体);
  miner/upgrader/builder/reserver/claimer 复用既有词条
- 驱动面归因: task 段 (structure-guard ⑤)
- 已知混沌效应: escapeAfter 用 `name.length` 取模脱困方向, 名字变长使
  个别 jitter 分岔 (t688 首例), 属中性抖动——16 组分布验收

### 称呼统一: unit/type 词汇表

- speedrun 模块: `memory.r`→`memory.type`, `ROLES`→`TYPES`,
  roles.ts→types.ts, spec `r:`→`type:`, 中文注释 角色→类型
- 主代码: EconomyRole→EconomyUnit, CombatRole→CombatUnit,
  isEconomyRole→isEconomyUnit, pauseRoles→pauseUnits,
  aliveRoles→aliveUnits, inflightRoles→inflightUnits,
  standingRoles→standingUnits, standingPriorityByRole→standingPriorityByUnit,
  surviveSpawnPauseRoles→surviveSpawnPauseUnits, keyRoles→keyUnits,
  REPLACEMENT_KEY_ROLES→REPLACEMENT_KEY_UNITS, roleFromCode→unitFromCode
- 序列化面不动: Memory.R 遥测行键 / 引擎 API (Game.creeps 等) 保持原样

### 20k 基线 (主代码融合后)

- 融合完成时默认路径逐位复现旧基线 `[1067305,1071434,1075888,1076177]` (mean 1,072,701)
- `dieMargin` 转正 30 后新基线 `[1071167,1080491,1074976,1079683]` (mean 1,076,579, +0.36%,
  4 seed 全正); 相同时序 L5 12,181–12,317 (旧 12,235–12,328)
- 其余调参旋钮默认全 0; 损耗机理与已排除项见 `docs/bugs/energy-loss-ledger.md`

## 模块化融合 (race 变体主链化)

- 入口收敛: `speedrunEntry.ts` (SPEEDRUN_MODE 入口切换) 删除, race 变体唯一入口
  `src/branch/race/main.ts` = 主代码内核 (装配/调度/校准/遥测/错误边界) +
  `RaceSpeedrun` (commit P0 单模块, 承担全部冲级行为)
- 模块清单硬约束 (sim 实证, 非随意裁剪):
  - 不挂 Agents/Broker: betterMove 原型覆写在 Broker 结算, 与引擎裸 move 语义互斥;
    且 Planner 等系统的意图队列以 Broker 为唯一消费方, 无 Broker 的链不能挂提交意图的模块
  - 不挂主链行为模块: sim 冲级场景把全 9 房 controller 报 `my=true` (8 个 rcl=0
    幽灵房), Perception→world 链会把幽灵房当己房 (布局/孵化/工地配额全污染);
    Spawning 与引擎 spawnIt 同步直调互抢
  - ActorOwnership 双件保留: 纯 global 运行时层注册表, 零 Memory/零原生调用
- 布局归一形态: 布局数据以 `planner/static/race.ts` 模板为单一事实源 (speedrun
  生产档坐标从模板派生); 布局放量节奏 (boxRcl/extMax/建序) 是引擎调优不可分割
  部分保留在引擎内——主管线接管放量的路线已证伪 (幽灵房配额/RCL<2 门/建序/
  Broker 依赖四重失配, sim 实测零建造)
- 构建链归一: `VARIANT=race` 单一入口, SPEEDRUN_MODE 入口切换删除;
  `SPEEDRUN_PROFILE` define 按 variant=race 激活 (不再依赖 SPEEDRUN_MODE)
- 逐位验收: 融合构建 4×20k `[1071167,1080491,1074976,1079683]` / 4×40k
  `[2281648,2295520,2272884,2289314]`, 与基线逐位一致零漂移
- 附带修复: `newRun` 保留 `Memory.Nexus` 子树 (引擎清 Memory 时不再击穿主代码
  校准产物, 布局记录跨 run 存活)
