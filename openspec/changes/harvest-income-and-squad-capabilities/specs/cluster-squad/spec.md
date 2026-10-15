# Spec Delta

## MODIFIED Requirements

### Requirement: 编队只持有槽位，成员由任务反填
`SquadRecord` MUST 只保存槽位定义与派生成员名列表；槽位定义 MUST 以**槽位定义数组**表达，每项自带其任务种类与所需能力（原为编队级单一任务种类与单一能力集合，数量以标量表示），编队 MUST NOT 直接持有 Creep 对象或对其发号施令。成员通过槽位任务 `assignedTo` 反填，成员执行的是普通任务，Agent 层 MUST NOT 需要知道自身处于编队中。

#### Scenario: 成员透明

- **WHEN** 一个 Creep 被分配到编队槽位任务
- **THEN** 该 Creep 执行的是标准任务，其行为路径不因"在编队内"而改变

#### Scenario: 增删编队类型不改动分配器

- **WHEN** 新增一种 `SquadKind`
- **THEN** TaskBoard / Allocator / AgentSystem / ActionBroker 无需改动

#### Scenario: 槽位按定义数组分化

- **WHEN** 编队声明槽位定义数组且各项任务种类或能力不同
- **THEN** 生成的槽位任务逐项携带各自的任务种类与所需能力，而非全编队共用一套

#### Scenario: 期望成员数取数组长度

- **WHEN** 读取编队的期望成员数
- **THEN** 该值等于槽位定义数组长度，而非独立维护的数量标量