# Spec Delta

## ADDED Requirements

### Requirement: 自动运营稳态连续性

main 分支全功能模式（非 rush 档）的房间自动运营 MUST 在长周期内保持稳态经济
连续性，以下任一塌陷形态 MUST NOT 出现超过窗口阈值：

- 供能断档：孵化队列因能量认领缺失空转（spawn 空闲且队列非空）连续 > 200 tick；
- 人口塌陷：单位总数较前 1000 tick 峰值下降 > 40% 且 500 tick 内未回升；
- 外矿断档：active 外矿房连续 > 1000 tick 无采集/搬运在编（有需求且未暂停）；
- 升级饥饿：控制器进度连续 > 5000 tick 零增长（有能量余额且非 RCL 上限）。

#### Scenario: 长周期无塌陷

- **WHEN** 运行 boot/sprint 场景至 ≥20000 tick
- **THEN** 上述四类塌陷指标均不触发，且 RCL 时间线不劣于改动前基线

#### Scenario: 优化可归因

- **WHEN** 任一运营优化落地
- **THEN** 指标改善可归因（诊断项 → 改动 → 场景读数对照），不以全局调参掩盖单点问题
