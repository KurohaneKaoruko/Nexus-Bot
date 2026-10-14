# Spec Delta

## ADDED Requirements

### Requirement: Controller 降级字段采集
感知快照的 Controller 摘要必须包含控制等级、升级进度与降级剩余时间（字段存在时），供下游降级风险分级与观测使用；字段不存在时不得伪造值。

#### Scenario: 采集降级计时
- **WHEN** 己方房间的 Controller 暴露降级剩余时间
- **THEN** 该房间快照的 Controller 摘要包含降级剩余时间、当前等级与升级进度

#### Scenario: 不伪造缺失字段
- **WHEN** Controller 未暴露降级剩余时间（如等级满级）
- **THEN** 摘要中不出现伪造的降级计时值

### Requirement: 房间失守事件
上一 Tick 仍属于己方、本 Tick Controller 归属变为非己方的房间，系统必须产生显式失守事件：该房间 Intel 记录失守时间，事件在当 Tick 可供策略与观测查询；既有 Intel 不得因失守被清除。

#### Scenario: 失守被记录
- **WHEN** 某房间上一 Tick 快照存在且本 Tick 其 Controller 不再属于己方
- **THEN** 该房间 Intel 写入失守时间，且当 Tick 产生可查询的失守事件

#### Scenario: 旧 Intel 保留
- **WHEN** 房间失守后长期不可见
- **THEN** 其 Intel 记录保留不清除，置信度按既有规则随时间衰减

#### Scenario: 无上一快照不误报
- **WHEN** 系统 Tick 启动首帧或全局重置后首 Tick 遇到非己方房间（无上一 Tick 己方快照）
- **THEN** 不产生失守事件
