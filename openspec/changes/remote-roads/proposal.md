# Proposal: remote-roads（外矿二期·路网）

## Why

外矿一期（phase4-remote-intel）落地了多房 Intel / 选点状态机 / 能源闭环 / 安全暂停 / 收益反馈，
但外矿采集与搬运仍走原生地形移动：跨房长途裸地往返，fatigue 使实际吞吐随距离劣化，
且无路网资产可维护。旧链 `externalRoad.ts`（PathPlanner / RoadBuilder / RoadMaintain，2070 行）
承担过这职责，已在 C 波删除。契约 `docs/nexus-design/13` §24.2 二期要求以 Nexus 结构
（任务板 / 账本 / Broker / planner 域）重建：**外矿路网规划、放工地、维修，路面配比搬运体**。

## What Changes

- **路网规划**（`modules/planner/`）：active 外矿房 → 母房 storage 的 PathFinder 干线规划，
  逐房限频（CPU 预算内）、结果落 `Memory.Nexus.layout.roads`（含已放量/待维修标记）；
- **放工地**：路网干线经既有 createSite 意图管线放量（复用 planner 域 sitePlacement 的
  dedupe/RCL 门/槽位预算），不新建直连调用；
- **维修**：remote planner 在巡查 active 房时登记 `remote:repair:` 任务（hits 低于阈值的外矿路段），
  路面配比搬运体（repair 消耗的能量经 remote 账本折叠，净收益口径不变）；
- **搬运体配比**：counts.ts 按 roadCoverage（干线已放量比例）切换搬运体 WORK 配比
  （有路 → 少 WORK 走得快，无路 → 多 WORK 爬得动），孵化消费端零改动；
- **config**：`REMOTE_CONFIG.roads`（规划间隔 / 维修阈值 / CPU 预算 / 配比档位）。

## Impact

- 代码：`src/modules/planner/`（新增 roadPlanner）、`src/modules/economy/remote/`（planner/counts 扩展）、
  `src/config/remote.ts`
- spec：`openspec/specs/` 增 remote-roads 能力增量
- 验证：sim remote-mine 场景扩展断言（路网放量 / 维修任务 / 配比切换），全场景门逐位一致基线不动
