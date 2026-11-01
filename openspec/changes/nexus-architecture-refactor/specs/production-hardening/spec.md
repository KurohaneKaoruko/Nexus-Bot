# Spec Delta

## Purpose

生产硬化与回归线：把四篇文档定义的场景门、生产级不变量监控与实服落地节奏固化为持续验收标准；缺陷修复轨道与重构轨道并行推进时的回归保障。

## ADDED Requirements

### Requirement: 场景门回归线
以下 sim 场景门 MUST 作为每次合入的回归线并保持可一键执行：boot（RCL2/RCL3 达标）、speedrun 分段门（RCL2≤500 / RCL3≤3k / RCL4≤5k / RCL5≤15k / RCL6≤30k）、sprint（L4 验收线）、remote-mine（跨房采集收入记录）、arena、race-body-audit。分段门未达属"冲级目标未达成"不计为重构回归，行为性缺陷（新回归、角色错轨、静默死锁）MUST 阻断合入。

#### Scenario: 回归线一键执行
- **WHEN** 变更准备合入
- **THEN** 全场景门可一条命令跑完并输出逐门红绿

#### Scenario: 行为回归阻断
- **WHEN** 某合入引入角色错轨或链路静默死锁
- **THEN** 对应场景门红，合入被阻断

### Requirement: 生产级不变量监控
系统 MUST 持续监控并告警以下不变量：一个 Actor 一个 owner；任务必有终结路径（无无主泄漏）；孵化名单一致性（孵化中不被清理/误杀）；Memory 无界增长；CPU 预算超支。不变量被打破 MUST 在限频窗口内产生可定位告警。

#### Scenario: 不变量破坏告警
- **WHEN** 出现无 owner 的 Actor 双控制冲突
- **THEN** 限频告警指明 Actor、双 owner 与 Tick

#### Scenario: Memory 增长受控
- **WHEN** 系统连续长时间运行
- **THEN** Memory 体量稳定在阈值内，无持续线性增长

### Requirement: 实服落地验证节奏
涉及运行时行为的变更 MUST 在实服完成落地验证后方可勾销：落地于指定私服，观察至少一个完整重置周期（含 4wt 自动重开场景）；实服观察到的缺陷 MUST 回流 `docs/bugs` 登记并标注优先级与验证标准。

#### Scenario: 实服验证闭环
- **WHEN** 某运行时变更合入
- **THEN** 在指定私服落地并观察一个重置周期，关键行为（孵化/采集/升级/扩张）正常后勾销

#### Scenario: 实服缺陷回流
- **WHEN** 实服观察发现异常
- **THEN** `docs/bugs` 出现对应登记（含优先级与验证标准），未修复的 P0/P1 阻断后续新功能

### Requirement: 缺陷轨道与重构轨道并行推进
`docs/bugs` 未修复缺陷（P0/P1 优先）MUST 与重构轨道并行修复：每修完一项 MUST 勾销并跑场景门回归；两轨道触碰同一代码域时缺陷修复优先。

#### Scenario: 修复即回归
- **WHEN** 一项缺陷修复完成
- **THEN** 对应 `docs/bugs` 文档勾销且场景门回归通过

#### Scenario: 同域冲突时缺陷优先
- **WHEN** 重构任务与缺陷修复触碰同一代码域
- **THEN** 先落缺陷修复再继续重构，避免重构覆盖修复
