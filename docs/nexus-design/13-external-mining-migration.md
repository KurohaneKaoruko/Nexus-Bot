# 24. 外矿迁移：旧外矿链 → Nexus 主线（Phase 4）

> 本文是 Rosmarin 时代外矿能力迁入 Nexus 架构的契约，也是 Phase 4（多房间 Intel 与远程采集，Phase 进度见 `docs/Nexus-Bot-02-重构指导.md`）的落地件。
> 它承接 `10-legacy-removal-ledger.md` 的删除门禁原则；外矿协作组属 Phase 3+ 实装域（`02-architecture-charter.md` 集群条目）。
> 全仓迁移现状见 `12-legacy-bot-migration-map.md`；一期实现变更：`openspec/changes/phase4-remote-intel/`。
> 终点：外矿能力在 Nexus 主线达到旧链水平后，删除 `modules/external/` 下的旧外矿链与对应旧角色（**休眠旧链已于 C 波删除**，本契约约束的是主线新外矿能力对旧链能力的对齐与剩余旧角色退场）。

> ⚠ **基线适配（2026-10-29 整理入仓）**：本文走查基于 v1.0.0（`73d3295`）。dev 已演进百余提交，部分结论被超越——最显著：旧外矿链 `modules/external/` 已整链删除（legacy-consolidation-b C 波，见 `10-legacy-removal-ledger.md`）；Phase 进度以 `docs/Nexus-Bot-02-重构指导.md` 为权威。file:line 引用使用前对照当前代码复核。

## 24.1 背景：旧链有什么，主线现在有什么

**旧外矿链**（原 `modules/external/externalMine.ts`、`externalScheduler.ts`、`outMine.ts`、`mine/` 六文件，约 4.8k 行，**已于 2026-10-29 经 legacy-consolidation-b C 波删除**，见 `10-legacy-removal-ledger.md`）在 Rosmarin 中具备：

- 能源外矿：0/1 背包选点、外矿采集 / 搬运 / 预定 / 建造孵化、积压加量。
- 外矿路网：PathPlanner 规划、定期重建。
- 外矿防御：out-defend、out-invader、双人组。
- 中央九房 / SK 房：out-attack 护航、固定体型采集、外矿元素矿。
- 收入分析、可视化，以及控制台 `mine.*` / `road.*`。

**它在 Nexus 主线不运行。** `outMine()` / `runEnergy` / `runCenter` 没有调用方；旧外矿角色（scout / reserver / out-*）在 `roleRegistry` 里没有执行器。仍在运行的只有三处：

1. 收入提供方：恒返回 0，只影响旧孵化链。
2. `getBuiltRoadCoverage`：恒返回 0。
3. 控制台命令。

**主线外矿**只有 `economy/remoteMining.ts`（95 行），而且实际没有运转，见 §24.3。

所以外矿是一次「功能迁移」：按 Nexus 的任务板 / 账本 / Broker 结构重建旧链的能力，分期达到旧链水平，然后删除旧链。

## 24.2 分期

| 期 | 内容 | 旧链来源 | 去向 | 变更 |
|---|---|---|---|---|
| **一期** | 殖民地名册（缺陷修复）、多房 Intel、侦察、能源外矿闭环（采集入容器 / 搬运 / 预定）、外矿暂停与撤回、手动指定外矿的控制台迁移 | `externalMine.ts` 能源部分、`mine.*` | `modules/economy/remote/`、`world/perception`、`console` | `phase4-remote-intel` |
| **二期** | 外矿路网：规划、放工地、维修，路面配比搬运体 | `externalRoad.ts`（PathPlanner、RoadData） | `modules/planner/`（路网规划）+ remote 的 repair 任务 | 另立 `remote-roads` |
| **三期** | 外矿防御：invader / invader core 清理、玩家骚扰应对 | `externalMine.ts:2014-2069`（out-defend / out-invader / 双人组） | 防御域作为需求方 → `cluster-squads`（C5，`SquadKind = "remote"`） | 另立 `remote-defense` |
| **四期** | 中央九房 / SK 房、外矿元素矿 | `externalMine.ts:2483-2555`（runCenter、out-attack、out-mineral） | remote 扩展 keeper 房类型 + 编队护航 | 另立 `remote-keeper` |
| **收尾** | 删除旧外矿链文件、旧外矿角色定义、旧控制台命令、`OutMineData.energy/centerRoom/RoadData` | 见 §24.11 | — | 随四期或单独变更 |

每期都是独立 openspec 变更，按项目惯例带验证。本文写满一期，二到四期写到接口与去向，具体设计在各自变更里展开。

