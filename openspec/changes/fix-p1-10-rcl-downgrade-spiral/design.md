# Design

## Context

见 proposal.md（P1-10 死循环链条与 sim 50k 证据）。已确认的现状锚点：

- 失明根因：`src/modules/world/perception.ts:30-34` 按 `controller.my` 过滤，房间失守后从 `world.rooms` 静默消失，`intel.lastSeen` 冻结；全仓无房间级失守处理。`WorldHolder`（`src/core/world.ts:156-159`）已有 `dead`（前后快照 diff）先例。
- 降级计时可直接读：sim shim `sim/src/js/screeps.js:1052` 与官方 API 均暴露 `controller.ticksToDowngrade`；sim 引擎升级即重置计时（`sim/src/engine/tick.rs:307-312`），计时**单调递减、升级重置为满额**——不存在渐进回升。`ControllerSummary`（`src/core/world.ts:123-133`）目前无降级字段。
- 抢占基建已存在：`src/modules/tasks/allocator.ts` `CRITICAL_PRIORITY=90`，任务 `priority ≥ 90` 可无视滞回抢占；upgrade 基础优先级 30（`src/store/taskSchema.ts:128-137`），永远够不到抢占线。
- upgrade 规划：`src/modules/economy/planners.ts:77-96`，survive 姿态走 `suppressUpgradeBuild` 降权存活（`postureBias.survive.upgrade=-25`、`suppressPenalty=40`）。
- 孵化：`src/modules/spawning/spawnDirector.ts:159` survive 暂停名单 `["upgrader","worker"]`；`:173-175` `aliveTotal===0` 时 bootstrap（失明态恒 0 → ~200t 空转）。预算无紧急通道。
- 姿态：`src/modules/strategy/core.ts:45-107` `evaluatePosture` 先过 `minDwellTicks` 驻留门；策略模块 `:148-152` 消费紧急标志跳过周期门控。失明时 `lastStockTotal` 是过期值，可能仍高于临界线 → 姿态赖在 develop。
- 内存 schema v6（`src/store/memorySchema.ts`），迁移注册表模式见 `src/store/migrations.ts`（`MIGRATIONS[v-1]` 纯函数逐级升级）。

## Goals / Non-Goals

**Goals:**

- 三条防线闭环：降级风险紧急通道（治本）→ 失守事件防失明（兜底）→ bootstrap 空转治理（止损）。
- 全部阈值/优先级/次数可配置（`src/config/`），零硬编码。
- 复用既有机制（`CRITICAL_PRIORITY` 抢占、standingRoles、`dead` diff 模式、迁移注册表），不新增抽象层。

**Non-Goals:**

- 不提升常规升级吞吐（P1-4/P1-5 已修，属经济模型域）；紧急通道只是保底不断供。
- 不处理「视野丢失但未失守」（无 creep 无建筑的房间不可见仍静默）——该场景由 bootstrap 治理兜底，失守判定只认「可见且非己」。
- 不做多房失守恢复流程（docs/nexus-design/18 Level 4 的重殖民属后续 change）。
- 不改 `allocator.ts` 抢占机制、不加 HUD/控制台新观测行（可后续补）。

## Decisions

### D1 风险判定：无状态纯函数，单阈值

`downgradeEmergency(controller?: ControllerSummary): boolean` 放 `src/core/world.ts`（纯域谓词，与 `ControllerSummary` 同处），读 `DOWNGRADE_CONFIG.emergencyTicks`（`src/config/economy.ts` 新增）：

```
紧急 ⇔ ticksToDowngrade !== undefined && ticksToDowngrade < emergencyTicks
```

- **为何单阈值而非双阈值迟滞**：计时单调递减、升级即重置满额（引擎语义），不存在「回升到两阈值之间」的路径，sticky 状态无收益（拒绝过度工程化）。
- 备选（否决）：按 `lastUpgradeTick` 推算计时——shim 与官方 API 均有现成字段，无需推算。
- 初值 `emergencyTicks: 2500`（RCL2 降级计时 10000t 的 1/4，覆盖替补生产+路程提前量），`sim` 回归后校准。

