# Design

## Context

Phase 1 内核与闭环已上线：模块按 `TICK_PHASES` 注册（perception→planning→reconcile→spawn→agents→commit），感知产出 `WorldView` 纯数据快照（sources/energyStructures/sites/piles/stores/creeps），任务为 DTO（dedupeKey 幂等 upsert/cancel），Allocator 两段式贪心，BetterMove 已接线（preTick/endTickResolve，持任务贴 Source 视为工作位）。当前短板：haul 任务只有货源没有目的地（§6.4 反模式「每 Tick 选最近」）、替补提前量是 `spawnTime+120` 常数、无账本与速率数据、拥堵无度量。契约以 docs/nexus-design/06/07/08/17 与既有 phase1 specs 为准。用户准则不变：高内聚低耦合、简洁、无硬编码（参数进 `src/config/`）。

## Goals / Non-Goals

**Goals:**

- docs/nexus-design/14 Phase 2 验收全项：采集/运输吞吐接近设定目标、Spawn 不因调度错误长期闲置、soak test Memory 有界
- 替补窗口满足 phase1 `spawn-director` spec 既有契约（提前量 = 生产+路程 P95+余量，重叠有度）
- 账本/配额/模型作为可独立开关的模块挂进既有阶段，不改动 TaskBoard/Allocator/Broker 架构

**Non-Goals:**

- Link/Factory/Terminal 物流与市场（Phase 6）；远程采集与多房间（Phase 4+）
- 全房间多智能体路径搜索或重写 BetterMove（本期拥堵只做检测+分级响应，docs/nexus-design/08 §8.4 初版原则）
- 完整 ConstructionPlanner/RoomBlueprint（docs/nexus-design/17 全量属后续；本期只做 Source 容器放置这一最小闭环）
- 二分图匹配等高级分配算法（仍用贪心 + 评分，按指标数据再议）

## Decisions

