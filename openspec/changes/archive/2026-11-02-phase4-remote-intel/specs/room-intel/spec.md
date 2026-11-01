# Spec Delta

## Purpose

多房 Intel：为外矿与侦察提供带新鲜度的房间事实。每个字段区分「未知 / 已知为空 / 已知但过期」，房间类型由房名推导，记录总量有界。

## ADDED Requirements

### Requirement: 三态读取
Intel 字段缺省表示未知，`null` 表示已知为空，有值但最近观测早于过期阈值表示过期。规划器必须通过统一的三态读取函数判断，不得以字段真假直接判断。

#### Scenario: 从未观测的房
- **WHEN** 规划器读取一个从未可见的候选房的 owner
- **THEN** 读取结果为「未知」，规划器派侦察而不是当作无主

#### Scenario: 已知无主
- **WHEN** 候选房最近一次观测时控制器无 owner 且在新鲜期内
- **THEN** 读取结果为「已知为空」，可以进入评估

#### Scenario: 过期
- **WHEN** 候选房最近一次观测早于 `INTEL_CONFIG.staleTicks`
- **THEN** 读取结果为「过期」，规划器按需重新侦察；已 active 的外矿不因过期本身暂停

### Requirement: 房间类型推导
房间类型（normal / highway / keeper / center）必须由房名坐标推导，不依赖视野；配置覆盖表优先于推导结果。

#### Scenario: 高速路
- **WHEN** 房名横坐标或纵坐标是 10 的倍数
- **THEN** 类型为 highway

#### Scenario: SK 房与中央房
- **WHEN** 房名两坐标对 10 取余都在 4..6
- **THEN** (5,5) 为 center，其余为 keeper

#### Scenario: 覆盖表
- **WHEN** 配置覆盖表声明某房的类型
- **THEN** 使用覆盖表的类型

### Requirement: 增量写入与单一写入方
Intel 只由感知模块写入；对可见房只在字段值变化时写入，未见期间不改写。置信度在读取端按最近观测时间现算。

#### Scenario: 未见期间
- **WHEN** 外矿房连续多个 tick 不可见
- **THEN** 其 Intel 记录在这些 tick 内不被写入，读取到的置信度随未见时间按半衰期下降

### Requirement: 有界清理
非己方、非外矿房的 Intel 超过遗忘阈值必须整条删除；记录总数超过上限时按最近观测最旧者淘汰，己方房与外矿房不参与淘汰。

#### Scenario: 超限淘汰
- **WHEN** Intel 记录数超过 `INTEL_CONFIG.maxRooms`
- **THEN** 删除最旧的非受保护记录直到不超限

### Requirement: 迁移
schema v10 → v11 迁移必须幂等：补齐房间类型；把旧外矿配置 `OutMineData[home].energy` 中的房迁为该殖民地外矿记录的钉选；`OutMineData` 的 `centerRoom`、`RoadData`、`highway` 原样保留；坏条目删除；其余新字段保持缺省。

#### Scenario: 重复迁移
- **WHEN** 对已是 v11 的数据再次执行迁移
- **THEN** 数据不变

#### Scenario: 旧外矿配置迁移
- **WHEN** 旧数据中 `OutMineData.W5N8.energy` 包含 `W5N9`
- **THEN** 迁移后 `remotes.W5N8.rooms.W5N9.manual` 为 `pin`，`OutMineData.W5N8.highway` 不变
