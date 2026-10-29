# migration-audit/：Rosmarin → Nexus 迁移走查证据链

> 2026-10-28 外部协助产物：通读 Nexus-Bot 与 Rosmarin-Bot，走查旧 bot 迁入 Nexus 架构的现状、缺陷与路线。**全部基于读代码，未运行 bot / tsc / sim。**

## 与设计件的关系

- 走查结论已提炼为两篇设计件：`../12-legacy-bot-migration-map.md`（全仓总图，§25 章节号）与 `../13-external-mining-migration.md`（外矿契约，§24 章节号）；一期实现变更为 `openspec/changes/phase4-remote-intel/`。
- 本目录 01–04 是走查原始记录，与设计件不一致时**以设计件和 07 复核记录为准**；06 记录每条结论的核对方式。

## 基线口径（重要）

走查基于 `main` 分支 v1.0.0（`73d3295`，2026-10-14）。**dev 其后已演进百余提交**，部分结论已被超越，最显著的：

- `modules/external/` 旧外矿链（externalMine/externalScheduler/outMine/mine/）**已于 2026-10-29 经 legacy-consolidation-b C 波删除**（见 `../10-legacy-removal-ledger.md`）——01 盘点的对象已不存在，仅存历史价值；
- 上游外矿链（批次 AD）已另线移植进 speedrun 隔离区；
- file:line 引用与「现状」均指 v1.0.0，使用前请对照当前代码复核。

## 目录

| 文件 | 内容 |
|---|---|
| `01-旧外矿链盘点.md` | `modules/external/*` 能力、Memory 键、调用情况、收入提供方、SK 处理（对象已删除，历史快照） |
| `02-经济孵化与角色现状.md` | 每个角色、孵化、体型、物流的运行状态；原生调用；旧 Memory 键 |
| `03-工业战争防御现状.md` | lab / factory / 市场 / terminal / power / 核弹 / 防御 / 编队 / 扩张 / 跨 shard |
| `04-内核规划移动现状.md` | 调度、存储、布局规划、移动、控制台、可视化、变体、类型债 |
| `05-设计审阅记录.md` | 外矿设计初稿的独立审阅意见与处理结果 |
| `06-核对记录.md` | 每条缺陷结论的核对方式与来源 |
| `07-迁移总图复核记录.md` | 总图的独立复核结论与 18 处更正（含对 02–04 的更正） |

## 维护者待拍板问题（自设计件汇总）

外矿（`../13-external-mining-migration.md` §24.16）：名册修复是否先行合入、外矿威胁是否计入全局、外矿与家内单位是否隔离、外矿开闸是否要求母房有 storage。

全仓（`../12-legacy-bot-migration-map.md` §25.8）：B1 是否有意为之、修 B1/B3/B4 后校准是否重做、迁移顺序（M1 孵化单轨 vs 外矿一期）。
