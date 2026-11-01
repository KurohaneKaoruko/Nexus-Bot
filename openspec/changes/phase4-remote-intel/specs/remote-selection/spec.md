# Spec Delta

## Purpose

外矿选点：每个殖民地维护自己的外矿集合，按由游戏常量与路程推导出的净收入和 spawn 时间占用决定准入与剔除；状态转移带原因与最小驻留，防止抖动。

## ADDED Requirements

### Requirement: 候选范围
候选房必须是母房在 `REMOTE_CONFIG.maxRouteLength` 房以内经出口相连的房，且房间类型为 normal。

#### Scenario: 排除高速路与 SK 房
- **WHEN** 母房一个出口通向 highway 或 keeper 类型的房
- **THEN** 该房不进入候选

### Requirement: 状态机
外矿房状态必须按 candidate → scouting → evaluated → active / rejected，active → paused → evaluated，active → rejected，rejected → candidate 转移。每次转移记录引用量化输入的原因；除威胁触发的暂停外，转移必须满足最小驻留时间。

#### Scenario: 首次准入
- **WHEN** 候选房 Intel 未知
- **THEN** 依次经历 scouting、evaluated，评估通过后进入 active，每步写原因

#### Scenario: 驻留拦截
- **WHEN** 外矿刚进入 evaluated，评估结果在驻留期内翻转
- **THEN** 状态不转移，直到驻留期满

#### Scenario: 威胁暂停不受驻留约束
- **WHEN** active 外矿房威胁分在驻留期内超过暂停阈值
- **THEN** 立即转为 paused

### Requirement: 推导口径的净收益
每源净收入必须等于有效采集速率减去单位成本摊销、容器维护和路途损耗；源产能、体型成本、寿命、容器衰减均取运行环境常量。预定只在母房能量容量足以孵化 2 CLAIM 体型时计入。

#### Scenario: 预定提升产能
- **WHEN** 母房能量容量足以孵化 2 CLAIM 体型
- **THEN** 源产能按预定口径（10/t）计算，并计入预定体成本

#### Scenario: 无法预定
- **WHEN** 母房能量容量不足以孵化 2 CLAIM 体型
- **THEN** 源产能按中立口径（5/t）计算，不生成预定任务

#### Scenario: 路程过长
- **WHEN** 路程增长使净收入 ≤ 0
- **THEN** 该房评估为 rejected，原因写明净收入

### Requirement: spawn 占用上限
殖民地全部 active 外矿的 spawn 时间占用合计不得超过 `spawnShareCap × spawn 数`；多个候选按「净收入 ÷ spawn 占用」降序准入。

#### Scenario: 占满
- **WHEN** 准入下一个候选会使占用超过上限
- **THEN** 该候选保持 evaluated，不进入 active

### Requirement: 外矿唯一归属
同一外矿房不得同时被两个殖民地置为 active。

#### Scenario: 两殖民地竞争
- **WHEN** 一个房已是殖民地 A 的 active 外矿
- **THEN** 殖民地 B 的评估跳过该房

### Requirement: 实测亏损剔除
active 外矿（钉选除外）的实测净收入 EMA 持续低于 0 达 `REMOTE_CONFIG.lossWindow` 时必须转为 rejected，原因为 `measured-loss`。

#### Scenario: 持续亏损
- **WHEN** 实测净收入 EMA 连续一个亏损窗口为负
- **THEN** 外矿转为 rejected，相关外矿任务取消

### Requirement: 开闸条件
殖民地只有在房间档位开启外矿、母房已有 storage、且战略姿态不是 survive 时才规划新外矿；survive 姿态下已 active 的外矿保持。

#### Scenario: 无 storage
- **WHEN** 母房尚未建成 storage
- **THEN** 不生成任何外矿候选与外矿任务

#### Scenario: rush 档
- **WHEN** 母房档位为 rush（`remoteMining = false`）
- **THEN** 不规划外矿

### Requirement: 手动钉选与禁用
外矿记录可被手动标记为钉选或禁用。钉选的房跳过净收益门槛与实测亏损剔除，但仍受安全规则约束；禁用的房永不准入，也不随重试回到候选。

#### Scenario: 钉选亏损房
- **WHEN** 钉选的外矿房实测净收入持续为负
- **THEN** 外矿保持 active，只记告警

#### Scenario: 钉选房受袭
- **WHEN** 钉选的外矿房威胁分超过暂停阈值
- **THEN** 外矿照常转为 paused

#### Scenario: 禁用
- **WHEN** 外矿房被标记为禁用
- **THEN** 该房保持 rejected，重试期满也不回到候选
