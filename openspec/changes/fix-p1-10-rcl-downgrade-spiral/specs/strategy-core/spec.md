# Spec Delta

## ADDED Requirements

### Requirement: 失守事件触发的紧急重估
房间失守事件必须触发战略姿态立即重估，不等待重估周期；重估时世界模型无任何己方可见房间，姿态必须立即为 survive，不受最小驻留时长限制。

#### Scenario: 失守立即重估
- **WHEN** 感知产出房间失守事件
- **THEN** 当 Tick 触发姿态紧急重估，不受周期门控

#### Scenario: 失明落入 survive
- **WHEN** 姿态重估时世界模型无任何己方可见房间
- **THEN** 姿态立即为 survive 并记录失守相关原因，不受最小驻留时长限制
