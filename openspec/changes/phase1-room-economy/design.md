# Design

## Context

Phase 0 内核已上线（`core/` 调度、`store/` Memory 引导、`config/` 变体开关、HUD、rolldown 部署链），主循环目前零业务模块。本变更按 docs/nexus-design/03 §3.3 Tick 流程填入感知→规划→对账→生产→执行→提交的全部业务段，契约以 docs/nexus-design/05–08 与 api/05–07 为准。用户准则不变：高内聚低耦合、简洁、避免过度工程化、高性能。

## Goals / Non-Goals

**Goals:**

- docs/nexus-design/14 Phase 1 验收全项：能源闭环自动运行、无重复无限任务、死亡回收、缺货自愈、无抖动停摆
- 任务系统成为唯一事实源，后续阶段（防御/扩张/工业）只加任务源与能力，不改架构
- Memory v1→v2 真实迁移（tasks/units 实装），dogfood 迁移注册表

**Non-Goals:**

- 资源账本、运输配额、固定采集工作位、EconomyModel 低频估算（Phase 2）
- 战斗/防御/远程/布局（docs/nexus-design/17）/PowerCreep；战斗任务 kind 仅占位
- 自定义寻路缓存与交通管理（Phase 2，docs/nexus-design/08）；本期用原生 `moveTo`
- 多房间、跨 Shard

## Decisions

1. **模块划分与注册**。`src/modules/world/`（感知）、`src/modules/economy/`（五类任务源）、`src/modules/tasks/`（TaskBoard + Allocator）、`src/modules/agents/`（AgentSystem + ActionBroker）、`src/modules/spawning/`（SpawnDirector/BodyFactory）。注册进既有 `TICK_PHASES`：perception=感知，planning=任务源，reconcile=对账+分配，spawn=生产，agents=行动提案，commit=Broker 提交；全部经变体 profile 开关，禁用零成本（复用 Phase 0 机制）。
2. **观测快照走 TickContext**。感知一次聚合 `FIND_SOURCES/STRUCTURES/CREEPS/CONSTRUCTION_SITES` 为纯数据摘要，经 `ctx.world: WorldView` 下发（ID+数字，不存 API 对象）；下游读快照不重复 `find`。替代方案：各模块自扫——CPU 重复，违反 docs/nexus-design/03 §3.4。
3. **任务持久化为 DTO**。`Memory.nexus.tasks: Record<id, NexusTask>`（api/05 §5.2 字段），执行 Tick 用 `Game.getObjectById` 解析目标；每 Tick 由 reconcile 建 dedupeKey 索引。闭包/实例不入任务（api/05 §5.7）。
4. **Memory v1→v2 dogfood**。v2 实装 `tasks`（NexusTask）与 `units`（name/roleCode/homeRoom/bornAt/lastTaskChange）字段形状；`migrateV1ToV2` 为空表补默认结构。既有私服 v1 数据会真实走一次迁移链，验证 Phase 0 的迁移框架。
5. **任务源是纯函数**。每个 planner `(ctx, world, board) => upsert/cancel`：harvest（容量=Source 相邻可行走格数）、haul（容器/落地能量→Spawn/Extension 缺口）、fill_spawn（供能结构缺量）、upgrade（常驻单任务）、build（工地存在性驱动）。缺货纠正 = fill_spawn/haul 优先级高于 build/upgrade（docs/nexus-design/06 §6.2 政策序）。
6. **Allocator 两段式贪心**。CapabilityProfile 由身体计算（按 creep 名当 Tick 缓存）；硬过滤（部件/spawning/TTL/容量/房间）→ 评分权重沿用 api/05 示例并集中配置；防抖动 = 切换需评分优势超阈值或 criticality 抢占 + 最短持有（docs/nexus-design/05 §5.7）。规模 ≤ 20 creep，不引入二分图匹配。
7. **行动管线最小集**。Phase 1 仅 `move/work/carry/controller` 四管线；同 actor 同管线留最高优先级计划，跨管线并行；返回码分流表按 api/06 §6.6（OK→accepted，ERR_NOT_IN_RANGE→retryable，ERR_INVALID_TARGET/ERR_FULL→replan，其余 invalid 限频）。`moveTo` 为移动计划的执行体（Phase 2 再上 PathCache）。
8. **SpawnDirector/BodyFactory**。模板表（universal/harvester/carrier/worker/upgrader × min/std/max 三档，RCL1–2 预算 300–800）；缺口聚合自未分配任务的 `requiredCapabilities`；替补 lead = `3×部件数 + 旅行估算 + 余量`；队列按房间，purpose 去重；命名走 `utils/naming`（`H-3F2A` 风格）；UnitRecord 入 `Memory.nexus.units`，死亡由感知信号触发回收（api/05 §5.7、docs/nexus-design/07 §7.6）。
9. **测试策略**。TaskBoard 状态机/去重/租约/对账（注入 now 与存活表）、Allocator 过滤与防抖、Broker 管线仲裁与返回码分类（stub Creep 记录调用并断言「提交外零原生调用」）、BodyFactory 预算边界、v1→v2 迁移、死亡回收端到端；私服冒烟验收闭环。
9a. **目录约定对齐 RosmarinBot**（用户反馈）：常见 conventional 文件夹名以便 IDE 显示图标——`src/modules/world|economy|tasks|agents|spawning/`（业务模块）、`src/core/`（内核）、`src/store/`（持久层）、`src/config/`、`src/constant/`、`src/utils/`、`src/visuals/`、`src/branch/<variant>/`。
9b. **大件模块整体挪用**（用户反馈）：① **BetterMove 移动优化**（137KB vendor 库：creep.moveTo 原型增强、跨房寻路、交通疏导、卡死恢复）整体移植到 `src/modules/movement/`，保持 `@ts-nocheck` 与上游一致；接线为 commit 前 `preTickBetterMove()`、提交后 `endTickResolve(isWorkTile)`（持任务且与 Source 相邻的采集工视为工作位不被推开）。② **RoomVisualExtension**（自包含绘制助手）移植到 `src/visuals/`，Phase 1 用于 Spawn 生产进度标注。③ 工具函数按需挑拣（GenCreepName 已适配为 `utils/naming.ts`）。
10. **CPU 纪律**。感知一次聚合、reconcile O(任务数)、分配 O(任务×候选) 且候选先硬过滤；任务源在预算紧张时可降频（`canRun(P2)` 天然门控）；HUD 增加任务/劳动力/Spawn 行并观察 P1/P2 占比。

