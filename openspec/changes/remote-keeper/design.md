# Design: remote-keeper

## 上下文

roomKind 已有 keeper/center 推导（`utils/roomName`，坐标 %10 ∈ 4..6）。
一期 stateMachine/estimate/planner 与三期 remote 编队（remote-defense）是
本期的两块地基。旧链 runCenter 的关键语义：覆盖检查（无 hasKeeperAttackCoverage
不派采集）、高配采集（upbody）、危险敌对双防（SK 之外的玩家敌对停手）、
元素矿（out-mineral）。

## 决策

### D1: keeper 准入 = pin-only + 评估扩展

- candidatesOf 生成时排除 keeper/center（auto 档），pin 路径放行；
- estimate 扩展：keeper 房产出 = 3 源 × SK 容量口径（容量 3000/再生 100
  的采集窗口模型），成本加 keeperHold 编队孵化摊销（slots 部件 × spawn
  时间 / TTL，与一期 s 口径同形）；
- RCL 门槛：keeper 准入要求母房 RCL ≥ keeperMinRcl（编队需要高配攻击件）。

### D2: 覆盖编队——复用三期请求协议

defense/planners 对 active keeper/center 房发常驻 requestSquad(kind="remote",
taskKind="defend", slots=keeper 配槽表——复用 defend 槽位任务链, 不新增
TaskKind)。与三期清理编队的差别：
- 常驻（threats 无关，TTL 续期由请求方每节拍刷新）；
- 槽位表按房内 lair 数（Intel 记录）配：lair ≤3 两攻击件+一治疗；>3 三攻+二治。
采集前置 = 编队 slots 全在位（cluster benefit/成员回填可查），否则撤单。

### D3: 撤离节律——Intel lair 观察驱动

perception 观察外矿房时记 lair：`rooms[x].lairs = [{ id, x, y, nextSpawnAt }]`
（有界数组；实现口径 nextSpawnAt = tick + ticksToSpawn, 引擎 lair 暴露
StructureKeeperLair.ticksToSpawn）。
危险窗口 = nextSpawnAt - now ≤ avoidWindow（刷新前撤离）；
执行层 submitSkLairAvoid 读同一 Intel 回避（avoidRadius 半径内高优 move）。

### D4: 元素矿——过道矿合约口径

economy/mineralWork 已有 resourceType harvest 语义（counts.ts 注释：过道矿
合约）。外矿元素矿任务 kind=harvest + resourceType=mineral 类型 + 远程
标志（targetPos.roomName ≠ roomName 已是 counts 判据），不新增 TaskKind。
extractor 放量走 sitePlacement 意图（与二期路段同一管线）。

### D5: 中央九房 = keeper 高密度

center 房复用 keeper 全链，仅配槽表升档（lairs 更密）。不单列状态机分支。

## 风险与守恒

- **CPU**：lair 观察随 perception 既有节拍；撤离计算是纯查表；
- **Memory**：lairs 记录有界（keeper/center 房数 × 每房 lair ≤ 7）；
- **不碰 speedrun**：pin-only 准入，speedrun 无 pin。
