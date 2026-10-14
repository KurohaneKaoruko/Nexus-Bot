# Spec Delta

## Purpose

维持房间控制权的生存闭环：按 Controller 降级剩余时间分级风险，紧急态把升级任务提权至可抢占并豁免孵化暂停以保住升级岗位，失守后抑制 bootstrap 空转，杜绝 RCL 降级螺旋。

## ADDED Requirements

### Requirement: 降级风险分级
系统必须基于 Controller 降级剩余时间把每个己方房间分为「紧急」与「正常」两档风险，判定阈值必须可配置且不得硬编码；降级计时不存在（满级或刚被升级动作重置满额）时视为正常，紧急态在计时被升级重置后立即解除。

#### Scenario: 跌破阈值进入紧急
- **WHEN** 某己方房间 Controller 的降级剩余时间低于紧急阈值
- **THEN** 该房间被标记为降级紧急，状态可被任务规划与孵化决策查询

#### Scenario: 升级重置后解除
- **WHEN** 紧急房间产生升级进度，降级计时被重置为满额或不再暴露
- **THEN** 该房间退出紧急态，恢复常规优先级与姿态规则

#### Scenario: 无计时视为正常
- **WHEN** Controller 未暴露降级剩余时间（满级）
- **THEN** 该房间不进入紧急态

### Requirement: 升级任务紧急提权
处于降级紧急的房间，其 upgrade 任务优先级必须提升到任务抢占线之上，使持有更低优先级任务的单位可立即切换为执行升级；提权期间必须豁免 survive 姿态对该任务的降权与节流；风险退出后优先级必须回落至常规档，姿态规则恢复生效。

#### Scenario: 抢占低优先级持有者
- **WHEN** 房间进入降级紧急且空闲或低优先级单位可用
- **THEN** upgrade 任务可抢占这些单位，其原任务按既有规则释放

#### Scenario: survive 不压制紧急升级
- **WHEN** 房间处于降级紧急且姿态为 survive
- **THEN** upgrade 任务不被降权、不被节流存活，升级意图持续产生

#### Scenario: 风险解除回落
- **WHEN** 房间降级计时被升级动作重置，退出降级紧急
- **THEN** upgrade 任务优先级回落至常规档，姿态偏置与节流规则恢复生效

### Requirement: 孵化豁免保升级岗位
降级紧急期间，upgrader 的常驻编制补位必须豁免 survive 姿态的生产暂停名单；非紧急时暂停名单照常生效。

#### Scenario: 紧急时 survive 不停 upgrader
- **WHEN** 房间处于降级紧急、姿态为 survive 且 upgrader 编制有缺口
- **THEN** 仍按常驻补位逻辑请求孵化 upgrader

#### Scenario: 非紧急时暂停名单照常
- **WHEN** 房间非降级紧急、姿态为 survive
- **THEN** upgrader 按既有暂停名单不请求孵化

### Requirement: 失守后 bootstrap 空转治理
世界模型无己方可见房期间，bootstrap 孵化连续次数超过可配置上限仍未恢复任何可见房时，系统必须降低 bootstrap 孵化节奏并在诊断中记录告警；房间恢复可见后孵化节奏立即复原。

#### Scenario: 连续空转降频告警
- **WHEN** 无己方可见房且 bootstrap 孵化连续次数超过上限
- **THEN** 后续 bootstrap 孵化间隔拉长，且诊断记录中存在告警条目

#### Scenario: 恢复可见后复原
- **WHEN** 任一己方房间恢复可见
- **THEN** bootstrap 孵化节奏与告警状态立即复位，计数清零
