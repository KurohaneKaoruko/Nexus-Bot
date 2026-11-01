# API 文档子目录

这是 EX-MACHINA NEXUS 自定义架构的 API 契约。原生 Screeps API 的逐项定义应以 [官方 API Reference](https://docs.screeps.com/api/) 和当前锁定的 `@types/screeps` 为准。

**唯一索引入口**：[API-REFERENCE.md](API-REFERENCE.md)（含版本声明、阅读顺序、控制台查询入口与设计边界）。

本目录文件：

| 文件 | 内容 |
|---|---|
| `01-baseline-and-versioning.md` | API 源头、版本与构建规范 |
| `02-native-api-surface.md` | 原生 Screeps API 分类目录与使用契约 |
| `03-kernel-runtime.md` | Kernel、TickContext、CPU 与错误边界 |
| `04-persistence-world-model.md` | Memory、迁移、Perception 与 World Model |
| `05-task-allocation.md` | TaskBoard、任务租约与 Allocator |
| `06-agent-action-broker.md` | Agent、ActionPlan 与 ActionBroker |
| `07-economy-spawn.md` | 经济账本、物流与 Spawn API |
| `08-navigation-combat-industry.md` | 导航、战斗、扩张、工业 API |
| `09-errors-and-invariants.md` | 错误码、重试策略与不变量 |
| `10-test-and-release-checklist.md` | 验收、测试和发布清单 |
| `contracts.ts` | 项目级 TypeScript 合同草案 |

> 注意：`contracts.ts` 是架构接口定义草案，不是包含所有实现、能单独部署的 Bot。应放在实际工程后由锁定版本的 Screeps 声明包编译验证，并按项目实现调整。
