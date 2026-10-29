# Proposal

## Why

- 外矿是 Rosmarin 迁入 Nexus 时尚未迁移的能力。旧外矿链（`modules/external/*`，约 4.8k 行）在主线不运行；主线自己的 `economy/remoteMining.ts` 也没有运转（docs/nexus-design/24 §24.3 B）：
  - 外矿采集任务被经济规划器的「主体消失」清扫每 tick 取消（`economy/planners.ts:286-293`）；
  - scout 无法孵化（`bodyFactory.ts:65-83` 不含 scout，`unitForTaskKind` 无 scout / reserve 分支）；
  - 往返采集、无容器 / 搬运 / 预定，回归不检查到账。
- 走查同时发现一个现网缺陷（docs/24 §24.3 A）：感知只快照己方房，单位跨出己方房的那一 tick 进入 `world.dead`，`runSpawnDirector` 随即删除它的 `units` 记录**和 `Memory.creeps`**（`spawning/spawnDirector.ts:220-229`）。编队、战争角色依赖 `creep.memory.role` / `targetRoom`，扩张单位同样跨房——它们出门即丢记忆。在岗计数、替补窗口、分配器候选、交通与速率统计也都按快照数单位。
- 路线图 Phase 4 为 ⬜；workforce-logistics 把外矿列为「步 3 主体」；docs/nexus-design/20 待办 C5 依赖「docs/10 落地」。

## What Changes

本变更是外矿迁移的一期（docs/24 §24.2）：

- **殖民地名册（缺陷修复）**：世界快照新增 `units` 与 `visible`；存活判定、死亡发现、在岗计数、替补窗口、分配器候选、交通与速率统计改按名册；`runAgents` 遍历名册，驱动范围按「己方房内与现状一致、外部房只驱动持有 Nexus 任务的单位」。`world.rooms` 语义不变。
- **多房 Intel**：`RoomIntelRecord` 扩展 kind / 源坐标 / 控制器坐标 / owner / 预定 / invader core / 敌对结构；三态读取；schema v10 → v11（含 `OutMineData.energy` → 钉选的数据迁移）。
- **侦察**：Intel 驱动，到达即完成，带 deadline；scout 可孵化。
- **外矿选点**：`remote-planner` 与 `Memory.Nexus.remotes`；开闸条件（档位 `remoteMining`、母房有 storage、非 survive）；状态机带原因与驻留；推导口径的净收入与 spawn 占用；手动钉选 / 禁用。
- **外矿能源闭环**：`remote:` 任务（采集 / 容器建修 / 搬运 / 预定 / 侦察）、经济规划器清扫豁免、容器工位、quota 主干交付到母房、ActionBroker `reserveController`、`scout` / `reserver` 进 `SpawnUnit` 与 BodyFactory、外矿单位与家内单位隔离（`UnitRecord.remote`）、按殖民地追加外矿编制。
- **外矿安全**：外矿房威胁观测与衰减、`RoomThreatRecord.scope` 与全局隔离、暂停 / 撤回 / 恢复、剔除条件。
- **收益反馈**：外矿交付速率、实测净收入 EMA、持续亏损剔除。
- **控制台迁移**：`Nexus.remote.pin / ban / clear / list` 取代 `mine.add / adds / remove / list` 的能源外矿部分。
- **移除**：`economy/remoteMining.ts`；`prototype/features.ts` 中的 `registerOutMineIncomeProvider` 注册。

## Capabilities

### New Capabilities

- `colony-roster`: 名册口径的单位存活判定、计数与驱动覆盖。
- `room-intel`: 多房 Intel 记录、三态读取、房间类型推导、新鲜度与有界清理、旧外矿数据迁移。
- `remote-selection`: 每殖民地外矿集合、开闸条件、状态机、推导口径的准入与剔除、手动钉选 / 禁用。
- `remote-energy-mining`: 外矿任务形态与清扫豁免、容器 / 搬运 / 预定、孵化与单位隔离、按殖民地定编、能量去处。
- `remote-safety`: 外矿威胁观测与全局隔离、暂停 / 撤回 / 恢复、剔除条件。

### Modified Capabilities

（无——openspec/specs 主规格当前为空。）

## Impact

- **代码**：`core/world.ts`、`modules/world/perception.ts`、`modules/agents/{agentSystem,actionBroker}.ts`、`modules/tasks/{index,allocator}.ts`、`modules/economy/{planners,ledger,model}.ts`、`modules/economy/remote/`（新）、`modules/spawning/{spawnDirector,bodyFactory}.ts`、`modules/movement/trafficMonitor.ts`、`modules/defense/{index,threatModel}.ts`、`core/store/{memorySchema,migrations}.ts`、`utils/roomName.ts`（新）、`config/remote.ts`（新）、`console`（`Nexus.remote.*`）。
- **删除**：`modules/economy/remoteMining.ts`；`registerOutMineIncomeProvider` 的注册调用。
- **不动**：`modules/external/*` 旧外矿链文件（二到四期迁移后收尾删除）；`OutMineData.centerRoom / RoadData / highway`；`strategy/expansion.ts`；`agentSystem.ts:1172` 的 `in` 判定（附带发现，另立变更）。
- **Memory schema**：v10 → v11。
- **回归**：`sim/remote-mine.sim.ts` 扩展、新增 `sim/remote-threat.sim.ts`、新增跨房单位取证场景；boot-from-scratch / rcl-sprint 不回退（两者为 rush 档，外矿关闭）。SK 房识别走纯函数用例 + 私服。
- **文档**：docs/nexus-design/24、25；docs/14 进度快照；docs/20 C5 依赖；docs/22 数据所有权表。

## 附带发现（不在本变更范围）

- `agentSystem.ts:1172` 以 `in` 判断 `Set` 成员，恒为 false，无任务指针的单位全部落入原型 `exec()`。
- `strategy/expansion.ts` 的房名拼接不区分 W/S；预定判断两分支同为 `return name`。
- 全仓迁移现状中的其他缺陷见 docs/nexus-design/25。
