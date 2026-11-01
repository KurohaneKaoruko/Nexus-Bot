# remote-keeper 四期：SK/中央房/元素矿

delta: specs/remote-keeper/spec.md

## ADDED Requirements

### Requirement: keeper 房准入

外矿状态机 SHALL 支持 keeper/center 房类型准入：仅经 pin 显式指定
（auto 档候选生成 SHALL NOT 自动纳入 keeper/center）；评估口径 SHALL
计入 SK 源高产（容量/再生 ×3 源）与 keeper 常驻编队成本（三期编队孵化
摊销进 net 估算）。

#### Scenario: pin keeper 房评估

- **WHEN** 用户 `Nexus.remote.pin("W4N4")`（keeper 房）且母房 RCL 达门槛
- **THEN** 该房进入 scouting → evaluated，估算含 3 源产出与编队成本，
  net 达门槛才 active

### Requirement: keeper 覆盖编队常驻

active 的 keeper/center 房 SHALL 常驻 `kind="remote"` 覆盖编队
（taskKind="keeperHold"）：压制 SK lair 刷新点；SHALL NOT 在无覆盖时向
该房派采集任务（采集任务登记以覆盖在位为前置）。

#### Scenario: 覆盖缺失停派采集

- **WHEN** active keeper 房覆盖编队解散/未成军
- **THEN** 该房 remote:harvest 任务撤单，采集者不派；覆盖恢复后任务重建

### Requirement: 采集撤离节律

keeper 房采集任务 SHALL 按 Intel 记录的 SK lair 刷新节律回避：lair 冷却
结束窗口前 `avoidWindow` tick 采集单位撤离至安全半径；Intel SHALL 记录
lair 位置与最近刷新 tick（视野内观察，有界）。

#### Scenario: 刷新窗口撤离

- **WHEN** keeper 房某 lair 距上次刷新 ≥ 刷新周期 - avoidWindow
- **THEN** 附近采集任务的目标权重下调/回避标记，采集单位撤出 lair 半径

### Requirement: 外矿元素矿

active 外矿房（含 keeper/normal）SHALL 在矿物存量 ≥ 阈值且 extractor
可建/已建时登记 `remote:mineral:{room}:{mineral}` 采集任务（resourceType
口径与 economy/mineralWork 过道矿合约一致）；矿物采空或低于阈值任务撤单。

#### Scenario: 元素矿登记

- **WHEN** active 外矿房 mineral.amount ≥ 阈值
- **THEN** 任务板出现 remote:mineral 任务，奖励口径按矿物密度档
