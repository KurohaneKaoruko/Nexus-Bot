# RoomObservation 膨胀路径取证（架构清单 BUG-009 存量收编）

- 优先级: P1（若实锤：Memory 无界增长 → 触顶丢档；若证伪：闭环留档）
- 发现: 2026-10-18（docs/Nexus-Bot-03-BUG清单.md §BUG-009 架构审计快照 @1ba8916）
- 状态: 未修复（取证待做）
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

## Regression Test

soak 场景断言：`Memory.Nexus.rooms` 体积曲线平稳（80k tick 窗口内峰值 ≤ 起始 × 1.5）；短暂视野房记录在失联 + 衰减窗口后被清除。

## Production Verification

实服 4wt 窗口 Memory 体积平稳（console 定期采样），无丢档重置。
