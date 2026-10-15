# Tasks

> 编排纪律（见 design.md D7）：
> - **轨道内串行，轨道间按依赖推进**；T1 与 T2 可真正并行（文件集不相交），T3 须待 T2，T4 须待 T2+T3。
> - **文件独占**：T2 独占 `store/memorySchema.ts`；T4 只向 T2 提迁移需求，不并发改 schema。
> - `config/cluster.ts` 拆分：T3 写槽位/指标参数，T4 只追加编队类型与领队参数（顺序约束）。
> - `core/world.ts` 的 `harvestIncomeOf` 由 T1 独占，其他轨道不得并发修改。
> - **T1 内三项改动（定编合一 / 体型分档 / 兜底闸门）必须同拍落地**，禁止拆成三次提交分别 A/B（docs/bugs 校准史：单杠杆必被反噬）。

## 1. T1 — 采集供给收敛（主线 A，P1-14）

> 本组三改同拍。独占文件：`spawnDirector.ts`、`legacy/spawnRules.ts`、`economy/workforce.ts`、`productionGate.ts`、`utils/rushBodies.ts`、`spawning/bodyFactory.ts`、`config/economy.ts`、`core/world.ts`。
>
> **校准结论（2026-10-15 实测，见 docs/bugs (四)）**：采集与升级的体型密度是同一机制的
> 配套杠杆，必须同拍。只改采集时升级吞吐 −27.5%，补上升级体密度后转正 +18.9%。
> 1.2/1.3 的两个开关默认**关闭**（`harvestTierEnabled` / `legacyHarvestStandby`），
> 留作 A/B 通道；其收敛口径需与定编一并成套校准，不得单点启用。

- [x] 1.1 workforce 导出采集定编单一来源（源饱和口径，每源一驻点），供两孵化路径消费；验证：`spawnDirector.unitTargets.harvester` 已改为逐房 `harvesterTargetTotal` 求和，两路径消费同一 `harvestStaffingOf` 公式
- [ ] 1.2 采集体型收入感知定档：**开关默认关闭**。实测开启后同能量少孵约 40% 编制（remote-mine 13→7），触及外矿防回退断言；按「采集/升级密度成套」口径另立校准后再启用（docs/bugs (四)）
- [ ] 1.3 legacy 采集让位闸门：**开关默认关闭**。收敛到「每源一驻点」会减 1 只编制（13→12）且低估外矿排队量；留 `legacyHarvestStandby` 作 A/B 通道
- [x] 1.4 源饱和口径实测分解：按源记录采集工时间去向（在源/往返/等待），按房按源定长有界存储；验证：`harvestTimeSplitOf` 随定编同拍刷新，消失的源即清理（不随 tick 增长）
- [x] 1.5 sim 四场景回归：验证 `npm run sim` —— boot ✓ L3@17371（基线 19721，改善）、remote-mine ✓（阈值按大体型口径重设，见下）、arena/sprint 断言本就未过未恶化、cpu p95 无劣化、零未捕获异常
- [x] 1.6 文档同步：docs/bugs 追加 (四) WORK 密度优先条目含三方对照实测表；remote-mine 场景阈值重设附产能口径取证说明

## 2. T2 — C3 异构槽位 schema（可与 T1 并行）

> 独占文件：`store/memorySchema.ts`。T4 的迁移需求并入本组。

- [ ] 2.1 新增 `SquadSlotDef`（`{ taskKind, capabilities, count }`）并把 `SquadRecord.slots` 由标量改为槽位定义数组，`taskKind`/`capabilities` 降为默认槽位定义；`CURRENT_SCHEMA_VERSION` 10 → 11；验证：typecheck 绿（specs `squad-heterogeneous-slots` 槽位以定义数组表达 / `cluster-squad` 编队只持有槽位）
- [ ] 2.2 迁移把旧 `slots: n` 展开为 n 个同质槽位定义，`expiresAt`/`members` 不变，坏条目回退安全空形态并告警；迁移幂等；验证：迁移用例（空数据/旧标量/合法保留/非法清洗/坏条目/幂等）node 直跑全绿（同 spec 槽位结构变更向后兼容）
- [ ] 2.3 承接 T4 提交的外矿协作组（`SquadKind = "remote"`）迁移/清洗需求（同批次落地）；验证：typecheck 绿，`SquadKind` 联合类型含 remote
- [ ] 2.4 `cluster/model.ts` 槽位模型改为遍历数组（`applyRequest`/`clampSlots`/槽位计数），`slotDedupeKey` 支持按槽位序号稳定生成；验证：typecheck 绿，槽位期望成员数 = 数组长度

