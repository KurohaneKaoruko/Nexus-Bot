# 跨房单位驱动断联取证（roster-probe，phase4-remote-intel 0.1/0.2）

- 优先级: P1（外矿/侦查主链路前置缺陷——任务驱动链对跨房任务三处断点）
- 发现: 2026-11-01（phase4-remote-intel 第 0 节取证，sim 实证）
- 状态: 已取证（三缺陷实锤 + 一项证伪），修复归第 1 节名册任务

## 取证场景

`sim/roster-probe.sim.ts`：母房 W5N8（flat, spawn+storage, RCL3）+ 邻房 W5N9（flat 双源, 中立 ctrl）。预置 scout 单位（MOVE×2, 初始 (48,25)）+ 一条租给它的 scout 任务（`targetPos W5N9(25,25)`）。Memory 带 schemaVersion 11 + 完整 economy 子结构（calibration 约束）。

对照组：任务挂靠房分别取 W5N9（外房）与 W5N8（母房）跑同构场景；bundle 探针采样位置/记忆/任务 + `--record-intents` 意图流。

## 缺陷一（实锤）: room-lost 清扫误杀外房挂靠任务

任务挂靠房 = 目标房（`roomName: 'W5N9'`, 非己方房）时，**t1 即被 cancelled**：

- `tasks/index.ts:44` 的 room-lost 清扫：`!myRoomNames.has(task.roomName) && !remoteEconomic` → cancel；
- `remoteEconomic` 豁免只覆盖 `harvest`/`carry`——**scout/reserve 任务挂靠外房即死**；
- 下游：scout 无租约 → `reportIdleUnit` 空转 1500t 自然死亡 → units/creeps 记录被死亡回收删除（时间线：t1 cancel / t~550 任务记录清扫 / t~1550 寿命尽 + 记录删除）。

## 缺陷二（实锤）: 跨房 move 意图寻路失效，单位卡墙角

任务挂靠母房（绕开缺陷一）后，scout 被正常驱动但**从不跨房**：

- 位置轨迹：(48,25) → (39,16) → (43,6) → **(49,0) 北墙角卡死**，400t 不动，任务 1400t 仍 in_progress；
- 目标房 W5N9 在**东**边（x+1），scout 却一路向**北**（dir 8/↖×12 → ↗×13 后静止）——move 意图 `targetPos {roomName:'W5N9'}` 进了 movement 管线后被当同房目标解算，路径退化成房内导航，边界处无 exit 穿越；
- 意图流佐证：`--record-intents` 中 scout（id 007）仅前 25t 有 move 意图，之后零意图（驱动层每拍重提但 movement 判定「已阻塞」不再执行）。

## 缺陷三（实锤）: 到达判定依赖 creep.roomName == targetPos.roomName，无兜底

`agentHandlers.ts` scout 完成判定 `creep.roomName === task.targetPos?.roomName`——因缺陷二单位到不了目标房，任务永挂 in_progress；lease 每拍 heartbeat 续命（不触发 lease 过期回收），deadline 3000 前只能靠 attempts 上限或 planner 重建解耦。三缺陷叠加形成「永挂任务 + 卡墙角单位」的稳定死锁。

## 证伪项: 跨房单位记忆保留（P1-18 修复有效）

挂靠母房的对照组里，scout 全程 1400t `units`/`Memory.creeps` 记录保留、taskId 不丢——`remoteUnits` 感知路径（`perception.ts:316-326` + `agentSystem.ts:115+` 外矿单位驱动）对「可见非己方房的己方单位」的存活/记忆/驱动链**有效**。phase4 提案 §24.3 A 描述的「跨房即丢记忆」在「单位可见」前提下不成立；真实断点在「跨房移动」（缺陷二）与「外房挂靠任务」（缺陷一）。

## 0.2 外矿链取证补充（remote-mine 30k + storage/RCL4 补洞后）

bundle 探针采样（`__remoteAudit` 每 1000t + scout 生死窗口 26500-28500 每 50t）：

- **scout 任务恒 available 无人执行**：t0-26500 全程 `scouts=0`（`t08da6`/`t0bad4` 两条任务永久 available）——planner 每 1000t upsert 同键续命（id 稳定不换手，§24.3 B7 的「每 tick 取消重建」**不成立**，upsert 续命口径已生效）；
- **~t26500 偶发孵出 2 只 scout**（S-28F7/S-31E4）→ S-28F7 卡 W4N8 (0,0) 500t（挂 t08da6 任务，跨房移动缺陷二同款）；S-31E4 卡 W5N8 (49,49) 无任务空转 → t27050 双双寿命尽死亡，**之后永不再孵**；
- 外矿主链在 27k 后由 harvest/carry/reserve 任务潮自愈成形（无 scout 点亮也跑通——本场景 alwaysVisible 的视野口径使 scout 点亮环节被跳过）；
- reserve 任务恒 available（reserver 不在孵化词表，与 scout 同族缺陷）。

## 修复方向（第 1 节承接）

1. room-lost 清扫的 `remoteEconomic` 豁免扩到 `scout`/`reserve`（或按「目标房有视野」判活）；
2. movement 管线跨房目标解算：目标 roomName ≠ 当前房时走 exit 寻路（`findExitTo` 语义），不落同房导航；
3. scout 完成判定加到达兜底（视野内目标房 + 距离阈值），或 deadline 到期转 failed 走重试。

## Regression Test

`sim/roster-probe.sim.ts` 断言（修复后）：任务挂靠外房不再 t1 cancel；scout 在 ~60t 内进入 W5N9（visibleRooms 含 W5N9）；任务 complete；单位卡墙角不再现（无连续 50t 同格静止）。
