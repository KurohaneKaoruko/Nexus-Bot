# Spec Delta

## Purpose

每 Tick 观测可见房间并维护世界模型，为任务生成、分配与生产提供唯一事实源；不可见的内容不得伪装成实时事实。

## ADDED Requirements

### Requirement: 每 Tick 观测摘要
系统必须在感知阶段把可见房间的关键对象聚合为当 Tick 快照（Source、Spawn/Extension 及其能量、Container 与落地资源、工地、本方 Creep 存活与负载），下游模块一律读取该快照，不得各自重复扫描房间。

#### Scenario: 快照覆盖关键对象
- **WHEN** 某房间本 Tick 可见
- **THEN** 快照包含该房间的 Source 列表、能量结构及其库存、工地列表与本方 Creep 存活摘要

#### Scenario: 无视野不伪造
- **WHEN** 某房间本 Tick 不可见
- **THEN** 不产生该房间的当 Tick 观测，涉及该房间的决策只能依据带新鲜度标注的 Intel

### Requirement: Intel 持久化与新鲜度
系统必须把观测增量写入持久的房间 Intel（最近观测 Tick、置信度、Source ID 等）；房间不可见时保留旧值并随时间降低置信度，不得把过期 Intel 当作当前事实使用。

#### Scenario: 可见时更新
- **WHEN** 房间被观测
- **THEN** 该房间 Intel 的最近观测 Tick 更新为当前 Tick，Source ID 等事实随之刷新

#### Scenario: 不可见时降置信
- **WHEN** 房间连续多个 Tick 未被观测
- **THEN** 其 Intel 置信度按规则降低，但既有记录保留且可查询

### Requirement: 死亡与目标失效发现
系统必须在本 Tick 观测中发现本方 Creep 消失与既知目标失效，并把这两类事件作为信号交给任务回收与生产替补流程；不得等到租约自然超时才发现死亡。

#### Scenario: Creep 死亡被发现
- **WHEN** 上一 Tick 存在的本方 Creep 本 Tick 不在观测中
- **THEN** 产生该单位死亡信号，其持有的任务进入回收流程

#### Scenario: 目标失效被发现
- **WHEN** 任务引用的目标 ID 无法解析到当前对象
- **THEN** 该目标被标记失效，引用它的任务进入回收流程
