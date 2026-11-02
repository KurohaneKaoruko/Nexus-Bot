# Design: main-rush-parity

## Context

- race 变体（`src/branch/race/main.ts`）只挂 `ActorOwnership*` + `RaceSpeedrun`，
  与 main 的 Spawning/Planner/Economy 链物理隔离；其速度来自「单模块直驱」。
- main 的 rush 档是 profile 固定档（`roomMode=rush`），仍走完整模块链（Planner/
  Spawning/Economy/Remote），速度受链路开销与调度节律拖累（sprint L3@39186）。
- 约束：main 的完整功能、布局风格、creep 命名风格都不能动；race 时间线必须保持不变。

## Goals / Non-Goals

**Goals**

- main rush 对照场分段读数达到逼近线（≤ race × 1.20），争取目标线（≤ ×1.10）；
- 自动运营四类塌陷指标在长周期场景不触发；
- race speedrun 逐位一致；main 全场景门 12/12 绿。

**Non-Goals**

- 不把 RaceSpeedrun 模块直接挂进 main（会与 Broker/意图管线冲突，且不算「完整功能」）；
- 不改布局生成口径与 creep 命名规则；
- 不删除 main 任何模块或功能入口。

## Decisions

### D1: 先建对照场，再动代码

新增 `sim/rush-parity.sim.ts`：9 房 + 上游地形 + main bundle + `roomMode=rush`
（memory 预设 `Nexus.rooms.W5N8.mode="rush"`，其余邻房同剖面）。读数与
`speedrun.sim.ts`（race）逐段对照。没有对照场不动任何冲级代码。

### D2: 差距按「链路开销 / 调度节律 / 预算分配」三类归因

用现有遥测（spawn telemetry、economy accumulators、planner 计时）先量三类开销：
- 链路开销：每 tick CPU 分布（snapshot/JS/意图结算）对照 race；
- 调度节律：孵化节律、任务发布→认领延迟、升级任务发射时点；
- 预算分配：rush 档下 energy 分配（spawn/ext/cc/外矿）与 race 的差异。
每类差距单独成切片，逐切片上对照场验证。

### D3: 机制移植优先「抄参照实现」

按 AGENTS.md：设计不出更好逻辑时直接复用 `../Rosmarin-Bot/src/branch/race` 与
本仓 race 变体的实现口径；只做接口适配（不改变行为语义），不重新发明。

### D4: 自动运营优化与冲级解耦

运营优化只在非 rush 档生效或对 rush 档中性（由 profile 门控），避免两目标互相污染；
每项优化必须在 boot/sprint/remote-mine 上给出「诊断→改动→读数」三元组。

### D5: 回归门

- race speedrun：逐位一致（任何时间线漂移即红）；
- main：全场景门 12/12 绿（速度类参考为 ✗ 的场景按趋势观察项读）；
- 新增对照场：硬门 + 逼近线/目标线三档判定。

## Risks / Trade-offs

- [风险] main rush 逼近 race 会引入 race 的单模块直驱思路，可能与 Broker 意图管线
  冲突 → 只移植机制（算法/节律/预算），不移植直驱执行方式。
- [风险] 运营优化改变既有行为基线 → 用 profile 门控 + 场景读数对照，必要时回退单切片。
- [权衡] 逼近线 1.20 是可达性优先；若机制移植后仍 >1.20，回到 D2 归因，不调参掩盖。

## Migration Plan

无 Memory 版本变更。新增场景文件与可选配置；上线前 sim 全绿。

## Open Questions

- main rush 对照场是否需要与私服同 world seed（首轮先用 speedrun 同地形，跑通后再校）。
