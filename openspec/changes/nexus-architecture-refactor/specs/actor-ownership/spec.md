# Spec Delta

## Purpose

Actor 所有权机制：确保任意 Tick 内每个被控 Actor（Creep/PowerCreep/结构）只有一个控制方，冲突可拦截、死亡自动释放，为统一仲裁提供前提。

## ADDED Requirements

### Requirement: 一个 Actor 一个 owner
每个 Actor 在任一 Tick MUST 至多被一个 owner 持有；后续 owner 对已持有 Actor 的控制请求 MUST 被拒绝并记录冲突（双方 owner、Actor、Tick）。

#### Scenario: 冲突控制被拒绝
- **WHEN** owner A 已持有某 Creep，owner B 同 Tick 尝试获取该 Creep 的控制权
- **THEN** owner B 的获取请求失败，记录一条冲突日志，owner A 的控制权不变

#### Scenario: 拒绝可观测
- **WHEN** 同一 Actor 的控制冲突在一个时间窗口内反复发生
- **THEN** 冲突计数进入遥测，可按 owner 与 Actor 查询聚合

### Requirement: 所有权分阶段收紧
所有权机制 MUST 支持三种递进模式且可配置切换：仅记录（不拦截）、告警（记录并限频告警）、拦截（低优先级 owner 被阻止）。模式切换 MUST NOT 要求代码变更，仅配置变更。

#### Scenario: 模式仅记录不改变行为
- **WHEN** 机制处于"仅记录"模式且发生控制冲突
- **THEN** 双方行为与机制启用前一致，仅多出记录数据

#### Scenario: 拦截模式阻止低优先级方
- **WHEN** 机制处于"拦截"模式且高优先级 owner 已持有 Actor
- **THEN** 低优先级 owner 的命令对该 Actor 不生效

### Requirement: 死亡与孵化边界自动释放
Actor 死亡（对象从游戏中消失）时所有权 MUST 在同 Tick 或下一 Tick 自动释放；孵化中（对象尚不在世界中）的 Actor MUST NOT 被判为孤儿清理或被夺取所有权。

#### Scenario: 死亡即释放
- **WHEN** 持有所有权的 Creep 死亡
- **THEN** 该所有权记录被清除，Actor 可被新 owner 获取

#### Scenario: 孵化中不被清理
- **WHEN** 某孵化单正在生产且其 Memory 记录存在
- **THEN** 该记录不被孤儿清理逻辑删除，也不触发"角色丢失"类恢复行为

### Requirement: 所有权租约与续期
所有权以租约形式持有：owner MUST 在租期内续期否则自动失效；租约数据 MUST 可序列化并受 schema 版本管理。

#### Scenario: 过期未续期自动失效
- **WHEN** owner 超过租期未续期
- **THEN** 所有权自动释放，可被其他 owner 获取

#### Scenario: 内存兼容
- **WHEN** 引入本机制时线上存在旧版 Memory
- **THEN** 旧 Memory 不产生未迁移字段错误，机制从空状态引导