1. **模块划分与挂载**。`economy/ledger.ts`（账本，planning 前段）、`economy/quota.ts`（配额，纯函数库被 planners 调用）、`economy/model.ts`（经济模型，独立模块挂 planning 末、P2 预算门控）、`world/worksite.ts`（工作位选择纯函数 + room intel 缓存）、`movement/trafficMonitor.ts`（伴生统计文件，既有文件零改动）。新模块全部经 profile 开关切（禁用零成本），参数集中在 `src/config/economy.ts`。
2. **账本 = 快照 + 预留的纯计算**。库存直接聚合自 WorldView（结构 store + creep 携带），不额外 find；预留是 `Memory.nexus.ledger.reservations` 的有界记录（owner/resource/amount/expiresAt），`reserve/commit/release` 为账本模块 API，过期在 reconcile 统一清理。首个消费者是配额：在途搬运量计入目的地「已承诺库存」，实现到达前失效预判；spawn 能量预留留接口不给实现。替代方案：账本自持库存缓存——与快照重复，否决。
3. **速率用衰减计数器而非环形缓冲**。生产/交付速率每 Tick O(1) 增量 + 每 N Tick 衰减（EMA 风格），Memory 恒定 O(房间数×资源种)；不存窗口历史数组。N 与衰减系数进配置。
4. **配额进任务流的方式**。NexusTask 增加可选 `destId/destPos`（schema v3 同步扩展 taskSchema），haul 任务的 dedupeKey 变为 `haul:<room>:<srcId>:<destId>`；planners 生成 haul 前向 quota 查询目的地（候选=低于最低库存线的 energyStructures 按缺口/类型优先级排序，其次 storage/容器），批量按 carrier 容量与往返耗时估算。Allocator 无需改动——目的地优先级体现在任务 priority 上。
5. **工作位 = 地形推导 + intel 缓存 + 快照校验**。首次为每 Source 计算相邻可行走格并按「距 Spawn/主路远、不堵出口」评分选定，结果存 `Memory.nexus.rooms[x].worksites`（仅坐标）；每 Tick 用快照校验（被站点/建筑占用则重选）。harvest 任务容量=工作位数，Agent 层驻点目标=工作位坐标；`endTickResolve` 的 isWorkTile 判定升级为精确坐标。容器放置：worksite 产出「期望容器位」→ planning 生成 siteRequest → commit 段幂等执行 `room.createConstructionSite`，失败按 docs/nexus-design/17 §17.10 分类（invalid_placement 重选/冷却，site_limit 暂停）。
6. **拥堵检测走快照差分，不改动既有实现**。trafficMonitor 每 Tick 比较前后快照中持移动意图单位的位置：未移动则累计 blockedTicks（滚动），多单位聚集于同一格计入热点频率（`room:x:y` 键，衰减 + 上限条目 GC）。分级响应挂在 Agent 提案层：blockedTicks 超阈值依次尝试让路（endTickResolve 推开）、路径重置、任务释放重分配；重试上限进配置。替代方案：侵入 BetterMove 内部计数——零改动原则，否决。
7. **替补窗口实装**。`replacementLead = spawnTime(body) + travelP95(role, room) + setupMargin`；travelP95 来自 UnitRecord 的 `bornAt→首次到岗` 实测滚动样本（有界窗口，样本不足时回退配置估算值）。重叠政策：harvester 允许在编 overlap ≤1，carrier/upgrader/worker 严格「alive+inflight < target」才补。参数全部入 `src/config/economy.ts`。
8. **经济模型两级结构**。每 Tick O(1) 累加器（快照差分：采集量、交付量、spawn 闲置 tick、缺货 tick、搬运空跑比例），每 N Tick（P2 门控，默认 150）跑一次诊断：比较生产/交付/库存三组速率 → 瓶颈分类（运输瓶颈/目的地错配/产能过剩）→ 输出运力目标调整（carrier 目标数乘数、配额下限修正），调整带迟滞（同窗口内最多一次）。docs/nexus-design/06 §6.8 六项指标汇总进 HUD 新增行 + 控制台查询。
9. **Memory schema v3**。新增 `ledger`（reservations+rates）、`traffic`（blocked+hotspots，有界）、`economy`（累加器+诊断+travelP95 样本）、`rooms[x].worksites`；migrations 注册 v2→v3（空默认值，dogfood 迁移链）；所有新结构声明 GC 规则（过期预留清理、热点条目上限、样本窗口固定）。NexusTask 可选字段向后兼容。
10. **CPU 纪律**。账本 O(预留+房间)、配额 O(目的地)、拥堵 O(creep)、模型常态仅累加；重计算全部降频 + P2 门控，预算紧张先砍模型与拥堵重估，不动感知/补给。HUD 观察各新模块 P1/P2 占比。

## Risks / Trade-offs

- [容器站点创建失败/被占格] → siteRequest 幂等 + 失败分类冷却（invalid_placement 重选工作位旁候选，site_limit 本窗口暂停），不阻塞主闭环
- [travelP95 早期样本不足] → 回退配置估算并标注置信度，样本达标后自动收敛；替补提前量宁大勿小（重叠由政策上限约束）
- [配额/模型参数不当引起运力抖动] → 全部参数集中配置 + 调整迟滞 + 指标对照（haulUtilization/spawnIdleTicks）；验收前在私服按 docs/nexus-design/13 soak
- [拥堵热点图膨胀] → 条目上限 + lastTick GC + 衰减，schema v3 声明有界性并在测试断言
- [EMA 速率对突变响应慢] → 窗口参数可调；瓶颈诊断比较的是多窗口趋势而非绝对值，误判代价限于目标微调

## Migration Plan

- 构建 → 上传 local 变体 → v2→v3 迁移自动执行（检查迁移日志）→ 观察：Source 容器规划落地、haul 任务带目的地、HUD 经济指标行 → 数千 tick soak：吞吐 vs 目标、spawnIdleTicks、Memory 占用曲线 → 对照 docs/nexus-design/14 Phase 2 验收。
- 回滚：重传 Phase 1 bundle（v3 Memory 未知字段由既有降级路径容忍，或清理 `Memory.nexus.ledger/traffic/economy` 与 rooms[].worksites 后重启）。

## Open Questions

- 无阻塞项；Link 接入、Storage 出现（RCL4）后的配额扩展、道路 ROI 铺路（docs/nexus-design/17 §17.7）按数据在后续变更另立。
