# Design

## Context

Phase 0–2 骨架已上线：模块按 `TICK_PHASES`（perception→emergency→strategy→planning→reconcile→spawn→agents→commit）注册，emergency 阶段目前空置；感知产出 `WorldView` 纯快照（sources/energyStructures/sites/piles/stores/creeps，creep 含部件计数）；任务为 DTO（dedupe 幂等 upsert/release/cancel，租约+心跳对账），Allocator 按 requiredCapabilities（work/carry/move/claim）硬过滤+贪心评分，priority ≥90（CRITICAL_PRIORITY）可无滞回抢占；ActionBroker 是唯一原生行动调用点（creep actor、管线内仲裁）；战略层姿态机有 war 枚举但无输入源（`evaluatePosture` 注释明确 ThreatModel 属 Phase 3），`markUrgentReeval/consumeUrgentReeval` 紧急重估通道已存在；Memory schema v4 + 逐版本迁移 + 子系统隔离重置（SUBSYSTEM_DEFAULTS/KEYS）。docs/nexus-design/19 §19.4 给出防御系统接入契约：emergency 阶段、威胁入 `Memory.rooms[].threat`（lastSeen/confidence）、retreat/repair/tower 进 TaskBoard 复用租约、war 输入源 + riskTolerance 启用、威胁衰减自动恢复。用户准则：高内聚低耦合、参数进 `src/config/`、拒绝过度工程化。

## Goals / Non-Goals

**Goals:**

- docs/nexus-design/14 Phase 3 验收全项：NPC/常见敌对情景合理响应、攻击后经济恢复、不长期全员防御、战损有预算与统计
- 防御作为可独立开关的职能系统挂进 emergency/agents 阶段，不改 TaskBoard/Allocator/Broker 架构，经济任务族行为不变（仅被 retreat 临时抢占）
- 一切战斗/塔/SafeMode 原生调用统一经 ActionBroker，保持唯一执行入口

**Non-Goals:**

- SquadPlanner 编队、跨房间援军、attack/heal 任务族的进攻用法（Phase 4+ 预留；本期只做防守性 defend）
- 远程采集受袭响应（无远采，Phase 4）；Boost 战斗单位与 Power Creep（Phase 6）
- 复杂集火微操（拉扯/kiting 状态机）：defender 行为为「接战-治疗-撤退」的规则级实现
- 重写导航：撤退移动复用既有 move 管线，仅靠任务优先级获得通行优先

## Decisions

