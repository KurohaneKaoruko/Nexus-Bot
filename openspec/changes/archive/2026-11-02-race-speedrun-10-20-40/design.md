# Design

## Context

当前 sim 实测（2026-10-18，基线 02c55e6）：speedrun L2@1117 / L3@14089 / L4 None，距 10kt RCL4 差 2.8 倍以上。race-strategy-port.md 五波移植已对齐公式族（定编/体型/供能链/禁建/等级优先级），剩余差距集中在四个机制缺口：

1. **同龄批死亡潮**：jitterRatio 0.1（±10% 寿命抖动）不足以离散整批到期，t13k 人口 22→13 塌陷后升级速率跌入 ~2.8 e/t 平台。
2. **ext 填充动力学**：fill_spawn 认领延迟使涓流期孵化节律 180t/只（旧体系 94t）；remote-mine 场景升级量 6.7k vs 旧体系 18.4k。
3. **L2 升级启动慢**：W5 载体前置孵化（race-body-audit 换代）使 L2 慢 400t（1066→1117），开局序列与冲级目标冲突。
4. **外矿静态上限**：remoteAutoMaxRooms: 2 固定，race bot 用动态取舍。

**参考本体**（用户指定，2026-10-18 补齐）：`../Rosmarin-Bot-dev/src/branch/race/bot/`——完整的 105 文件独立 race bot（达成 1wt/2wt/4wt 的本体，非此前参考的 shared/ 重构版）。核心文件勘察结论：

| 模块 | 文件 | 行数 | 冲级关键机制 |
|---|---|---|---|
| 升级定编 | room/manageUpgrade.ts | 382 | numWork 统计（剔除将死体）→ maxWork 上限 → idler 收编 → 缺口孵化；`building && !upgradeNeeded` 止升让位；`2×(maxWork−numWork) < bodyNumWork` 半缺口不孵（防小体 churn） |
| maxWork 公式 | utils/roomUtils.ts getMaxWork | — | 三分支：terminal 期 `clamp(energyLevel−90, lower, upper)` / storage 期双档（<90: `income×energyLevel/100`，>120: `income+energyLevel−90`）/ 无仓期 `income × multiplier`，multiplier = `clamp(spawnBalance/2+0.8, 1, 1.2)` |
| 升级吞吐封顶 | roomUtils getUpgradeCapacity | — | controller link 期 `floor(800/(range+1))`（800 = LINK_CAPACITY×(1−3%)/15t 折算），无 link 期 90 |
| spawnBalance | room/spawnManager.ts + roomUtils | — | EMA 控制器（α = 1−2^(−1/50)，50t 半衰期）：搬运有请求 → addSpawnBalance（+1 目标），搬运空转/建造断粮 → subtract（0 目标）；无仓期才有，storage 建成即删。**这是无仓期（RCL1–3）升级定编的反馈核心**——spawn 线忙则 upgrader 定编 ×1.2，闲则回落 ×1.0 |
| energyLevel | roomUtils getEnergyLevel | — | `< standard`：`100×total/standard`；`≥`：`100+(total−standard)/1500`；standard 表 {1-3:10000, 4:20000, 5:40000, 6:80000...}（config.economy.energyStandard） |
| 建造 | room/manageBuild.ts | 312 | builder 空载且 depot 空 → subtractSpawnBalance（建造断粮信号）；无仓期 builder 进 creepsToFill（porter 直供） |
| 搬运 | room/manageLogistics.ts | 865 | requests/idlers 匹配 + relay 接力；idler 空转 → addSpawnBalance（搬运过剩信号） |
| 采集 | room/manageSource.ts | 1198 | 远程矿工驻点兼职建容器/维修（CONSTRUCTION_SITE_NUMBER=6 限工地）；REMOTE_BUILDER 3w3c3m 段 |
| 外矿 | remote/remoteUtils.ts + remoteRoles.ts | 1889 | activeSources 注册表 + reserver + 驻点建设 |
| 孵化 | room/spawnUtils.ts | 1975 | getMinerBody（W 封顶 maxWork，speed 0.5）/ getUpgraderBody（carryRatio 缺省 4，tightCpu 期 5）/ getHaulerBody / getBuilderBody |
| 布局 | DISABLED.md | — | race 禁 terminal（省格位），storage link 恢复；lab RCL7（config.rclToBuildLab=7） |

与 Nexus 已对齐部分的差异定位（race-strategy-port.md §已核实 + 本次勘察）：Nexus 的 workforce 定编公式同构，但缺 **spawnBalance EMA 反馈**、**link 吞吐封顶的 800/(range+1) 精确口径**（Nexus 走几何吞吐公式族）、**止升让位的 building 联动**、**半缺口不孵的防 churn 闸**。

架构约束：四篇文档（01/02/03/04）已规格化——任务驱动单路径（G-P4-1）、broker 边界（G-P2-3 直连只减不增）、配置无硬编码（AGENTS.md）、先修 bug 再开发（03 §41）。

## Goals / Non-Goals

**Goals:**