## 24.3 现状核查（2026-10-28，代码走查）

标注「推断」的条目需要 tasks 0.x 的 sim 取证。

**A. 单位离开己方房即被当作死亡（现网缺陷，波及外矿之外）**

1. 感知只快照己方房（`modules/world/perception.ts:88`）；快照的 `creeps` 来自该房 `FIND_MY_CREEPS`（`:183`）。
2. `aliveNames`（`core/world.ts:193`）只数快照单位，感知据此产出 `world.dead`（`perception.ts:292`）。单位跨出己方房的那一 tick 就进入 `world.dead`。
3. `runSpawnDirector` 对 `world.dead` 删除 `units[name]` **和 `Memory.creeps[name]`**（`modules/spawning/spawnDirector.ts:220-229`）。此后该单位的 `creep.memory` 是空对象。
4. 受影响的不只外矿：
   - 编队与战争角色依赖 `creep.memory.role` / `targetRoom`（`teams/runtime/TeamController.ts:47`、`teams/roles/double-attack.ts:29`、`teams/roles/aio.ts:228`）；
   - 扩张模块派出的单位同样会跨房。
   - （推断）这些单位出门后丢失角色与目标。
5. 其他按快照数单位的地方，同样把外出单位当作「不存在」：
   - 在岗计数：`spawnDirector.ts:246-253`，外出即缺编，会触发重孵；
   - 替补窗口：`spawnDirector.ts:343-359`；
   - 分配器候选：`modules/tasks/index.ts:36-38`；
   - 拥堵记录：`modules/movement/trafficMonitor.ts:39`；
   - 动作速率：`modules/economy/model.ts:123`；
   - 威胁统计在威胁活跃期把它计为战损：`modules/defense/threatModel.ts:169`。
6. AgentSystem 只驱动快照里的单位（`modules/agents/agentSystem.ts:1157`）；单位进入非己方房后不再产出意图。

**B. 主线外矿实际不运转**

7. 外矿采集任务每 tick 被取消重建：经济规划器在 `planRemoteHarvest` 之前执行（`economy/index.ts:19-24`）。它的「主体消失」清扫会取消所有 `roomName = 母房`、kind ∈ {harvest, haul, fill_spawn, upgrade, build}、且不在本 tick 预期集合里的任务（`economy/planners.ts:286-293`），外矿采集任务从不在这个集合里。
8. scout 孵化不出来：`ECONOMY_ROLES` 不含 scout（`spawning/bodyFactory.ts:65-83`），`isSpawnUnit("scout")` 为 false，编制循环跳过；`unitForTaskKind` 也没有 scout / reserve 分支（`spawnDirector.ts:52-66`）。外矿采集任务只在邻房偶然可见时出现。
9. 规划直接读 `Game.rooms`，不读 Intel（`remoteMining.ts:38`）；8 个邻房不分高速路 / SK / 中央房；`owner || reservation` 一律跳过，包括自己的预定。
10. scout 到达后只清指针（`agentSystem.ts:427`），任务等租约到期又回到 available。
11. 外矿 harvester 是往返采集，交付到「任意己方房第一个有空位的 spawn」（`agentSystem.ts:910-1005`），没有容器、搬运与预定。
12. 定编把外矿任务数加进全局 harvester 编制（`spawnDirector.ts:98-111`）；carrier 编制不含外矿运量。
13. `sim/remote-mine.sim.ts` 只断言 creep 数、RCL、CPU、noErrors，不检查外矿能量是否到家。
14. boot-from-scratch 与 rcl-sprint 均为 `cpu.limit=100`，解析为 rush 档，`remoteMining=false`，外矿在这两个回归场景里是关闭的。

**C. 收入口径**

15. 旧链收入提供方只被旧孵化链读取（`roomWorkforce.ts:402-432` → `spawnMission.ts:113`、`spawnRules.ts:219`）。主线升级定编 `upgradeWorkTargetOf`（`economy/workforce.ts:178`）读的是 `harvestIncomeOf`，只算己方房的源；它另有 storage 水位 / 盈余项（`workforce.ts:89-102`、`212-225`）。

## 24.4 设计原则（本文约束）

沿用架构公约六原则（`02-architecture-charter.md`）与三循环数据所有权（`02-architecture-charter.md §22`），补四条：

