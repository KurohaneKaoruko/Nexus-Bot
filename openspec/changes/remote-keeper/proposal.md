# Proposal: remote-keeper（外矿四期·SK/中央房/元素矿）

## Why

外矿一至三期覆盖 normal 房能源闭环、路网、NPC 防御。四期是最后一块：
**SK 房 / 中央九房的高强度采集**与**外矿元素矿**。旧链
`externalMine.ts:2483-2560`（runCenter：keeper 覆盖检查、危险敌对双防、
高配采集、元素矿）已删除。契约 `docs/nexus-design/13` §24.2 四期要求：
remote 扩展 keeper 房类型 + 编队护航。

## What Changes

- **keeper 房准入**：stateMachine 候选评估扩展 keeper 房类型——roomKind=keeper
  房经 pin 显式准入（auto 档不自动进），评估含 keeper 威胁成本与 SK 源
  高产出（3000/1500 容量 ×3 源）；
- **keeper 覆盖编队**：active keeper 房常驻 `remote` 编队（kind="remote"
  复用三期，taskKind="keeperHold"）压制 SK lair 刷新——旧链 hasKeeperAttackCoverage
  同语义：无覆盖时不派采集（采集者会被 SK 秒杀）；
- **中央九房**：roomKind=center 房同 keeper 口径（SK 密度更高），四期一并支持；
- **外矿元素矿**：active 外矿房（含 keeper）矿物 > 阈值时登记 `remote:mineral:`
  采集任务（过道矿合约语义复用 economy/mineralWork 的 resourceType 口径）；
- **采集撤离节律**：SK 房采集者按 SK lair 刷新周期回避（lair 冷却窗口内
  远离，采集窗口内作业），旧链无此细节、由 Intel lair 记录支撑；
- **config**：`REMOTE_CONFIG.keeper`（准入阈值 / 覆盖编队配槽 / 回避窗口 /
  矿物采集阈值）。

## Impact

- 代码：`src/modules/economy/remote/`（stateMachine/planner/counts/estimate 扩展）、
  `src/modules/defense/planners.ts`（keeperHold 常驻请求）、
  `src/config/remote.ts`、`src/modules/world/`（lair 观察）
- spec：`openspec/specs/` 增 remote-keeper 能力增量
- 验证：sim 新场景 remote-keeper（SK 房 pin → 覆盖编队 → 采集节律 → 元素矿），
  全场景门其余场景逐位一致
