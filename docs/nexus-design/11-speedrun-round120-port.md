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