- **殖民地是外矿的核算边界**：外矿的收入、成本、单位、预留都挂在母殖民地名下（EX MACHINA 蓝图 L4，`01-blueprint.md`）。外矿房自己不是 Cluster。
- **准入用推导，不用手调分数**：只比较「预计净收入/tick」与「占用的 spawn 时间」，两者都由游戏常量与路程推出（§24.7.2）。配置只放上限、迟滞和安全阈值。
- **失败要承认**：实测净收入持续为负或反复死人，外矿必须能暂停或剔除（`10-legacy-removal-ledger.md` 门禁四条件）。
- **迁移保留旧能力的使用方式**：旧链的手动指定外矿（`mine.add`）在新链中保留为「钉选 / 禁用」，旧 Memory 数据一次性迁入。

## 24.5 殖民地名册（缺陷修复）

### 24.5.1 世界快照新增两项

`world.rooms` 保持「己方房快照」，房间级的空间查询（某房的源、工地、库存）照旧读它。新增：

```ts
// core/world.ts
export interface WorldView {
	tick: number;
	rooms: Record<string, RoomObservation>;          // 不变: 己方房
	/** 新增: 本 tick 可见的非己方房轻量快照 (外矿房 + 有本方单位驻留的房) */
	visible: Record<string, VisibleRoomObservation>;
	/** 新增: 全部本方单位 (Game.creeps 一次遍历), 以名字为键 */
	units: Record<string, CreepSummary>;
}

export interface VisibleRoomObservation {
	roomName: string;
	sources: SourceSummary[];
	piles: PileSummary[];
	stores: StoreSummary[];          // 仅 container
	sites: SiteSummary[];            // 仅本方工地
	hostiles: HostileSummary[];      // 复用防御域的敌方摘要
	controller?: { owner?: string; reservation?: { username: string; ticksToEnd: number }; x: number; y: number };
	invaderCore: boolean;
	creeps: CreepSummary[];          // 本方单位 (与 units 同一批对象)
}
```

`visible` 只为外矿集合内的房和有本方单位的房建快照，CPU 上限 O(外矿房数 + 单位所在房数)。

### 24.5.2 单位口径一览

规则：**数「有哪些单位 / 有几个单位」用名册；问「某房里有谁」用房间快照。**

| 消费方 | 现状 | 改为 |
|---|---|---|
| `aliveNames`（`core/world.ts:193`） | 快照单位 | `world.units` 的键 |
| `world.dead`（`perception.ts:292`） | 上 tick 快照有、本 tick 无 | 上 tick `units` 有、本 tick 无（真实死亡） |
| `runAgents`（`agentSystem.ts:1157`） | 遍历 `rooms[*].creeps` | 遍历 `units`，上下文取 `rooms[r] ?? visible[r]`；驱动范围见 §24.5.3 |
| 在岗计数（`spawnDirector.ts:246-253`） | 快照单位 | `units`，按 `UnitRecord.homeRoom` 归属 |
| 替补窗口（`spawnDirector.ts:343-359`） | 快照单位 | `units` |
| 分配器候选（`tasks/index.ts:36-38`） | 快照单位 | `units`（资格见 §24.8.3） |
| 拥堵记录（`trafficMonitor.ts:39`） | 快照单位 | `units`；外矿房内的阻塞同样记录 |
| 动作速率（`economy/model.ts:123`） | 在快照里找执行者 | `units[actorName]` |
| 威胁战损归因（`threatModel.ts:169`） | `world.dead` | 不改代码，`world.dead` 口径修正后自然正确 |

### 24.5.3 驱动范围（行为最小变化）

- 单位在己方房：与现状完全一致，包括 `agentSystem.ts:1172` 的原型 `exec()` 分流（见 §24.12 的 `in` 判定问题，本期不改）。
- 单位在非己方房：只有持有 Nexus 任务指针（`memory.taskId`）的单位由 AgentSystem 驱动；其余单位（编队成员、扩张单位、旧角色）维持现状，由各自的执行入口驱动（如 `team.exec()`），AgentSystem 不在外部房为它们调用原型 `exec()`。

### 24.5.4 验收

- 单位进入外矿房后，`Memory.creeps[name]` 与 `units[name]` 保留，任务租约由心跳续期。
- `world.dead` 只在真实死亡时出现；编队单位跨房后 `memory.role` / `targetRoom` 不丢失。
- 外出单位不触发重孵、不被计为战损。

## 24.6 多房 Intel

### 24.6.1 Intel 记录扩展（schema v10 → v11）