- speedrun 三档达标（10kt RCL4 / 20kt RCL5 / 40kt RCL6），六场景回归不红。
- 四条机制缺口各有可度量的验收口径（人口峰谷差 / 孵化节律 / L2 时间 / 外矿激活数）。
- 每批改动独立 commit + sim 回归，随时可回退到上一稳定态。

**Non-Goals:**

- 不动 nexus-architecture-refactor 的剩余任务（9.2 legacy 删除 / 9.5 实服总验证 / 9.6 收尾对账）——本变更结束后由该变更独立完成。
- 不做沼泽地形优化（P1-14 域，sim 邻房全平地，speedrun 路线无收益；W2 道路项维持"待评估"状态）。
- 不搬 Rosmarin 代码结构（无 Room 原型链、无 memory 直读），只移植策略公式与机制语义。
- 不追求 boot 场景 bit-identical（开局序列重排的 L2 漂移 ≤10% 已 justified，见 race-strategy-port.md 先例）。

## Decisions

### D1：断言三档一步到位，不设中间台阶

speedrun 断言直接改为 10k/20k/40k 三档（删 L2/L3 中间档），即使当前实测红——断言是目标不是现状，绿灯前 CI 红是冲刺状态的诚实呈现。回归护栏依赖 boot/sprint/remote-mine 的既有断言，不靠 speedrun 的中间档。
**理由**：中间档（如先 15kt RCL4 再 10kt）会诱导"调断言迁就现状"的道德风险；三档是榜口径的硬目标。
**替代方案**：分段收紧断言（每达标一档改一档）——被否，改断言本身有成本且中间档无独立价值。

### D2：替补错峰改为"孵化周期窗口离散"

jitterRatio 从 ±10% 寿命抖动升级为：替补触发点 = 寿命终点 − 前置量（生产时间 + 路程 P95 + 安全余量，既有公式）+ 单位名哈希离散项，离散项均匀分布在 [0, 孵化周期×批次规模] 窗口。参数进 config/economy.ts。
**理由**：同龄批死亡潮的本质是替补请求同 tick 集中 → 孵化槽排队 → 空窗期采集面塌陷；把请求离散到完整孵化周期窗口，让孵化槽匀速消化。
**替代方案**：按批次年龄分簇错峰（记录出生批号）——被否，批次追踪引入新 Memory 结构，哈希离散零状态达成同效果。

### D3：ext 填充动力学走"认领即锁定 + spawnBalance 反馈"

fill_spawn 认领延迟的治理双管齐下：① 任务发布 Tick 内锁定 ext/容器的能量认领（账本预留即时生效）+ 孵化槽空闲前瞻（spawn 空闲前 N tick 预备，N=最小体型孵化时间）；② 移植 race bot 的 **spawnBalance EMA**（α=1−2^(−1/50)，50t 半衰期）：搬运请求未满足/搬运空转两路信号驱动 `clamp(balance/2+0.8, 1, 1.2)` 的无仓期定编乘数——搬运线紧张时压 upgrader 定编让位孵化，闲时放额定编吃满采集面。porter 直供链（W3 评估项）**暂不移植**——race bot 的 porter 属 manageLogistics requests/idlers 匹配体系，Nexus 有 controllerBuffer + coreDepot 等价机制，先行评估收益再决定。
**理由**：孵化节律 180→94 差距的主因是认领延迟 + 定编静态（race bot 用 spawnBalance 闭环动态平衡采集/搬运/升级三角，Nexus 无此反馈）；认领即锁打供给延迟，spawnBalance 打定编平衡。
**替代方案**：完整 porter 体系移植——被否，与既有 energyLogistics 职责重叠，架构成本高收益未证实。

### D4：开局序列按 roomMode 分档

rush 模式开局：首只采集体（harvester）→ 首只升级体（upgrader）→ 搬运体（carrier）。非 rush（main 档）保持现行（W5 载体前置对涓流场景有益）。分档走 config（race 变体已有 defaultRoomMode: 'rush' 机制）。
**理由**：race-strategy-port.md 已实证 carrier 前置换 L3 快 1k+ 在涓流场景成立，但在 speedrun（能量充裕）场景拖慢 L2 400t——两个场景最优解不同，按模式分档各取所需。

### D5：升级定编补齐三个 race bot 精确口径

Nexus workforce 公式族同构但缺三个细节，全部对齐 race bot 源码：① **link 吞吐封顶** `floor(800/(range+1))`（range = controller link 到 storage link 切比雪夫距离；800 = LINK_CAPACITY×0.97/15 折算，无 link 期 90）；② **止升让位** `building && !upgradeNeeded` 时 upgrader 定编归零（upgradeNeeded = ticksToDowngrade 低于降级线触发，building = 主结构在建）；③ **半缺口不孵闸** `2×(maxWork−numWork) < bodyNumWork` 时不孵化（缺口不足半只新体工作量时放弃，防小体 churn——与 docs/bugs 攒能定档同族问题）；④ numWork 统计剔除将死体（`ticksToLive > body.length×CREEP_SPAWN_TIME` 才计入），替补孵化不与将死体重复计数。
**理由**：四个口径都是 race bot 1wt/2wt/4wt 实测调参的产物，逐项对齐成本低于自行调参。
**替代方案**：保留 Nexus 几何吞吐公式族自行校准——被否，调参周期长且无实测背书。

