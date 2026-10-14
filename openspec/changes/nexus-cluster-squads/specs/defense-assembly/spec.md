# Spec Delta

## Purpose

防御系统装配：补齐防御系统的 Tick 循环入口（emergency 阶段：威胁观测 → 任务规划 → 塔行动 → 消耗入账），并把高强度威胁的响应形态由"单条 defend 任务"升级为"编队协作需求"，低强度路径保持不变。

## ADDED Requirements

### Requirement: 防御模块在 emergency 阶段装配

防御系统必须作为模块接入 Tick 循环，运行于 `emergency` 阶段（感知之后、战略之前），预算带为 P0（预算再紧张也不得跳过威胁响应）。模块必须按序执行：更新房间威胁摘要 → 按房间规划防御任务 → 分配塔行动 → 折叠塔消耗入账。

#### Scenario: 威胁观测进入 Tick 循环

- **WHEN** Tick 运行至 emergency 阶段
- **THEN** 房间威胁摘要被更新，防御任务按房间被幂等规划

#### Scenario: 预算带保护

- **WHEN** CPU 预算极为紧张
- **THEN** 防御模块仍被执行，不被跳过

### Requirement: 无威胁时零副作用

在没有有效威胁的房间，防御模块必须为纯 no-op：威胁分不升高、不产出防御任务、不产生塔行动、不修改与防御无关的状态。

#### Scenario: 和平房间无动作

- **WHEN** 房间无有效威胁源
- **THEN** 不产出任何防御任务，塔不执行防御行动

### Requirement: 威胁分级决定协作形态

防御响应必须按威胁分级（tier）决定形态：`peace` 无任务；`low` 由规划器直接建单条 `defend` 任务（塔 + 单防御单位）；`high` 由规划器**登记编队需求**，槽位数取既有编制配置 `STAFFING_CONFIG.tierDefenders.high`，交由集群建队。

#### Scenario: 低强度直接建单任务

- **WHEN** 房间威胁分级为 low
- **THEN** 规划器直接产出单条 `defend` 任务，不登记编队需求

#### Scenario: 高强度提编队需求

- **WHEN** 房间威胁分级升至 high
- **THEN** 规划器登记 `kind="defense"` 的编队需求，槽位数取自编制配置；不直接建单条任务

#### Scenario: 分级回落

- **WHEN** 威胁分级由 high 回落至 low
- **THEN** 编队需求停止续期，编队按 TTL 解散

### Requirement: 塔行动经共享 broker 提交

塔的攻击/维修行动必须经与 Agent 层共享的 ActionBroker 实例提交（单一原生动作调用点），保证同 actor + 同 pipeline 的仲裁一致（保留最高优先级），塔消耗被计入统计。

#### Scenario: 塔行动统一仲裁

- **WHEN** 塔同时被防御规划器与其它来源驱动
- **THEN** 只有优先级最高的一条行动被提交执行

#### Scenario: 消耗入账

- **WHEN** 塔在本 Tick 执行了行动
- **THEN** 其能量消耗被折叠进房间消耗统计
