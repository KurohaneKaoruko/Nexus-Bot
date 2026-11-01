# Spec Delta

## Purpose

外矿安全：外矿房纳入威胁观测；威胁或连续死亡触发暂停与撤回，威胁衰减后迟滞恢复；他人占有、他人预定、invader core 与敌对结构直接剔除。

## ADDED Requirements

### Requirement: 外矿房威胁观测
威胁模型必须对可见的外矿房评分，写入该房 Intel 的威胁记录，并沿用现有的未见衰减规则。

#### Scenario: 外矿房出现敌人
- **WHEN** 外矿房可见且出现带攻击部件的敌方单位
- **THEN** 该房 Intel 出现威胁记录，分数按现有威胁模型计算

### Requirement: 暂停与撤回
外矿房威胁分达到暂停阈值，或死亡窗口内外矿单位死亡数达到阈值时，外矿必须转为 paused；该房外矿任务取消（原因 `remote-paused`），房内本殖民地单位撤回母房，载货单位先交付。

#### Scenario: 威胁暂停
- **WHEN** active 外矿房威胁分 ≥ `REMOTE_CONFIG.pauseThreat`
- **THEN** 外矿转为 paused，外矿任务取消，房内单位领取撤退任务

#### Scenario: 载货撤回
- **WHEN** 暂停发生时外矿搬运体满载
- **THEN** 搬运体回母房完成交付，不丢弃能量

#### Scenario: 连续死亡
- **WHEN** `REMOTE_CONFIG.deathWindow` 内该外矿房死亡的本殖民地单位数 ≥ `REMOTE_CONFIG.pauseDeaths`
- **THEN** 外矿转为 paused，原因写明死亡数

### Requirement: 迟滞恢复
暂停期满且威胁分低于恢复阈值（恢复阈值低于暂停阈值）时，外矿必须回到 evaluated 重新准入。

#### Scenario: 威胁未消退
- **WHEN** 暂停期满但威胁分仍高于恢复阈值
- **THEN** 外矿保持 paused

#### Scenario: 恢复
- **WHEN** 暂停期满且威胁分低于恢复阈值
- **THEN** 外矿回到 evaluated，按准入规则重新进入 active

### Requirement: 剔除条件
外矿房被观测到他人占有、他人预定、invader core 或敌对结构时，必须转为 rejected 并写明原因；剔除重试期满后回到候选。

#### Scenario: 他人预定
- **WHEN** 外矿房控制器被其他玩家预定
- **THEN** 外矿转为 rejected，原因包含预定者

#### Scenario: 重试
- **WHEN** rejected 状态经过 `REMOTE_CONFIG.rejectedRetryTicks`
- **THEN** 外矿回到 candidate，按 Intel 新鲜度决定是否重新侦察

### Requirement: 外矿威胁与全局隔离
外矿房的威胁记录必须标记为外矿范围，不计入全局最大威胁分；外矿受袭不得抬高家内 defender 编制、不得触发 war 姿态。外矿房失视期间威胁按现有衰减规则下降。

#### Scenario: 外矿房出现 invader
- **WHEN** 外矿房威胁分很高而所有己方房无威胁
- **THEN** 全局姿态不变，家内 defender 编制不变，外矿转为 paused

#### Scenario: 失视衰减
- **WHEN** 暂停后外矿房不再可见
- **THEN** 其威胁分按衰减规则逐 tick 下降，暂停期满后可据此判断是否恢复
