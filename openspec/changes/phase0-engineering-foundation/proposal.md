# Proposal

## Why

Nexus-Bot（Screeps 机器人）目前只有设计文档（docs/）和一套上传脚本（plugins/、scripts/、.secret.json），还没有可构建、可运行、可恢复的工程。按照 docs/nexus-design/14 路线图，Phase 0「工程地基」是一切后续阶段（经济闭环、防御、扩张）的前提：必须先做到空房间稳定运行、Memory 迁移可重复、单模块异常不拖垮其他模块、构建产物能按目标环境上传。

**范围假设**：「开始项目开发」按 docs/nexus-design/14 推荐优先级从 Phase 0 起步，本次变更不实现任何经济/防御/扩张业务逻辑（Phase 1+ 另立变更）。项目名按用户要求为 Nexus-Bot（目录名 Nexus-Bot 保持不变）。

## What Changes

- 新增 Node 工程：`package.json`（名称 `Nexus-Bot`）、TypeScript 严格配置（docs/api/01 §1.4 严格策略）、依赖与 lockfile
- 新增 `rolldown.config.js`：以 `VARIANT` 环境变量选择分支变体入口，串接既有 `plugins/`（screeps 上传插件、sourcemap 整理、本地客户端复制）
- **分支变体机制**：`.secret.json` 的每个 branch 对应独立 main 入口（`src/main.ts` 或 `src/branch/<variant>/main.ts`），构建与上传目标 branch 同名绑定，实现不同服务器上传不同入口代码
- 新增 `src/` 运行时骨架：`main.ts` 主循环、TickContext、CpuBudget（P0–P3 分级）、模块错误隔离边界（`runIsolated` 限频报告，单模块异常不中断其他模块）
- **模块开关机制**：按分支变体的模块开关配置，禁用的模块不注册、不产生 CPU 成本，用于适配不同私服规则
- 新增 Memory schema（`NexusMemory` v1 + `schemaVersion`）、bootstrap 初始化与逐版本迁移框架（迁移失败安全降级）
- 新增限频日志与最小遥测（模块 CPU 用量、错误统计、预算跳过计数）
- 新增单元测试（Memory 迁移等纯函数优先）与 vitest 测试基建

## Capabilities

### New Capabilities

- `kernel-runtime`: Tick 执行内核——阶段化主循环、TickContext、CPU 预算分级与降级、模块错误隔离、限频日志，以及按分支变体的模块开关（禁用模块零 CPU 成本）
- `memory-persistence`: Memory 持久化——`Memory.nexus` schema 版本化、bootstrap 初始化、逐版本纯函数迁移、迁移失败时的隔离与告警
- `build-deploy`: 构建与部署——rolldown 打包、分支变体入口选择、经既有 scripts/plugins 按服务器/账号/分支上传、sourcemap 处理、凭据不入库

### Modified Capabilities

（无——全新项目，`openspec/specs/` 当前为空）

## Impact

- 新增 `package.json`、`tsconfig.json`、`rolldown.config.js`、`vitest` 配置；`src/` 从零创建
- 运行时依赖：`screeps-api`、`git-rev-sync`、`shelljs`、`@inquirer/prompts`（既有脚本已引用）；开发依赖：`typescript`、`@types/screeps`、`rolldown`、`vitest`
- 既有 `plugins/` 与 `scripts/` 代码保持不动，仅被新构建配置引用
- `.secret.json` 已被 `.gitignore` 排除，凭据不入库
- 游戏侧影响：首次上传后在空房间/初始化状态下稳定空转运行
