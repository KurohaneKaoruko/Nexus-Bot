# Phase 8 实现记录：经济账本（任务 7.1–7.5）

日期：2026-10-17 · 轨道 D · 全部经 sim 六场景回归

## 7.1 五态分账

- `ReservationRecord.createdAt`（可选）：超龄回收判据。
- `LedgerView.states(roomName)`：一次遍历预留返回 Observed / Reserved（无目的地）/ Committed（带目的地 destId）/ Available（= 库存 − 预留 − 承诺）/ Consumed（consumedTotal 单调累计）。
- `commit(id, actualUse)`：按实际用量计入 `rates.consumed`（EMA）与 `consumedTotal`；少用部分随记录删除回到可用量。
- 预计收入单列于 income.ts（见 7.3），不入五态。

## 7.2 预留泄漏防护

- `LEDGER_CONFIG.maxReservationAge = 800`（> 任务最大 deadline 700，只兜异常滞留）。
- `maintainLedger`：`createdAt` 存在且 now − createdAt > maxReservationAge → 强制回收 + `overdueCount` 计数告警；`expiresAt` TTL 清理与 owner 消失释放保持既有行为（任务终结同 tick 释放，reconcile 阶段调用）。
- 防御初始化 `ensureLedgerShapes`：v13 子键缺失时补安全空状态，降级运行不炸。

## 7.3 收入口径统一

新文件 `src/modules/economy/income.ts`——折算的单一事实源：

- `reservationFactor`：己方预订记 1，未预订记 0.5（容量减半，对齐 specs/race-remote 预订线）。
- `remoteSourceWeightOf`：本矿登记在板的远程 harvest 任务按预订状态加权求和（原 activeRemoteSourceCount 逻辑收编，旧名保留为 deprecated 包装）。
- `incomeWithRemoteOf(ctx, roomName, localIncome)`：本矿实测 + 加权数 × (3000/300)。
- `workforce.harvestIncomeWithRemoteOf` 改为引用 income.ts（原实现满采上限未折算预订减半，已修正）。
- 孵化门 spawnArbiter 引用的 `harvestIncomeOf` 与升级定编 `harvestIncomeWithRemoteOf` 同源同文件链。

## 7.4 饥饿与瓶颈指标

- `LedgerMemory.hunger`：每房至多一条 `RoomHungerVitals{kind: spawn|cc, sinceTick, deficit, lastTick}`。
  - spawn 线：任一 spawn 存量 0（与模型 starvation 累加器同口径）；
  - cc 线：controller buffer 低于 `CONTROLLER_BUFFER_CONFIG.floorRatio` 保障水位（与配额 floor 同源）。
- `updateHungerVitals`：模型每 Tick 调用（快照直读，无额外 find）；脱离饥饿或房间失联即删——有界，无流水明细入库。
- `EconomyIndicators` 新增 `overdueReclaimed`（超龄回收累计）与 `hunger`（房名 → 链路/持续 tick/缺口），控制台/HUD 可查。

## 7.5 Available 口径切换

- `spawnDirector.ccBelowSpawnGate`：cc 判据改为 `store.energy + committedTo(cc) < 水位`——在途补货承诺计入，不再因已发出的补货任务误暂停升级体孵化。
- `courier` 闸门⑤：运作线判据与预算均扣除 `committedTo(spawn/extension)`——fill_spawn 在途承诺不再被快递预算重复花销。
- quota 目的地 headroom 原本已走 `committedTo`（保持）。
- 行为面验证见下表，无超发与饥饿误判（noErrors 全绿，RCL 时间线持平或更优）。

## schema v13 与迁移

- `CURRENT_SCHEMA_VERSION = 13`；`migrateV12ToV13`（幂等）：ledger 补 hunger/consumedTotal/overdueCount 子键、rates 各房补 consumed 速率位；createdAt 不回填（缺省记录不做超龄判定）。
- `SUBSYSTEM_DEFAULTS.ledger` 同步四子键。

## sim 回归（对照 baseline/2026-10-17-sim-matrix.md）

| 场景 | 本次 | 基线 | 结论 |
|---|---|---|---|
| boot-from-scratch | ✓ L2@728 cpu p95 6.0 | ✓ L2@749 | 优 |
| race-body-audit | ✓ L2@796 | ✓ L2@991 | 优 |
| remote-mine（v11 预置→v13 两步迁移） | ✓ L3@0 | ✓ L3@0 | 持平 |
| speedrun | ✗分段门 L2@796 L3@21113 | ✗ L2@991 L3@28028 | 均优，noErrors 绿 |
| arena | ✗分段门 L3@17049 | ✗ L3@21139 | 优，noErrors 绿 |
| sprint | ✗分段门 L2@1367 | ✗ L2@1446 | 优 |

失败仅为既存分段门差距（冲级速度目标，非行为回归）。typecheck / oxlint / arch-guard（328 处全在册）全绿。