### D2 感知扩展：ControllerSummary 采集降级字段 + 失守事件

- `ControllerSummary` 增加可选字段 `level / progress / progressTotal / ticksToDowngrade`，`perception.ts:170-179` 在字段存在时采集，不存在不伪造（满足 specs/room-perception「不伪造缺失字段」）。
- 失守事件仿 `dead` 模式：`WorldHolder` 增加 `lostRooms: string[]`，perception 在构建新 view 后 diff——上一 Tick `view.rooms` 中存在、本 Tick `Game.rooms[roomName].controller` 可见且非己方的房间，即为失守：
  - `intel.lostAt = tick` 持久化（`RoomIntelRecord` 新增可选字段；记录缺失时按 `{lastSeen: tick, confidence: 0, sourceIds: []}` 建档）；房间重新为己方观测时删除 `lostAt`（复得即清除）。
  - 推入 `ctx.world.lostRooms`（每 Tick 重置，同 `dead`）。
- **为何只认「可见且非己」**：`Game.rooms` 无该房（纯视野丢失）不代表控制权丢失，误报会污染姿态；P1-10 实证路径是 RCL0 后 `controller.my=false` 且房间仍可见。
- 首 Tick / 全局重置后首 Tick 无上一快照 → 不产生事件（无上一快照不误报）。

### D3 升级紧急提权：planner 落点，复用抢占通道

`planEconomyRoom`（planners.ts:77-96）upgrade 分支：

- 紧急时 `priority = DOWNGRADE_CONFIG.upgradePriority`（初值 **91**），**不走** `suppressUpgradeBuild` 分支、**不叠加** `postureBias`（spec 要求 survive 不压制紧急升级；-25 偏置会侵蚀提权）。
- 91 的取值理由：严格高于抢占线 90（含 retreat 90），低于 defend 92 与 fill_spawn 95——供能与防御仍优先于保级。
- 抢占切换由 allocator 既有 `priority >= CRITICAL_PRIORITY` 通道完成，被切走的原租约照常 `board.release(..., "preempted")`；upgrade 任务 `requiredCapabilities: ["work","carry","move"]`（P0-2 定案）保证被切来的单位有能力执行。**不改 allocator。**

### D4 孵化豁免：pauseRoles 过滤

`spawnDirector.ts:159` 计算 `pauseRoles` 时：世界任一房处于降级紧急 → 从 survive 暂停名单剔除 `upgrader`（worker 照停）。缺口请求仍走 standingRoles 既有路径（`standingPriority: 55`），与任务 available 状态解耦（P1-5）。

### D5 姿态：失明即 survive，绕过驻留与过期库存

- `StrategyInputs` 增加 `ownedRooms`（`aggregateStrategyInputs` 数 `world.rooms` 键数，感知只收己方房，此数即己方可见房数）。
- `evaluatePosture` 在驻留门**之前**判定：`ownedRooms === 0` → 立即 `survive`（原因 `owned rooms 0 (lost)`）。理由：失明是灾难态，且 `lastStockTotal` 是过期值、驻留门（600t）会拖延转移；库存/饥饿规则在无房时全部失真，唯有「无房」本身可信。
- 触发时机：`strategyCoreModule.run` 的紧急条件并入 `ctx.world.lostRooms.length > 0`（与 `consumeUrgentReeval` 同级），失守当 Tick 即重估，不等 300t 周期。perception（perception 阶段）先于 strategy（strategy 阶段），时序天然成立。

### D6 bootstrap 空转治理：持久计数 + 降频 + 告警

