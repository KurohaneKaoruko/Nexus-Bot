# Spec Delta

## Purpose

智能连结集群（编队层）：需求方（职能系统）以单 Tick 运行时队列声明协作需求，集群机制负责编队的建队、续期、维持与解散。编队不持有单位，只持有槽位；成员由槽位任务的 `assignedTo` 反填。集群复用 TaskBoard / Allocator / AgentSystem / ActionBroker 的全部既有不变量，不引入第二套分配器，也不直接调用游戏 API。

## ADDED Requirements

### Requirement: 需求经单 Tick 运行时队列声明

需求方必须以 `SquadRequest` 声明协作需求，经 `global` 运行时层的单 Tick 队列传递，由集群模块在 planning 阶段消费并清空；不得引入独立事件总线。同一 Tick 内相同 `kind + room` 的需求必须合并（取最高优先级、最大槽位数、最迟 TTL），队列长度必须有上限。

#### Scenario: 合并同类需求

- **WHEN** 同一 Tick 内两个需求方对同一 `kind + room` 各提交一次需求
- **THEN** 队列中只保留一条合并后的需求，优先级取大、槽位数取大、TTL 取最迟

#### Scenario: 消费即清空

- **WHEN** 集群模块在 planning 阶段读取需求队列
- **THEN** 队列被消费并清空，下一 Tick 不得重复看到上一 Tick 的需求

#### Scenario: 队列有界

- **WHEN** 未消费的需求持续累积超过配置上限
- **THEN** 队列被截断至上限，不无界增长

### Requirement: 编队只持有槽位，成员由任务反填

`SquadRecord` 只保存槽位定义（数量/优先级）与派生成员名列表；编队不得直接持有 Creep 对象或对其发号施令。成员通过槽位任务 `assignedTo` 反填，成员执行的是普通任务，Agent 层无需知道自身处于编队中。

#### Scenario: 成员透明

- **WHEN** 一个 Creep 被分配到编队槽位任务
- **THEN** 该 Creep 执行的是标准任务，其行为路径不因"在编队内"而改变

#### Scenario: 增删编队类型不改动分配器

- **WHEN** 新增一种 `SquadKind`
- **THEN** TaskBoard / Allocator / AgentSystem / ActionBroker 无需改动

### Requirement: 编队生命周期管理

集群必须维护编队的建队、续期与解散：需求首次出现时建队，持续出现时续期（不得重复建队），超过 TTL 未续期时解散。编队数量与单编队槽位数必须受配置上限约束。

#### Scenario: 建队

- **WHEN** 收到某 `kind + room` 的协作需求且未达编队数上限
- **THEN** 创建对应编队并生成其槽位任务

#### Scenario: 续期不重复建队

- **WHEN** 同一需求在后续 Tick 持续出现
- **THEN** 编队被续期（`expiresAt` 后移），不产生第二个同 id 编队

#### Scenario: 过期解散

- **WHEN** 编队超过 TTL 未收到续期需求
- **THEN** 编队被解散并从 `Memory.squads` 移除

#### Scenario: 容量上限

- **WHEN** 已达编队数上限或单编队槽位上限
- **THEN** 超出的需求被裁剪，不突破上限

### Requirement: 解散取消槽位任务而非释放回池

编队解散或槽位收缩时，其槽位任务必须被**取消**，不得释放回任务池。需求消失后这些任务无意义，回池会产生"幽灵防御任务"被经济单位误领。

#### Scenario: 解散取消任务

- **WHEN** 编队因 TTL 过期被解散
- **THEN** 其全部槽位任务被取消，不留孤儿任务占住租约

#### Scenario: 收缩清理多余槽位

- **WHEN** 续期需求的槽位数少于当前编队槽位数
- **THEN** 多余的槽位任务被取消，编队收缩到目标槽位数

### Requirement: 命名空间隔离

集群只清理与自身命名空间（`squad:<id>:slot:` 前缀）相关的任务；防御规划器只清理 `defend:<room>` / `retreat:<room>` 前缀任务。两者都写 `defend` 类型任务，必须互不取消。

#### Scenario: 不越权取消

- **WHEN** 同一房间同时存在编队槽位任务与规划器直建的 `defend:<room>` 任务，且编队解散
- **THEN** 只有编队命名空间内的任务被取消，规划器的任务不受影响

### Requirement: 槽位任务优先级下限抬升

槽位任务的优先级必须不低于配置下限（`CLUSTER_CONFIG.priorityFloor`）与需求方优先级中的较大者。编队任务是防御承诺，不得被经济繁荣期的采集/搬运任务挤出。

#### Scenario: 优先级取大

- **WHEN** 需求方优先级低于配置下限
- **THEN** 生成的槽位任务优先级取下限值

#### Scenario: 高优先级需求不被压低

- **WHEN** 需求方优先级高于配置下限
- **THEN** 生成的槽位任务优先级取需求方优先级

### Requirement: 集群零游戏 API 调用

集群模块不得直接调用游戏 API（`Creep.moveTo`、`Structure.attack` 等）。所有意图必须经共享 ActionBroker 统一提交。

#### Scenario: 意图统一提交

- **WHEN** 集群维护槽位任务
- **THEN** 只操作 TaskBoard，不产生任何直接游戏动作；动作由 Agent 层经 ActionBroker 提交