```ts
// core/store/memorySchema.ts  (持久化根: Memory.Nexus)
export type RoomKind = "normal" | "highway" | "keeper" | "center";

export interface RoomIntelRecord {
	// ...v10 既有字段不变 (lastSeen / confidence / sourceIds / worksites / threat / lostAt / mode / sourceTiming / upgradersStarved)
	// ── v11 新增 (全部可选, 缺省 = 未知) ──
	/** 由房名推导, 无需视野 */
	kind?: RoomKind;
	/** 源坐标 (sourceIds 的同序补充): 无视野时算工位/路程 */
	sources?: { id: string; x: number; y: number }[];
	controllerPos?: { x: number; y: number };
	/** 观测时的 owner (null = 已知无主) */
	owner?: string | null;
	/** 观测时的预定 (null = 已知无预定); untilTick = 观测 tick + ticksToEnd */
	reservation?: { username: string; untilTick: number } | null;
	invaderCore?: boolean;
	/** 观测到他人敌对结构 */
	hostileStructures?: boolean;
}
```

- **三态**：字段缺省 = 未知；`null` = 已知为空；有值但 `lastSeen` 早于 `INTEL_CONFIG.staleTicks` = 过期。读取统一走 `intelState(record, field, now)`。
- **`kind` 由房名推导**（`utils/roomName.ts`）：横坐标或纵坐标为 10 的倍数 → highway；两坐标对 10 取余都在 4..6 → (5,5) 为 center、其余为 keeper；其他 → normal。私服自定义地图用 `INTEL_CONFIG.kindOverride` 覆盖。
- **新鲜度**：`confidence = 0.5 ^ (未见 tick / INTEL_CONFIG.confidenceHalfLife)`，与威胁模型同形；读取端现算，不每 tick 写 Memory。
- **写入方唯一**：`modules/world/perception`，对 `visible` 房增量写入，值变化才写。
- **迁移** `migrateV10ToV11`：只补 `kind`；幂等；坏条目删除。
- **有界**：非己方、非外矿、`lastSeen` 超过 `INTEL_CONFIG.forgetTicks` 的条目删除；总数超 `INTEL_CONFIG.maxRooms` 时淘汰最旧者，己方房与外矿房不参与淘汰。

## 24.7 外矿选点

### 24.7.1 记录与状态机

```ts
// Memory.Nexus.remotes[home]
export interface RemoteColonyRecord {
	rooms: Record<string, RemoteRoomRecord>;
}

export type RemoteState = "candidate" | "scouting" | "evaluated" | "active" | "paused" | "rejected";

export interface RemoteRoomRecord {
	state: RemoteState;
	since: number;
	reason: string;                  // 最近一次转移原因 (引用量化输入)
	/** 手动设置: pin = 跳过净收益门槛 (安全规则仍生效); ban = 永不准入 */
	manual?: "pin" | "ban";
	sources: Record<string, RemoteSourceRecord>;
	estimate?: RemoteEstimate;
	measured?: { netEma: number; lastFoldTick: number };
	pausedUntil?: number;
	/** 本期: energy; 四期: keeper */
	profile: "energy";
}

export interface RemoteSourceRecord {
	pathLength: number;              // 母房交付点 → 源工位路径长 (格)
	containerId?: string;
}
```

候选：母房出口相连的房（`Game.map.describeExits`，无需视野），`kind === "normal"`，在 `REMOTE_CONFIG.maxRouteLength` 房以内（默认 1）；另加所有 `manual = "pin"` 的房。

**开闸条件**（全部满足才规划外矿）：

- 房间档位 `remoteMining = true`（沿用现有 `config/roomMode.ts`，rush / low 档关闭）；
- 母房已有 storage——外矿能量需要一个汇，见 §24.8.5。这是结构条件，不是新的等级阈值；
- 战略姿态不是 `survive`（`survive` 下不新增外矿，已 active 的保持）。

状态转移：

```
candidate ──(Intel 未知/过期)──► scouting ──(侦察到达)──► evaluated
evaluated ──(净收益 > 0 或 pin，且 spawn 预算有余)──► active
evaluated ──(净收益 ≤ 0 / ban / 他人占有或预定 / invader core / 敌对结构)──► rejected
active ──(威胁 / 连续死亡)──► paused ──(到期且威胁已衰减)──► evaluated
active ──(实测净收入持续 < 0，pin 除外)──► rejected
rejected ──(rejectedRetryTicks 后，ban 除外)──► candidate
```

- 每次转移写 `reason` 并进 runtime 环形日志。
- 最小驻留 `REMOTE_CONFIG.minDwellTicks`；威胁触发的暂停不受驻留约束。
- 同一外矿房只能被一个殖民地置为 active。

