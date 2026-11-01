# remote-defense 三期：外矿防御

delta: specs/remote-defense/spec.md

## ADDED Requirements

### Requirement: 威胁可清分类

threatModel 的 remote 作用域 SHALL 在威胁记录中区分威胁性质：
`npc`（owner=Invader 的单位，无核心）、`core`（invader core 结构，带
stronghold 层级）、`player`（其他玩家单位/结构）。分类 SHALL 随威胁记录
有界存储（复用一期 threat 单条记录结构，增 nature 字段）。

#### Scenario: NPC invader 分类

- **WHEN** 外矿房视野内出现 owner=Invader 的敌对单位且无 invader core
- **THEN** 该房 threat.nature = "npc"，score/confidence 语义与一期一致

#### Scenario: invader core 分级

- **WHEN** 外矿房出现 invader core 结构
- **THEN** threat.nature = "core" 且记录 stronghold 层级（结构 expansion 属性）

### Requirement: 清理编队请求

防御系统 SHALL 对「active 且因威胁暂停」的外矿房，当威胁 nature 为 npc/core
时经 `requestSquad(kind="remote")` 发起清理编队请求：
- npc：槽位 = 攻击件 ×（威胁 score 档位）；
- core：按 stronghold 层级配槽（低层单攻击件，高层攻击+治疗对）；
- 请求 TTL 内未成军或威胁源消失 → 撤销请求。
玩家骚扰（nature=player）SHALL NOT 发起编队（暂停 + 控制台观测口径）。

#### Scenario: NPC 清理成军

- **WHEN** active 外矿房 threat nature=npc 且 score 超暂停门槛
- **THEN** 出现 kind="remote" 编队，槽位任务 kind 为 defend，目标 = 外矿房
- **AND** 编队清理掉 invader 后（威胁观测归零）编队按 TTL 解散，外矿自动恢复

#### Scenario: 玩家骚扰不开编队

- **WHEN** 威胁源为玩家单位
- **THEN** 无 remote 编队请求，房间维持 paused，控制台 `Nexus.remote.threats()`
  可见 nature=player 记录

### Requirement: 清理失败止损

清理编队成军后在 `REMOTE_CONFIG.defense.engagementTimeout` 内未清掉威胁
（单位全灭或超时）SHALL 撤销编队请求并维持外矿暂停，且该房在
`retryCooldown` 内不再发起清理（防止无收益循环孵化）。

#### Scenario: 清理超时止损

- **WHEN** 编队与 invader 交战超 engagementTimeout 威胁仍在
- **THEN** 编队解散、请求撤销、房间保持 paused 且进入 retryCooldown