## 3. T3 — C3 消费侧适配 + C6 收益指标（须待 T2）

> 文件：`cluster/index.ts`、`visuals/statusPanel.ts`、`core/metrics.ts`、`config/cluster.ts`（槽位/指标参数部分）。

- [ ] 3.1 `cluster/index.ts` 维护循环改为遍历槽位定义数组，每槽位按其 `taskKind`/`capabilities` 生成任务；disband 按命名空间取消全部槽位任务（不释放回池）；验证：编队建队→槽位被认领→解散后槽位任务 cancelled（同 spec 异构槽位生命周期一致）
- [ ] 3.2 `statusPanel.ts` 编队展示行适配数组结构；grep 复核 `slots`/`capabilities`/`taskKind` 标量用法零残留；验证：typecheck + lint 绿，grep 干净
- [ ] 3.3 C6 收益指标入 telemetry：记录协同前后战损/击杀/存活时长对比，基线取编队建立前同房等长窗口，按房有界；验证：sim/控制台可读出对比与基线（同 spec 编队收益指标入遥测）
- [ ] 3.4 协同行为开关默认关闭、开启判据阈值入 `config/cluster.ts`；验证：默认部署不开领队/外矿协同，指标为负或缺失保持关闭（同 spec 协同行为默认关闭并以指标为开启门）

## 4. T4 — C4 领队逻辑 + C5 外矿协作（须待 T2+T3）

> 文件：`cluster/` 内领队协调、`config/cluster.ts`（编队类型/领队参数部分）。

- [ ] 4.1 C4 领队共享目标写入编队记录，只影响目标**选择**，意图仍经 ActionBroker 提交，编队层零游戏 API 调用；解散即清除共享目标；验证：grep 编队层无游戏 API 直调，目标选择变更走统一仲裁（同 spec 领队协调经意图网关表达）
- [ ] 4.2 C5 外矿协作组 `SquadKind = "remote"` 需求方接入外矿场景，依赖 T3 指标判净收益为正；验证：外矿场景下 remote 编队按需建队/解散，净收益指标为正才保留（同 spec 协同行为默认关闭并以指标为开启门）
- [ ] 4.3 文档同步：更新 docs/nexus-design/20 §20.7.2 C3/C4/C5/C6 勾销与 docs/nexus-design/14 进度；验证：文档与实现一致

## 5. 集成验收

- [ ] 5.1 sim 全场景回归（sprint / boot / remote-mine / arena）零未捕获异常、CPU 不劣化；验证：`npm run sim` 报告 —— boot/remote-mine 绿，cpu p95 持平，arena/sprint 存量失败未恶化（RCL4 验收线属 P1-14 范畴，本次未触及）
- [x] 5.2 变更族文档收口：更新 openspec/changes 下受影响既有变更族（fix-p1-14-rush-sprint / workforce-logistics）的重复待办勾销状态，避免同一验收门在两族重复留档；验证：openspec validate 全绿、无重复待办残留。【2026-10-15 收口】主责划分：P1-14 RCL4 验收（§7.2）、P1-14 文档勾销（§7.4）、私服冲级实测（§7.5）、rcl-sprint 指标基线对照（§3.5）留 `fix-p1-14-rush-sprint`；`workforce-logistics` §5.2/§5.4/§5.5 改为交叉引用、§5.3 收窄为 boot 回归与 TTL churn；C3/C4/C5/C6 归本族，`nexus-cluster-squads` §7.3 与 §8.1-§8.3 改为指针与状态说明。RCL4 未达成，相关门一律不勾销。验证：`openspec validate --all` 11 passed / 0 failed（`--strict` 全量下历史族 spec delta 的 RFC 2119 告警为既有项，收口前即存在，未新增）