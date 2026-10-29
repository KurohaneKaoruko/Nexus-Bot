# docs/nexus-design — 专题设计目录

> 目标架构与重构程序的唯一事实源是 [`01-架构设计`](../Nexus-Bot-01-架构设计.md) / [`02-重构指导`](../Nexus-Bot-02-重构指导.md) / [`03-BUG清单`](../Nexus-Bot-03-BUG清单.md) 三篇，本目录冲突时以前三篇为准（裁定规则见 [`架构设计与重构指导`](../Nexus-Bot-架构设计与重构指导.md) §2）。

## 文件清单（按阅读顺序）

| 序 | 文件 | 内容 | 性质 |
|---|---|---|---|
| 01 | [`01-blueprint.md`](01-blueprint.md) | EX MACHINA 蓝图（书籍式 §0–§15） | 总纲 |
| 02 | [`02-architecture-charter.md`](02-architecture-charter.md) | 分层落地与扩展契约（§19）、架构定案与 src 顶层结构（§21）、三循环与数据所有权（§22） | 现行公约 |
| 03 | [`03-cluster-squads.md`](03-cluster-squads.md) | Squad 架构、交互接口契约、进度表（§20.7 是当前进度源） | 现行公约 |
| 04 | [`04-foundations.md`](04-foundations.md) | Screeps 游戏机制（§1）、设计原则（§2）、术语与规则来源（§16） | 基础 |
| 05 | [`05-expansion-intelligence.md`](05-expansion-intelligence.md) | 侦察状态机、房间价值评分、Reserve/Claim、撤退 | 专题 |
| 06 | [`06-testing-deployment.md`](06-testing-deployment.md) | 构建命令、测试金字塔、sim 场景、回归线、发布策略 | 专题 |
| 07 | [`07-operations-recovery.md`](07-operations-recovery.md) | 配置分层、Flags 语义、灾难恢复等级 | 专题 |
| 08 | [`08-race-speedrun.md`](08-race-speedrun.md) | race 冲级机制复刻 P0–P5（原生路线参考） | 专题 |
| 09 | [`09-legacy-archive.md`](09-legacy-archive.md) | 原 03–17 共 12 篇设计稿（已被 01/02 篇取代） | 历史存档 |
| 10 | [`10-legacy-removal-ledger.md`](10-legacy-removal-ledger.md) | legacy 删除四条件台账（02 篇 §28 判定程序） | 治理 |
| 11 | [`11-speedrun-round120-port.md`](11-speedrun-round120-port.md) | round-120 冲级血统同步移植记录 | 专题 |
| 12 | [`12-legacy-bot-migration-map.md`](12-legacy-bot-migration-map.md) | 旧 Bot（Rosmarin）迁移总图：状态口径、缺陷 B1–B13、双轨清单、路线 M0–M8（§25 章节号，v1.0.0 走查基线） | 走查 |
| 13 | [`13-external-mining-migration.md`](13-external-mining-migration.md) | 外矿迁移契约：分期、名册、Intel、选点、闭环、安全、收益反馈（§24 章节号，一期变更 `openspec/changes/phase4-remote-intel/`） | 走查 |
| — | [`migration-audit/`](migration-audit/README.md) | 12/13 的走查原始记录（01–07）与核对链，v1.0.0 基线快照 | 证据 |

## 章节编号

合并文件**沿用原篇号**作为章节号，便于旧引用追溯，因此章节号与文件名编号无关：

| 文件 | 章节号来源 | 引用写法 |
|---|---|---|
| `02-architecture-charter.md` | 原 19 / 21 / 22 篇 | `02-architecture-charter.md §21.1` |
| `04-foundations.md` | 原 01 / 02 / 16 篇 | `04-foundations.md §2.7` |
| `09-legacy-archive.md` | 原 03–17 篇 | `09-legacy-archive.md §17.3` |
| `01` / `03` / `05`–`08` | 原样 | `01-blueprint.md §5` |

## 注意

- **`01-blueprint.md` 与根目录 `Nexus-Bot-01-架构设计.md` 是两个不同文件。** 本目录正文写「01 篇」时通常指**根目录权威源**；指本文件时写「本篇」。
- `09-legacy-archive.md` 内各节**不得作为实现依据**，篇首均有「权威改向」标注指向现行权威。

## 合并与重编历史

原 25 篇按主题合并为 10 篇，并统一重编为 01–10：

| 现文件 | 来源 |
|---|---|
| `01-blueprint.md` | 23-ex-machina-blueprint.md |
| `02-architecture-charter.md` | 19-智械连结扩展.md + 21-architecture.md + 22-three-loops-and-data-ownership.md |
| `03-cluster-squads.md` | 20-智能连结集群.md |
| `04-foundations.md` | 01-game-mechanics.md + 02-nexus-design-principles.md + 16-glossary-sources.md |
| `05-expansion-intelligence.md` | 10-expansion-intelligence.md |
| `06-testing-deployment.md` | 13-testing-deployment.md |
| `07-operations-recovery.md` | 18-operations-control-recovery.md |
| `08-race-speedrun.md` | 24-race-speedrun-port.md |
| `09-legacy-archive.md` | 03/04/05/06/07/08/09/11/12/14/15/17 共 12 篇 |
| `10-legacy-removal-ledger.md` | legacy-removal-ledger.md |
