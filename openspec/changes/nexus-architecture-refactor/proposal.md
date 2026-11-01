# Proposal: nexus-architecture-refactor

## Why

四篇新审计文档（`docs/Nexus-Bot-01-架构设计.md`、`02-重构指导.md`、`03-BUG清单.md`、`04-架构设计与重构指导.md`）判定：当前 Nexus-Bot 的问题不是"没有架构"，而是**新旧两套系统仍同时持有游戏状态的突变控制权**。源码实测：约 250+ 处直接突变调用绕过 ActionBroker——legacy prototype 角色库 ~115 处、teams ~45 处、economy/units ~70 处、planner 12 处直接 `createConstructionSite`、spawning 6 处直接 `spawnCreep`、market/terminal 10 处，连 visuals 模块都会 `spawning.cancel()`；broker 根本没有 spawn/建造/market/claim/PowerCreep 五条管线；Movement 通过原型猴补丁自成第二突变边界；`agentSystem.ts` 内还有绕过 broker 的直接 `claimController`/`reserveController`（文档 03 BUG-001/002/003 的实证）。同时 `docs/bugs` 存在未修复的 P0-16/P1-17/18/19 等缺陷，正在放大这些结构性问题。本变更把四篇文档定义的 Phase 0–15 全量重构程序落成单一可执行、可并行推进的总览变更。

## What Changes

- 建立 **Actor Ownership** 机制（acquire/release/ownerOf/assertOwner），实现"一个 Actor 一个 owner"，分三阶段落地（记录 → 告警 → 拦截）。
- 把 ActionBroker 升级为**全局唯一 mutation boundary**（Validation → Ownership Check → Conflict Resolution → Execution），修正 ActionResult 语义（内部原因与原生返回码分离）。
- Movement 收口：Agent 提交 MoveIntent，经 MovementAdapter 执行；直接 `moveTo` 只允许出现在移动适配层。
- TaskBoard 增加 **TaskIndex**：按 room/kind/state/assignee 的近似 O(1) 查询，无 stale index。
- 统一 Agent 控制平面：Task → Agent FSM → Intent 单路径，按配置分阶段关闭 legacy actor execution。
- Planner 只产生 ConstructionIntent；建造放量与 worker 吞吐联动。
- Spawn 拆分为 Demand Sources / SpawnArbiter / BodyFactory / SpawnQueue；`directSpawn` 改造为 emergency SpawnRequest；UnitDefinition 作为角色唯一定义源。
- Economy 统一 **ResourceLedger**：Observed / Available / Reserved / Committed / Consumed 五态分账。
- Defense 变 demand generator；Teams 变 adapter；Industry 逐子系统 adapter 化；Expansion / InterShard 纳入命令边界。
- **Legacy Removal 门禁**：Nexus 等价 + 生产验证 + sim 验证 + CPU 验证四条件齐备才允许删除旧实现。
- 建立**架构守护**：检查脚本禁止新增 direct Game mutation（allowlist 收敛制）。
- **并行缺陷轨道**：`docs/bugs` 未修复缺陷（P0-16a/b/c → P1-17 → P1-18 → P1-19/P2-20，以及 role-registry-executor-gap、race-strategy-port 分波）与重构轨道并行修复——项目所有者已确认此并行推进节奏。
- 生产硬化：场景门回归线（speedrun 分段门、sprint、remote-mine、arena）、生产级不变量监控、分阶段实服落地。

**BREAKING**：legacy prototype 角色执行入口按阶段关闭；Memory 结构迁移依赖 schemaVersion + migration 兜底；`directSpawn` 调用方需改造为 SpawnRequest。

## Capabilities

### New Capabilities

- `actor-ownership` — Actor 所有权：一个 Actor 一个 owner、租约、死亡释放、冲突拦截
- `command-boundary` — 全局唯一突变边界：命令管线、所有权校验、legacy Adapter、架构守护、MoveIntent 统一入口
- `task-index` — 任务事实源索引与生命周期完整性
- `agent-unification` — Agent 单一控制平面与角色判定以 Memory 为准
- `construction-intents` — Planner 意图化与建造吞吐联动
- `spawn-arbiter` — 孵化管线单源决策与孵化中名单可见性
- `resource-ledger` — 资源五态账本与预订释放
- `combat-demand-adapters` — Defense 需求化与 Teams Adapter 化
- `industry-expansion-adapters` — Industry / Expansion / InterShard 命令化
- `legacy-removal-gate` — 旧实现删除四条件门禁
- `production-hardening` — 场景门回归线、不变量监控、实服落地

### Modified Capabilities

（无——主 specs 现仅 `cluster-squad`，其"编队不直接指挥单位"的既有约定与本变更方向一致，不需修改。）

## Impact

- **代码**：`src/modules/agents`（broker 升级+五条新管线）、`src/runtime`（新增 actorOwnership/actorRegistry）、`src/modules/{planner,spawning,teams,industry,external,economy,movement,defense,prototype,visuals}`（约 250+ 处直连调用收编）、`src/core`（kernel/state 拆分迁移）、`src/console`（人操命令层的豁免治理）、新增架构守护脚本。
- **缺陷轨道**：`docs/bugs` 未修复项按 sim-audit-2026-10-16 的修复顺序（P0-16 放大器优先）+ role-registry-executor-gap + race-strategy-port 分波（W1/W2）。
- **测试**：sim 场景回归（boot / speedrun 分段门 / sprint / remote-mine / arena / race-body-audit）、RCL 时间线取证钩子、架构守护检查。
- **兼容**：7 个 in-progress OpenSpec change 保持不动；未同步的 phase1 `agent-action` delta 与本变更 `command-boundary` 存在交叠（前者定义 broker 基础管线，后者扩展为全局边界），归档顺序上本变更后行，冲突以本变更为准。
- **基线**：以当前工作区 WIP（含未提交重构与 dist 产物，2026-10-16 sim 审计对象）为重构基线，非 HEAD。