### 24.7.2 净收益估算（推导口径）

全部取运行环境常量。`d` = `pathLength`（格），`E` = 母房 `energyCapacityAvailable`。

| 项 | 公式 |
|---|---|
| 源产能 `r` | 满足预定条件：`SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME`（10/t）；否则 `SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME`（5/t） |
| 采集体 | `w = ceil(r / HARVEST_POWER)` WORK + 1 CARRY + 无路 1:1 MOVE，按 `E` 裁剪；`r_eff = min(r, w_eff × HARVEST_POWER)` |
| 搬运容量 | `C = ceil(r_eff × (2d + 装卸余量) / CARRY_CAPACITY)`，装卸余量入配置（默认 2） |
| 搬运体数 | `ceil(C / 每只 CARRY 数)`，每只按无路 1:1 在 `E` 内取最大 |
| 预定体 | `E ≥ 2 × (BODYPART_COST.claim + BODYPART_COST.move)`（2 CLAIM 才能让预定净增长）时一房一只 |
| 单位成本/tick | `Σ 体型成本 / CREEP_LIFE_TIME`（预定体用 `CREEP_CLAIM_LIFE_TIME`） |
| 容器维护/tick | `CONTAINER_DECAY / CONTAINER_DECAY_TIME × REPAIR_COST`（现值 0.5/t） |
| 路途损耗 | `r_eff × d / CREEP_LIFE_TIME` |
| **净收入** | `r_eff − 单位成本 − 容器维护 − 路途损耗` |
| **spawn 占用** `s` | `Σ 部件数 × CREEP_SPAWN_TIME / 寿命` |

准入：`net > 0`（pin 跳过），且外矿 spawn 占用合计 `Σs ≤ REMOTE_CONFIG.spawnShareCap × spawn 数`；候选按 `net / s` 降序准入。`spawnShareCap` 是本节唯一的策略参数。

`pathLength` 首次评估时 `PathFinder.search` 一次（plain 1 / swamp 5），之后由实测到岗时间（`firstArrivedAt`）修正。

### 24.7.3 时机与预算

- `remote-planner`：`planning` 阶段，规划 band **P2**，每 `REMOTE_CONFIG.planInterval` tick 或外矿事件（死亡、威胁变化、Intel 更新）触发。
- 评估（含 PathFinder）：band **P3**，每次至多 `REMOTE_CONFIG.evalPerRun` 个候选；bucket 不足时跳过，已 active 的外矿不受影响。

## 24.8 外矿能源闭环

### 24.8.1 任务形态

全部复用现有 kind；`roomName` 恒为母房；dedupeKey 前缀 `remote:`。

| 任务 | kind | dedupeKey | 目标 | 生成条件 |
|---|---|---|---|---|
| 外矿采集 | `harvest` | `remote:harvest:<home>:<sourceId>` | 源工位 | active |
| 容器建造 | `build` | `remote:build:<home>:<siteId>` | 容器工地 | active 且源旁无容器 |
| 容器维修 | `repair` | `remote:repair:<home>:<containerId>` | 容器 | hits < `containerRepairBelow` |
| 外矿搬运 | `haul` | `remote:haul:<home>:<containerId>` | 取货 = 容器，`destId` = 母房配额目的地 | 容器存量 ≥ 单只运量 |
| 预定 | `reserve` | `remote:reserve:<home>:<room>` | 控制器 | active、满足预定条件、剩余 < `reserveRefreshBelow` |
| 侦察 | `scout` | `remote:scout:<home>:<room>` | 房间中心 | candidate / scouting，或 Intel 过期；带 `deadline` |

- **经济规划器清扫豁免**：`economy/planners.ts:286` 的「主体消失」清扫必须跳过 `remote:` 前缀的任务；外矿任务的取消只由 `remote-planner` 负责。
- **工位**：复用 `world/worksite.ts`（已用 `Room.Terrain`，无需视野），无视野时源坐标取自 Intel。
- **容器工地**：外矿房可见时由 `remote-planner` 放置，与 planner 现有放置结构的做法一致（如 `planner/index.ts:62` 放开局源容器、`controllerBuffer.ts:118` 放 cc 容器），属规划层结构操作。采集体带 1 CARRY：有工地先建，建成后采集卸入容器，容器低血就地修。
- **搬运**：外矿 haul 进 quota 主干，`destId` 由 `destinationQuotas` 分配，只在母房；在途承诺照常 `committedTo`。
- **侦察**：到达目标房中心 3 格内 `board.complete`；之后由 Intel 新鲜度决定是否再派。
- **预定动作**：ActionBroker 新增 `reserveController`（现有 `claim` 分支直接调 `claimController`，`agentSystem.ts:731`；预定不沿用这种写法）。