## Risks / Trade-offs

- [首启从零起步（无 Spawn 供能）] → universal 模板按可用能量降级到最小体（1W1C1M, 200 能量），先跑通闭环再扩编
- [官方同时行动规则与假设不符] → Phase 1 仅用 move/work/carry/controller 四条规则明确的管线，并按 api/06 要求对规则写测试；后续管线逐个验证
- [任务抖动导致无产出] → hysteresis + 最短持有 + `completedPer100Ticks`/切换次数进 HUD，验收项直接覆盖
- [v2 迁移首次真实执行] → 迁移函数单测 + 迁移前私服 Memory 可导出备份；回滚路径已由 Phase 0 验证
- [贪心分配局部最优] → 规模小时影响有限，指标观察；Phase 2 按数据决定是否升级匹配算法

## Migration Plan

- 构建 → 上传 xx-local（存量 v1 Memory 自动迁移 v2）→ 确认迁移日志与数据 → 放置出生 Spawn → 观察 universal 起步→分工扩编→能源闭环 → 数千 tick soak → 对照 docs/nexus-design/14 Phase 1 验收。
- 回滚：重传 Phase 0 bundle（v2 Memory 由 v1 代码降级运行，Phase 0 已支持）；或清理 `Memory.nexus.tasks/units` 重启闭环。

## Open Questions

- 无阻塞项；固定采集工作位坐标、Container 摆放时机等属 Phase 2 范畴，届时按 docs/nexus-design/06/17 另立变更。
