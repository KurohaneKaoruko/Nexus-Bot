# Design

## Context

- 现状：docs/ 设计文档完整；`plugins/`（rolldown 上传插件、sourcemap 整理、本地客户端复制）、`scripts/`（交互式提交 `submit.js`、密钥读取 `secret.js`）已存在；`.secret.json` 的 `branches` 表已约定「分支名 → 入口路径」（`main → ./src/main.ts`，`local/race/stronghold → ./src/branch/<variant>/main.ts`），`submit.js` 以 `DEST`/`VARIANT`/`BRANCH` 环境变量把目标交给 rolldown。`src/` 为空，无 `package.json` 与构建配置。
- 约束：docs/api/01 §1.4 严格 TS 策略（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等，游戏侧类型仅 `screeps`，不引入 DOM/Node）；docs/api/03 内核契约（TickContext / CpuBudget / ErrorHandler / TickScheduler）；docs/nexus-design/04 §4.4 迁移流程；docs/nexus-design/12 性能预算。既有脚本为 ESM（`import` / `import.meta.url`），故 package.json 需 `"type": "module"`。
- 用户准则：高内聚低耦合、简洁优美、避免过度工程化与不必要抽象、保持高性能。

## Goals / Non-Goals

**Goals:**

- 最小可编译、可上传、空房间稳定运行的内核骨架（Phase 0 验收全项）
- 分支变体入口与模块开关两个横切机制（机制一次做对，后续变体零成本接入）
- Memory v1 schema + 逐版本迁移框架（含失败降级）
- 纯函数单元测试基建

**Non-Goals:**

- 不实现感知/任务/经济/防御等业务模块；未到阶段的阶段允许零模块空跑，不建空 stub 文件
- 不改既有 `plugins/`、`scripts/` 的对外行为，仅被新配置引用
- 不引入事件总线、DI 框架、原型补丁
- 不做 RawMemory segments、跨 Shard、高级遥测面板

## Decisions

