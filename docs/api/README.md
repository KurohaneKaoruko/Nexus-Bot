# API 文档子目录

这是 EX-MACHINA NEXUS 自定义架构的 API 契约。原生 Screeps API 的逐项定义应以 [官方 API Reference](https://docs.screeps.com/api/) 和当前锁定的 `@types/screeps` 为准。

阅读顺序：

1. `01-baseline-and-versioning.md`
2. `02-native-api-surface.md`
3. `03-kernel-runtime.md`
4. `04-persistence-world-model.md`
5. `05-task-allocation.md`
6. `06-agent-action-broker.md`
7. `07-economy-spawn.md`
8. `08-navigation-combat-industry.md`
9. `09-errors-and-invariants.md`
10. `10-test-and-release-checklist.md`
11. `contracts.ts`（项目级 TypeScript 合同草案）

> 注意：`contracts.ts` 是架构接口定义草案，不是包含所有实现、能单独部署的 Bot。应放在实际工程后由锁定版本的 Screeps 声明包编译验证，并按项目实现调整。
