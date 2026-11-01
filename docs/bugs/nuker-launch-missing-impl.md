# 缺陷: Room.NukerLaunchTo / NukerCanLaunchTo 接口声明无实现 (运行时 TypeError)

> 发现: 2026-10-17 (8.4 industry Adapter 化审计中浮出) · 优先级: **P2 (核弹链路非主线, 但一旦调用必炸)**
> 关联: nexus-architecture-refactor 8.4 / 9.2 (legacy 删除时一并处置)

## 现象

`src/types/room.interface.d.ts:71-78` 声明了四个 Nuker 方法, 但 Rosmarin 融合时
`nukerControl.ts` 实现从未随迁——两处调用方运行时会 TypeError:

1. `src/modules/industry/console/nuker.ts:27` — 人操 `nuke-` 旗触发发射 (console 域)
2. `src/modules/prototype/Flag/function/baseFunction.ts:47-50` — `baseFunction` 旗逻辑
   (P6 轨道域, 自动发射路径)

## 证据

- `grep -rn "NukerLaunchTo" src/modules/prototype/Room/` → 零实现
- `grep -rn "launchNuke" src/modules/agents/actionBroker.ts` → broker 无 `launchNuke` kind
  (arch-guard scanner 提示的 "launchNuke 方法名" 指向的是 console 旗名正则 `nuke-`,
  不是真实执行器)
- 唯一真实的核弹执行路径 = 人操 console 内直接调用不存在的方法 → 必 TypeError

## 防护 (2026-10-28, 不替代修复)

两处调用方在调用前检测 `Room.prototype` 上是否有实现 (旗逻辑 `nukeLaunchSupported()`,
`src/proto/Flag/function/baseFunction.ts`; console 内联同一检测): 旗逻辑无实现时跳过该旗并每 1000 tick
告警一次, 不再抛 TypeError 中断 RoomFeatures 本 tick 的其余旗帜 / 房间处理;
console `nuker.launch` 直接返回提示。实装或收编 broker 后检测自然通过, 防护可删。

## 修复方向 (二选一, 随 9.2 legacy 删除轨决策)

1. **实装 prototype/Room**: 按 Screeps 原生语义补 `GHOUL NukerCanLaunchTo (距离 ≤10 房内 nuker 且 cooldown=0)` ——最小实现, 保留人操语义
2. **收编 broker**: actionBroker append `launchNuke` kind (结构 actor, pipeline `work`),
   两处调用方改走命令边界——与 8.4 industry Adapter 化口径一致

## 验证标准

- tsc/oxlint/arch-guard 三门绿
- sim 不回归 (race L2@796)
- 实服 console 人操 `nuke-` 旗触发一次完整发射不 TypeError (或删除该入口并登记)