1. **构建管线：`tsc --noEmit`（类型门禁）+ `rolldown -c`（转译打包）**。rolldown 不做类型检查，类型门禁由 tsc 承担，二者串联为 `build` 脚本；`submit` 链路复用 `scripts/submit.js`。备选：仅 rolldown（无类型门禁，违反 docs/api/01）、仅 tsc 多文件输出（上传模块多、无 tree-shaking）。路径约定：`@/` 绑定 `src/`（tsconfig paths + rolldown alias），源码内避免相对路径。
2. **变体解析：环境变量 `VARIANT` → 入口表**。`rolldown.config.js` 读 `VARIANT`（缺省 `main`），按 `<variant> → src/branch/<variant>/main.ts` 解析入口；入口缺失时抛出带可用变体列表的明确错误。变体的模块开关配置放代码内（`src/branch/<variant>/profile.ts`），不放 `.secret.json`：开关影响运行时行为、需版本管理与评审；`.secret.json` 只承载部署目标与凭据且不入库。
3. **模块开关：注册期过滤**。调度器注册模块时按变体 profile（`Record<string, boolean>`，缺省启用）过滤，禁用模块不注册 → 每 Tick 零成本（优于运行期逐 Tick if 判断）；禁用模块在遥测中保留 disabled 计数以便排障。
4. **错误隔离与熔断：`runIsolated` + 连续失败计数**。错误边界捕获后分类（DATA / API / POLICY / INVARIANT / UNEXPECTED）、限频上报、返回有定义的失败状态；CPU 经预算器 measure 记录。熔断取最小实现：连续失败 ≥ 5 → 跳过 100 Tick，熔断窗口仅告警一次，成功即清零；状态存进程内存，global 重置自然复位。备选：加权错误预算熔断——Phase 0 无必要。
5. **Memory：`Memory.nexus` + 迁移注册表**。`NexusMemoryV1` 只落 Phase 0 实际用到的最小子集（`schemaVersion`、global 姿态占位、rooms/tasks/units 空表、metrics 计数器），未用字段不建，避免为未来字段付序列化成本。迁移注册表 `MIGRATIONS: PureFn[]`，第 v-1 项把 v-1 升到 v，逐级执行、每级可单测；单级失败 → 仅重置该子系统并限频告警；无法识别版本的整体损坏 → 直接重建最小结构（Phase 0 无关键战略值，docs/nexus-design/04 的「若可控再备份」暂不触发，重建即安全降级）。
6. **日志节流：进程内限频表**。`key（模块+类别）→ 上次输出 tick` 的内存 Map（上限 200 键，超出淘汰最旧），同一 key 默认间隔 ≥ 20 Tick 才再输出。存运行时内存而非 Memory（符合「日志历史不入 Memory」），global 重置后自动重建。遥测高频摘要以 **RoomVisual HUD** 呈现（每 Tick 重绘于首个可见房间），控制台不周期性输出，只保留限频错误/告警与按需查询 `Nexus.metrics()`——避免高频信息挤占控制台关键信息（用户反馈，2026-10-10）。
7. **测试：vitest + `tests/` 目录**。项目 `.gitignore` 已排除 `test/`（单数），故用 `tests/`（不匹配该规则，无需改 gitignore）。优先覆盖：迁移链（含损坏输入）、开关过滤、限频日志、熔断、预算降级。Screeps API 以轻量 stub 注入参数，不改全局原型。
8. **游戏侧入口形态**。`src/main.ts` 与各变体入口只负责组装 profile 并导出 `loop`；内核按 docs/nexus-design/15.1 骨架定义完整阶段顺序，Phase 0 仅 bootstrap / 预算 / 遥测有真实模块，其余阶段零模块空跑——保持阶段契约完整，后续变更逐阶段填模块即可。
9. **上传链内置，不重复造轮子**。`scripts/` 与 `plugins/` 构成完整上传链；错误映射不引入 `source-map` 依赖（约 100KB 包体，违反高性能准则），改为内置 VLQ 解码，带**低桶保护**（bucket < 2000 或 CPU > 80% 跳过映射）与**堆栈缓存**（加界防无界增长）。Creep 命名采用完整角色代号表与 `CODE-HEX` 格式（详见 phase1-room-economy/design.md 决策 9）。
10. **依赖划分**。游戏运行时零 npm 依赖（Screeps 沙盒无 node_modules）；dev 依赖：`typescript`、`@types/screeps`（锁版本、提交 lockfile，docs/api/01 §1.3）、`rolldown`、`vitest`；工具脚本侧依赖既有脚本所需：`screeps-api`、`git-rev-sync`、`shelljs`、`@inquirer/prompts`，以及构建侧 `@types/node`（不进 src 编译范围）。tsc 核心配置只包含 `src/`，scripts/plugins 为 JS 不参与类型检查。

## Risks / Trade-offs

- [rolldown 产物与 Screeps 沙盒的兼容性（模块包裹、格式）] → 产物为单文件 `main.js`（IIFE），先在 sim/私服烟雾验证；既有上传插件与 sourcemap 链路已按 `main.js + main.js.map.js` 设计。
- [`exactOptionalPropertyTypes` 等严格标志与 `@types/screeps` 摩擦] → 按 docs/api/01 要求记录每一次调整理由，不静默开启 `skipLibCheck`。
- [限频表 / 熔断状态在 global 重置后丢失] → 重置后自动重建，退化表现为短暂多打日志，可接受且符合简洁原则。
- [变体入口文件遗漏导致提交失败] → 构建期明确报错并列出可用变体；新增分支时同步建 `src/branch/<variant>/` 入口即可。
- [`@inquirer/prompts` 交互在 CI 不可用] → 提交脚本已支持参数直选（`服务器@账号` + `--branch`），非交互场景走参数。

## Migration Plan

- 首次上线：`build` → 提交 sim/本地私服验证空房间稳定运行 → 提交 test 分支 soak → main。每步均可用既有提交脚本按服务器[@账号]分支直达。
- 回滚：分支级回滚 = 向目标分支重新上传上一稳定 bundle；Memory 侧 schemaVersion 固定为 1，新旧代码互读兼容，回滚不引发迁移。

## Open Questions

- `race` / `stronghold` 变体的模块开关组合待对应私服规则确定后再定；机制已支持，Phase 0 仅落 `main` 与 `local` 的最小差异。
