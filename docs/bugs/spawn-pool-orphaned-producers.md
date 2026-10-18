# P1: spawn 池孤儿生产者——战争旗操/power 件孵化断链

- 优先级: P1 (战斗与 power 孵化功能整体断链; sim 不可见, 线上已断 ~1 天)
- 发现: 2026-10-17 (nexus-architecture-refactor 任务 5.6 消费面测绘)
- 状态: **已修复 2026-10-17** (桥接 directSpawn 同口径; 六场景门 bit 一致复验)

## 现象

战争族旗操 (AIO/CLEAN/ACLAIM/DIS/LOOT) 与 mineMission 的 power 件 (PA/PH/PR/PC)
调用 `room.SpawnMissionAdd(...)` 产孵化挂单, 但挂单永远无人消费——**战件与 power 件
不再孵化**。

## 根因

b8ca2d3 (2026-10-16, docs/bugs (十九)/(二十)) 撤除孵化消费端 `SpawnWork` 时,
spawn 池的唯一消费者链 `SpawnWork → SpawnCreep → GetSpawnTaskData → getSpawnMission`
整体死亡。该提交只验证了经济链 (主线 spawnDirector 自产自销, 不读池), 未覆盖
**入池型生产者**:

| 生产者 | 入口 | 状态 |
|---|---|---|
| UpdateSpawnMission (经济角色) | mission/index.ts 定时 | 挂单仅作 pending 计数, 无孵化预期 (b8ca2d3 设计内) |
| warSpawn 旗操 ×5 族 | features.ts:65 handleWarSpawnFlag | **断链**——本应经池孵化 |
| mineMission power 件 ×4 | mineMission.ts:121-167 | **断链** |
| TeamSpawner | TeamSpawner.ts:539 directSpawn | 活 (绕池直孵, 不受影响) |
| industry console spawn | industry/console/spawn.ts:12 | 人操入口, 断链同 warSpawn |
| pc-assist healer | PowerCreep/mode/assist.ts | directSpawn 活; 但 assist.ts:276 读池判 in-flight 的口径失效 (池恒空 → 可能重复派单) |

## 证据

- `grep -rn "SpawnWork()" src/` → 零调用 (仅 types 声明与 spawnControl 自身)
- `GetSpawnTaskData`/`SpawnCreep` 唯一调用方是 spawnControl.SpawnWork (死)
- spawnDirector/spawnArbiter 主线零读 `MISSION_POOLS.spawn`
- ExpandController.getExpandSpawnCounts 读池计 in-flight (expandId 挂单), 而
  expand 自身走 directSpawn 不入池 → 计数恒空 (无害但同源)

## 修复方案 (已实施 2026-10-17)

战件/power 桥接 directSpawn (与 TeamSpawner 同口径), 全部落地:

1. warSpawn.ts 五旗 (AIO/CLEAN/ACLAIM/DIS/LOOT) `SpawnMissionAdd` → `directSpawn`
   (显式体型经 `flattenBody` pairs→flat; boost 派单 `AssignBoostTaskByBody` 语义不变)
2. mineMission.ts 六处 (PA/PH/PR/PC/DH/DT) → `directSpawn`; PA/PH 成对下蛋加
   空闲 spawn ≥2 原子性门 (boost 按对偶派资源, 单 spawn 只下一只会悬空)
3. industry/console/spawn.ts 四处人操入口 → `directSpawn` (压缩体型串经
   `decompressBodyConfig` 解析)
4. assist.ts hasPendingHealer 移除恒空的池兜底 (pc-heal 走 directSpawn 从不入池)
5. **蛋窗口防重复**: directSpawn 同步下蛋后蛋不在 `Game.creeps` (引擎快照语义)——
   - `getFlagSpawnLoad` live 计数补 `spawn.spawning` 蛋匹配 (warSpawn 五旗口径)
   - `creepTickIndex` 单扫缓存新增 `eggsByTargetRoom` 索引 + `getUnitCountByTargetRoom`
     (mineMission 六计数位从池挂单口径换蛋感知口径; `getSpawnMissionCount` 退役)

## 验证标准 (已达成)

- tsc/oxlint/arch-guard 全绿 (守护 124 条不变——桥接点全在豁免文件域内)
- sim 三绿门 bit 一致: race L2@796 / boot L1@0 L2@728 L3@17049 / remote-mine 全断言
  (经济链零改动——UpdateSpawnMission 生产端不动)
- 单测 5/5 绿
- 待线上验证: 战旗放置后 N tick 内 spawn.spawning 出现对应 unit (下次落地窗口执行)

## 后续 (已收口 2026-10-18, 5.6 批次二)

- ~~spawnControl.ts (死链 ~400 行)~~ 已删 (批次一)
- ~~UpdateSpawnMission 生产端保留~~ **已退役**: 实证为纯空转环——桥接后 spawn 池
  挂单零消费者 (spawnControl 删/mineMission 桥/console 桥/usePower 蛋感知化),
  每 interval 白耗 CPU 产无人孵的单。整链删除: spawnRules.ts 430 行 +
  spawnMission.ts 477→66 行 (仅存休眠 external spawner 的 SpawnMissionAdd)。
- 同类断链顺带修复: usePower.Operate_Spawn 池读改蛋感知 (否则 power/team 件
  孵化加速永不触发); console mine 取消命令删池清理段 (directSpawn 蛋不可取消)
- 验证: race/boot/remote-mine bit 一致; speedrun +3t (21113→21116) 确定性
  CPU 蝴蝶 (spawn 池挂单 Memory 开销消失→bucket/qos 分档微移), 新参考已录;
  六场景矩阵全绿×2; tsc/oxlint/arch-guard/单测 5/5 全绿
