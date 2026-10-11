# Proposal

## Why

Phase 1 已跑通单房间能源闭环，但搬运仍是「看到货就搬」的即时反应，Spawn 替补用固定提前量估算，采集没有固定工作位，系统无法回答「吞吐是否达标、瓶颈在哪」。按 docs/nexus-design/14 路线图进入 Phase 2：让采集与运输从被动响应升级为可计算的资源流，使吞吐接近设定目标、Spawn 不因调度错误闲置、Memory 长期运行不无界增长。

## What Changes

- **资源账本**（docs/nexus-design/06 §6.1/§6.6）：按房间跟踪库存/可用库存/滚动生产与交付速率，支持 reserve/commit/release 预留承诺与超时清理，为后续跨系统（扩张/工业）避免重复花同一笔能源打地基。
- **运输目标配额**（docs/nexus-design/06 §6.4）：haul 目标从「任意最近货源」改为货源/目的地明确的资源流——目的地按优先级与最低库存保障（Spawn/Extension 优先）竞争运力，估算往返耗时，空载回程可承接新任务。
- **固定采集工作位**（docs/nexus-design/06 §6.3、docs/nexus-design/17 §17.4）：为每个 Source 选定固定工作位并持有（与既有 work-tile 保护衔接），规划 Source 旁 Container 放置（RCL 达标后产生建造任务），矿工驻点稳定生产、运输职责进一步向 carrier 分离。
- **路口拥堵检测**（docs/nexus-design/08 §8.4/§8.6）：基于既有 BetterMove 信号统计 blockedCount/等待时长/路口堵塞频率，连续拥堵触发让路或路径重估；本期只做检测与响应，不重写交通管理。
- **替补窗口实装**（docs/nexus-design/07 §7.5）：将 `spawnTime + 固定 120` 升级为按岗位路径实测的 `spawnTime + travelP95 + 余量`，使 phase1 spec 的替补契约真正达标；关键岗位允许短暂重叠，廉价岗位不重叠。
- **低频经济模型**（docs/nexus-design/06 §6.7/§6.8）：低频（降频运行）估算采集产能、物流吞吐、Spawn 闲置与升级效率，输出瓶颈诊断（如「采集多交付少 → 优先补运输」），据此调整搬运运力目标；新增 docs/nexus-design/06 §6.8 指标并接入 HUD。

## Capabilities

### New Capabilities

- `resource-ledger`：房间资源账本——库存/可用库存区分、滚动生产/交付速率、预留承诺（reserve/commit/release/过期）与有界存储。
- `transport-quota`：运输目标配额——haul 任务的目的地优先级与最低库存保障、货源绑定与批量估算、空载回程承接。
- `harvest-worksite`：固定采集工作位——每 Source 固定工作位选择与持有互斥、Source 容器放置规划、矿工驻点稳定性。
- `traffic-monitor`：路口拥堵检测——堵塞计数/等待/路口频率的滚动统计与拥堵响应信号，统计有界。
- `economy-model`：低频经济模型——产能/吞吐/闲置的周期估算、瓶颈诊断输出与运力目标调整、§6.8 指标接入。

### Modified Capabilities

（无——主 specs 尚未从 phase0/phase1 同步；替补窗口在本期是让实现满足 phase1 既有需求契约的实装修正，规格行为不变。）

## Impact

- **新增模块**：`src/modules/economy/ledger.ts`（账本）、`src/modules/economy/quota.ts`（配额）、`src/modules/economy/model.ts`（经济模型）、`src/modules/world/worksite.ts`（工作位）；拥堵检测挂在 `src/modules/movement/` 既有钩子旁（保持 vendor 文件不动，新增伴生统计文件）。
- **修改**：`src/modules/economy/planners.ts`（haul 接配额）、`src/modules/spawning/spawnDirector.ts`（替补提前量）、`src/modules/world/perception.ts`（快照补充容器/塔等账本所需观测）、`src/core/world.ts`（快照契约扩展）、`src/store/memorySchema.ts` + `migrations.ts`（schema v3：ledger/拥堵统计/经济模型状态，全部有界）、`src/config/profile.ts` 及变体 profile（新模块开关）、HUD（指标行）。
- **不动**：TaskBoard/Allocator/Broker 架构与阶段顺序（Phase 1 承诺：后续阶段只加任务源与能力，不改架构）、`movement/index.ts` vendor 代码本体。
- **验收对齐**：docs/nexus-design/14 Phase 2——吞吐接近目标、Spawn 不长期闲置、soak test Memory 有界。