### 24.8.2 孵化

- `SpawnUnit` 与 BodyFactory 增加 `scout`（单 MOVE）与 `reserver`（≥ 2 CLAIM + 等量 MOVE）；`reserver` 的 unit code 已存在（`UNIT_CODES.reserver = "RSV"`），旧执行器未注册，本期由 AgentSystem 的 `reserve` 分支驱动。
- `unitForTaskKind` 补 `scout → scout`、`reserve → reserver`。
- 外矿采集体 / 搬运体沿用 `harvester` / `carrier` unit code，BodyFactory 新增 `remote` 体型提示：无路 1:1 MOVE，WORK 上限 `ceil(r / HARVEST_POWER) + 1`。

### 24.8.3 外矿单位与家内单位隔离

`UnitRecord` 新增 `remote?: string`（外矿房名），孵化外矿单位时写入。Allocator 资格：

- `remote:` 任务只分给 `homeRoom` 相同、且带 `remote` 标记的单位；scout 与 reserver 只接 `remote:` 任务。
- 家内任务只分给不带 `remote` 标记的单位（现有资格规则照旧）。

外矿单位与家内单位因此互不抢任务，家内定编与 P1-14 校准过的口径不受外矿影响。

跨房路程：Allocator 的 `travelCostOf` 对 `remote:` 任务读 `RemoteSourceRecord.pathLength`（单位在母房时），或同房切比雪夫距离（单位已在目标房时）。

### 24.8.4 定编

- 外矿编制按殖民地由 `remote-planner` 给出（每 active 外矿：采集体 = 源数，搬运体 = §24.7.2 公式，预定体 0/1，scout = 待侦察房数上限 1）。
- `unitTargets` 在家内编制之外**加上**外矿编制；外矿缺口只由母房 spawn 承接。在岗计数按 `remote` 标记分开：家内单位只抵家内编制，外矿单位只抵外矿编制。
- 无 active 外矿时外矿编制为 0，家内定编与变更前完全相同。

### 24.8.5 外矿能量的去处

- 开闸条件要求母房已有 storage（§24.7.1）：quota 主干把 storage 当兜底目的地，外矿搬运体不会因 spawn / ext 全满而原地持能。
- 消化外矿能量的，是 `workforce.ts` 已有的 storage 水位 / 盈余项（`workforce.ts:89-102`、`212-225`）：外矿收入抬高 storage 存量 → 升级火力按既有口径加码。本期不改 `harvestIncomeOf` / `upgradeWorkTargetOf`，不动 P1-14 校准过的家内口径。
- 外矿交付量另记 `ledger.rates["remote:<home>:<room>"]`，供 §24.10 收益反馈。

## 24.9 外矿安全

- **观测**：外矿房的威胁由 `updateRoomThreat` 写入该房 Intel 的 `threat`。`defense/index.ts:51` 现在只对 `world.rooms` 调用，扩为同时对外矿集合调用：可见时评分；不可见时按现有衰减规则衰减。外矿房没有己方资产，`proximityFactor` 取 1。
- **与全局隔离**：外矿房威胁**不计入** `maxThreatScore`（`threatModel.ts:180`）。因此它不抬高家内 defender 编制（`spawnDirector.ts:127`），不触发 war 姿态（`strategy/core.ts:83`），也不关闭快递。`RoomThreatRecord` 增加 `scope: "home" | "remote"`，`maxThreatScore` 只取 `home`。
- **暂停**：威胁分 ≥ `pauseThreat`，或 `deathWindow` 内外矿单位死亡 ≥ `pauseDeaths` → `paused`，`pausedUntil = now + pauseTicks`。
- **撤回**：外矿任务全部 `cancel`（`remote-paused`）；外矿房内的本殖民地外矿单位领 `retreat` 回母房，载货单位先交付。
- **恢复**：`pausedUntil` 到期且威胁 < `resumeThreat`（`resumeThreat < pauseThreat`）→ `evaluated`。需要确认时派 scout。
- **剔除**：invader core、他人占有、他人预定、敌对结构 → `rejected`（ban 之外，`rejectedRetryTicks` 后重回候选）。
- **派兵清理**：三期，外矿防御作为需求方接 `requestSquad`。

## 24.10 收益反馈

