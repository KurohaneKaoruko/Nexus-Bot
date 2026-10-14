# 智能连结集群（编队层）

## 背景

docs/nexus-design/19 定义了「智械连结」的分层智能（战略 → 指令 → 局部规划 → 遥测），并把「集群」（多 Creep 协作编队）列为 Phase 3+ 的扩展位。当前缺失：

- 防御系统有 `ThreatModel` / `planners` / `towerControl`，但**没有任何模块装配入口**（代码注释引用的 `defense/index.ts` 不存在），威胁观测从未被调用，`rooms[].threat` 恒为空 → war 姿态永远不触发、防御任务永不生成。
- 高强度威胁下只有一条 `defend` 任务，无法组织多单位协同。
- 缺少「需求方声明协作需求 → 机制组织并维持编队」的通用契约。

## 目标

1. 补齐防御系统装配（emergency 阶段：观测 → 任务 → 塔 → 统计）。
2. 引入集群层：编队生命周期（建队/续期/解散）+ 槽位任务维持，**不改动** TaskBoard / Allocator / AgentSystem / ActionBroker 的既有不变量。
3. 明确「需求方（职能系统）」与「执行形态（集群机制）」的接口契约，使后续编队类型（外矿/工业）可零改动集群模块接入。

## 非目标

- 编队内领队战术（集火/拉扯）——见 docs/nexus-design/20 §20.7.2 待办 C4。
- 异构槽位（不同槽位不同能力/任务种类）——待办 C3。
- 外矿协作组（`SquadKind = "remote"`）——待办 C5。
- 任何未经 sim/私服验证的性能结论。

## 范围

| 类别 | 文件 |
|---|---|
| 存储 | `src/store/memorySchema.ts`(v6)、`migrations.ts`、`runtime.ts`、`bootstrap.ts` |
| 配置 | `src/config/cluster.ts`、`src/config/defense.ts`、`src/config/economy.ts` |
| 集群 | `src/modules/cluster/{model,index}.ts` |
| 防御 | `src/modules/defense/index.ts`(新增)、`planners.ts` |
| 单位层 | `src/modules/agents/{index,sharedBroker,agentSystem}.ts`、`src/modules/spawning/spawnDirector.ts` |
| 装配/观测 | `src/modules/index.ts`、`src/core/boot.ts` |
| 测试 | `tests/cluster/*`、`tests/defense/module.test.ts` 及既有测试更新 |
| 文档 | `docs/nexus-design/20-智能连结集群.md`、`CONTRIBUTING.md`、docs/nexus-design/03、docs/nexus-design/14、docs/nexus-design/19、docs/api/API-REFERENCE.md、docs/bugs/* |

## 影响与风险

- **Memory schema v5 → v6**：新增 `squads` 子系统。迁移为纯新增（补空表 + 清洗不合规条目），可重复执行，旧数据零丢失。
- **防御模块首次接入 Tick 循环**：在无敌人的场景下为纯 no-op（威胁分 0 → 无任务无塔行动）；有敌人时行为变化较大，需 sim/私服验证。
- **高强度威胁的 defend 任务来源变更**：由规划器直接建单任务改为编队槽位任务。低强度路径保持不变。
- **产物体积**：`dist/main.js` 247.85 kB → 277.59 kB（+12%，防御装配 + 集群层 + 观测）。
