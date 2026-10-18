# Proposal: race-speedrun-10-20-40

## Why

speedrun 榜冲刺是项目最终目标之一（AGENTS.md），但当前 sim 实测距目标差距巨大：speedrun 场景（主房 W5N8 + 8 邻房，9 房双矿平地，RCL1 零结构开局——与私服口径一致）当前实测 **L2@1117 / L3@14089 / L4 None**，而目标是 **10kt RCL4 / 20kt RCL5 / 40kt RCL6**（对齐 RosmarinBot race 分支的 1wt/2wt/4wt 性能目标）。race-strategy-port.md 的 Wave 1–5 已移植了公式族主体（定编/体型/供能链/禁建表/等级优先级），但遗留三大结构性缺口：同龄批死亡潮（t13k 人口 22→13 塌陷）、ext 填充动力学（fill_spawn 认领延迟导致孵化节律 180t vs 旧体系 94t）、L2 期升级启动慢（多孵 carrier 致升级启动晚 ~400t）。四篇架构文档（01/02/03/04）已完成可执行规格化，本变更以它们为架构约束，把 Rosmarin race 分支尚未移植的策略机制补齐，冲进 10/20/40 三档。

## What Changes

- **speedrun 断言更新为三档目标**：`speedrun.sim.ts` 断言改为 RCL4≤10000 / RCL5≤20000 / RCL6≤40000（保留 noErrors + cpuP95 护栏）；L2/L3 中间档删除（榜口径只看 4/5/6），当前 500/3k/5k/15k/30k 五档废止。sprint 场景 RCL4≤40000 断言与 boot 基线断言保持不动（回归护栏）。
- **同龄批死亡潮根治**（race-strategy-port 遗留 #1）：替补错峰机制升级——jitterRatio 0.1 不够，参照 Rosmarin 的批次到期离散化，把同龄批的替补触发 tick 按单位哈希离散到完整孵化周期窗口，消除"整批同时死→同时补→再同时死"的churn循环。
- **ext 填充动力学攻坚**（遗留 #2）：fill_spawn 认领延迟治理——孵化节律 180t/只 → 目标 ≤120t/只。路径：认领即填充（任务发布 Tick 内完成 ext 能量锁定）+ 孻化槽空闲前瞻（spawn 空闲前 N tick 预备能量）。
- **L2 期升级启动提速**（遗留 #3）：开局孵化序列重排——首只 carrier 不前置（改回 harvester 优先，rush 档保留 harvester→upgrader→carrier 序列），消除升级启动晚 ~400t。
- **Rosmarin W2/W3 剩余项移植**（参考本体 `../Rosmarin-Bot-dev/src/branch/race/bot/`，105 文件完整 race bot——1wt/2wt/4wt 成绩本体）：
  - 升级定编四口径对齐：link 吞吐封顶 `floor(800/(range+1))`、止升让位（`building && !upgradeNeeded` → 定编归零）、半缺口不孵闸（防小体 churn）、numWork 剔除将死体；
  - spawnBalance EMA 反馈移植（α=1−2^(−1/50) 50t 半衰期）：搬运需求未满足/空转两路信号驱动无仓期定编乘数 `clamp(balance/2+0.8, 1, 1.2)`；
  - porter 直供链评估（race bot manageLogistics requests/idlers 体系），sim 实证有净收益才落地；
  - 外矿激活动态取舍（评分排序替代 remoteAutoMaxRooms: 2 固定上限，rush 模式预算保底）。
- **分段达标冲刺程序**：每完成一批移植 → 跑 speedrun 场景记录 L4/L5/L6 达成 tick → 未达标定位下一瓶颈（升级均速/采集面/孵化节律三轴）→ 循环，直到三档全绿。
- **实服落地验证**：三档 sim 全绿后，`submit.js 47.100.24.220@nexus --branch main` 落地，观察 4wt 重置周期内 RCL 时间线与榜单口径对齐。

**BREAKING**：speedrun 场景断言变更（旧五档 500/3k/5k/15k/30k 废止，CI 口径改变）。

## Capabilities

### New Capabilities

- `race-speedrun`：冲级性能能力——speedrun 场景三档目标（10kt RCL4 / 20kt RCL6 / 40kt RCL6）作为可验证行为契约，涵盖替补错峰、填充动力学、开局序列、外矿激活四条机制线的需求。

### Modified Capabilities

（无——`cluster-squad` 主 spec 需求不变；`architecture-docs` 为文档能力，本变更不触碰四篇文档内容。）

## Impact

- **受影响代码**：`src/modules/spawning/`（demandSources 替补错峰、开局序列）、`src/modules/economy/`（fill_spawn 认领、porter 评估、外矿背包）、`src/config/economy.ts`（jitterRatio 等参数）、`sim/speedrun.sim.ts`（断言）。
- **架构约束**：所有改动走既有架构（任务驱动/broker 边界/配置无硬编码）；违反 G-P2-3（直连调用）与双控制平面的捷径禁止——冲级优化在策略层做，不在架构层开洞。
- **参考实现**：`../Rosmarin-Bot-dev/src/branch/race/bot/`（用户指定的完整 race bot 本体，105 文件：manageUpgrade 定编/manageSource 采集/manageLogistics 搬运/spawnUtils 体型/roomUtils 公式）——只抄策略公式与机制，不搬代码结构（无原型链/memory 直读）。
- **回归面**：六场景门（boot / sprint / remote-mine / arena / speedrun / run-residue）每批必跑；boot 的 L2@~1066 基线断言容忍 ±10% 漂移（开局序列重排的预期影响，race-strategy-port.md 已有 justified 先例）。
- **不触碰**：`nexus-architecture-refactor` 变更的剩余任务（9.2/9.5/9.6 独立推进，本变更不吸收）；docs/bugs 既有文件（新发现缺陷按 03 §41 流程登记新文件）。
