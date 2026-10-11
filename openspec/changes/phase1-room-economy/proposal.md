# Proposal

## Why

Phase 0 的内核已上线验证（5000+ tick 稳定、Memory 幂等、模块开关与部署链可用），但主循环里没有任何业务模块——Creep 还不存在，房间不会产出一单位能源。按 docs/nexus-design/14 路线图，Phase 1「单房间生存经济」是游戏的起点：让 Nexus-Bot 在单房间内自动完成采集→搬运→补给→升级→建造的能源闭环，并以任务系统（而非每个 Creep 各自为政）作为后续一切阶段的事实底座。

**范围假设**：
- 一次变更覆盖 docs/nexus-design/14 Phase 1 全部验收项；单房间（RCL 1–2）起步。
- 战斗类任务（defend/attack/heal 等）只在任务类型枚举中占位，不在本次实现（Phase 3）。
- build 任务只针对已存在的 construction site；自动布局规划属 docs/nexus-design/17 的后续变更。
- 资源账本、运输目标配额、固定工作位属 Phase 2，不在本次。

## What Changes

- 新增感知与世界模型：每 Tick 采集可见房间对象摘要（Source/Spawn/Extension/Container/工位/Creep 存活），更新 `RoomIntel` 与新鲜度，发现单位死亡与目标失效
- 新增任务系统：TaskBoard（提案/去重/租约/状态机/reconcile 回收）+ Allocator（CapabilityProfile 硬过滤 → 贪心评分分配，含防抖动阈值与最短持有）
- 新增 Agent 与 ActionBroker：Creep 按租约任务产出 ActionPlan，Broker 按 pipeline 归类校验、冲突仲裁后统一提交，返回码分流（accepted/retryable/replan/invalid）
- 新增 SpawnDirector 与 BodyFactory：从「无法分配的任务」聚合能力缺口 → SpawnRequest → 模板身体 → 生产队列；替补窗口（spawnTime + travel）；Creep 死亡后释放租约、回收任务
- 新增经济任务源：harvest/haul/fill_spawn/upgrade/build 五类任务的生成、去重（`kind:room:targetId`）与优先级政策（Spawn 补给 > 采集 > 建造/升级），关键结构缺货自动纠正
- Memory schema v1→v2：tasks/units 记录实装（正式启用迁移注册表，dogfood 迁移链路）
- 调度器接入全部新模块（经变体开关），HUD 增加任务/劳动力/Spawn 状态行

## Capabilities

### New Capabilities

- `room-perception`: 每 Tick 观测可见房间并维护世界模型——对象摘要、Intel 新鲜度与置信度、单位死亡与目标失效的发现（docs/nexus-design/04、docs/nexus-design/03 §3.3 Perception/World Update 阶段）
- `task-system`: 任务黑板与分配器——任务生命周期状态机、去重键、租约与进展检测、失效回收（reconcile）、能力画像硬过滤与贪心评分分配、防抖动（docs/nexus-design/05、api/05）
- `agent-action`: 行动提案与统一提交——Agent 按任务产出 ActionPlan，ActionBroker 按行动管线校验/仲裁/提交并分流返回码；杜绝绕过 Broker 的原生调用（api/06）
- `spawn-director`: 能力缺口驱动的生产——缺口聚合、BodyFactory 模板、生产排程与替补窗口、UnitRecord 生命周期与死亡回收（docs/nexus-design/07、api/07）
- `room-economy`: 单房间能源闭环的任务源与政策——harvest/haul/fill_spawn/upgrade/build 任务的生成与优先级、关键结构缺货纠正（docs/nexus-design/06 §6.2–6.4）

### Modified Capabilities

（无——phase0 的能力尚未归档到 `openspec/specs/`，本变更不改动其需求）

## Impact

- `src/` 新增：`modules/world/`（感知）、`modules/economy/`（任务源）、`modules/tasks/`（TaskBoard/Allocator）、`modules/agents/`（Agent/Broker）、`modules/spawning/`（SpawnDirector/BodyFactory）；`src/store/` schema v2 + 首个迁移函数
- `Memory.nexus` 首次承载 tasks/units/rooms 实数据；对既有 v1 数据执行一次真实迁移（私服已验证幂等路径）
- HUD 遥测扩展：任务数（按状态）、Creep 数（按角色代号）、Spawn 队列/闲置
- 测试显著增加：任务状态机与租约、去重、分配防抖、Broker 冲突与返回码、BodyFactory 预算边界、死亡回收端到端
- 运行时依赖不变（零 npm 依赖）；CPU 基线上升（感知聚合 + 任务 reconcile），需在 HUD 观察 P1/P2 占比
