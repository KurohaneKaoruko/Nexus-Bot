# Design: remote-roads

## 上下文

一期（phase4-remote-intel）外矿闭环已运转：candidate → scouting → evaluated →
active，采集/搬运/预定/暂停/收益反馈全在 `modules/economy/remote/` 五模块内。
二期补「路网」：active 房到母房的干线，量产后修，搬运体按路面配比。

旧链参照（`Rosmarin-Bot/src/modules/features/external/externalRoad.ts` 2070 行）
是独立大文件 + 自带 CostMatrixCache / RoadMemory / Visual。Nexus 侧不照搬结构，
按域拆挂：

| 旧链职责 | Nexus 去向 |
|---|---|
| PathPlanner（规划干线） | `modules/planner/roadPlanner.ts`（新，纯函数 + 限频状态） |
| RoadBuilder（放工地） | 复用 planner 域 sitePlacement 的 createSite 意图管线 |
| RoadMaintain（维修巡查） | `economy/remote/planner.ts` 巡查节拍扩展 `remote:repair:` 任务 |
| RoadData（路面记忆） | `Memory.Nexus.layout.roads`（layout 域所有权，见 02 §22.2） |
| 搬运体体型 | `economy/remote/counts.ts` 按 roadCoverage 配比档 |

## 决策

### D1: 干线路径规划——PathFinder 单次干线，逐段坐标落 layout

- 起点 = 外矿容器位（Intel sources.containerSpot），终点 = 母房 storage 位；
- `PathFinder.search({range:1}, plainCost/swampCost 按配置, maxOps 限 CPU)`；
- 结果路径按房切段存 `layout.roads[roomName] = { rooms: {roomName: [packedXY]}, placed, coverage }`；
- 单轮限 `evalPerRun` 条（与一期路程评估共享预算），失败（incomplete）不写。

### D2: 放量复用 sitePlacement——不碰直连

sitePlacement 已有 dedupe / RCL 门 / 每 tick 放量限速 / 槽位预算。roadPlanner
只产出「建议路段坐标流」，经 `submitIntent(createSite, pipeline=construction,
priority=road 档)` 进入同一队列。road 的 priority 档低于塔/storage，与 ext 同档
（既有 placementOrder.road=5 语义一致）。

### D3: 维修进 remote 巡查节拍——不新增模块

一期 planner 巡查 active 房时已读 container hits（containerRepairBelow）。
同节拍扩展：遍历该房干线**已建**路段（FIND_MY_STRUCTURES 过滤 road + 坐标命中
干线集合），hits 比例 < repairBelow 即登记 `remote:repair:{room}:{x}:{y}` 任务。
paused 房冻结（与采集任务同口径）。

### D4: 配比档——coverage 两档，孵化端零改动

counts.ts 已按房产出搬运体模板。增 `roadCoverage(roomName)`（layout.roads 查询）：
- coverage ≥ pavedThreshold（默认 0.8）：轻载配比 [CARRY,M] 交替少 WORK；
- 否则：重载配比（现状，多 WORK 抗 fatigue）。
只改模板产出，spawnDirector / broker 不动。

### D5: CPU 预算

规划与放量都在 remote-planner 主循环（planInterval=50t）与 sitePlacement 每 tick
限额内，不新增独立 tick 相位。roadPlanner 自身无 PathFinder 缓存（一期路程评估
已有 cache），干线规划一次性 + 失效重规划（房 kind 变更 / 干线记录 age 超期）。

## 风险与守恒

- **Memory 有界**：每外矿房一条干线记录，房间数受一期 spawnShareCap 上限约束；
- **行为门基线**：remote-mine 场景扩展断言（路网放量 / 维修任务 / 配比切换），
  其余场景逐位一致不动；speedrun 场景无外矿，不受影响；
- **不引入「私服/官服」分叉**：road 规划对环境无感知。