- 每个 active 外矿房每 `foldInterval` tick 折叠 `measured.netEma` = 外矿交付 EMA − 该房外矿单位的孵化成本摊销。
- `measured.netEma < 0` 持续 `lossWindow` → `rejected`（`measured-loss`），pin 的房只记告警不剔除。
- 预计与实测偏差进遥测，作为 Phase 7 指标窗口的第一批数据。
- 旧链收入提供方 `registerOutMineIncomeProvider`（`prototype/features.ts:33`）只服务旧孵化链，且恒返回 0：一期移除该注册，不接新的提供方（理由见 §24.8.5）。

## 24.11 旧链迁移与删除清单

| 旧链能力 | 位置 | 去向 | 期 |
|---|---|---|---|
| 目标选择（0/1 背包 + 300 tick 迟滞） | `externalMine.ts:423-573`、`2350-2368` | 推导口径 + 状态机（§24.7） | 一 |
| 手动指定外矿 `mine.add / adds / remove / list` | `console/function/mine.ts:99-201` | `Nexus.remote.pin / ban / clear / list`（§24.7.1 `manual`） | 一 |
| 邻房自动加入（仅 rush） | `externalMine.ts:643-680` | `describeExits` 候选 | 一 |
| 外矿采集 / 搬运定编、替补 | `externalMine.ts:2075-2199`、`1121-1160`、`1838-1853` | §24.7.2 公式 + 现有替补窗口 | 一 |
| 预定 | `externalMine.ts:2210-2226` | `remote:reserve` + `reserver` | 一 |
| 侦察 | `externalMine.ts:1875-1896` | Intel 驱动 scout | 一 |
| 外矿建造（容器） | `externalMine.ts:2249-2284` | 采集体自建自修 | 一 |
| 收入分析 `getRoomRemoteIncome` | `externalMine.ts:1370-1418` | 实测 EMA（§24.10） | 一 |
| 外矿路网规划 / 放工地 / 维修 | `externalRoad.ts:629-705`、`889-990`、`RoadMaintain` | planner 路网 + remote repair | 二 |
| `road.*` 控制台、`getBuiltRoadCoverage` | `console/function/road.ts`、`baseFunction.ts:516` | planner 路网覆盖率 | 二 |
| 外矿防御（out-defend / out-invader / 双人组） | `externalMine.ts:2014-2069` | 防御域需求方 + C5 编队 | 三 |
| 中央九房 / SK 房、out-attack、外矿元素矿 | `externalMine.ts:2483-2555`、`2003-2011` | `profile: "keeper"` + 编队护航 | 四 |
| 搬运重平衡（跨源 / 跨房） | `externalMine.ts:1162`、`1289` | 不迁：quota 主干 + Allocator 已覆盖 | — |
| 可视化 | `externalRoad.ts:1862` 等 | HUD 外矿行（一期）；路网可视化随二期 | 一 / 二 |

**Memory 迁移**（一期 schema v11 迁移中执行，幂等）：

- `Memory.Nexus.OutMineData[home].energy` 中的房 → `remotes[home].rooms[room].manual = "pin"`；
- `.centerRoom` 中的房 → 保留原值，四期迁移；
- `.RoadData` → 保留，二期迁移；
- `.highway` 仍被 power / deposit 链路读取（`mineMission.ts:334`、`highwayMine.ts`），**不动**。

**删除**（收尾）：`externalMine.ts`、`externalRoad.ts`、`externalScheduler.ts`、`outMine.ts`；`CreepConstant.ts` 中旧外矿角色定义（out-*、旧 scout / reserver 执行器条目）；`console/function/mine.ts`、`road.ts`；`OutMineData.energy / centerRoom / RoadData`。一期只删 `economy/remoteMining.ts`（被 `remote-planner` 取代）。

## 24.12 附带发现（不在本期范围）

- `agents/agentSystem.ts:1172` 用 `in` 判断 `Set` 成员（`creep.unitCode in NEXUS_TASK_DRIVEN_CODES`），结果恒为 false，所有无任务指针的单位都会落入原型 `exec()`。主线 harvester / carrier 孵化时写了 `memory.role`（`spawnDirector.ts:476`），空闲时会跑旧角色执行器。修正会改变空闲单位行为、影响已校准的家内经济，需单独用 sim 对照。
- `strategy/expansion.ts` 的 `findExpandTarget` 以 `E${x}N${y±1}` 拼房名，不区分 W/S；同函数预定判断两个分支都 `return name`。Phase 5 扩张设计时重写。

## 24.13 数据所有权（三循环数据所有权增补，`02-architecture-charter.md §22`）

