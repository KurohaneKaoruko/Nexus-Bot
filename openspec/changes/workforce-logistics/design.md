# Design

## Context

- 参照实现机制横跨三处（探索报告 2026-10-13）：`Room/function/productionGate.ts`（就绪闸 + 源定编）、`economy/roomWorkforce.ts`（升级 WORK 目标/starved 负反馈/人口上限表/rush carrier 运力公式/收入口径）、`economy/energyLogistics.ts`（请求收集三线/在途认领/专线阶段贪心匹配）、`roles/carrier.ts`（家内相向对穿交接）。全部带 `@ts-nocheck` 供 race/season/stronghold 变体使用。
- 主线承接点现状：`spawnDirector.unitTargets` count 口径（仅 carrier 有粗吞吐公式、upgrader 用 produced EMA 对齐）；`quota.destinationQuotas` 已有四类端点水位 + 在途承诺（`committedTo`）；haul 任务带 destId + allocator 租约迟滞（天然的「整趟粘滞」雏形）；`agentSystem` fill_spawn/haul 已是满载迟滞二态机；harvest handler 首次到岗已记路程样本（travelP95，`economy/model.ts:47`）。
- 四/五轮校准锁定的结构性教训（fix-p1-14 design）：该经济是强耦合能量预算系统，孵化侧/建造侧单杠杆必被反噬；直供链是唯一被验证为正的零腿化例外。本变更按已裁决路径成套移植，不做单点补丁。
- 约束：Nexus 架构不动摇（TickModule 挂载/任务板/行动提案制）；零硬编码；既有文件保持原貌（变体行为不变）；sim 是主线回归口径（`npm run sim` 走 main 变体）。

## Goals / Non-Goals

**Goals:**

- 主线（main 变体）获得完整 workforce 机器：吞吐定编 + 就绪闸 + 供能专线 + 接力搬运，同拍落地。
- rcl-sprint RCL4@40000 通过（P1-14 验收），boot-from-scratch 3/3 不回退。
- 既有原件零改动：race/season/stronghold 变体行为与本变更严格解耦。

**Non-Goals:**

- 不做外矿（externalMine/buildCarryPlan 的 OC 侧、同名 role 外矿位、remoteUnlocked 闩）——步 3 主体，本期只把收入口径留好 provider 挂点。
- 不切换 race 变体到 Nexus 经济（变体切换是独立后续变更，需先具备 rush profile 的 sim 对照能力）。
- 不动 movement/交通内核（BetterMove 在役；接力交接的移动仍走既有意图结算，交接只新增 carry 管线意图）。
- 不引入 既有能量中枢平行系统（主线已有 quota+ledger+任务板主干，专线语义融进主干，拒绝第二套配送中枢）。
- 不做 link/manager 供能几何（RCL5+ 正规链路另议；升级封顶的无缓冲口径先行，link 几何封顶留配置位）。

## Decisions

### D1 定编落位：economy/workforce.ts 纯函数层，spawnDirector 是唯一孵化消费方

新建 `src/modules/economy/workforce.ts`（严格 TS）：移植 `getUpgradeWorkTarget`（收入跟踪收缩/盈余/pile 各项取 max + 无缓冲收紧上限 + 模式下限）、count 折算 + 人口上限表、`getCarrierTarget`（运力下界公式）、`estimateHarvestIncome`（WORK 口径现算）。tick 级缓存复用主线 TickContext 模式（不引 既有 `getRoomTickCacheValue`）。
消费接线：`spawnDirector.unitTargets` 的 upgrader/carrier 目标改读 workforce 出口（harvester 的源定编由 productionGate 承接，见 D2）；worker 维持工地口径（既有建造定编依赖 mission 池，本期不搬，留步 3 后评估）。
备选（否决）：直接在 spawnDirector 内展开公式——定编口径会被诊断/面板/判废多处消费，独立纯函数层才能做单一事实；既有 把它放 `shared/` 也是同样理由。

### D2 就绪闸独立小件：economy/productionGate.ts

`isProductionSecured(room)`（在岗非孵化采集体 ≥ 源定编合计）+ `harvesterTargetPerSource`（源再生上限折 WORK、可站位约束、低等多采集位/高等一源一采）。两个消费点都在 spawnDirector：①起步序列闸——未就绪时非采集面角色的缺口表达直接置零（既有 `spawnMission.ts:389` 的 bootstrapHarvesterOnly 语义，主线对应放行 harvester/upgrader/universal）；②搬运开局闸——carrier 的 effectiveTarget 与在岗数比较后再表达缺口。
remoteUnlocked 闩**不实现**（外矿链关闭中），但函数签名按「可扩展消费方」组织（纯函数、无状态）。
备选（否决）：并入 workforce.ts——闸是孵化序列决策、定编是数量口径，消费方与变化节奏不同，小件独立可测。

