# Tasks

## 1. 工程脚手架

- [x] 1.1 创建 `package.json`：名称 `nexus-bot`、`"type": "module"`、scripts（`typecheck`/`build`/`test`/`submit`）；安装依赖（dev：typescript、@types/screeps、rolldown、vitest；脚本侧：screeps-api、git-rev-sync、shelljs、@inquirer/prompts），提交 lockfile。验证：`npm install` 与 `npm ls typescript @types/screeps` 成功
- [x] 1.2 创建 `tsconfig.json`：按 docs/api/01 §1.4 严格策略（strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes、types: ["screeps"]，include 仅 src/）。验证：`npx tsc --noEmit` 通过
- [x] 1.3 配置 vitest 与 `tests/` 目录（避开 .gitignore 的 `test/` 规则）。验证：`npm test` 空跑通过

## 2. rolldown 构建与分支变体

- [x] 2.1 创建 `rolldown.config.js`：读 `VARIANT` 环境变量解析入口（缺省 `main → src/main.ts`，命名变体 `src/branch/<variant>/main.ts`），入口缺失时报错并列出可用变体；单文件输出 `dist/main.js` + sourcemap。验证：本地构建缺省变体产出 main.js
- [x] 2.2 串接既有 `plugins/` 插件链：sourcemap 整理（剥 sourcesContent → main.js.map.js）、screeps 上传、本地客户端复制。验证：构建后 dist 含 `main.js` 与 `main.js.map.js`
- [x] 2.3 创建缺省入口 `src/main.ts` 与变体入口 `src/branch/local/main.ts` + 变体 profile（模块开关表，缺省变体全量启用）。验证：`VARIANT=local` 构建以变体入口产出；`VARIANT=notexist` 构建明确报错
- [x] 2.4 验证构建产物不含 `.secret.json` 凭据内容。验证：对 dist/ 产物 grep 服务器凭据字段无命中

## 3. Memory 持久层

- [x] 3.1 定义 `NexusMemoryV1` 最小 schema 与类型（schemaVersion、global 姿态占位、rooms/tasks/units 空表、metrics 计数器）。验证：tsc 类型检查通过
- [x] 3.2 实现迁移注册表与 bootstrap：缺失初始化、逐版本纯函数迁移、单级失败仅重置该子系统、无法识别版本整体重建、全程幂等。验证：`tests/` 单测覆盖首次初始化、重复执行幂等、升级、损坏隔离、整体重建五个场景并通过

## 4. 内核运行时

- [x] 4.1 实现 TickContext 与阶段定义（bootstrap → 感知 → … → 遥测的固定顺序，未实现阶段零模块空跑）。验证：单测断言阶段顺序稳定
- [x] 4.2 实现 CpuBudget：P0–P3 分级 canRun、measure 计量、recordSkip 跳过计数、连续跳过饥饿保护。验证：单测覆盖预算不足降级与饥饿恢复场景
- [x] 4.3 实现错误边界 runIsolated（错误分类、限频上报、不吞错）与最小熔断（连续失败 ≥ 5 跳过 100 Tick、窗口告警一次、成功清零）。验证：单测覆盖异常隔离、重复错误限频、熔断进入与恢复
- [x] 4.4 实现 TickScheduler：注册时按变体 profile 过滤禁用模块（零注册零成本），拒绝重名模块、稳定排序。验证：单测覆盖禁用零成本与变体差异
- [x] 4.5 实现限频日志（key 上限 200、默认间隔 20 Tick）与最小遥测（模块 CPU、错误数、跳过数、控制台可查询），均不落 Memory。验证：单测覆盖限频与 Memory 无日志残留
- [x] 4.6 组装 `loop`：bootstrap → 各阶段调度 → 遥测，模块经 runIsolated 执行。验证：`npx tsc --noEmit` 通过，`npm test` 全绿
- [x] 4.7 Creep 命名工具 `src/utils/naming.ts`：`CODE-HEX`（大写代号 + 连字符 + 大写短十六进制），缩写沿用 既有 完整代号表（`src/constant/RoleConstant.ts`），随机源与占用查询可注入。验证：单测覆盖生成格式、碰撞重试

## 5. 部署与 Phase 0 验收

- [x] 5.1 提交 sim/本地私服烟雾验证：上传成功、空房间初始化状态下主循环稳定运行、控制台遥测摘要可查询且无未捕获异常。验证：游戏控制台观察数千 Tick 无报错
- [x] 5.2 验证 Memory 兼容与迁移可重复：重新上传代码后旧 Memory 不被重置、迁移不重复执行。验证：控制台核对 schemaVersion 与数据留存
- [x] 5.3 对照 docs/nexus-design/14 Phase 0 验收清单逐项核对（空房间稳定、迁移可重复、单模块异常不扩散、按目标环境上传）。验证：四项验收全部通过并记录结果
