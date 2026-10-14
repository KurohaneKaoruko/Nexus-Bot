# Tasks

## 1. Schema v7 基础（design D7）

- [x] 1.1 `src/store/memorySchema.ts`：`RoomIntelRecord` 增加可选 `lostAt?: number`（失守 tick，注释说明复得即清除）；新增 `spawn` 子系统结构 `{ bootstrapCount, lastBootstrapTick }` 并同步 `NexusMemory`/`SUBSYSTEM_DEFAULTS`/`SUBSYSTEM_KEYS`；`CURRENT_SCHEMA_VERSION` 升到 7，头部版本注释更新。验证：`npm run typecheck` 通过，`tests/store/migrations.test.ts` 既有用例不回归
- [x] 1.2 `src/store/migrations.ts`：新增 `migrateV6ToV7`（仿 v4→v5 的 defense 模式补 `spawn` 默认结构；`lostAt` 可选不回填）并注册到 `MIGRATIONS`。验证：`tests/store/migrations.test.ts` 新用例——v6 数据升级后 `spawn` 字段齐全、既有 rooms/tasks 数据原样保留、重复迁移幂等

## 2. 感知层：降级字段与失守事件（design D2 / specs/room-perception）

- [x] 2.1 `src/core/world.ts` `ControllerSummary` 增加可选 `level/progress/progressTotal/ticksToDowngrade`；`src/modules/world/perception.ts` controller 采集处按字段存在性采集（undefined 不伪造）。验证：`tests/world/perception.test.ts` 新用例——暴露 `ticksToDowngrade` 时摘要含该值与等级/进度；未暴露时摘要无伪造值；既有感知用例不回归
- [x] 2.2 `src/core/world.ts` `WorldHolder` 增加 `lostRooms: string[]`（`createWorldHolder` 同步初始化）；`perception.ts` 仿 `dead` 模式在构建新 view 后 diff：上一 Tick 在 `view.rooms`、本 Tick `Game.rooms` 中可见且 `controller.my` 为 false 的房间 → 写 `intel.lostAt`（记录缺失按 `{lastSeen: tick, confidence: 0, sourceIds: []}` 建档）并推入 `lostRooms`；己方观测分支复得时删除 `lostAt`；每 Tick 重置。验证：`tests/world/perception.test.ts` 新用例——失守写入 `lostAt` 且当 Tick `lostRooms` 可查、既有 Intel 字段保留、首帧无上一快照不误报、复得后 `lostAt` 清除

## 3. 风险判定与配置（design D1 / specs/controller-downgrade-guard「降级风险分级」）

- [x] 3.1 `src/config/economy.ts` 新增 `DOWNGRADE_CONFIG = { emergencyTicks: 2500, upgradePriority: 91 }`（带注释：初值依据 RCL2 计时 10000t 的 1/4，sim 校准点）。验证：`npm run typecheck` 通过
- [x] 3.2 `src/core/world.ts` 新增纯函数 `downgradeEmergency(controller?: ControllerSummary): boolean`（`ticksToDowngrade !== undefined && < emergencyTicks`）。验证：单测（新增到 `tests/world/` 或就近测试文件）——低于阈值判紧急、undefined（满级/刚重置）判正常、恰等于阈值判正常

## 4. 升级紧急通道（design D3 / specs/controller-downgrade-guard「升级任务紧急提权」）

- [x] 4.1 `src/modules/economy/planners.ts` upgrade 分支：房间紧急时 `priority = DOWNGRADE_CONFIG.upgradePriority`、不叠加 `postureBias`、不走 `suppressUpgradeBuild` 节流分支；非紧急路径保持原样。验证：`tests/economy/planners.test.ts` 新用例——`ticksToDowngrade` 低于阈值时任务 priority 为 91（survive 偏置 -25 不侵蚀）、supervive 节流期紧急房仍全权 upsert、非紧急房原优先级与节流行为回归不变

## 5. 孵化豁免与 bootstrap 治理（design D4/D6 / specs「孵化豁免」「bootstrap 空转治理」）

