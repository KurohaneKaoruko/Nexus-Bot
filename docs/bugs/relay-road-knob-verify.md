# 接力换载与造路旋钮验证（K.swap / K.paved）——响应"主代码有传递与造路，为何不开"

- 优先级: P2
- 状态: 已验证，均负优化，维持默认关闭
- 背景: 用户指出主代码有接力搬运（specs/接力搬运）与外矿造路，race 应启用。

## 结论（20k、4 组 jitter、构建期 SPEEDRUN_KNOBS 烧死旋钮）

| 旋钮 | mean | vs 基线 1,072,701 | 机理 |
|---|---|---|---|
| swap:1 | 987,211 | **-8.0%** | 换载省载具费时间：交接 1t + 双方转身，等效"路程减半趟数翻倍"；单房矿距 40-70t 短途，瓶颈在车道汇聚点不在里程，交接点反成新排队点（RCL2 即慢 60-170t） |
| paved:6 (1500t 起) | 1,007,360 | **-6.1%** | 41k→82.7k built（+41.7k 建造量 ≈ 4,170 能量 + builder 时间）；路只对 MOVE 寿命有收益，race hauler 本就走同权重最短路，路不改变路径只改寿命——T3→L4 反而慢 1,300t |

## 机制对齐说明

- 主代码 `specs/接力搬运`（utils/carryRelay + tryRelayHandoff）的适用面是
  **跨房长距离**（carrier 里程 100+，整仓交接省半程）；race 的 swapLoad
  （towing.ts，K.swap 门）是它的单房对应物，矿距短无收益。
- 造路收益公式：路回收 MOVE 消耗（plain 2→1）≈ 体力寿命 ×2，只在
  **吃 MOVE 寿命**（远距离/持久战）时回本。20k 单房 rush 的 hauler
  生命周期内走不完那么多里程，建造成本反超。
- 上游 40k 开放档案（claimRooms=5、多卫星、长干线）里 paved 是正收益
  （experiments/open*.js 1.16M 档案都带 paved），与单房 20k 档结论不矛盾。

## 顺手修复（负优化验证途中抓到的真 bug）

1. `types.ts` 引用 `swapLoad` 未 import —— `K.swap=0` 时短路掩盖了
   ReferenceError，开 swap 即炸（上游遗留）。
2. `economy.ts` 引用 `LANE_Y` 未 import（同型掩蔽 bug，K.paved=0 掩盖）。
   `LANE_Y` 从 types.ts 局部常量提升到 layout.ts 导出，两侧共用。
3. 新增构建期旋钮注入口 `SPEEDRUN_KNOBS`（rolldown define → K merge），
   实验旋钮烧死且不触碰 `globalThis.__K`，不影响 PRIVATE_PROFILE
   自动选择（ring 实验发现的 `__K` 前缀测试陷阱）。

## 验证

- swap:0 / 无旋钮默认构建 4 组逐位复现基线（1067305/1071434/1075888/1076177）
- 全门禁绿：tsc / oxlint / arch / structure / 47 tests
