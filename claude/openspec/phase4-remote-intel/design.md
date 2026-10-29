# Design

## Context

- 设计契约：docs/nexus-design/24（外矿迁移）；全仓迁移现状：docs/nexus-design/25。本文记录一期的实现决策与否决的备选。
- 走查结论（2026-10-28，docs/24 §24.3）：跨房单位被当作死亡并丢记忆；主线外矿任务每 tick 被清扫取消、scout 无法孵化；旧外矿链主线不运行。
- 承接点：TaskBoard 的 dedupeKey / 租约 / 对账；quota 主干 `destinationQuotas` 与 `committedTo`；账本 `rates` 累加与 EMA 折叠；`world/worksite.ts` 用 `Room.Terrain` 算工位；威胁模型的衰减与置信度；`firstArrivedAt` 实测路程；`workforce.ts` 的 storage 水位 / 盈余项。
- 约束：Nexus 架构不动摇（TickModule / 任务板 / 提案制 / Broker 唯一原生调用点）；零硬编码；P1-14 校准过的家内口径不动；sim 是主线回归口径。持久化根是 `Memory.Nexus`。

## Goals / Non-Goals

**Goals:**

- 单位在任何可见房都被正确计数与驱动，只有真实死亡才清理记录。
- 能源外矿形成闭环：侦察 → 评估 → 采集入容器 → 搬运回母房 → 实测净收入 → 准入 / 暂停 / 剔除。
- 旧外矿链的能源外矿能力与手动指定方式迁入主线。
- 单殖民地、无外矿时，家内行为与变更前一致。

**Non-Goals:**

- 外矿路网（二期）、外矿防御派兵（三期）、SK / 中央房与外矿元素矿（四期）、旧链删除（收尾）——docs/24 §24.2。
- claim / settling / 扩张（Phase 5）；多殖民地家内定编拆分与 spawn 互借。
- `agentSystem.ts:1172` 的 `in` 判定修正、两套孵化器并存等全仓问题（docs/25 列出，另立变更）。

## Decisions

### D1 世界快照加 `units` / `visible`，不改 `world.rooms` 语义

规则：数单位用名册，问「某房里有谁」用房间快照。名册口径的消费方逐一列在 docs/24 §24.5.2（存活、死亡、`runAgents`、在岗计数、替补窗口、分配器候选、交通、速率）。

备选（否决）：把非己方可见房塞进 `world.rooms`——源数加总、库存、定编都假定它只含己方房。

备选（否决）：只改 `aliveNames`——单位不再误判死亡，但在外部房仍不被驱动、不被计入在岗。

### D2 名册驱动范围取「行为最小变化」

己方房内与现状完全一致（含原型 `exec()` 分流）；外部房只驱动持有 Nexus 任务指针的单位。编队与扩张单位继续由各自入口驱动。

备选（否决）：外部房也走原型 `exec()` 分流——主线 harvester / carrier 带 `memory.role`，空闲时会在外矿房跑旧角色执行器；编队成员还会被 `team.exec()` 与 AgentSystem 双重驱动。

### D3 Intel v11 只加可选字段，三态由读取函数统一表达

缺省 = 未知，`null` = 已知为空，过期由 `lastSeen` 现算；`kind` 由房名推导。迁移补 `kind`，并把 `OutMineData[home].energy` 迁为钉选。

备选（否决）：每字段单独 `seenAt`——docs/02 §2.5 明确不为每字段打时间戳；外矿用到的字段随同一次观测刷新。

### D4 外矿状态挂在殖民地下：`Memory.Nexus.remotes[home].rooms[room]`

外矿房 Intel 在 `rooms[room]`（事实），选点状态在 `remotes`（决策），写入方分开。同一房对不同殖民地的路程与价值不同，不能放在房间记录上。docs/19 §19.4 的 `rooms[].expansion` 留给 Phase 5。

### D5 准入用推导口径，唯一策略参数是 `spawnShareCap`；钉选保留手动控制

净收入与 spawn 占用由常量、体型、路程推出；按 `net / s` 降序准入至 `spawnShareCap × spawn 数`。钉选跳过净收益门槛但不跳过安全规则；禁用永不准入。

备选（否决）：沿用旧链 0/1 背包——价值/重量含 `0.04`、`75|100`、`1.5|2`、SK `−4.5/+50`、预定 `−1.3/+5` 等手调系数，预算用部件数近似 spawn 时间。首期候选 ≤ 8，降序贪心与背包差别可忽略，推导口径可直接用实测校验。

### D6 开闸要求母房有 storage

外矿能量需要一个汇。quota 主干在有 storage 时有兜底目的地；消化由 `workforce.ts` 已有的 storage 水位 / 盈余项完成。

