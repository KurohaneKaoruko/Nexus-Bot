# remote-roads 二期：外矿路网

delta: specs/remote-roads/spec.md

## ADDED Requirements

### Requirement: 路网干线规划

远端系统 SHALL 对每个 active 外矿房规划「外矿容器 → 母房 storage」的干线路径，
规划频率受 `REMOTE_CONFIG.roads.planInterval` 限频，单轮 PathFinder 次数受
`evalPerRun` 约束；规划结果（逐房间坐标序列与放量状态）SHALL 落
`Memory.Nexus.layout.roads`，条目有界（每外矿房一条干线记录）。

#### Scenario: active 房触发规划

- **WHEN** 外矿房转入 active 且无干线记录
- **THEN** 下一轮 remote-planner 主循环节点产出该房干线（PathFinder search，
  plain/swamp 代价按配置），写入 `layout.roads[roomName]`
- **AND** CPU 不足时本轮跳过，不产生部分路径

#### Scenario: 暂停房不规划

- **WHEN** 外矿房处于 paused（威胁或收益）
- **THEN** 不新增该房干线规划，已有路段维修登记同样冻结

### Requirement: 干线放量走意图管线

路网干线 SHALL 经既有 createSite 意图（`submitIntent` + construction pipeline）
放量，遵守 sitePlacement 的 dedupe / 槽位预算 / RCL 门；SHALL NOT 在
roadPlanner 内直连 `createConstructionSite`。

#### Scenario: 干线逐段放量

- **WHEN** 干线路径已规划且母房 RCL ≥ 放量门槛
- **THEN** 路段按距母房由近及远进入工地队列（受每 tick 放量限速），
  dedupeKey 形如 `remote-road:{home}:{room}:{x}:{y}`

### Requirement: 外矿路段维修

remote planner 巡查 active 外矿房时 SHALL 对 hits 低于
`REMOTE_CONFIG.roads.repairBelow` 的干线已建路段登记 `remote:repair:` 任务
（dedupeKey 含房间与坐标，期限与 scout 同口径）；容器维修（一期已有）
与路段维修共存于同一巡查节拍。

#### Scenario: 路段损毁出任务

- **WHEN** active 房干线某已建路段 hits/maxHits < repairBelow
- **THEN** 任务板出现 `remote:repair:{room}:{x}:{y}` 任务，奖励口径与
  一期容器维修一致（能量经 remote 账本折叠）

### Requirement: 路面配比搬运体

counts.ts SHALL 按 `roadCoverage`（该外矿房干线已放量路段占比）选择搬运体
WORK 配比档：coverage ≥ 满档阈值用「轻载快走」配比，低于阈值用「重载慢走」
配比；配比切换 SHALL 只影响新孵化单位，存量单位不重训。

#### Scenario: 路网成型换轻配比

- **WHEN** 外矿房干线 coverage 从 0 升到 ≥ 满档阈值
- **THEN** 该房后续孵化的搬运体按轻载配比（更少 WORK / 更多 CARRY-MOVE 交替）
- **AND** 存量重载搬运体继续服役至自然淘汰
