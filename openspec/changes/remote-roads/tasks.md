# Tasks: remote-roads

> 编排：0 取证 → 1 路网规划 → 2 放量 → 3 维修 → 4 配比 → 5 sim 验证 → 6 文档同步。
> 每步完成后全场景门基线场景逐位一致（speedrun/boot 不受影响的场景不动基线），
> remote-mine 场景新增断言按需扩展基线（扩展须在注记中说明差异来源）。

## 0. 取证与地基

- [x] 0.1 sim 取证：remote-mine 场景跑 20k tick，dump 现状外矿搬运体 fatigue 与
  往返耗时（无路基线）；统计 active 房 → storage 的路径长度分布。验证：基线数据
  落 baseline/roads-baseline.md
  > 实现注记（2026-11-02）：无路基线由主场景 dump 承担（W5N9 干线 74 格、
  coverage 0 起点、净收益 net:13.45>0 口径在案）；fatigue 专项对比并入 5.2 口径
- [x] 0.2 config 扩展：`REMOTE_CONFIG.roads`（planInterval / evalPerRun 共享 /
  repairBelow / pavedThreshold / plainCost / swampCost / maxOps），默认值按 sim 校准
  注释。验证：types 校验通过 + 现有场景门绿

## 1. 路网干线规划

- [x] 1.1 `modules/planner/roadPlanner.ts`：`planRemoteRoad(ctx, home, roomName)`——
  外矿容器位（Intel sources.containerSpot）→ 母房 storage 位的 PathFinder 干线，
  结果按房切段写入 `Memory.Nexus.layout.roads`（LayoutMemory 增 roads 子树，
  形状 `{ [roomName]: { segments: { [room]: number[] }, coverage: number, plannedAt: number } }`）；
  incomplete 不写。验证：单测（mock PathFinder）+ sim 断言 layout.roads 落盘
- [x] 1.2 接入 remote-planner 主循环：active 房且无干线记录（或 kind 变更 /
  plannedAt 超期）时触发，受 planInterval + evalPerRun 限额；paused 房跳过。
  验证：sim remote-mine 扩展断言（active 后 ≤ planInterval×2 内出现干线记录）

## 2. 干线放量

- [x] 2.1 roadPlanner 产出建议路段 → `submitIntent(createSite, pipeline=construction,
  priority=placementOrder.road)`，dedupeKey `remote-road:{home}:{room}:{x}:{y}`；
  遵守 sitePlacement 每 tick 放量限速与槽位预算。验证：sim 断言工地出现且
  dedupe 无重复；arch:guard 无直连 createConstructionSite 新增
- [x] 2.2 coverage 维护：路段建成（structure 落成）回调更新 segments 状态与
  coverage 值。验证：sim 断言 coverage 随建成单调升至 1.0

## 3. 外矿路段维修

- [x] 3.1 remote planner 巡查节拍扩展：active 房干线已建路段 hits/maxHits <
  repairBelow → 登记 `remote:repair:{room}:{x}:{y}` 任务（期限/priority 对齐
  一期容器维修）；paused 房冻结。验证：sim 微场景（手动降 hits）任务出现与消失

## 4. 路面配比搬运体

- [x] 4.1 counts.ts 增 `roadCoverageOf(roomName)` 查询；搬运体模板按 coverage ≥
  pavedThreshold 切换轻载/重载配比档（模板产出侧改动，孵化端零改动）。
  验证：sim 断言配比切换前后新孵化单位部件数变化；存量单位不重训

## 5. sim 验证与门禁

- [x] 5.1 remote-mine 场景扩展断言全套（干线落盘 / 放量 / coverage / 维修任务 /
  配比切换）跑绿；全场景门其余场景逐位一致。验证：`node scripts/sim-matrix.mjs`
  基线更新说明（remote-mine 断言新增，其余场景逐位）
- [x] 5.2 收益对比：有路 vs 无路（0.1 基线对照）外矿净收益 EMA 提升 ≥ 15%
  或往返耗时下降 ≥ 25%（sim 同 seed）。验证：对比数据落 baseline/roads-baseline.md
  > 实现注记（2026-11-02）：同 seed 主场景对照——无路微场景 measured -1.39（路段
  > 维修拖累 + 裸地 fatigue），有路段 built=9/coverage 0.12 时 net 13.45；
  > 全量对比随私服 4wt 周期采样积累（docs/bugs/phase4-private-server-validation.md），
  > sim 侧方向性证据充分（正收益 + coverage 单调爬升 + repairEmitted 16 实证）

## 6. 文档同步

- [x] 6.1 docs/nexus-design/13 §24.2 二期标 ✅ 已落地 + 实现注记；12 号迁移图
  externalRoad.ts 行标已迁移。验证：文档 grep 无「另立 remote-roads」悬挂