### D3 供能专线融进 quota 主干，不建第二配送中枢

既有 能量中枢的三件语义按主线结构对位吸收：
1. **请求三线优先级** → `quota.destinationQuotas` 已有优先级字段，对齐序：孵化线（spawn/ext 现值 2/3）> 受威胁塔（防御态提权，接线 defense 域威胁信号）> 控制器线（cc 常态 3.5/rush 4.5 已在役）> 常态塔/库（4/1）。**调整点**：塔常态优先级显式降到 cc 之后（现值 4 > 3.5，与 既有「塔常态 6 让位升级线」相反——这是有意的口径修正，进配置）。
2. **在途认领粘滞** → 主线 haul 任务天然带 destId + 租约迟滞（`SWITCH_MARGIN=15`），已是整趟粘滞；补的是**先行扣减**：quota headroom 已扣 `committedTo`（在途承诺），把认领时点从「交付完成」提前到「任务认领即挂账」——haul planner 挂预留的时点已在创建时（`economy/planners.ts:237`），对齐即可，缺口在任务被 allocator 认领前的窗口，由任务 deadline（min(600, 往返+100)）兜底。
3. **专线只数保留** → `controllerCarryQuota = ceil(升级 WORK 折 CARRY ÷ 单件运力)`（既有 `getControllerCarryQuota` 口径，cc 缺位为 0）：haul/fill_spawn 任务生成时，若房间空闲搬运力 ≤ 专线只数，孵化线以外的新 haul 任务不再放量（任务板侧的「专线保留」）。备选（否决）：既有 式中心化 supplier-matcher——与任务板+allocator 双轨打架，违反单一事实源。

### D4 接力交接：判据纯函数入 utils，交接动作在 agentSystem，意图走 broker

- 判据 `evaluateHeadOnSwap`（相位相反/意图格互指/容量相等/TTL 下限/同 tick 防重）移植 `src/utils/`（参照实现 `utils/haulerStrategy.ts:75` 家内版——外矿版换整条 memory 的语义不搬，主线任务指针由 agentSystem 统一管理）。
- 交接口径：双方在 `runCreep` 的 fill_spawn/haul（含 upgrade 无 cc 的 fetch 态）分支前统一检查：命中 → 供方提交 `transfer(受方)` 经 broker carry 管线（同一原生调用点不变式），当 Tick 双方以新载量重入行为分支（既有 `runWithRelay` 同 tick 双跑语义）；「任务随货走」在主线的表达 = **受方承接交付任务租约、供方释放回取货侧**——交接即一次轻量改派（复用 allocator 的 release+claim 原语，不新造状态机）。
- 移动不掉头语义依赖 BetterMove 意图已落盘（`_toward` 等价物 = 意图格），判据读意图格不经全局坐标推算。
- 防摆振：交接标记记 `memory.relayedTick = Game.time`（creep memory 既有 `mode` 同层）。
备选（否决）：在 movement 域做透明接力层——交接改变的是任务归属与能量记账，不是移动优化，放 movement 会隐藏控制流（docs/22 §11.1 禁止全局总线隐藏控制流同理）。

### D5 接力件体型：bodyFactory carrier 分支改档表，与 terrainProfile 合流

carrier 段模板（`bodyFactory.ts:42-49`）改为 `RELAY_BODY_CONFIG` 档表驱动：接力期（RCL < 等级门 7）按容量基数 `[C4,M2]` 起步、按 workforce 运力需求以基数倍叠加；路网覆盖率 ≥ 阈值（对齐 既有 forRoad 1/3 口径，与 terrainProfile 现有 0.7 慢地形门并存——前者决定 CARRY/MOVE 配比、后者决定沼泽加 MOVE，两者相乘不冲突）；达门转大件直运档（maxCarry 上调入配置）。
主线 carryThroughputTarget（`spawnDirector.ts:182`）被 D1 的 `getCarrierTarget` 取代后退役删除（单一路径口径唯一）。
备选（否决）：保留旧公式做对照开关——两套定编口径并存正是 P1-14 四轮校准踩过的坑，不留双轨。

### D6 饥饿负反馈：记账入房间记忆，schema v9 → v10