1. **模块划分与挂载**。新建 `src/modules/defense/`：`threatModel.ts`（威胁评分/衰减纯函数 + `Memory.nexus.rooms[x].threat` 更新）、`planners.ts`（`planDefenseRoom`：defend/retreat/repair 任务幂等 upsert/cancel + SafeMode 评估）、`towerControl.ts`（塔目标分配→行动提案）、`index.ts`（`defenseModule` 挂 emergency 阶段 band P0；`defenseTowersModule` 挂 agents 阶段（brokerModule 前）band P0）。参数全部集中 `src/config/defense.ts`。变体经 `profile.modules` 开关，禁用零注册零 CPU（docs/nexus-design/19 §19.3 清单）。替代方案：塔控并入 commit 段 construction 旁——commit 段语义是「施工收尾」，塔控是当 Tick 行动决策，放 agents 段与其他行动提案同批仲裁更一致，否决。
2. **威胁摘要 = 快照派生 + 有界持久**。感知单次遍历扩展：`FIND_HOSTILE_CREEPS`（位置/主人/存活部件 attack·ranged_attack·heal·tough·move/boost 部件计数）与既有 `FIND_STRUCTURES` 一趟收集塔（能源）、墙体/城门（hits）、受损建筑（hits<hitsMax），CreepSummary 补充 bodyAttack/bodyRanged/bodyHeal/bodyTough（能力由实际身体计算，总表验收项）。评分纯函数：能力估值（部件×boost 权重）× 关键资产接近度（Spawn/Controller/存储/矿工，快照坐标）× 类别乘数（玩家 > NPC），输出 score + 可归因 reason。持久层 `rooms[x].threat` 单条有界记录（score/peak/category/firstSeenAt/lastSeenAt/confidence/hostileCount/reason），失视按 lastSeen 衰减 confidence 与 score（docs/nexus-design/04 §4.3 新鲜度语义）。替代方案：逐敌方实体持久化——失视后即过期，持久化无消费者且膨胀，否决。
3. **撤退走 TaskBoard，per-creep dedupe**。`retreat:<room>:<creepName>` 每威胁房间为每个非战斗单位（按部件判定无 attack/ranged/heal）幂等生成，priority 90（达 CRITICAL_PRIORITY 抢占线，绕过滞回直接撤离），requiredCapabilities ["move"]；经济任务被抢占时 board.release 回 available（dedupe 不变，战后 Allocator 自然改派，零重建开销）。目标锚点 = 首个 Spawn 坐标（配置可改 Controller）。威胁衰减后 planner cancel 撤退任务，单位回池恢复经济——「不长期困于防御」由任务生命周期保证。替代方案：Agent 层行为压制不动任务板——违背 docs/nexus-design/19「撤退任务进 TaskBoard 复用租约与对账」契约，否决。
4. **defend 任务与战斗行动**。`defend:<room>:<threatTier>` 房间级任务（容量语义 = 编制目标由威胁分级推导），targetId = 当前最高威胁敌方单位（规划期更新），requiredCapabilities ["ranged"]（defender 模板能力）。Agent 分支：射程内出 attack/rangedAttack 提案，持 heal 部件且友方损血超阈值改出 heal；目标消失/租约丢失当 Tick 停止产出。Allocator 能力键扩展 "attack"/"ranged"/"heal"（canExecute/scoreCandidate 同构加三行）。新增 ActionKind：attack/rangedAttack/heal/repair（管线 "combat"，creep actor）；Attack/Heal 原生签名 creep 与 tower 同形，塔提案复用同批 kind（管线 "tower"，actor = 塔结构）。
5. **塔控 = 每 Tick 无状态分配**。towerControl 读威胁摘要 + 快照：候选目标按「即刻危险×战略价值×击杀可行性」排序（敌方治疗量折算进可行性），多塔贪心分配避免重复锁死将亡低价值目标；能源低于储量线停修缮（repair 提案不再生成）只保留对敌，低于补给触发线经既有 economy planners 语义产生高优补塔任务（quota 目的地候选增塔，账本预留）——补塔不改 haul 架构。塔耗能统计挂 broker 结果回调（accepted×10 折窗口 EMA + 累计）。替代方案：塔开火也建 TaskBoard 任务——塔不移动、无租约语义，每 Tick 建/结任务是纯 churn，且 docs/nexus-design/03「执行入口统一」指 ActionBroker 而非任务板，docs/nexus-design/19 塔控条目按「结构 actor 行动提案」落地。
6. **SafeMode 经 broker 提交**。新增 ActionKind `activateSafeMode`（管线 "defense"，targetId = controller id，priority 99）：多条件政策——关键结构濒毁（hits < 上限×配置比例）且预估防御火力不足（塔+defender 能力 vs 威胁能力估值）且 `safeModeAvailable > 0` 且非冷却；`Memory.nexus.defense.safeMode.lastAttemptTick` 防重复尝试，激活记录原因进转移式日志。禁止单一敌人数量阈值（docs/api/08 §8.3）。
7. **war 姿态输入源**。`StrategyInputs` 增 `maxThreatScore`（聚合自 `rooms[].threat`，纯 Memory 读，不扫 Game）；`evaluatePosture` 增 war 转移：score > warEnter 且过 minDwell → war，score < warExit（阈值分离防抖）且过 minDwell → develop；敌方首见由 defense 模块调既有 `markUrgentReeval`。`postureBias.war` 填充（fill_spawn/defend/repair 正偏置，build/upgrade 负偏置），riskTolerance 政策值随 war 写入（消费端仍仅偏置层，Allocator risk 权重项保持 0 占位——接入属 Phase 5 调参）。
8. **维修分级**。`repair:<room>:<structureId>` 幂等任务，requiredCapabilities ["work"]（worker 兼职）；排序 = 结构价值 tier（配置表：spawn/tower/storage > rampart/wall > 其他）× 损坏程度 × 威胁区域加成；目标线分级——和平期修至维护线（wall/rampart 用配置绝对值阶梯，其余 hitsMax×比例）即完成，威胁活跃期受威胁防线 priority 提至 75 抢修。维护线参数全部入 config（docs/nexus-design/09「不无条件修满」）。
9. **Defender 生产**。bodyFactory 增战斗角色段模板（单一 `defender` 角色：远程为主的段 + move，min/max 段数受控，代号对齐 RoleConstant 既有 DF）；SpawnDirector：roleForTaskKind defend→defender、repair→worker，defender 编制目标 = 威胁分级映射（和平 0 / 低威胁 1 / 高威胁 2），不受 survive 岗位暂停约束；生产请求经账本 reserve(owner=spawn request)，取消/过期 release（首个账本生产消费者，为 Phase 4+ 扩张排产打样）。
10. **Memory schema v5 + 战损统计**。`rooms[x].threat`（单条有界）+ `Memory.nexus.defense`（safeMode 簿记、stats：unitsLost/hostilesKilled/towerEnergy 窗口 EMA+累计/threatWindows 计数，全部有界）；migrations v4→v5 空默认补齐（幂等纯函数），SUBSYSTEM_DEFAULTS/KEYS 扩展（bootstrap 隔离重置自动覆盖）。战损归因：threat 窗口内 `ctx.world.dead` 计己方损失、可见敌方数下降且非失视计击杀（近似值，排障级精度足够）。
11. **CPU 纪律**。感知扩展保持单趟 find 分发（不多扫）；评分 O(敌数+关键资产数)；塔分配 O(塔×敌) 有上限截断；emergency 模块 band P0（预算再紧不跳威胁响应，与 fill_spawn 同级）；规划幂等 dedupe 使重复 Tick 零 churn；战损统计 O(1) 累加+窗口折叠。HUD 增威胁行（分数/类别/战损计数）。

