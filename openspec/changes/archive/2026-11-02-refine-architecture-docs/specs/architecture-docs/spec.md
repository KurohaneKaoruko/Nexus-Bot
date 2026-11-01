# Spec Delta

## Purpose

docs/ 下四篇架构文档（01 架构设计 / 02 重构指导 / 03 BUG 清单 / 04 合并版索引）的内容结构与质量要求：各篇职责边界、深化颗粒度标准、合并版索引化形态、交叉引用规范，以及与 docs/bugs、AGENTS.md 缺陷治理规则的对账关系。

## ADDED Requirements

### Requirement: 01 架构设计篇可执行颗粒度
01 架构设计篇 MUST 为每个核心抽象提供字段级定义与失败语义：ActionResult 五分类（accepted/retryable/replan/invalid/suppressed）MUST 含产生原因、消费方职责与重试策略；ResourceLedger 五态 MUST 含记账时点与结算规则；Memory schema MUST 逐字段标注类型、生命周期与迁移策略位；六层（Cluster/Goal/Task/Agent/Intent/Command）间接口 MUST 声明输入/输出契约。

#### Scenario: ActionResult 分类可判定
- **WHEN** 开发者要为一个新命令类型决定 ActionResult 分类
- **THEN** 能在 01 篇的 ActionResult 章节查到该分类的判定标准、示例与内部错误码注册表，无需再凭经验判断

#### Scenario: Ledger 记账时点无歧义
- **WHEN** 两个开发者对"资源何时从 Reserved 转 Committed"有分歧
- **THEN** 01 篇 ResourceLedger 章节的五态转换时点表给出唯一答案

#### Scenario: Memory 字段有生命周期标注
- **WHEN** 审查一个新增的 Memory 字段
- **THEN** 能按 01 篇 Memory schema 字段表的格式声明类型、生命周期与迁移策略位，缺任一项视为不合规

### Requirement: 02 重构指导篇阶段门禁
02 重构指导篇的每个 Phase MUST 具备三要素：进入条件（前置 Phase 的产出依赖）、验收门禁（客观可测的通过标准与度量方法）、回滚策略。Phase 0 基线冻结 MUST 列明具体指标与采集方法；Ownership 三阶段 MUST 各自定义行为、升级条件与降级开关；Legacy Removal 门禁四条件 MUST 有判定程序与证据格式。

#### Scenario: Phase 验收可客观判定
- **WHEN** 实施者声明某 Phase 完成
- **THEN** 按 02 篇该 Phase 的验收门禁逐条度量，每条都能得出通过/不通过的客观结论，而非主观评价

#### Scenario: Ownership 阶段切换有开关
- **WHEN** 拦截阶段出现误伤（低优先级 owner 被错误阻断）
- **THEN** 能按 02 篇定义的降级开关配置回退到告警阶段，无需改代码

#### Scenario: Legacy 删除有证据链
- **WHEN** 申请删除一个 legacy 子系统
- **THEN** 02 篇 Legacy Removal 门禁要求提交四条件各自的证据（等价性、生产验证、sim 验证、CPU 验证），缺一不得删除

### Requirement: 03 BUG 清单篇治理对账
03 BUG 清单篇 MUST 为每项 BUG 标注处置状态并与 docs/bugs/ 文件建立映射：状态 MUST 为已修复、已登记 docs/bugs、仍在代码、已失效之一；修复顺序章节 MUST 与 docs/bugs 优先级体系合并为单一口径；Bug 管理方法章节 MUST 与 AGENTS.md 规则（先修 bug 再开发、修复即勾销 + sim 回归）一致。

#### Scenario: BUG 状态可追溯
- **WHEN** 查看清单中的某项 BUG
- **THEN** 能看到其处置状态及对应的 docs/bugs/ 文件链接（若已登记），不产生"清单说已修、bugs 目录无记录"的悬空状态

#### Scenario: 修复顺序单一口径
- **WHEN** 规划下一轮缺陷修复批次
- **THEN** 03 篇修复顺序章节与 docs/bugs 各文件头部的优先级标注指向同一批次划分，无互相矛盾的两个清单

#### Scenario: 新缺陷单一流程
- **WHEN** sim 审计或线上观察发现新缺陷
- **THEN** 按 03 篇 Bug 管理方法（与 AGENTS.md 一致）登记到 docs/bugs 并标注优先级与验证标准，而不是在 03 篇内新增编号条目

### Requirement: 04 合并版索引化
04 合并版（Nexus-Bot-架构设计与重构指导.md）MUST 降级为索引页：保留执行摘要与文档层级说明，正文内容 MUST 替换为指向前三篇的章节级索引；MUST NOT 继续独立维护与前三篇重复的设计内容。

#### Scenario: 查阅架构主题走索引
- **WHEN** 读者在 04 合并版中查找某个架构主题（如 ResourceLedger）
- **THEN** 通过章节级索引跳转到 01/02/03 篇的对应章节，04 自身不含该主题的独立论述

#### Scenario: 索引不漂移
- **WHEN** 前三篇章节结构发生调整
- **THEN** 04 索引页同步更新引用（章节号 + 篇名），不出现指向已不存在章节的死链

### Requirement: 文档交叉引用规范
四篇文档的篇内引用 MUST 带篇名与章节号（如 "02 §13 Phase 5"）；四篇与 docs/nexus-design/ 的关系 MUST 明确定位为：四篇为目标架构权威源，nexus-design 为历史演进与专题设计；两处对同一主题的表述冲突时 MUST 以四篇为准并在 nexus-design 侧标注废弃或改向标注。

#### Scenario: 引用可解析
- **WHEN** 读者遇到文档内的交叉引用
- **THEN** 引用格式包含篇名与章节号，能唯一定位到目标章节

#### Scenario: 冲突有仲裁顺序
- **WHEN** nexus-design 某篇与四篇对同一机制的描述不一致
- **THEN** 按文档层级以四篇为准，且该 nexus-design 篇章带废弃/改向标注指向四篇对应章节