### D6：外矿激活用评分排序替代完整背包 DP

race bot（及 shared 版）的动态取舍机制先落"价值密度排序 + 预算上限"（value/distance 排序，预算内贪心取前 K），rush 模式预算保底。若实测与 Rosmarin 口径差距大再升级 DP。
**理由**：背包 DP 的最优性在候选房多（8+）时才显著；贪心在 speedrun 场景（8 邻房双源）与 DP 解高度重合，实现成本 1/5。
**替代方案**：完整 DP 移植——保留为升级路径，不阻塞主线。

### D7：冲刺程序按"瓶颈轴"迭代，每批一 commit + 全场景回归

每轮循环：跑 speedrun → 读 rclReachedBy 三档达成情况 → 未达标轴定位（升级均速 / 采集面 / 孵化节律三轴，用 sim 探针数据）→ 针对性移植/调参 → 全场景回归 → commit。单轮失败机制（如某项移植实测负收益）撤销该轮 commit 并在 race-strategy-port.md 留档（全负实验留档先例）。
**理由**：冲级优化是强耦合系统，单杠杆常反噬（race-strategy-port.md 十连实测"单杠杆必反噬"教训）；小步快跑 + 每步可回退是唯一安全姿势。

### D8：实服落地在三档全绿后，作为独立验收段

sim 三档全绿后才执行 `submit.js 47.100.24.220@nexus --branch main`；落地观察一个 4wt 重置周期的 RCL 时间线（与 sim 口径对照），实服缺陷回流 docs/bugs。不在冲刺中途落地（避免 sim 未绿时实服噪声干扰定位）。
**理由**：sim 是可控可复现场景，实服有 4wt 重置与不可控因素；先 sim 后实服隔离变量。

## Risks / Trade-offs

- [开局序列重排拖累 boot/race-body-audit 基线] → D4 按模式分档：rush 档才改序列，main 档不动；boot 场景漂移容忍 ≤10%（justified 先例）。
- [错峰离散窗口过大导致替补延迟] → 离散上限 = 孵化周期×批规模，且有安全余量兜底；sim 人口曲线（run-residue 场景已有种群探针）验证无空窗。
- [认领即锁定与账本预留冲突] → 复用 ResourceLedger reserve（01 §18.1 五态），fill_spawn 预留走既有 reserve API，无新记账路径；TTL 兜底防泄漏。
- [spawnBalance 信号面不匹配（race bot 的 add/sub 调用点与 Nexus 任务体系不同构）] → D3 只移植 EMA 机制与两路信号语义（搬运需求未满足 + / 搬运空转或建造断粮 −），信号源映射到 Nexus 的 fill/haul 任务队列状态，不照搬调用点。
- [link 吞吐封顶 800/(range+1) 与 Nexus 布局的 link 位置不一致（Nexus 布局 link 距离不同）] → 公式按距离自适应，Nexus 布局的 range 值代入即可；sim 实测定编是否误伤。
- [贪心外矿与 DP 口径分歧] → D6 保留 DP 升级路径；实测收入差 >15% 时触发升级。
- [冲级改动破坏架构红线] → 每轮 arch-guard + tsc/oxlint 全绿才 commit；直连调用只减不增（G-P2-3）。
- [sim 绿实服不绿] → D8 隔离段处理；实服观察期发现的缺陷按 03 §41 登记 docs/bugs，不混入本变更任务。

## Migration Plan

1. **批次 A 断言与基线**：speedrun 断言三档化 + 当前三轴探针数据采集（升级均速/孵化节律/人口曲线的 sim 输出固化）。
2. **批次 B 机制落地**（按瓶颈轴优先级）：同龄批错峰（D2）→ 填充动力学 + spawnBalance（D3）→ 升级定编四口径（D5）→ 开局序列（D4）→ 外矿评分（D6）。每项独立 commit + 全场景回归。
3. **批次 C 冲刺迭代**：D7 循环直至三档全绿；负收益实验撤销留档。
4. **批次 D 实服落地**：D8 独立段（三档绿后）。

回滚：每批次独立 commit，单批次 revert 即回上一稳定态；config 参数（jitterRatio/离散窗口/前瞻 N/EMA α）可配置化回退，无需改代码。

## Open Questions

- porter 直供链的收益评估结论（D3 暂缓项）：待填充动力学落地后用 sim 探针对比再决策——不阻塞本变更主线，评估结论记入 race-strategy-port.md。
- race bot 的 energyStandard 表（{1-3:10000, 4:20000, 5:40000, 6:80000}）与 Nexus energyLevelOf 的档位是否完全一致：D5 实施时逐档核对，不一致以 race bot 口径为准对齐（speedrun 场景背书）。
