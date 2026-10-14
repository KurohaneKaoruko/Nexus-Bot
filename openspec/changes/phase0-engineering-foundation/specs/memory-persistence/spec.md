# Spec Delta

## Purpose

为 Nexus-Bot 提供版本化、可迁移、可恢复的 Memory 持久层，保证代码升级与回滚时存量 Memory 始终可用。

## ADDED Requirements

### Requirement: Memory 初始化与幂等
系统必须在 `Memory.nexus` 缺失时初始化当前 schema 的最小有效结构并写入 `schemaVersion`；初始化必须幂等、可重复执行。

#### Scenario: 首次初始化
- **WHEN** Memory 中不存在 nexus 数据
- **THEN** 引导流程创建包含当前 schemaVersion 的最小有效结构

#### Scenario: 重复执行幂等
- **WHEN** 引导流程在已初始化的 Memory 上再次执行
- **THEN** 不重复迁移、不重置既有数据、不改变 schemaVersion

### Requirement: 逐版本迁移
系统必须在检测到 schemaVersion 低于当前版本时按相邻版本逐级迁移（每级一个纯函数），完成后写入当前版本，后续 Tick 不再迁移；不得把任意旧对象直接当作新类型使用。

#### Scenario: 旧版本升级
- **WHEN** 存量 Memory 的 schemaVersion 低于当前版本
- **THEN** 按相邻版本逐级迁移到当前版本，完成后 schemaVersion 为当前值

#### Scenario: 迁移可重复
- **WHEN** 同一旧版本样例 Memory 多次执行迁移
- **THEN** 每次均得到一致的当前版本结构

### Requirement: 迁移失败安全降级
系统必须在某级迁移失败或数据损坏时隔离受影响数据、限频记录告警，并以当前 schema 的安全空状态继续运行；不得使主循环崩溃或陷入无限重复迁移。

#### Scenario: 损坏数据隔离
- **WHEN** 存量 Memory 中某子系统数据损坏导致该级迁移失败
- **THEN** 仅该子系统被重置为安全空状态，其余子系统数据保留，主循环正常继续

#### Scenario: 整体损坏重建
- **WHEN** 存量 Memory 损坏到无法识别 schemaVersion
- **THEN** 限频告警后以当前 schema 重建最小有效结构，主循环正常继续

### Requirement: 仅持久化 JSON 兼容数据
系统必须只把 ID 与 JSON 兼容数据写入 Memory，不得保存游戏 API 对象引用或闭包；跨 Tick 需要的目标以 ID 加观测元数据表示。

#### Scenario: 不落 API 引用
- **WHEN** 模块需要跨 Tick 记住某个游戏目标
- **THEN** Memory 中只保存该目标的 ID 与观测时间等元数据