## Risks / Trade-offs

- [私服敌情不可人工构造，实测覆盖有限] → 单测按 docs/nexus-design/09 §9.7 场景逐一 mock 快照覆盖；私服靠 NPC Invader 自然波次观察真实响应，HUD 威胁行提供可观测性
- [威胁评分参数失准导致响应过度/不足] → 分级响应（tier1 仅塔 / tier2 +defender / tier3 SafeMode 评估）+ 全参数集中配置 + 原因摘要可归因，按战损统计校准
- [retreat 与经济任务抢占抖动] → retreat priority 固定 90 抢占线、威胁分级滞回（进出阈值分离），planner cancel 后有恢复窗口才允许再生成
- [war 姿态抖动] → warEnter/warExit 阈值分离 + 既有 minDwell 迟滞，与库存阈值同一防抖模式
- [defender 生产挤占经济能源] → 账本预留可见化 + 威胁分级上限编制（≤2）+ 战损统计对照
- [boost 侦测与治疗估值粗糙] → 初版按部件计数×配置权重近似，误差只影响响应分级不误触发 SafeMode（其有多条件门）
- [Memory 膨胀] → threat 单条/房、defense stats 窗口折叠，schema v5 声明有界并在迁移测试断言

## Migration Plan

- 构建 → `npm run typecheck` + `npm test` 全绿 → 上传 local 变体：v4→v5 迁移自动执行（核对迁移计数），和平期行为零变化（无 defender、无防御任务、HUD 威胁行 0）→ 等待/诱发 NPC Invader 波次：观察威胁行、retreat 生效、塔开火、war 姿态转移与回落、战后经济恢复 → 数千 tick soak 对照 docs/nexus-design/14 Phase 3 验收清单。
- 回滚：重传 Phase 2 bundle；v5 新增字段（rooms[].threat、defense）由既有未知字段容忍路径处理，或清理后重启。
- 注：phase2 变更的 8.3 soak 项仍开放，与本期 soak 在同一私服窗口合并执行。

## Open Questions

- defender 段模板的最优配比（远程/近战/治疗混合）与威胁分级阈值：初值进配置，按私服战损统计迭代，不阻塞本期。