- [x] 5.1 `src/modules/spawning/spawnDirector.ts` pauseRoles 计算：世界任一房 `downgradeEmergency` 时从 survive 暂停名单剔除 `upgrader`（worker 照停）。验证：`tests/spawning/spawnDirector.test.ts` 新用例——survive + 紧急房 upgrader 缺口仍发请求、survive + 非紧急 upgrader 照停（既有 survive 门控用例回归）
- [x] 5.2 `src/config/economy.ts` `SPAWN_CONFIG` 扩展 `bootstrap: { maxConsecutive: 8, throttleInterval: 1000 }`；`spawnDirector.ts` bootstrap 分支接入 `memory.spawn` 计数：每次 bootstrap 请求计数 +1 并记 tick，超过 `maxConsecutive` 后仅 `tick - lastBootstrapTick >= throttleInterval` 才再发；节流时 `ctx.cpu.recordSkip("spawn-director", "bootstrap-loop")` + `ctx.logger.warn`（按节流间隔限频）；`world.rooms` 非空时计数与节流状态即时复位。验证：`tests/spawning/spawnDirector.test.ts` 新用例——连续超限后按间隔降频、节流计入 skip、任一房可见后立即复位

## 6. 姿态联动（design D5 / specs/strategy-core「失守事件触发的紧急重估」）

- [x] 6.1 `src/modules/strategy/core.ts`：`StrategyInputs` 增加 `ownedRooms`，`aggregateStrategyInputs` 从 `world.rooms` 计数；`evaluatePosture` 在驻留门之前判定 `ownedRooms === 0` → 立即 `survive`（原因含 lost 语义）。验证：`tests/strategy/core.test.ts` 新用例——无己方房且驻留未满仍转移 survive、有房时库存/饥饿规则回归不变
- [x] 6.2 `strategyCoreModule.run` 紧急条件并入 `ctx.world.lostRooms.length > 0`（与 `consumeUrgentReeval` 同级），失守当 Tick 即重估。验证：模块级测试（仿既有 strategy 模块用例）——lostRooms 非空时当 Tick 执行重估并写 `lastStrategicTick`，不等 300t 周期

## 7. 回归、勾销与落地（design D8）

- [x] 7.1 全量门禁：`npm run typecheck && npm test` 全绿，无未捕获异常。验证：命令输出零失败
- [x] 7.2 sim boot 20k 断言回归（P0-3 遗留的 `rclReachedBy 3` 等）：`cd sim && ./target/release/nexus-sim -s scenarios/boot-from-scratch.json -b ../dist/main.js`。验证：断言 3/3 PASS，pickup/transfer/drop 相对审计基线不劣化
- [x] 7.3 sim boot 50k P1-10 判据（docs/bugs 验证标准）：rcl 时间线全程 ≥ 2、无 RCL0；upgradeController 意图持续分布（非集中开局）；units 生产 ≈ 死亡 + 编制增量、无 universal 式 churn；`--dump-memory` 无 `lostAt` 记录、`spawn.bootstrapCount` 未触顶。验证：报告 JSON + ticks CSV 逐项核对，结论记入 docs/bugs
- [x] 7.4 soak 数千 tick（P1-6/P2-8 遗留，可与 phase2 8.3 合并执行）：Memory 占用曲线平稳、账本/热点有界、控制台零未捕获异常。验证：soak 报告 + docs/bugs 回归表更新
- [x] 7.5 docs/bugs 勾销：P1-10 标记已修复并附 sim 证据；P0-3/P1-4/P1-5 的 sim 列与回归基线表同步更新为已验证；如 sim 校准调整了 `DOWNGRADE_CONFIG`/`bootstrap` 参数，回写 config 注释。验证：文档与代码一致、无遗留「待跑」项
- [ ] 7.6 私服冒烟（可选收尾）：`node submit.js 47.100.24.220@nexus --branch main` 落地 W5N8，观察 v6→v7 迁移执行、和平期零行为变化、无 bootstrap-loop 告警。验证：控制台/API 取证记录
