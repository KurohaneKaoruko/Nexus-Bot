# Proposal: refine-architecture-docs

## Why

docs/ 下四篇架构文档（01 架构设计 / 02 重构指导 / 03 BUG 清单 / 04 合并版）是 2026-10-17 落库的审计快照：章节框架完整，但多数章节只有方向性原则（"必须分离""不要伪造 native code"），缺少字段级 schema、状态机、度量方法与验收门禁等可执行细节；同时合并版与前三篇大量重叠，双份维护必然漂移。在 `nexus-architecture-refactor` 变更推进 Phase 0–15 的当下，文档作为"实现依据"的颗粒度不足，且第 41 章 "最终 Bug 管理方法" 提出的 docs/bugs 流程与 AGENTS.md 的缺陷治理规则也存在口径不一致。

## What Changes

- **01 架构设计**全面深化为可执行规范：
  - ActionResult 五分类语义补全（每类的产生原因、消费方职责、重试策略），内部错误码注册表。
  - ResourceLedger 五态分账字段级 schema（Observed/Available/Reserved/Committed/Consumed 的记账时点、结算规则、不变量）。
  - Memory schema 字段表（每字段类型、生命周期、迁移策略位），与 Runtime Index 的分界线。
  - Event System 与 Telemetry 的通道定义、事件类型注册表、CPU 预算分配表。
  - Cluster/Goal/Task/Agent/Intent/Command 六层间接口契约（输入/输出类型、失败语义）。
- **02 重构指导**全面深化为可执行迁移程序：
  - 每个 Phase 补齐三要素：进入条件（依赖哪些前置 Phase 的产出）、验收门禁（客观可测的通过标准 + 度量方法）、回滚策略。
  - Phase 0 基线冻结清单落到具体指标：RCL 时间线基准的采集方法、CPU/Spawn/任务完成率的采样与记录格式。
  - Ownership 三阶段（记录→告警→拦截）每阶段的行为定义、升级条件与降级开关。
  - Legacy Removal 门禁四条件（Nexus 等价 + 生产验证 + sim 验证 + CPU 鉤证）的判定程序与证据格式。
- **03 BUG 清单**与 docs/bugs 治理体系对账：
  - 35 项 BUG 逐项标注处置状态（已修复/已登记 docs/bugs/仍在代码/已失效），建立与 docs/bugs/ 文件的映射表。
  - 修復顺序章节与 docs/bugs 优先级体系（P0-16a/b/c → P1-17 → P1-18 → P1-19/P2-20）合并口径。
  - 第 41 章 Bug 管理方法与 AGENTS.md 规则（先修 bug 再开发、修复即勾销 + sim 回归）统一为单一流程。
- **04 合并版降级为索引**：内容改为"导读 + 指向前三篇的章节索引 + 文档层级说明"，消除双份维护；前三篇成为唯一事实源。
- 建立文档间交叉引用规范：01/02/03 篇内引用需带章节号，与 docs/nexus-design/ 23 篇的关系定位（四篇 = 目标架构权威源，nexus-design = 历史演进与专题设计）。

**BREAKING**：无代码行为变更（纯文档变更）。
**BREAKING**（文档层面）：合并版（04）从独立内容文档降级为索引页，原有内容不再单独维护。

## Capabilities

### New Capabilities

- `architecture-docs`：四篇架构文档的内容结构与质量要求——各篇职责边界、深化的颗粒度标准（字段级 schema/状态机/验收门禁）、合并版索引化后的形态、交叉引用规范、与 docs/bugs 及 AGENTS.md 的对账关系。

### Modified Capabilities

（无——`cluster-squad` 等既有 spec 的需求不变，本变更不改系统行为。）

## Impact

- **受影响文件**：`docs/Nexus-Bot-01-架构设计.md`、`docs/Nexus-Bot-02-重构指导.md`、`docs/Nexus-Bot-03-BUG清单.md`、`docs/Nexus-Bot-架构设计与重构指导.md`（重写为索引）。
- **下游消费者**：`openspec/changes/nexus-architecture-refactor`（其 design/tasks 以四篇文档为依据，深化后需核对无冲突）；后续所有以 docs/nexus-design 与四篇文档为架构依据的开发工作。
- **不影响**：src/ 代码、openspec/specs/ 主 specs、docs/bugs/ 既有缺陷文件（03 对账只读引用，不修改缺陷文件本身）。
- **风险**：文档体量增长；03 章节号体系与 docs/bugs 文件名的映射需维护。通过 04 索引页集中管理章节跳转来缓解。
