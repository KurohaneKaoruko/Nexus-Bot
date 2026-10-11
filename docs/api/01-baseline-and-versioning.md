# API-01：API 源头、版本与构建规范

## 1.1 目标

本章规定开发时“哪个来源说了算”，以及如何在编译、测试和部署中降低接口不匹配风险。任何具体 API 有争议时，必须按以下优先级核验：

1. 目标服务器当前暴露的 Screeps API / 游戏内 API 文档。
2. [官方 API Reference](https://docs.screeps.com/api/) 对应对象和方法。
3. [Screeps 官方文档仓库](https://github.com/screeps/docs) 中对应 API 源文件或机制说明。
4. 锁定版本的 [`@types/screeps`](https://www.npmjs.com/package/@types/screeps) 类型定义。
5. 本文的架构契约与示例。
6. 社区帖子、旧代码和教程只能用作线索，不能凌驾于以上来源。

若 1–4 之间存在差异，不要自行“挑一种能编译的写法”；创建一个最小验证，确认目标服务器行为并记录环境差异。

## 1.2 官方文档主要入口

| 主题 | 权威入口 | 用途 |
|---|---|---|
| 完整对象/方法/属性 | [API Reference](https://docs.screeps.com/api/) | 查类、属性、方法、参数、返回值和常量 |
| Tick 状态与结算 | [Game loop](https://docs.screeps.com/game-loop.html) | 理解对象快照、行动意图及 Tick 边界 |
| 同 Tick 动作冲突 | [Simultaneous actions](https://docs.screeps.com/simultaneous-actions.html) | 构建 ActionBroker 的冲突规则 |
| 全局对象与记忆 | [Global Objects](https://docs.screeps.com/global-objects.html) | `Game`、`Memory`、对象持久化边界 |
| CPU 与 Bucket | [CPU limit](https://docs.screeps.com/cpu-limit.html) | 配置预算、延迟任务和降级模式 |
| Creep 身体与寿命 | [Creeps](https://docs.screeps.com/creeps.html) | BodyFactory、能力画像、替补 |
| RCL/GCL | [Control](https://docs.screeps.com/control.html) | 建筑限制、领土与 Controller 规划 |
| 防御 | [Defense](https://docs.screeps.com/defense.html) | Tower、Safe Mode、Rampart 等 |
| 资源与工业 | [Resources](https://docs.screeps.com/resources.html) | Lab、资源、Factory 等玩法 |
| 市场与 Terminal | [Market](https://docs.screeps.com/market.html) | 交易、费用、交易能源与冷却 |
| TypeScript 工程起点 | [screepers/screeps-typescript-starter](https://github.com/screepers/screeps-typescript-starter) | 构建、打包与部署流程 |
| TypeScript 声明包 | [@types/screeps](https://www.npmjs.com/package/@types/screeps) | 编译期 API 约束 |

## 1.3 版本锁定

建议在新工程初始化时执行并提交 lockfile：

```bash
npm install --save-dev typescript @types/screeps
npm install
npm ls typescript @types/screeps
```

本文记录到的 `@types/screeps` 版本快照是 `3.4.0`，但版本会更新。不要把本行视为永远最新的声明包版本。若工程需要重现本文编写时的基线，可显式安装 `@types/screeps@3.4.0`；若使用更新版本，应先运行完整测试并记录升级理由。

推荐规则：

- 提交 `package-lock.json`，CI 使用 `npm ci`，避免不同开发机器安装不同依赖版本。
- TypeScript 使用明确版本，不依赖“永远最新”。
- 不要在 `tsconfig.json` 中绕开严格类型检查来消除错误。
- 不要随意增加 `@types/node` / 浏览器 DOM 类型；Screeps 沙盒不是普通 Node 或浏览器运行环境。确实需要构建工具类型时，把工具侧代码与游戏运行时代码分开编译。
- 自定义扩展只能通过项目命名空间或合法的 declaration merging 添加，不能伪造游戏运行时属性。

## 1.4 推荐的 TypeScript 严格策略

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": false,
    "types": ["screeps"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

这是一份严格策略示例，必须与当前 bundler、TypeScript 和 `@types/screeps` 版本验证后使用。若某个类型包自身存在兼容性问题，不能未经记录就将 `skipLibCheck` 打开并宣称检查已完整。

## 1.5 版本升级程序

每次升级 Screeps API 类型包或部署环境：

1. 记录原版本、新版本和服务器目标。
2. 搜索 release notes、官方 API Reference 与相关类型变更。
3. 执行 `npm ci`、类型检查和全部单元测试。
4. 对 Spawn、Creep 行动、Store、PathFinder、Terminal、Market、Tower、Safe Mode 和 Power 进行最小集成测试。
5. 用 Simulation / 私有测试房间做短期烟雾测试，再进行长时间低风险测试。
6. 验证 CPU、Memory 和任务失败率没有异常。
7. 将确认过的变化写入 `CHANGELOG.md` 和环境兼容矩阵。

## 1.6 明确不做的事

- 不把 API 返回的对象引用存进 `Memory`；保存 ID 和 JSON 兼容数据。
- 不通过 `as any` 把错误强行压过去。
- 不认为方法返回 `OK` 就代表资源已经在当前 JS 快照里更新。
- 不把某个社区 Bot 使用的私有常量、原型补丁或 mod 当作官方功能。
- 不把 World API 文档当作 Arena API 文档。
