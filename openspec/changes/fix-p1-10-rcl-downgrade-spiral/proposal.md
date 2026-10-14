# Proposal

## Why

P1-10（docs/bugs/sim-audit-2026-10-11.md）是当前唯一未修复的 P1 缺陷，按项目准则**阻塞一切新功能开发**：升级吞吐不足 → controller 降级计时到期 → RCL 2→1→0 失去房间 → 感知按 `controller.my` 静默丢弃房间 → 全模块失明空转 → bootstrap 每 ~200t 空孵 universal 的死循环。sim 50k tick 实证（`/tmp/report-dev-50k.json`：20k 后零进展、72 只 universal churn、0 个任务被认领）且无自然恢复路径。它也是 P0-3/P1-4/P1-5/P1-6/P2-8/P2-9 已修代码的 sim 回归（boot 20k `rclReachedBy 3` 断言、soak）被阻塞的直接原因。

## What Changes

- **降级风险感知**：感知层采集 controller 的 `level/progress/ticksToDowngrade`（sim shim 与官方 API 均已暴露该字段，无需按 lastUpgradeTick 推算），进入 `ControllerSummary`。
- **升级紧急通道（治本）**：`ticksToDowngrade` 低于紧急阈值时，该房间 upgrade 任务优先级动态提至抢占线（≥ `CRITICAL_PRIORITY`），可抢占持有者；降级计时被升级动作重置后回落。紧急态豁免 survive 姿态对 upgrade 的降权与节流（`postureBias.survive.upgrade` / `sustainSuppressed`）。
- **孵化紧急通道**：降级紧急态下 upgrader 的常驻补位豁免 survive 暂停名单（`surviveSpawnPauseRoles`），保升级不断供。
- **房间失守事件（防失明兜底）**：上一 Tick 属于自己、本 Tick `controller.my` 突变 false 的房间，感知层产出显式**失守事件**（Intel 记 `lostAt`、事件可查询），触发姿态紧急重估 → survive；房间从快照消失但必须留下事件痕迹，不得无声失明。
- **bootstrap 空转治理**：世界模型无可见房期间连续 N 次 bootstrap 无效果时降频孵化，并在诊断/遥测中告警，消除 universal churn。
- **回归与勾销**：sim boot 50k 验证（rcl 全程 ≥ 2、无 RCL0、upgrade 意图持续分布、无 universal churn）；补跑 P0-3/P1-4/P1-5/P1-6/P2-8/P2-9 遗留的 sim 回归与 soak；勾销 docs/bugs 清单。

## Capabilities

### New Capabilities
- `controller-downgrade-guard`: 维持房间控制权的闭环——降级风险感知、升级任务紧急提权与抢占、孵化预算优先豁免、失守后 bootstrap 空转治理（docs/nexus-design/17 §17.9「维持控制权」、05 §5.7 紧急抢占、18 §18.6–18.7 失守恢复的落地）。

### Modified Capabilities
- `room-perception`: 新增「Controller 降级字段采集」与「房间失守事件」要求——己方房间 controller 归属丢失必须被识别为显式事件并写入 Intel、可供查询，而不是从世界模型静默消失（基线 spec 位于未 archive 的 `phase1-room-economy` change，主 specs 库尚未建立）。
- `strategy-core`: 新增「失守事件触发的紧急重估」要求——房间失守必须触发姿态立即重估，失明期间姿态落入 survive（基线 spec 位于未 archive 的 `nexus-linked-intelligence` change）。

## Impact

- `src/core/world.ts`：`ControllerSummary` 扩展降级字段（内存 schema 契约变更，随版本迁移）。
- `src/modules/world/perception.ts`：采集降级字段；前后快照对比产出失守事件。
- `src/modules/economy/planners.ts`：upgrade 任务按降级风险动态提权（读当 Tick 感知快照，planning 阶段在 perception 之后，时序天然成立）。
- `src/modules/spawning/spawnDirector.ts`：upgrader 豁免 survive 暂停；bootstrap 连续空转降频告警。
- `src/modules/strategy/`：失守事件接入紧急重估输入。
- `src/config/`（economy/strategy 等）：紧急阈值、迟滞、bootstrap 降频参数全部可配，不硬编码。
- 测试：`tests/world`、`tests/spawning`、`tests/economy`、`tests/strategy` 新增用例；sim 场景回归。
- 不改 `allocator.ts` 抢占机制本身（复用既有 `CRITICAL_PRIORITY` 通道）；不动 cluster/defense 模块。
