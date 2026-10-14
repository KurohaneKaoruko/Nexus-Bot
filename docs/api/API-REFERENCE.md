# EX-MACHINA NEXUS — API 参考手册

**版本**：1.0.0  
**适用模式**：官方 Screeps: World（持久化 MMO）  
**文档基线日期**：2026-10-10  
**语言/类型系统**：TypeScript；Screeps 运行时 API 以目标服务器为准  
**状态**：自定义架构 API 契约 + 官方原生 API 导航；不是将官方所有原生类逐条复制的 API Reference 镜像。

## 重要声明：如何最大限度避免 API 错误

任何离线文档都不能保证“开发绝对不会出错”：运行时版本、私服 mod、API 定义更新、游戏状态变化及策略错误都可能产生问题。本手册采用更可靠的做法：

1. **官方原生 API 的最终依据**是 [Screeps API Reference](https://docs.screeps.com/api/)、对应的游戏机制文档，以及目标服务器实际版本。
2. **TypeScript 类型检查依据**是项目锁定的 `@types/screeps` 版本。本文编写时 npm 页面列出的版本为 `3.4.0`；新项目应先核对 [npm 当前版本](https://www.npmjs.com/package/@types/screeps)，然后保存 `package-lock.json`，不要每次构建都解析浮动版本。
3. **本文定义的项目模块 API**是 EX-MACHINA NEXUS 内部接口契约。实现必须满足契约，并通过模拟测试、目标服务器测试和长期运行测试。
4. **类型正确不等于运行时成功**。类型系统不能证明目标拥有权、距离、冷却、容量、RCL、资源余量、Power 条件或行动冲突都成立；调用前检查和返回码处理不可省略。
5. Screeps: Arena、私服、带 mod 的部署环境不能默认等价于官方 World；部署前必须核实环境差异。

## 文档导航

- [API 源头、版本与构建规范](docs/api/01-baseline-and-versioning.md)
- [原生 Screeps API 分类目录与使用契约](docs/api/02-native-api-surface.md)
- [Kernel、TickContext、CPU 与错误边界](docs/api/03-kernel-runtime.md)
- [Memory、迁移、Perception 与 World Model](docs/api/04-persistence-world-model.md)
- [TaskBoard、任务租约与 Allocator](docs/api/05-task-allocation.md)
- [Agent、ActionPlan 与 ActionBroker](docs/api/06-agent-action-broker.md)
- [经济账本、物流与 Spawn API](docs/api/07-economy-spawn.md)
- [导航、战斗、扩张、工业 API](docs/api/08-navigation-combat-industry.md)
- [错误码、重试策略与不变量](docs/api/09-errors-and-invariants.md)
- [TypeScript 项目级契约声明](docs/api/contracts.ts)
- [验收、测试和发布清单](docs/api/10-test-and-release-checklist.md)

## 架构文档导航（非 API，但为协作必需）

- [总体架构、模块职责与 Tick 生命周期](03-system-architecture.md)
- [智械连结：分层架构落地与扩展契约](19-智械连结扩展.md)
- [**智能连结集群：架构、接口与进度**](20-智能连结集群.md) — 集群层唯一权威（`SquadRequest` / `SquadRecord` / 槽位任务约定）
- [**多 Agent 并行协作规范**](21-multi-agent-collaboration.md) — 单一事实源、接口冻结、交接协议、DoD

## 控制台查询入口（运行时）

| 入口 | 返回 | 说明 |
|---|---|---|
| `Nexus.metrics()` | 遥测摘要（模块 CPU/跳过/错误） | 排障首选 |
| `Nexus.economy()` | 经济指标快照 | 上一 Tick |
| `Nexus.strategy()` | 战略快照（姿态/驻留/节流/转移计数） | 上一 Tick |
| `Nexus.defense()` | 防御快照（威胁分/分级/战损/塔能耗） | 上一 Tick |
| `Nexus.cluster()` | 编队快照（编队数 + 每队就位进度） | 上一 Tick |
| `Nexus.modules()` | `{ enabled, disabled }` 模块名 | 变体开关核对 |

## 设计边界

- 文中 `NexusCore`、`TaskBoard`、`Allocator`、`ActionBroker` 等均为**自定义 Bot 代码接口**，不是 Screeps 全局对象。
- `Game`、`Memory`、`RawMemory`、`PathFinder`、`Creep`、`Room`、`Structure*`、`Store` 等才是 Screeps 原生 API。
- 不要发明原生属性或复制网上旧教程的魔法数字；优先使用类型定义、Screeps 常量和实时对象属性。
- 不要把本文示例视为已实现的全功能 Bot。接口可以作为开发合同，但具体模块需要实现并测试。
