# Design: external-legacy-retire

## Context

见 proposal.md「Why」。当前状态取证（2026-11-02 全仓扫描）：

- `GetUnitBodys` 真调用点只有 `productionGateAccess.ts:76`（`UNITS.harvester`），
  out-\* 九个角色无孵化源；`structure-guard.mjs` 将其归 `dormant-spawn`；
- `modules/external/road/*` 与 `externalRoad.ts` 的引用面只有两处：
  `bodyFunction.ts`（`getBuiltRoadCoverage`，carrier 死分支）与
  `console/function/mine.ts`（`road.*` 人操面）；`features.ts` / `main.ts` 零挂载；
- `bodyFunction.ts` carrier 分支的活链替代已存在：`spawnArbiter.ts` 的
  `pavedRemoteCarry` 消费 `roadPlanner.roadCoverageOf`（remote-roads 二期数据源）；
- `OutMineData` 内部活/死分明：`highway` / `powerMine` / `depositMine` 被
  `mineralWork` / `highwayMine` 视觉消费（保留）；`energy` / `centerRoom` 仅剩
  console 写入与 HUD 统计读取（`statistics.ts:316`）；`RoadData` / `RoadVersion`
  仅 `externalRoad` 内部读写。

## Goals / Non-Goals

**Goals**

- 三类 legacy 对象按 `dormant-code-retirement` 程序退役，全仓扫描零残留；
- 行为零变化：全场景门 12/12 逐位一致（含 speedrun 时间线）；
- console 人操面的活链入口（power/deposit 矿物链）行为不变。

**Non-Goals**

- 不迁移存量 `OutMineData` 旧字段（读方退场后自然过期，不做破坏性重写）；
- 不改 `Nexus.remote.*` 入口行为与 remote 状态机；
- 不动 `deposit-*` / `power-*` 词表（其孵化链另属矿物域，本轮不在清单）。

## Decisions

### D1: 删除顺序按依赖倒序，每次一提交

1. **词表角色**（无依赖）：`CreepConstant` 删 9 个 `UnitData` 条目 + 4 个
   `UnitLevelData` 分级表；`UnitConstant` 删 9 个 `UNITS` 名；`bodyFunction`
   删 out-defend/out-attack/out-ranged 三个 `case`；`structure-guard` 的
   `dormant-spawn` 行同步删 9 项（词表三方一致断言必须与 `UnitData` 键集同步）。
2. **console 人操面拆分**：`mine.ts` 保留 `power/deposit/cancel/auto/mapShow/mapHide`，
   删 `add/adds/remove/list/clearRoad` 与 `road.*`；`help.ts` 同步删
   `helpRoad` 组与 `helpMine` 中旧条目；`statistics.ts` 的 `outData.energy`
   改读 `Nexus.remotes`（按 `remotes[home].rooms[*].state === "active"` 计外矿房）。
3. **externalRoad 整链**：删 `modules/external/road/` 五个文件与 `externalRoad.ts`，
   `modules/external/index.ts` 去掉再导出；`bodyFunction.ts` 删 carrier 分支与
   `@/modules/external` import；`utils/remoteBody.ts` 悬空注释改写。
4. **类型收尾**：`memory.interface.d.ts` 删 `OutMineRoadMemory`、`OutMineMemory`
   的 `energy/centerRoom/RoadData/RoadVersion`、`memory.interface.d.ts:437`
   的 road 位置示例注释；`room.interface.d.ts` 删 `RoomMemory.road`（零读取）。
5. **文档/台账**：`docs/nexus-design/13` §24.11 的「待收尾变更处理」三项改为
   「已收尾」并注明提交；`docs/nexus-design/24` 等如有 `externalRoad` 引用同步改。

### D2: console 删除不做兼容垫片

旧入口无自动调用点，仅人操。直接删除并由 `Nexus.remote.*` 覆盖；帮助文案移除，
不留「已废弃」转发（避免死代码再生）。`mine.` 组保留项在 help 中明确为
「矿物链人操入口（power/deposit）」。

### D3: 统计口径改读 Nexus.remotes，不保留旧桶兜底

`statistics.ts` 的外矿在岗计数改为：`Nexus.remotes[home].rooms` 中
`state === "active"` 的房名集合，替代 `OutMineData.energy`。旧桶不再读取——
存量 Memory 里残留的 `energy/centerRoom` 字段无消费方，自然过期。口径变化仅
影响 HUD 展示，不影响任何自动决策。

### D4: `RoomMemory.road` 一并删除

该字段零读零写（唯一提及是类型注释示例），属道路数据面残留；随 `RoadData`
同批删。若后续需要「外矿道路位置缓存」，以 `Nexus.layout.roads` 为准。

### D5: 守卫与豁免

`structure-guard` 词表三方一致断言要求 `UnitData` 键集与驱动面登记表双向差集为空，
删除必须同批；若 `arch-guard` 豁免清单出现 `modules/external` 直连条目，随删除
同步收缩（单调收缩原则）。`bodyFunction.ts` 删除 `@/modules/external` import 后，
arch 直连豁免行数应下降。

## Risks / Trade-offs

- [风险] 误删活链：`out-mineral` 是否被矿物域引用需在实施时复核（本轮扫描为零，
  但 `mineralWork` 只读 `OutMineData` 桶，不读词表角色）；以全仓符号扫描为准。
- [风险] `bodyFunction` 删 carrier 分支后，若未来有调用方以 `'carrier'` 调
  `GetUnitBodys` 会得到空 body；当前真调用点只有 harvester，且空 body 语义已有
  文档口径（`remoteBody.ts` 注记），接受。
- [权衡] 不做 Memory 迁移：旧字段残留在存量 Memory 中，属预期（读方归零即死数据）。

## Migration Plan

无 Memory 版本变更（schemaVersion 不变）。上线后旧字段不读不写；
`Nexus.remotes`/`Nexus.layout.roads` 为唯一外矿与路网事实源。

## Open Questions

（无）