- `Memory.nexus` 新增 `spawn` 子系统：`{ bootstrapCount: number; lastBootstrapTick: number }`（恒定 O(1)，有界）。选 Memory 而非 runtime：私服 4wt 全局重置后 Memory 仍在，空转计数不归零；runtime 单例会随重置丢状态。
- `SPAWN_CONFIG` 扩展 `bootstrap: { maxConsecutive: 8, throttleInterval: 1000 }`。
- `spawnDirector.ts:173-175` bootstrap 分支：每次发出 bootstrap 请求时计数 +1、记 tick；计数超过 `maxConsecutive` 后，仅当 `tick - lastBootstrapTick >= throttleInterval` 才再发请求；被节流时 `ctx.cpu.recordSkip("spawn-director", "bootstrap-loop")` + `ctx.logger.warn`（按节流间隔限频）。
- 复位：`world.rooms` 非空（任一己方房可见）即清零计数——每 Tick 检查，恢复即时生效。

### D7 Schema v7：纯增量迁移

- `CURRENT_SCHEMA_VERSION = 7`；`RoomIntelRecord.lostAt?: number`（可选，v6 数据天然兼容）+ `spawn` 子系统默认空状态（`SUBSYSTEM_DEFAULTS` / `SUBSYSTEM_KEYS` 同步）。
- `migrateV6ToV7`：补 `spawn` 默认结构（仿 `migrateV4ToV5` 的 defense 模式）；`lostAt` 为可选新增无需回填。
- 契约注释同步：memorySchema 头部版本说明。

### D8 验证策略

- 单测（沿用 `tests/helpers.ts` 的 `makeCtx`/`stubRoom` 模式）：感知采集与失守事件、风险判定纯函数、planner 提权与豁免节流、spawn 豁免与 bootstrap 节流、姿态失明规则、v6→v7 迁移幂等。
- sim 回归（判据 = docs/bugs P1-10 验证标准）：`boot-from-scratch` 50k——`rcl` 全程 ≥ 2 无 RCL0；upgradeController 意图持续分布（非集中开局）；无 universal 式 churn（生产 ≈ 死亡 + 编制增量）；`--dump-memory` 无 `lostAt` 记录（防线 1 生效则不应失守）。
- 补跑遗留回归：boot 20k 断言（P0-3 的 `rclReachedBy 3`）、P1-6/P2-8 soak、场景全绿后更新 docs/bugs 清单勾销。
- 私服冒烟（可选收尾）：`submit.js 47.100.24.220@nexus --branch main` 落地 W5N8，观察和平期零行为变化、无降级告警。

## Risks / Trade-offs

- [提权抢占风暴：91 与 fill_spawn 95 之间的持有者反复切换] → fill_spawn 更高且二者的合格身体不同（fill 需 carry、矿工无 carry 不合格 upgrade）；SWITCH_MARGIN 滞回对非 critical 切换仍然生效；sim 回归观察 upgrade 意图分布无高频抖动即通过。
- [race 私服 spawn 自动回能掩盖修复效果] → 判据以 sim（无回能偏差由场景保证）为准，私服仅冒烟不断言节奏。
- [紧急阈值 2500 拍脑袋] → 全部走 `DOWNGRADE_CONFIG`，sim 时间线（L2 降级点 vs 提权生效点）校准。
- [失守判定依赖可见性：视野丢失不产生事件] → 已声明 Non-Goal；该场景落入 bootstrap 治理（计数降频）止损，恢复视野后事件链自然重接。
- [Memory 增量：spawn 子系统 + lostAt 字段] → 两数字段 + 每房至多一个时间戳，恒定有界；迁移幂等可测。
- [提权期间 upgrader 豁免暂停名单，survive 下能量紧张加剧] → 豁免只影响「是否请求孵化」，预算仍受 `energyAvailable` 约束；紧急态本义就是宁可挤占也要保级。

## Migration Plan

1. 代码合入 dev → `npm run typecheck && npm test` → sim 回归（20k 断言 → 50k 判据 → soak）。
2. 私服上传走 `submit.js`，v6→v7 迁移在首个 Tick 由 bootstrap 自动执行（纯增量，旧数据无损）。
3. 回滚：git revert 即可——v7 新字段对旧代码为未知可选字段，私服 4wt 自动重开会重建 Memory，兼容窗口风险极小。

## Open Questions

- 是否补 `Nexus.world()` 控制台查询降级风险/失守记录（仿 `Nexus.defense()`）：不影响本 change 的行为契约，可后续独立小改动。
