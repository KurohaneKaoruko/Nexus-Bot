# Proposal

## Why

docs/bugs P1-14（沼泽地形经济低均衡陷阱）仍未修复：rcl-sprint 50k 升级总量停在基线带上沿（~19674），RCL4@40000 断言不过，按 AGENTS.md 门禁阻塞一切新功能开发。四/五轮校准已实证结论：孵化侧、建造侧任何单点手术都会被强耦合能量预算反噬（19674→11193→…→8322 六轮全负），唯一出路是**成套校准 workforce 机器**（productionGate 产出就绪闸 / 接力搬运 / 吞吐现算定编 / 路网协同），即外矿能力的公认前置件。主线现状与之差距明确：定编以 count 口径为主（harvester=源数、worker=工地数/2、manager 系 0/1 硬门）、carrier 吞吐公式粗（单目的地、tileTicks 二档、运力常数 200）、无产出就绪闸、搬运单爬整段无接力、升级定编无饥饿负反馈与人口上限（实测 RCL3 房 38 只 1-WORK 升级工的坑）。

## What Changes

- **吞吐定编（WORK 口径）**：新建 `economy/workforce.ts`——升级人力目标按 WORK 总量现算（采集收入基线 × 档位倍率，水位收缩/盈余加码/落地堆清理各项取 max），按当前孵化体型折只并受 RCL 人口硬上限表约束；carrier 定编改为运力现算 `Σ(2×源实测路程×源采集速率)×冗余 ÷ 单件运力`，实测路程缺失回退保守基线。采集收入按在岗 harvester 有效 WORK 现算，成为定编与诊断的单一收入事实。
- **productionGate（产出就绪闸）**：在岗采集体 ≥ 源定编每 tick 现算（无锁存，死亡自动回落）。两个消费闸：起步序列闸（未就绪时孵化面只放行采集/应急角色）、搬运开局闸（未就绪时搬运体数 ≤ max(1, 在岗采集体数)——杜绝「3 搬运 ： 1 矿工」倒挂吃光孵化槽）。
- **控制器供能专线**：控制器线（cc + 断供升级工）的 carrier 服务只数按运力需求现算并优先满足；已认领目的地整趟粘滞、运量在请求账上先行扣减（杜绝多车奔向同一将满目标）；升级供能不得被近距孵化线请求吸干。
- **接力搬运**：RCL<7 恒接力——相向（一空一满 + 意图格互指）且容量相等的两搬运体同 tick 整仓交接，货物单 tick 前进两格、任务粘滞状态随货走；carrier 体型转微型接力件（容量/MOVE 配比入配置，路网覆盖达标转路面配比），RCL≥7 转大件直运。
- **升级工饥饿负反馈**：取能落空且控制器缓冲全空时记账，升级定编按记账收缩，惰性衰减有界；rush 档按既有 EMA 口径差异化。
- **顺手修三件**（行为缺陷顺手修原则）：攒能等待超时兜底死代码（`spawnIdleSince` 每 tick 重建致 `capacityWaitTicks` 永不触发）持久化；`ccBelowSpawnGate` 多房短路（首个有 cc 房即 return）；`deliverEnergy` 兜底投递不受配额目的地约束。
- **说明**：本块能力由主线新建严格 TS 实现，参照既有实现（`Room/function/productionGate.ts`、`economy/roomWorkforce.ts`、`economy/energyLogistics.ts`、`roles/carrier.ts` 接力部分）保持原貌继续供 race/season 变体使用，其未合并标记的移除与归档随变体切换（后续变更）。
- **回归与勾销**：rcl-sprint 3/3（RCL4@40000 / cpuP95<20 / noErrors，P1-14 验收）、boot-from-scratch 3/3 不回退；docs/bugs P1-14 勾销、docs/14 进度快照、config 注释同步。

## Capabilities

### New Capabilities

- `workforce-staffing`: 房间劳动力吞吐定编——升级 WORK 口径目标、count 折算与 RCL 人口上限、carrier 运力现算、采集收入单一事实口径、饥饿负反馈。
- `production-readiness-gate`: 产出就绪闸——采集面就绪每 tick 现算、起步孵化序列约束、搬运开局闸。
- `controller-supply-line`: 控制器供能专线——专线服务只数运力现算、在途认领粘滞与请求账先行扣减、请求优先级序。
- `relay-hauling`: 接力搬运——相向对穿整仓交接判据、任务状态随货走、微型接力件体型与路网配比联动。

### Modified Capabilities

（无——openspec/specs 主规格当前为空，全部以新 capability 建立。）

## Impact

- **代码**：`src/modules/economy/`（workforce.ts 新建、productionGate.ts 新建、quota/planners/model 接线）、`src/modules/spawning/`（spawnDirector 定编消费与两闸、bodyFactory carrier 接力件档）、`src/modules/agents/`（agentSystem 接力交接、饥饿记账、交付粘滞）、`src/utils/`（交接判据纯函数）、`src/config/`（WORKFORCE/RELAY 等参数组，零硬编码）。
- **参照实现（只读移植源，保持 既有实现）**：既有实现 (`prototype/Room/function/productionGate.ts`)、`src/modules/economy/roomWorkforce.ts`（本地定编部分）、`src/modules/economy/energyLogistics.ts`（中枢与专线部分）、`src/modules/economy/roles/carrier.ts`（家内接力部分）、`src/utils/haulerStrategy.ts`（对穿判据）。
- **Memory schema**：v9 → v10（`rooms[x].upgradersStarved`、`rooms[x].sourceTiming` 可选字段 + 幂等迁移）。
- **不动**：既有代码及其门禁排除清单（race/season/stronghold 变体行为不变）；movement/交通（BetterMove 在役，交接移动仍走既有意图结算）。
- **回归**：sim rcl-sprint（P1-14 验收主线）、boot-from-scratch；docs/bugs、docs/14、docs/21/24 同步；私服实测留可选收尾。
