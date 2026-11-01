# RoomObservation 膨胀路径取证（架构清单 BUG-009 存量收编）

- 优先级: P1（若实锤：Memory 无界增长 → 触顶丢档；若证伪：闭环留档）
- 发现: 2026-10-18（docs/Nexus-Bot-03-BUG清单.md §BUG-009 架构审计快照 @1ba8916）
- 状态: 已闭环（2026-10-31 sim 取证：原假设证伪 + 连带挖出真泄漏 `spawn.telemetry.pendingSince` 并修复, 详见「取证结论」节）
- 关联: 03 篇 BUG-009；01 篇 §24.3 Memory/Runtime 分界线

## Summary

架构审计提出：`RoomObservation`（房间观察记录）随时间持续膨胀的风险——若观察数据只增不减（或衰减规则缺失/未接线），Memory 将无界增长，最终触发引擎 2MB 上限的丢档重置。

## Symptoms（假设成立时的预期表现）

- soak 场景（≥80k tick）Memory 曲线中 `Memory.Nexus.rooms` 字段体积单调上升不回落
- 远程房（短暂视野后失联）的观察记录永久残留
- global reset 后 Memory 体积不减（排除 runtime 缓存干扰）

## Reproduction（取证方案）

1. sim soak（boot 80k）dump Memory，按 tick 采样 `JSON.stringify(Memory.Nexus.rooms)` 体积曲线；
2. 对照 `world/perception.ts` 的观察衰减/清理逻辑：找出"最后一次见到该房"的记录何时（是否）被清理；
3. 构造短暂视野场景（scout 路过陌生房），验证失联 N tick 后记录是否衰减/清除。

## Root Cause

待取证。候选路径：① 观察衰减规则存在但未在 reconcile 接线（类比 P1-11 maintainLedger 漏接线先例）；② 衰减只减字段不减键（房名键集只增）；③ 无衰减设计（纯缺失）。

## Impact

若实锤：长周期运行（实服 4wt 重置窗口内）Memory 触顶，全量丢档重置——所有会计事实（账本/任务/情报）归零，等同灾难性回退。

## Fix

待取证后按根因三选一：补接线 / 补键清理 / 补衰减设计。修复须符合 01 篇 §24.2 字段表模板（生命周期列标明衰减规则）。

## 取证结论（2026-10-31，sim 实证）

**原假设证伪，连带挖出真泄漏（已修）**：

1. **RoomObservation 无膨胀**（证伪）：`world/perception.ts` 每 tick 重建 `rooms` 观测快照（runtime 态不落盘）；持久层 `Memory.nexus.rooms` 只为「己方房 ∪ 失守房」写 intel，`RoomIntelRecord` 全字段定长（worksites 每源一条、rclTimeline ≤8、harvestSplit 每源三项）。sim 实测（boot 同构场景, flat, 1 己方房 + 8 邻房）：键数恒 1, 体积 503B→1019B 平稳（80k 窗口, rclTimeline 封顶 4 键）。
2. **真泄漏在 `spawn.telemetry.pendingSince`**（已修复）：`spawnDirector` 写入侧照抄 `requests` 的 map 键（含 raceRemote 复合键 `rm:{taskId}`）, 而清账侧（孵化成交）按 `request.unit` 删键——键口径不一致使复合键永久残留, 每个新任务 ID 泄漏一条。sim 实测 80k 时 **2809 键 / 56KB 线性增长**（`Memory.Nexus.spawn` 9.6KB→51KB）。连带缺陷：remoteMiner 的等待 EMA 从未结算（`since` 恒 undefined）。
3. **修复**（`spawnDirector.ts` + `memorySchema.ts`）：写入侧改按 `request.unit` 键控；补出池清账路径（本 Tick 不在池的词表键结算 EMA 后摘键, 与孵化成交同口径）；历史泄漏键（非词表）不结算直接摘除；`SpawnTelemetry` 类型补 `pendingSince` 字段去断言。修复后 `Memory.Nexus.spawn` 506→532→498B 平稳（80k 窗口）。
4. **边界**：泄漏链仅 main 变体（`dist-race/main.js` 无 `pendingSince`/`rm:` 符号）——实服冲级 bot 不受影响。telemetry 三项（waitEma/queueDepthPeak/denyReasons）全仓无决策消费方（纯观测）, 修复后全场景门 7 门 GREEN 逐位一致（boot L3@8557 / remote-mine L3@0 等, 2026-10-31）。
5. **其余子系统核查**：`tasks`（71→78→74 有界均衡, 旧任务正常出清）/ `units`（20→17）/ `layout`/`ledger`/`metrics`/`defense` 均平稳——全 Memory 体积收敛至 ~100KB 内平稳。

## Regression Test

soak 场景断言：`Memory.Nexus.rooms` 体积曲线平稳（80k tick 窗口内峰值 ≤ 起始 × 1.5）；短暂视野房记录在失联 + 衰减窗口后被清除。

补充（2026-10-31）：`Memory.Nexus.spawn.telemetry.pendingSince` 键集 ⊆ SpawnUnit 词表（非词表键出池即摘）；`Memory.Nexus.spawn` 体积 80k 窗口平稳（≤1KB）。

## Production Verification

实服 4wt 窗口 Memory 体积平稳（console 定期采样），无丢档重置。
