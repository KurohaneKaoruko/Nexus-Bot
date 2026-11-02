# Proposal: main-rush-parity

## Why

race 变体（`RaceSpeedrun` 单模块）在 9 房冲级场景已达 L4@6004 / L5@12489 /
L6@32545，而 main 分支的 rush 房模式（`roomMode=rush`）在同一地形/同一声明口径下
只有 L2@834 / L3@39186（sprint 50k 快照，L4 未达）——同一套目标（10k/20k/40k）
在两条链上的实现质量差距过大。同时 main 分支的房间自动运营（全功能模式）近年只做
了收口与瘦身，缺少以「稳态经济连续性」为目标的专项优化。本变更在**不损失 main
完整功能、不改布局风格、不改 creep 命名风格**的硬约束下，把 main rush 模式的
冲级速度逼近 race 变体，并系统优化自动运营质量。

## What Changes

- **测量先行**：新增/固化「main rush 对照场」——9 房、上游真实地形、main bundle、
  `roomMode=rush` 固定档，与 race 的 speedrun 场同世界同口径；分段读数与 race
  逐段对照（L2–L6）。
- **冲级机制移植**：以 race 变体（及 `../Rosmarin-Bot/src/branch/race` 血统）为
  参照，把与「单模块冲级」耦合度低、可复用的机制（开局序列、孵化填充、替补错峰、
  外矿预算、任务优先级/预算分配）迁入 main 的 rush 档；**布局与 creep 命名不变**。
- **自动运营优化**：以 boot/sprint/remote-mine 等全功能场景为基线，针对稳态经济
  连续性（供能断档、孵化空转、外矿吞吐、升级饥饿）做诊断驱动的优化，不改变现有
  对外行为契约。
- **回归门扩展**：race `speedrun` 保持逐位一致；main 全场景门 12/12 绿；新增 main
  rush 对照场的分段门（逼近 race 的量化线：见 specs）。

## Capabilities

### New Capabilities

- `room-auto-operation`: 房间自动运营的稳态质量契约——全功能模式下经济连续性
  （供能/孵化/升级/外矿）在长周期内不塌陷、不空转，并以可观测指标回归。

### Modified Capabilities

- `race-speedrun`: 新增「main rush 模式冲级逼近 race」要求（同场同口径分段读数、
  逼近比例上限），原有 race 三档达标与回归护栏不变。

## Impact

- 代码：`src/branch/race/*`（只读参照，不改）、`src/modules/spawning/*`、
  `src/modules/strategy/*`（room mode profile）、`src/modules/economy/*`、
  `src/config/*`；`sim/`（新增 main rush 对照场）。
- 约束：main 全功能不回退（12/12 场景门）；布局风格与 creep 命名风格不变；
  race 变体产物与时间线逐位一致。
- 验证：race speedrun 逐位一致 + main rush 对照场分段达标 + 全场景门绿。