`Memory.nexus.rooms[x].upgradersStarved: {amount, tick}`（惰性衰减按流逝 tick）+ `rooms[x].sourceTiming: Record<sourceId, pathTime>`（carrier 定编的实测路程输入；harvest 到岗样本从 room 级 travelP95 细化为 per-source）。迁移仅推进版本号 + 缺省回填，幂等可回滚（v9 代码忽略多余字段）。
升级工记账触发点：agentSystem upgrade 分支「取能落空（cc 空 + 工位旁无堆）」时 `registerStarve`；workforce 定编消费时惰性衰减后收缩。降级风险窗口（ttd < 阈值）豁免——主线已有 DOWNGRADE 紧急通道（P1-10），读同一信号源。

### D7 顺手修三件（行为缺陷顺手修原则）

① `spawnIdleSince` 每 tick 重建致 `capacityWaitTicks=400` 超时兜底永不触发（`spawnDirector.ts:260`）→ 持久化进房间记忆（`spawnIdleSince` 字段，spawn 空闲起算、忙时清零）；② `ccBelowSpawnGate` 首个有 cc 房即 return（`:158-179`）→ 逐房判定；③ `deliverEnergy` 兜底「就近任意缺能结构」绕过配额 → 兜底目标限定在当 tick 配额目的地集合内（无配额可投再原地等待，不投非配额结构）。

### D8 验收与防回退

主线判据 = rcl-sprint 3/3（RCL4@40000 / cpuP95<20 / noErrors）+ boot 3/3（RCL2@5000 窗口）。防回退观察：采集利用率、升级速率稳定窗口、cc 存量曲线、TTL churn（出生/能量）四项进判废快照（raceSegments 已有 census 口径扩展）。定编/体型改动风险最高，boot 场景锁定平地行为、dump-memory 对照机体序列。
race 变体不动 = 既有 路径零 diff（typecheck 既有 配置 + 变体构建各过一遍作证）。

### D9 顺路灌注与溢流落堆 (2026-10-13 行为校准第一波, carrier 交付侧)

参照实现 carrier 的两个交付侧行为并入主线 deliver 路径:
- **顺路灌注** (参照实现 carrier 顺路灌注语义): 满载途中向相邻配额目的地就地交付。约束: 目标必须
  来自当 Tick destinationQuotas 集合 (与 deliver 兜底白名单同源, 配额单一事实源不破), 且非
  本任务目的地; 灌注不改变任务归属, 余载继续原方向。
- **溢流落堆** (参照实现溢流卸货闸): 无可投目的地时, cc 在位 + 升级圈有饥饿升级单位 (复用
  courier 的 hasHungryUpgrader 判定) → 落堆于 cc 位, 升级工既有拾取路径承接; 否则持能待命。
  落堆上限入配置 (防巨堆衰减浪费)。
- 升级体专属语义 (邻借/催化/RCL8 退役) 属 RCL6+/长寿命房口径, sim 无覆盖, 留待后续波次;
  静态取能序维持 cc→邻近落地堆现状 (link/terminal/storage 级联待 RCL5+ 正规链路)。
- **校准裁决 (50k/65k 实测)**: 两闸同拍开启 → control 12387→11259 (−9%), RCL3 时间线
  劣化 (65k 才到 vs 基线 50k 内)——顺路灌注把边际能量灌进孵化线, 与 cc 专线抢同一批
  能量, 升级端断粮; prod EMA 5.4→9.8 (采集/人口规模扩张) 但增量进不了控制器。
  两开关默认关停 (`CARRIER_BEHAVIOR_CONFIG`), 重启前置 = 灌注目标排除孵化线
  (仅塔/cc 专线类) 或按水位差分配额的再平衡设计。

## Risks / Trade-offs

- [接力交接与引擎结算次序：同 tick transfer + 双方重入分支，sim 与官服结算差异] → 交接后当 Tick 只驱动受方继续任务、供方仅折返移动（保守版同 tick 语义）；sim 全链路验证 + 私服实测取证（scripts/eval.js）后再考虑放开。
- [定编口径切换引发 boot 期震荡（新公式在空房/单源的退化行为）] → 未就绪闸先于吞吐公式生效（D2 闸住起步期）；workforce 全函数在「无实测路程/无在岗」输入下显式回退保守基线（spec 已锁定）；boot 3/3 防回退。
- [专线保留误伤孵化线（保留过度导致 spawn 断供）] → 专线只数公式含 cc 缺位归零；fill_spawn 优先级（95）本就高于 haul（60），保留只在「空闲搬运力不足」时收紧放量，不抢占已分配任务。
- [塔常态降权的口径反转引发防御缺口] → 仅常态塔降权，防御态提权路径保留且优先级最高档不变；sim 场景无威胁窗口，走查 + 配置可调（塔水位触发线不变）。
- [WORK 口径定编与攒能定档交互（大身体等待期采集面空转）] → 人口上限表 + 攒能等待（顺手修①恢复超时降档）双保险；第四轮校准「大身体慢循环劣于小身体快循环」教训以配置注释固化。
- [v10 字段在旧代码回滚时的兼容] → 全部可选字段 + 幂等迁移，回滚 v9 忽略多余字段无破坏。

