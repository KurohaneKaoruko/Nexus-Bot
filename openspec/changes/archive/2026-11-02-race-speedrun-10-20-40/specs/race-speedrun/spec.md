# Spec Delta

## Purpose

冲级性能能力：在 9 个空旷双矿房间的模拟环境（主房 W5N8 + 8 邻房，平地，RCL1 零结构开局，与私服 speedrun 榜口径一致）中，Nexus 必须在 10000 tick 内达到 RCL4、20000 tick 内达到 RCL5、40000 tick 内达到 RCL6。支撑该目标的四条机制线（替补错峰、填充动力学、开局序列、外矿激活）的需求在此固化。

## ADDED Requirements

### Requirement: speedrun 三档达标
speedrun 模拟场景的断言 MUST 为 RCL4 达成 ≤10000 tick、RCL5 达成 ≤20000 tick、RCL6 达成 ≤40000 tick（从落地 tick 0 起算），并保留 noErrors 与 cpuP95 护栏；旧的五档断言（500/3k/5k/15k/30k）MUST 废止。

#### Scenario: 三档全绿
- **WHEN** 在 speedrun 场景（seed 7，主房双源+8 邻房双源平地，RCL1 零结构）运行 40000+ tick
- **THEN** rclReachedBy 断言 RCL4≤10000、RCL5≤20000、RCL6≤40000 全部通过，且 noErrors 与 cpuP95Below 护栏通过

#### Scenario: 回归护栏不动
- **WHEN** 本能力的实现改动落地后运行全部 sim 场景
- **THEN** boot 场景 RCL2 达成时间与既有基线的漂移 ≤10%，sprint 场景 RCL4≤40000 与 remote-mine 场景断言不因本能力改动而变红

### Requirement: 替补错峰根治同龄批死亡潮
替补触发时点 MUST 按单位确定性哈希离散化，使同龄批次单位的替补申请分布在完整孵化周期窗口内；sim 实测中由同龄批到期引发的种群塌陷（人口峰谷差 >30%）MUST NOT 出现。

#### Scenario: 同龄批到期不塌陷
- **WHEN** 一批同 tick 出生的单位同时接近寿命终点
- **THEN** 它们的替补申请按哈希离散在时间窗内陆续触发，人口曲线平滑下降回升，无"整批死亡→空窗→整批补齐"的 V 型谷

#### Scenario: 离散确定性
- **WHEN** 同一单位名在多次运行中计算替补触发点
- **THEN** 结果恒定（名称哈希，不引入随机源），sim 场景可复现

### Requirement: 孵化填充动力学达标
孵化槽的能量填充链 MUST 消除认领延迟：从孵化槽空闲到 spawn 蓄能开始的间隔目标 ≤孵化节律 120 tick/只（sim 实测口径）；fill_spawn 类任务的发布 Tick 内 MUST 完成能量认领锁定。

#### Scenario: 孵化节律达标
- **WHEN** speedrun 冲级期（RCL2–RCL5）统计孵化节律（相邻两只 creep 出生的平均间隔）
- **THEN** 平均节律 ≤120 tick/只，无因能量未锁定导致的空转等待

### Requirement: 开局孵化序列冲级优先
rush 房间模式的开局孵化序列 MUST 为采集面优先（首只采集体先于首只搬运体孵化），升级任务 MUST 在首只采集体产出后立即发射；非 rush 模式的既有序列保持不变。

#### Scenario: L2 达成提速
- **WHEN** speedrun 场景从零开局运行至 RCL2
- **THEN** L2 达成时间较当前基线（~1100 tick）明显缩短，升级任务发射不晚于首只采集体首次满载

### Requirement: 外矿激活动态取舍
外矿目标房激活 MUST 采用价值/成本动态取舍（背包或等价评分机制），替代固定上限；rush 模式下外矿预算 MUST 保底（不因本地能量紧张清零），能量目标房上限放开。

#### Scenario: 收入驱动扩容
- **WHEN** 冲级期本地采集面饱和且孵化预算有余量
- **THEN** 外矿激活数量随预算动态扩展（不锁定在固定 2 房），收入曲线相应上升

#### Scenario: 短缺期不断档
- **WHEN** 本地能量进入紧张状态
- **THEN** rush 模式下外矿预算保有下限，已激活外矿的采集链不骤降断档
