# Tasks

## 1. 配置与 Memory schema v3

- [x] 1.1 新建 `src/config/economy.ts`：集中 Phase 2 全部参数（最低库存线、衰减系数与周期、替补余量/重叠上限、拥堵阈值/重试上限、模型周期 N、热点条目上限等），phase1 散落的 MIN_HAUL_AMOUNT 等一并迁入。验证：`npm run typecheck` 通过且代码中无同类魔法数残留
- [x] 1.2 实装 schema v3：`ledger`（reservations/rates）、`traffic`（blocked/hotspots）、`economy`（累加器/诊断/travelP95 样本）、`rooms[x].worksites`；`NexusTask` 增加可选 `destId/destPos`；`CURRENT_SCHEMA_VERSION = 3`。验证：tsc 通过，新增结构均声明有界性与 GC 规则注释
- [x] 1.3 编写 `migrateV2ToV3`（空默认值补齐，幂等纯函数）并注册迁移链。验证：单测覆盖 v2→v3 升级、重复执行幂等、迁移计数递增、v1→v2→v3 全链

## 2. 资源账本

- [x] 2.1 实现 `src/modules/economy/ledger.ts`：库存聚合自 WorldView（结构 store + creep 携带），`available = stock - Σ有效预留`；`reserve/commit/release` API（owner/resource/amount/expiresAt），预留拒绝超发。验证：单测覆盖可用量扣减、超发拒绝、提交差额返还
- [x] 2.2 预留过期清理：reconcile 段统一清理过期预留并计入过期统计，可用量随之回升。验证：单测覆盖过期清理后 available 回升、统计递增
- [x] 2.3 滚动速率：生产/交付速率每 Tick O(1) 增量 + 周期衰减（EMA，参数入配置），Memory 恒定 O(房间×资源种)。验证：单测覆盖增量累加、衰减收敛、单 Tick 尖峰不平滑翻转、长期占用不增长

## 3. 运输配额与 haul 改造

- [x] 3.1 实现 `src/modules/economy/quota.ts`：目的地候选=低于最低库存线的 energyStructures（按类型与缺口优先级）+ storage/容器兜底；在途承运量（在途 haul 任务的量）计入「已承诺」，剩余容量不足的目的地不再接单。验证：单测覆盖优先级排序、最低库存保障抢占、在途满载截流
- [x] 3.2 haul 规划器改造：haul 任务携带货源+目的地+批量（按 carrier 容量与往返耗时估算），dedupeKey 变为 `haul:<room>:<srcId>:<destId>`；目的地消失/满载/保障满足时任务终结或改派。验证：单测覆盖任务字段完整、绑定稳定、到达前失效预判终结
- [x] 3.3 空载回程承接：交付完成后由 Allocator 按距离评分自然承接邻近 haul 任务，无专属逻辑；haulUtilization 指标统计运输/等待/空跑占比。验证：单测构造交付后邻近货源场景断言再分配；指标产出空跑占比

## 4. 固定采集工作位与容器放置

- [x] 4.1 实现 `src/modules/world/worksite.ts`：首见为每 Source 计算相邻可行走格并评分选定工作位，缓存入 `rooms[x].worksites`（仅坐标）；每 Tick 用快照校验，被占/不可通行重选；环境不变时替补继承原工作位。验证：单测覆盖选定稳定、占用重选、替补继承
- [x] 4.2 接线采集链路：harvest 任务容量=工作位数；Agent 驻点目标=工作位坐标；`endTickResolve` isWorkTile 判定升级为精确坐标匹配，普通交通不挤离驻点。验证：单测覆盖容量互斥与驻点目标；私服观察矿工不漂移
- [x] 4.3 Source 容器放置：worksite 产出期望容器位 → planning 生成幂等 siteRequest → commit 段执行 `createConstructionSite`，失败按 invalid_placement（重选候选+冷却）/site_limit（本窗口暂停）分类；容器或站点已存在不重复，被摧毁可重建。验证：单测覆盖幂等、失败分类冷却、重建；私服观察容器落地

## 5. 拥堵检测与分级响应

- [x] 5.1 实现 `src/modules/movement/trafficMonitor.ts`（vendor 零改动）：快照差分统计持移动意图单位的位置——未移动累计 blockedTicks（滚动窗口），多单位聚同一格计入热点频率（`room:x:y` 键，衰减 + 条目上限 GC）。验证：单测覆盖阻塞累计、恢复重置、热点频率累计、条目有界
- [x] 5.2 分级响应接线 Agent 提案层：blockedTicks 超阈值依次让路（endTickResolve 推开）→ 路径重置 → 任务释放重分配，重试上限入配置；各失败码独立计数不无限重试。验证：单测覆盖阈值逐级升级、上限后释放；热点数据可被查询

## 6. 替补窗口实装

- [x] 6.1 travelP95 样本：UnitRecord 记录 `bornAt→首次到岗` 实测，按 role+room 滚动窗口（有界，参数入配置）；样本不足回退配置估算值。验证：单测覆盖样本累积、P95 计算、窗口淘汰、回退路径
- [x] 6.2 SpawnDirector 替补改造：`replacementLead = spawnTime(body) + travelP95 + 余量`（替换常数 +120）；重叠政策——harvester 在编 overlap ≤1，carrier/upgrader/worker 严格 `alive+inflight < target` 才补。验证：单测覆盖临期提前量随实测收敛、廉价岗位不重叠、关键岗位短暂重叠

## 7. 低频经济模型与指标

- [x] 7.1 每 Tick O(1) 累加器：采集量、交付量、spawn 闲置 tick、关键结构缺货 tick、搬运空跑比例、预留/可用比值（快照差分，入 `Memory.nexus.economy`）。验证：单测覆盖各累加器对快照变化的响应
- [x] 7.2 低频诊断（每 N Tick，P2 门控，参数入配置）：比较生产/交付/库存速率 → 瓶颈分类（运输瓶颈/目的地错配/产能过剩）→ 输出运力目标调整（carrier 目标乘数、配额下限修正），同窗口最多调整一次（迟滞）；预算不足跳过计入降级统计。验证：单测覆盖三类瓶颈判定、迟滞不抖动、预算跳过不影响补给
- [x] 7.3 诊断接入消费端：spawnDirector 读取 carrier 目标乘数，quota 读取下限修正；docs/nexus-design/06 §6.8 六项指标汇总进 HUD 新增行 + 控制台查询（含更新时间）。验证：单测覆盖消费端读取；HUD 渲染冒烟

## 8. 集成与 Phase 2 验收

- [x] 8.1 注册全部新模块（变体开关默认启用、禁用零成本验证）并核对 Tick 阶段顺序：ledger→planners→model→reconcile→spawn→agents→commit。验证：`npm run typecheck` + `npm test` 全绿；禁用新模块时 Phase 1 行为不回退（回归测试）
- [x] 8.2 上传 local 变体冒烟：v2→v3 迁移执行、Source 容器规划落地、haul 任务带目的地、替补提前量生效。验证：控制台核对迁移日志、容器站点出现、任务字段与 HUD 指标行
- [ ] 8.3 数千 tick soak：采集/运输吞吐 vs 设定目标、spawnIdleTicks 无长期闲置、Memory 占用曲线平稳（账本/热点/样本均有界）、拥堵分级响应生效。验证：HUD/遥测 + 控制台零未捕获异常，对照 docs/nexus-design/14 Phase 2 验收清单逐项通过
