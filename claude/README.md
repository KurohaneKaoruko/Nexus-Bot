# claude/：Rosmarin → Nexus 迁移的分析与设计

本目录是一次外部协助的产物：通读 Nexus-Bot（v1.0.0）与 Rosmarin-Bot（main，2026-10-02），整理旧 bot 迁入 Nexus 架构的现状、缺陷与路线，并给出外矿迁移的完整设计。2026-10-28 完成。

- **全部基于读代码，没有运行 bot、tsc 或 sim。** 哪些结论亲自核对过、哪些只来自分域走查，见 `analysis/06-核对记录.md`；design/25 另经一轮独立复核，更正见 `analysis/07-迁移总图复核记录.md`。analysis/01–04 是走查原始记录，与 design/ 不一致处以 design/ 和 analysis/07 为准。
- 文档沿用本仓库的写法：编号设计文档、openspec 的 proposal / design / tasks / specs、每条任务带「验证」、七问表、持久化根 `Memory.Nexus`。
- 本目录不改动仓库其他任何文件。

## 基线

本目录分析的是 `main` 分支 v1.0.0（`73d3295`，2026-10-14）。`dev` 分支此后又有 129 个提交（至 2026-10-27，包括「上游外矿链整套移植」，以及 `docs/nexus-design/` 改为 01–11 编号并新增 `09-legacy-archive`、`10-legacy-removal-ledger`），本目录没有据此重新核对。因此：

- 文中的 file:line 引用与「现状」均指 v1.0.0。**已按 `dev`（`dbe9d01`）逐条复核，见 `analysis/08-dev分支复核.md`**：B2 / B3 / B4 已修、B13 部分修复，B6–B12 仍在；design/25 的分域现状与路线已被 `dev` 的进展和维护者自己的 02 / 03 / 10 号文档取代；design/24 中名册、清扫豁免、侦察 / 预定 / 搬运已在 `dev` 实现，Intel、外矿安全、状态机、收益反馈仍可参考。
- 下表「采用时建议放到」一列按 v1.0.0 的文档编号写；在 `dev` 的新编号体系下请由维护者决定位置。

## 先读哪个

1. `design/25-旧Bot迁移总图.md`：全仓现状图。§25.2 是 13 个跨域阻断缺陷（B1–B13），§25.6 是迁移路线 M0–M8，§25.8 是需要维护者拍板的问题。
2. `design/24-外矿迁移.md`：旧外矿链分四期迁入主线，最终删除 `modules/external/*`。§24.16 是需要维护者拍板的问题。
3. `openspec/phase4-remote-intel/`：外矿迁移一期的实现变更，可直接照 tasks.md 开工。

## 目录

| 文件 | 内容 | 采用时建议放到 |
|---|---|---|
| `design/25-旧Bot迁移总图.md` | 全仓迁移现状、缺陷 B1–B13、双轨清单、Memory 现状、路线 M0–M8 | `docs/nexus-design/25-旧Bot迁移总图.md` |
| `design/24-外矿迁移.md` | 外矿迁移契约（分期、名册、Intel、选点、闭环、安全、收益反馈、旧链删除清单） | `docs/nexus-design/24-外矿迁移.md` |
| `openspec/phase4-remote-intel/` | 外矿迁移一期：proposal、design（D1–D12）、tasks（0–8 节）、5 个 capability spec | `openspec/changes/phase4-remote-intel/` |
| `analysis/01-旧外矿链盘点.md` | `modules/external/*` 能力、Memory 键、调用情况、收入提供方、SK 处理 | — |
| `analysis/02-经济孵化与角色现状.md` | 每个角色、孵化、体型、物流的运行状态；原生调用；旧 Memory 键 | — |
| `analysis/03-工业战争防御现状.md` | lab / factory / 市场 / terminal / power / 核弹 / 防御 / 编队 / 扩张 / 跨 shard | — |
| `analysis/04-内核规划移动现状.md` | 调度、存储、布局规划、移动、控制台、可视化、变体、类型债 | — |
| `analysis/05-设计审阅记录.md` | 外矿设计初稿的独立审阅意见与处理结果 | — |
| `analysis/06-核对记录.md` | 每条缺陷结论的核对方式与来源 | — |
| `analysis/07-迁移总图复核记录.md` | design/25 的独立复核结论与 18 处更正（含对 analysis/02–04 的更正） | — |
| `analysis/08-dev分支复核.md` | B1–B13 与外矿设计在 `dev`（`dbe9d01`）上的逐条状态、`dev` 外矿的新问题、本目录各文件在 `dev` 上的适用性 | — |

文档内部的交叉引用写的是「采用后的路径」（如 `docs/nexus-design/25`、`openspec/changes/phase4-remote-intel/`）。在本目录内阅读时，按上表对应即可。

## 需要维护者拍板的问题（汇总）

外矿（design/24 §24.16）：

1. 名册修复（跨房单位丢记忆）是否不受 P1-14 门禁、先行合入。
2. 外矿威胁是否不计入全局威胁。
3. 外矿单位与家内单位是否隔离。
4. 外矿开闸是否要求母房有 storage。

全仓（design/25 §25.8）：

1. B1（旧角色走不动）是否有意为之。
2. 修复 B1 / B3 / B4 后 P1-14 校准是否需要重做。
3. 迁移顺序：先做孵化单轨（M1），还是先做外矿一期。