| 数据 | 唯一主要写入方 | 读取方 |
|---|---|---|
| `world.units` / `world.visible` | `modules/world/perception` | AgentSystem、Allocator、SpawnDirector、外矿规划、威胁模型、交通 |
| `Memory.Nexus.rooms[*]` v11 字段 | `modules/world/perception` | 外矿规划、侦察、威胁模型 |
| `rooms[*].threat`（含 `scope`） | `modules/defense/threatModel` | 战略（只读 home）、外矿规划（读 remote） |
| `Memory.Nexus.remotes` | `modules/economy/remote`（`remote-planner`）；`manual` 由控制台写 | SpawnDirector、Allocator、HUD |
| 外矿任务（`remote:*`） | `remote-planner` 经 TaskBoard | Allocator、AgentSystem |
| 外矿交付速率 | `modules/economy/ledger` | `remote-planner` |

`remote-planner` 注册在 `economy-planners` 之后、`spawn` 阶段之前。

## 24.14 配置（零硬编码）

新增 `src/config/remote.ts`：

- `INTEL_CONFIG`：staleTicks、confidenceHalfLife、forgetTicks、maxRooms、kindOverride。
- `REMOTE_CONFIG`：maxRouteLength、spawnShareCap、minDwellTicks、planInterval、evalPerRun、scoutDeadline、containerRepairBelow、reserveRefreshBelow、pauseThreat、resumeThreat、pauseDeaths、deathWindow、pauseTicks、rejectedRetryTicks、foldInterval、lossWindow、装卸余量。

每项注释写清含义与单位；默认值实现时按 sim 校准，校准结论回写注释。

## 24.15 验收对齐（`04-foundations.md §2.7` 七问）

| 问题 | 回答 |
|---|---|
| 1. 需要什么输入？哪些会过期？ | Intel（owner / 预定 / 源坐标 / 威胁 / kind）、`describeExits`、PathFinder 路程、账本外矿交付速率。owner / 预定 / 威胁随未见时间衰减；预定按 `untilTick` 过期；路程以实测修正 |
| 2. 属全局战略 / 房间 Cluster / 单个 Agent？ | 殖民地级局部规划。战略层只经指令影响它（`survive` 不新增外矿）；外矿威胁不上行到战略 |
| 3. 最坏 CPU 成本？ | 每 tick：名册 O(单位数) + `visible` O(外矿房数)；规划 P2 周期 / 事件触发 O(候选 ≤ 8 × 殖民地数)；PathFinder 只在 P3，每次 ≤ `evalPerRun`，结果缓存 |
| 4. 目标消失 / 单位死亡 / 失视？ | 源 / 容器消失：`remote-planner` 取消并重建任务；死亡：名册口径下才判死，租约由对账释放；失视：Intel 进入过期态，外矿不因失视暂停，威胁按衰减规则下降，需要时派 scout |
| 5. 会修改 Memory 吗？schema 与清理？ | `rooms[*]` v11 字段、新增 `remotes`、`UnitRecord.remote`、`RoomThreatRecord.scope`；v10 → v11 幂等迁移（含 `OutMineData.energy` → pin）；Intel 按 forgetTicks / maxRooms 有界，外矿集合受 spawnShareCap 与候选范围约束 |
| 6. 成功如何测量？失败如何记录？ | 每外矿房 `measured.netEma`、预计 / 实测偏差、外矿单位死亡数、spawn 占用；状态转移 `reason` + 环形日志，限频输出 |
| 7. 是否直接调用游戏 API？ | 单位动作（采集、建造、维修、搬运、预定）一律经 ActionBroker；放容器工地属规划层结构操作，与 planner 现有做法一致；规划只读 `Game.map` / `PathFinder` / `Room.Terrain` |

## 24.16 待维护者裁决

以下是本文替维护者做的决定，实现前请确认或改写：

1. **§24.5 名册修复是否免门禁先行。** 它修的是现网缺陷（跨房单位丢记忆，波及编队与扩张），本文按「行为缺陷顺手修」处理。
2. **外矿威胁不计入全局威胁（§24.9）。** 若希望外矿受袭也能触发家内战备，需要另定外矿威胁到全局的折算规则。
3. **外矿单位与家内单位隔离（§24.8.3）。** 隔离换来家内口径不变；代价是空闲的外矿单位不会回家帮忙。
4. **外矿开闸要求母房有 storage（§24.7.1）。** RCL3 及以下不开外矿；若要在 RCL3 开外矿，需先把外矿收入接入 `upgradeWorkTargetOf`，并重新对照 P1-14 校准。
