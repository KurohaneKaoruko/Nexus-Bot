# Nexus-Bot 架构设计·索引与导读

> 基线：`KurohaneKaoruko/Nexus-Bot`
> 定位：Screeps Bot / EX-MACHINA NEXUS
>
> **本文是索引页**：目标架构的完整内容不在本文维护，统一由分离三篇承载（见下）。本文只保留执行摘要、文档层级说明与主题索引。

---

# 1. 执行摘要（压缩版）

当前 Nexus-Bot 已经拥有 NEXUS 架构的多个重要组件（Kernel/World/Strategy/Economy/Cluster/Task/Agent/ActionBroker/Movement/Spawning/Defense/Teams/Industry/Expansion/InterShard/Telemetry）。项目的问题不是"没有架构"，而是：

> **新架构和旧 Bot 仍然同时拥有部分控制权。**

多个潜在控制平面（Nexus 任务系、Legacy Prototype、Teams、Industry、Expansion、Movement Runtime）并存直控，导致行为覆盖、任务抢占、重复移动、状态不一致、无法追溯、无法测试。

所以重构第一原则：

> **Ownership First：先统一控制权，再整理业务模块。**

详细论证与源码实测数据 → 01 篇 §1–§5、03 篇 BUG-001/002/003。

# 2. 文档层级说明

```text
docs/
├── Nexus-Bot-01-架构设计.md          ← 目标架构规范（What）（权威源 A）
├── Nexus-Bot-02-重构指导.md          ← 迁移程序与验收门禁（How/When）（权威源 B）
├── Nexus-Bot-03-BUG清单.md           ← 架构审计快照 + 治理对账（权威源 C）
├── Nexus-Bot-架构设计与重构指导.md    ← 本文：索引与导读（不承载独立内容）
├── nexus-design/                     ← 历史演进与专题设计（23+ 篇；与前三篇冲突时以前三篇为准）
│   └── legacy-removal-ledger.md      ← legacy 删除门禁台账（活文档，02 §28 引用）
├── bugs/                             ← 行为级缺陷唯一事实源（03 §41 流程）
└── api/                              ← API 契约参考
```

裁定规则：

- **目标架构的唯一事实源**是 01/02/03 三篇（+ 主 specs `openspec/specs/`）。
- nexus-design 是历史演进与专题设计存档；对同一主题与前三篇冲突时，**以前三篇为准**，nexus-design 侧带废弃/改向标注。
- 行为级缺陷一律 docs/bugs；本层级图内无第二处缺陷记录。

# 3. 主题 → 章节 索引表

按主题查前三篇的对应章节（`篇 §章节`）：

## 3.1 架构与机制（01 篇）

| 主题 | 章节 |
|---|---|
| 设计目标 / 机凯种理念落地 | 01 §1, §32 |
| Screeps 运行模型硬约束 | 01 §2 |
| 最终架构总图 / 六层职责 | 01 §3–§4 |
| Actor Ownership（模型/字段/四操作/冲突矩阵） | 01 §5 |
| TickContext / 最终 Tick 流程 | 01 §6, §33 |
| World Model / Intelligence / Cluster | 01 §7–§9 |
| Task 系统 / 租约 | 01 §10–§11 |
| Agent / Intent / Command（六层接口契约） | 01 §12–§14 |
| ActionBroker / ActionResult（五分类/错误码注册表） | 01 §15–§16 |
| Movement / Economy（五态账本）/ Spawn / Construction | 01 §17–§20 |
| Defense / Teams / Industry | 01 §21–§23 |
| Memory（schema/字段模板/分界线）/ Runtime Index / CPU | 01 §24–§26 |
| Error Isolation / Event System（通道/注册表/预算表） | 01 §27–§28 |
| 最终目录（含现行态裁定与迁移矩阵）/ 依赖规则 / 模块标准结构 | 01 §29–§31 |
| 重构成功标准 | 01 §34 |

## 3.2 迁移程序与验收门禁（02 篇）

| 主题 | 章节 |
|---|---|
| 重构原则（绞杀式）/ Phase 总览 | 02 §1–§2 |
| 三要素块约定（进入条件/门禁/回滚 + G-编号规则） | 02 §0 |
| Phase 0 基线冻结（指标采集表） | 02 §3 |
| Phase 1 Ownership（三阶段/降级开关） | 02 §4 |
| Phase 2 Command Boundary / ActionResult 迁移 | 02 §5–§6 |
| Phase 3 TaskBoard / Reconciliation | 02 §7–§8 |
| Phase 4 Agent / Legacy Role 迁移 | 02 §9–§10 |
| Phase 5 Movement（禁止项） | 02 §11–§12 |
| Phase 6 Construction / ConstructionPlan | 02 §13–§14 |
| Phase 7 Spawn（Demand/BodyFactory） | 02 §15–§17 |
| Phase 8 Economy（Ledger/Transfer 统计） | 02 §18–§20 |
| Phase 9 Defense | 02 §21 |
| Phase 10 Cluster/Squad / Squad 迁移 | 02 §22–§23 |
| Phase 11 Teams | 02 §24 |
| Phase 12 Industry | 02 §25 |
| Phase 13 Expansion / InterShard | 02 §26–§27 |
| Phase 14 删除 Legacy（四条件门禁/台账） | 02 §28 |
| Phase 15 性能 / Global Reset | 02 §29–§30 |
| 提交规则 / Coding Agent 规则 / 每阶段验收汇总 | 02 §31–§33 |
| 第一/二/三批实际改动建议 | 02 §34–§36 |
| 最终迁移完成标志 / 重构路线核心原则 | 02 §37–§38 |

## 3.3 审计与治理（03 篇）

| 主题 | 章节 |
|---|---|
| 严重度定义（P0–P3/A） | 03 §1 |
| 35 项架构 BUG（逐项含状态标注） | 03 §2–§36 |
| 修复顺序（docs/bugs 单一口径汇总） | 03 §37–39 |
| 重构前后不变量 | 03 §40 |
| Bug 管理方法（与 AGENTS.md 等价流程） | 03 §41 |
| 处置状态映射表（两轴对账） | 03 §43 |
| 最终判断 | 03 §42 |

## 3.4 治理入口（docs/ 外部）

| 入口 | 用途 |
|---|---|
| `docs/bugs/` | 行为级缺陷登记/勾销（03 §41 流程；先修 bug 再开发） |
| `docs/nexus-design/legacy-removal-ledger.md` | legacy 删除四条件台账（02 §28 判定程序） |
| `AGENTS.md` | 开发准则（bug 优先/模块化/无硬编码/nightx 属主） |
| `openspec/specs/` + `openspec/changes/` | 规格事实源与变更追踪（重构主变更：nexus-architecture-refactor） |

# 4. EX-MACHINA NEXUS 一句话

不是一个"有很多 Creep 的 Bot"，而是：

> **一个通过大量分布式执行单元实现统一意识、局部自治和持续反馈的 Screeps 集体智能系统。**

重构成功的标志：能回答"这个 Tick，为什么这个 Creep 做了这个动作？"——沿 Action → Intent → Task → Goal → Strategy 完整追溯（01 §14 层间契约 + 01 §33 最终 Tick）。
