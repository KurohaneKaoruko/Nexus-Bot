# RCL1 采集定编欠采（源速采不满）

- 优先级: P1
- 状态: 已修复（2026-10-18）
- 发现来源: 人工审计（speedroom 冲榜优化）

## 现象

RCL1（孵化容量 300）期采集面每源仅 1 只 [W2,M1]（4e/t），
源再生速率 10e/t（3000e/300t）——**结构性欠采 60%**，
能量烂在源边，升级/建造全面涓流。

## 根因

三层缺口（缺一不可，只改任何单层都不生效甚至更糟）：

1. **定编公式**：`harvestStaffingOf` 只数口径 = `sources.length`（每源 1 只），
   注释写明「饱和缺口由攒能定档升体型承接」——但 RCL1 容量上限 300，
   单只物理极限 2W，**攒能永远升不到 5W 满速体**，该口径在 RCL1 是死路。
2. **任务面**：每源 1 条 harvest 任务 + 单租约（assignedTo 唯一）+
   单驻点 tile（atWorksite 严格坐标）——即使孵出多只也无处可去。
3. **让位闸**：harvesterShort 期间只孵 harvester/defender/scout/
   carrier(yieldCarrierFloor=1)——carrier 恒 1 只时 6 矿工的掉落堆
   搬不完，spawn 能量回流断档，攒能死锁（迭代中间态实测 L2 +192t 更糟）。

## 修复（RosmarinBot race 分支同源口径）

1. `productionGate.harvestStaffingOf` 泛化 `energyCapacity` 折算：
   单只 W（复用 `buildRushHarvesterBody` 同一生成器，口径永不漂移）
   < 满速 5W 时按 `ceil(容错 6W / 单只W)` 每源多只。
   RCL1: 2W → 3 只/源（6W）；550 容量: 5W → 1 只自动回落单座。
   容错 6W = 采满源速最少 5W + 1W 换班/移动损耗。
2. `planners` 每源多槽任务：`harvestSlotsFor`（worksite.ts 新增）=
   [主驻点（兼容器合一）, 其余 walkableAdjacents 评分序]，
   任务 i ↔ slots[i]（upgrade 工位先例）；主槽保持无缀 dedupeKey
   （与单座期任务键连续，升档回落不重建）。
   **多只同格不可行**：creep 移动进已占格被挡，互挤寻路
   （迭代中间态实测 harvested 反降 12174→11058、p95 5→9ms）。
3. 代理钉位：`task.targetPos` 槽位坐标（≠Source 本格判定），
   旧口径任务/远程任务回退 intel 主驻点。
4. `spawnArbiter` 让位闸：阻塞线回归**基础编制** `sources.length`
   （满编 3×N 由 unitTargets 持续请求慢慢补齐，不阻塞升级启动——
   满编阻塞实测 race L2 796→1237 大劣）；让位期 carrier 放行
   `< max(1, 在岗矿工数)`（1 采 1 搬交替孵化，防回流断档死锁）。
5. `RoomObservation` 补 `energyCapacity` 快照字段（perception 透传）。

## 验证（已达成）

- 6k 双源探针（引擎 JSON 报告）: harvested 29000→**97522 (3.4×)**,
  control 8526→**13220 (+55%)**, p95 5→7ms（+2ms，红线内）
- sim 矩阵: boot L3 17049→**8885**、arena L3 17049→**8991**、
  speedrun L3 21116→**19049**、sprint L2 1367→1216；
  race L2 796→806（开局孵化序列微调，全程能量面碾压性正收益）
- 新参考重录后全场景矩阵绿 ×2；tsc/oxlint/arch-guard/单测 5/5 绿
