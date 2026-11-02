# Proposal: external-legacy-retire

## Why

外矿域已完成四期迁移（`Nexus.remotes` 状态机 / 路网 / 矿物链），但 §24.11 收尾核对
仍有三类 legacy 残留面未处置：休眠词表角色（out-\* 无孵化源）、console `mine.ts`
的旧外矿人操面（含已无人消费的 `energy/centerRoom` 桶）、以及 `externalRoad.ts`
整链（全仓无自动调用点，仅被 console 与人操可视化引用）。三者不清理会持续拉高
词表/守卫台账、让「零引用」扫描失真，并阻碍 `OutMineData` 瘦身。本次按
`dormant-code-retirement` 的固定程序收口，行为零变化（全场景门逐位一致）。

## What Changes

- **休眠词表角色退役**：删除 `out-build / out-defend / out-2attack / out-2heal /
  out-invader / out-attack / out-ranged / out-mineral / out-repair` 的
  `UnitData` 条目、`UnitLevelData` 分级表、`UNITS` 中文名映射，以及
  `bodyFunction.ts` 中引用它们的三个体型特例分支；`structure-guard` 驱动面
  登记表同步收缩。
- **console `mine.ts` 人操面拆分**：删除旧外矿桶维护入口
  （`mine.add/adds/remove/list/clearRoad`）与 `road.*` 整组；保留并显式登记为
  人操豁免的活链入口（`mine.power/deposit/cancel/auto/mapShow/mapHide`，
  `mineralWork` 消费）；帮助文案同步（`helpMine`/`helpRoad`）。
- **`externalRoad.ts` 整链退役**：删除 `modules/external/road/*`（roadBuilder /
  pathPlanner / roadMemory / roadVisual / costMatrixCache）与 `externalRoad.ts`
  入口；`bodyFunction.ts` 的 carrier 路面配比分枝一并删除（活链配比已由
  `spawnArbiter` 消费 `roadPlanner.roadCoverageOf`）。**BREAKING**（console
  API）：`road.*` 与 `mine.add/adds/remove/list/clearRoad` 不再可用。
- **Memory 结构收尾**：`OutMineData.energy / centerRoom / RoadData / RoadVersion`
  与 `RoomMemory.road` 类型声明删除（`highway` / `powerMine` / `depositMine` 保留）；
  HUD 统计的 `outData.energy` 消费改读 `Nexus.remotes`。
- **连带清理**：`statistics.ts` 外矿统计口径、`console/help.ts` 文案、
  `utils/remoteBody.ts` 悬空注释、`docs/` 引用、arch/structure 白名单。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dormant-code-retirement`: 固定的休眠对象清单新增本轮三项（out-\* 词表角色、
  console `mine.ts` 旧外矿人操面、`externalRoad` 道路链），并明确各自判定凭据、
  连带清理面与人操豁免边界。

## Impact

- 代码：`src/constant/CreepConstant.ts`、`src/constant/UnitConstant.ts`、
  `src/proto/Room/function/bodyFunction.ts`、`src/modules/external/`、
  `src/console/function/mine.ts`、`src/console/help.ts`、`src/core/statistics.ts`、
  `src/types/memory.interface.d.ts`、`src/types/room.interface.d.ts`、
  `scripts/structure-guard.mjs`、`scripts/arch-guard.mjs`（如命中豁免清单）。
- API：console 旧入口移除（BREAKING，仅人操面；`Nexus.remote.*` 已覆盖外矿目标管理）。
- Memory：`OutMineData` 仅保留 `highway` / `powerMine` / `depositMine`；
  存量旧字段读取方全部退场，不做破坏性迁移（旧字段自然过期）。
- 验证：全场景门 12/12 逐位一致（清理不改行为）；`npm run guard`（arch/structure）
  绿；词表三方一致断言收缩后仍绿。
