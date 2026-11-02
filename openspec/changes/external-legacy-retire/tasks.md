# Tasks

## 1. 词表死角色退役（out-\*）

- [x] 1.1 `CreepConstant.ts` 删 9 个 `out-*` `UnitData` 条目与 4 个
  `UnitLevelData` 分级表（out-defend / out-invader / out-2attack / out-2heal）；
  `UnitConstant.ts` 删 9 个 `UNITS` 名。验证：全仓 `out-build|out-defend|out-2attack|`
  `out-2heal|out-invader|out-attack|out-ranged|out-mineral|out-repair` 扫描零真引用
- [x] 1.2 `bodyFunction.ts` 删 out-defend / out-attack / out-ranged 三个 `case`
  分支；`utils/remoteBody.ts` 悬空注释改写（不再引用 `UNITS['out-build']`）。
  验证：该文件无 out-\* 提及
- [x] 1.3 `structure-guard.mjs` 的 `dormant-spawn` 登记表同步删 9 项（词表三方
  一致断言与 `UnitData` 键集双向差集为空）。验证：`node scripts/structure-guard.mjs` 绿

## 2. console 人操面拆分

- [x] 2.1 `console/function/mine.ts` 删 `add / adds / remove / list / clearRoad`
  与 `road.*` 整组；保留 `power / deposit / cancel / auto / mapShow / mapHide`。
  验证：文件内无 `RoadBuilder|PathPlanner|RoadMemory|RoadVisual|CostMatrixCache`
  引用，无 `OutMineData.energy/centerRoom` 写入
- [x] 2.2 `console/help.ts` 删 `helpRoad` 组与 `helpMine` 旧条目（add/adds/remove/
  list/clearRoad），保留矿物链条目并标注「矿物链人操入口」。验证：`helpMine`
  无已删命令，`helpRoad` 无残留引用（`help.ts` + 任何入口）
- [x] 2.3 `core/statistics.ts` 外矿在岗统计改读 `Nexus.remotes`（active 房集合），
  删除 `OutMineData.energy` 读取。验证：文件内无 `outData?.energy`

## 3. externalRoad 整链退役

- [x] 3.1 删 `src/modules/external/road/`（roadBuilder / pathPlanner / roadMemory /
  roadVisual / costMatrixCache）与 `src/modules/external/externalRoad.ts`；
  `modules/external/index.ts` 去掉道路再导出（保留 `Expansion`）。验证：全仓
  `externalRoad|CostMatrixCache|RoadMemory|PathPlanner|RoadBuilder|RoadVisual`
  扫描零真引用
- [x] 3.2 `bodyFunction.ts` 删 carrier 路面配比分枝与 `@/modules/external` import
  （活链配比由 `spawnArbiter` 消费 `roadCoverageOf`，不重建）。验证：该文件无
  `getBuiltRoadCoverage`；`spawnArbiter.ts` 的 `pavedRemoteCarry` 路径不变

## 4. 类型与 Memory 收尾

- [x] 4.1 `types/memory.interface.d.ts` 删 `OutMineRoadMemory` 接口、
  `OutMineMemory` 的 `energy / centerRoom / RoadData / RoadVersion` 字段与注释；
  `types/room.interface.d.ts` 删 `RoomMemory.road`。验证：`tsc --noEmit` 绿，
  全仓无这些字段的读写
- [x] 4.2 存量 Memory 旧字段不做迁移；`accessor.ts` 的 `getOutMineData` 保留
  （`highway/powerMine/depositMine` 活链）。验证：`mineralWork.ts` / `highwayMine.ts`
  引用不变

## 5. 文档与台账

- [x] 5.1 `docs/nexus-design/13` §24.11 三项「待收尾变更处理」改为「已收尾」并
  注明提交；全仓 `docs/` 中 `externalRoad` / `mine.add` / `road.recalc` 等引用
  同步改写或删除。验证：`grep -rn "externalRoad" docs/` 零命中
- [x] 5.2 若 `scripts/arch-guard.mjs` 豁免清单含 `modules/external` 直连条目，
  同批收缩并更新基线计数。验证：arch-guard 绿且豁免数单调下降

## 6. 验证门

- [x] 6.1 `npm run build` + `tsc --noEmit` 绿；arch/structure 守护绿
- [x] 6.2 sim 全场景门 12/12 绿且逐位一致（7 基线 + threat/clear/keeper/residue/
  door/roster），重点核对 speedrun 时间线（L2@866 L3@3364 L4@6004 L5@12489 L6@32545）
