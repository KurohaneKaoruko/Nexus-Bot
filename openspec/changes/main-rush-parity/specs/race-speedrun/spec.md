# Spec Delta

## ADDED Requirements

### Requirement: main rush 模式冲级逼近 race 变体

main 分支在 9 房冲级对照场（上游真实地形、主房双源 + 8 邻房、RCL1 零结构、
`roomMode=rush` 固定档、main bundle）的分段读数 MUST 逐步逼近 race 变体
speedrun 场（L2@866 / L3@3364 / L4@6004 / L5@12489 / L6@32545）：

- 硬门（对齐既有 10k/20k/40k 要求）：RCL4 ≤ 10000、RCL5 ≤ 20000、RCL6 ≤ 40000；
- 逼近线（parity ceiling）：每段达成 tick ≤ race 对应段 × 1.20；
- 逼近目标（stretch）：每段达成 tick ≤ race 对应段 × 1.10。

约束：布局风格（`Nexus.layout` 生成口径）与 creep 命名风格 MUST NOT 改变；
main 完整功能 MUST NOT 以裁剪模块/挂载点的方式换取速度。

#### Scenario: 对照场分段读数

- **WHEN** 运行 main rush 对照场至 RCL6（≥40000 tick）
- **THEN** 输出分段达成 tick，并按硬门/逼近线/目标三档判定

#### Scenario: 约束不破

- **WHEN** 冲级机制改动落地
- **THEN** 布局记录生成口径与 creep 命名规则无差异（对照基线快照），main 全场景门 12/12 绿

## MODIFIED Requirements

（无）

## REMOVED Requirements

（无）