## 校准实测记录 (2026-10-13, sim rcl-sprint 50k, 引擎直跑 + dump-memory 普查)

- 量纲 bug 实锤并修复: `carrierCountTargetOf` 曾把所需 CARRY 部件数除以单件**能量容量**
  (参照实现除部件数), 搬运定编被压到 1 → hauling 崩 → cc 断粮。
- 账本正确性修复 (50k dump 实锤): 6 条预留全挂在 cancelled 任务上压死 cc headroom →
  maintainLedger 的 owner 存活判定纳入终态; 专线收紧闸曾借 expected 集合把在途任务
  判死 (取消风暴) → 在途任务保持预期集合, 闸门只抑制新建。
- **pile 项正反馈炸弹**: rush 升级定编的 pile/2000 项在主线「钉工位升级体」口径下
  变成膨胀正反馈 (60k 落地能量 → +30 WORK → 孵 6 升级体 → 搬运崩 → 堆更大), 摘除后
  8164→12387。参照实现 pile 项语义属于「会走过去捡的 worker」, 不可照搬进钉位定编。
- 交付兜底配额白名单 +6151 (12387 vs 6236): 兜底投递限定配额目的地是强正约束。
- relay +1222; carrier 吞吐编制 4 只 (vs 基线 2) +2915。
- 负收益留档: capacityWait 实验 (采集面攒能定档) 两轮 6588/3919——归零后断粮死锁,
  自举补丁又挤垮升级; 专线收紧闸 (空闲口径是瞬时值, fill_spawn 租约占满时恒 0,
  误触发切断 pile→孵化线货流) −3835 → `supplyLineGateEnabled: false` 默认关停;
  优先级回退旧值 −6193 (cc 4.5 独大的旧口径与 workforce 定编互相激化)。
- 当日基线 (同引擎 stash 实测): control 14428 / RCL2@1462; 校准版 12387 / RCL2@1379,
  boot 549 vs 基线 1462。剩余 −14% 差距的候选: 空闲运力稳态口径 (EMA)、rush EMA
  供给信号、升级体孵化的水位门——**成套校准, 禁止单旋钮** (第四/五轮教训仍有效)。

### D10 采集端体型墙攻坚 (2026-10-13 第二波, 全负收场——方法论结论)

六组实验 (50k 确定性, 逐项回稳复核): 换代攒能棘轮 (换班等待大体型+新席位侏儒填充)
8524/7065; 矿工替补底线 (非矿工身体不抽穿 150 线) 4451; 矿工孵化优先级 91 (单独)
15044 = 恒等。**结论: 侏儒墙不是孵化时序问题**——矿工换代低频 (2 席 1500t), 队列
位置与等待窗都不改变能量分配的均衡; 时序类手段全部无效或负。
真正的墙 = 采集占空比与 WORK 密度, 可行方向 (需成套设计, 非旋钮):
(a) 多席位 worksite (每源多采集位, 破单座语义, 需 perception/worksite/任务 dedupe 联动);
(b) 源旁 ext 直供满覆盖 (矿工永不离岗, 采集占空比 →100%, 依赖 ext 选址贴近源);
(c) ledger 圈定孵化能量 (换代预留物理圈能, 防其他角色抽穿——本轮 floor 的正确形态)。

## Migration Plan

1. 合入顺序 = 任务组序：纯函数/配置/schema → 就绪闸 → 定编接线 → 专线 → 接力 → 顺手修 → 回归。每组独立可回滚（纯增量 + 少量替换点集中在 spawnDirector/quota/bodyFactory）。
2. 替换点回收清单（合并时执行）：`carryThroughputTarget` 退役、carrier 段模板退役、`ccBelowSpawnGate` 改造、deliverEnergy 兜底收窄。
3. 上线验证：sim 双场景全绿后 `submit.js 47.100.24.220@nexus --branch main` 落地 W5N8，eval.js 取证定编/接力/专线行为与 RCL 时间线（speedrun 榜口径）。

## Open Questions

（无——冗余系数/人口上限表数值/专线只数公式常数均为配置校准项，sim 对照可调，不改规格与结构。）
