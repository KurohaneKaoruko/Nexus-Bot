# Spec Delta

## Purpose

Agent 层单一控制平面：一切单位的行为产出统一为"任务 → Agent 状态机 → 意图"单路径；角色判定以 Memory 为权威来源；legacy 双执行路径按阶段关闭。

## ADDED Requirements

### Requirement: 单一行为路径
每个单位在任一 Tick MUST 只产生一条行为路径的输出：要么任务驱动（任务 → 状态机 → 意图），要么显式登记的 legacy Adapter 路径；两条路径 MUST NOT 对同一单位同 Tick 同时生效。

#### Scenario: 双路径互斥
- **WHEN** 某单位同时具备任务驱动条件与 legacy 角色条件
- **THEN** 只有其一产出行为，另一路径静默让位并计数

#### Scenario: 路径可追踪
- **WHEN** 审计某单位一个 Tick 的行为来源
- **THEN** 遥测能回答"这个行为来自哪条路径、哪个任务、哪个 owner"

### Requirement: 角色判定以 Memory 为权威
单位的角色/职能判定 MUST 以其 Memory 记录为第一权威来源，名称解析仅作 fallback；孵化完成的单位 MUST 在出生后首个可见 Tick 前保有角色记录。

#### Scenario: 孵化竞态下角色不丢
- **WHEN** 单位孵化完成前后经历 Memory 清理窗口
- **THEN** 其角色记录不被误删，不出现"出生即无角色"导致的兜底行为

#### Scenario: 异常名不致错轨
- **WHEN** 单位名称不符合命名协议（外部生成/旧名/特殊名）
- **THEN** 角色判定仍按 Memory 记录正确路由，不走错误分支

### Requirement: legacy 执行按阶段关闭
legacy 单位执行路径 MUST 支持按单位类别/房间/全局三级配置开关分阶段关闭；关闭某级别后，对应单位 MUST 由任务驱动路径或 Adapter 接管，且行为可用性不回退（采集/搬运/升级/建造主链路保持）。

#### Scenario: 级别关闭即接管
- **WHEN** 某单位类别被配置为关闭 legacy 执行
- **THEN** 该类单位的全部行为经任务驱动路径产出，legacy 分支不再命中

#### Scenario: 主链路不回退
- **WHEN** legacy 执行全量关闭
- **THEN** 场景回归中采集、搬运、升级、建造的吞吐不低于关闭前基线