备选（否决）：沿用 `rcl >= 3`，并把外矿收入接入 `harvestIncomeOf` / `upgradeWorkTargetOf`——要动 P1-14 校准过的家内口径，需要重新跑校准；且 RCL3 无 storage 时 spawn / ext 满后外矿搬运体会原地持能。留给维护者裁决（docs/24 §24.16）。

### D7 外矿任务复用现有 kind，`remote:` 前缀，经济规划器清扫豁免

`roomName` 恒为母房；`economy/planners.ts:286` 的清扫跳过 `remote:` 前缀；外矿任务只由 `remote-planner` 生成与取消。

备选（否决）：新增 `remote_*` kind——handler 与租约政策和本地同名任务几乎一致，区别只在目标位置。

备选（否决）：外矿任务挂外矿房的 `roomName`——清扫不会误伤，但分配器资格、定编归属、在途承诺都要按殖民地反查，绕得更远。

### D8 外矿单位与家内单位隔离：`UnitRecord.remote`

外矿任务只分给同殖民地、带 `remote` 标记的单位；家内任务只分给不带标记的单位。在岗计数分开抵扣。

备选（否决）：混用——1:1 MOVE 的外矿体会抢家内源，5W 家内矿工会被派去外矿；「无外矿时家内定编不变」无法保证。

### D9 外矿搬运进 quota 主干，交付只在母房

`destId` 由 `destinationQuotas` 分配，在途承诺照常；交付量另记 `ledger.rates["remote:<home>:<room>"]`。

备选（否决）：外矿搬运自带交付选择（旧链 `pickBestCarryTargetRoom`）——在 quota 外再长一套配送决策，重蹈 workforce-logistics D3 否决的「第二配送中枢」。

### D10 预定走 Broker 新动作；`scout` / `reserver` 进主线孵化

`reserveController` 加入 ActionBroker；`SpawnUnit` 与 BodyFactory 增加 `scout`、`reserver`（unit code `RSV` 已存在）；`unitForTaskKind` 补两条映射。`claim` 分支绕过 Broker 的问题不在本变更修。

### D11 外矿威胁与全局隔离

`RoomThreatRecord.scope`；`maxThreatScore` 只取 `home`。外矿受袭不抬高家内 defender 编制、不触发 war 姿态、不关快递。`updateRoomThreat` 扩为对外矿集合调用（可见评分、不可见衰减），`proximityFactor` 取 1。

备选（否决）：外矿威胁计入全局——家内 defender 去不了外矿（defend 任务只在己方房生成），只会白白挤占孵化，并把全局姿态切到 war。

### D12 删除 `remoteMining.ts` 与旧链收入提供方注册

旧链收入提供方只服务旧孵化链且恒返回 0；移除注册后 `estimateRoomEnergyIncome` 回到回退估算（`roomWorkforce.ts:427-428`），影响的是旧孵化链的升级插队判断。这是行为变化，1.x 之外单独验证（tasks 7.2）。

## Risks / Trade-offs

- **名册改动牵动热路径**（`runAgents`、分配器、在岗计数）。缓解：`units` 复用感知已建的 `CreepSummary`；1.6 对照 CPU p95。
- **两套孵化器并存**（docs/25）：旧任务池孵化的单位名字形如 `H#XXXX`，主线在岗计数看不到它们。外矿编制只由主线 SpawnDirector 承接，外矿单位隔离后不受影响；但家内计数的这个问题依旧存在，不在本变更修。
- **旧角色的移动意图在 Broker 提交时被清空**（docs/25）：外矿单位全部由 AgentSystem 经 Broker 驱动，不受影响。
- **sim 覆盖不到 SK 与 NPC 行为**：房间类型用纯函数用例；暂停 / 恢复用状态机用例 + 私服。
- **门禁**：第 0、1 节可先行；第 2 节起受 P1-14 门禁约束。

## Migration Plan

1. 第 0、1 节单独合入（schema 不变）。
2. 第 2 节起合入时 schema v10 → v11：补 `kind`；`OutMineData[home].energy` → `remotes[home].rooms[room].manual = "pin"`；`centerRoom` / `RoadData` / `highway` 不动。
3. 回滚：v11 新字段全部可选，旧代码忽略；`remotes` 子树旧代码不读。注意 `calibration.ts` 对不可识别版本会整体重建 `Memory.Nexus`（docs/25），回滚前确认旧版本代码认识 v11，或先把 `schemaVersion` 写回 10。

## 附录：旧外矿链去向

见 docs/nexus-design/24 §24.11（逐项迁移表、Memory 迁移、删除清单）。
