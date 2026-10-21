# Nexus-Bot

```text
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗    ██████╗  ██████╗ ████████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝    ██╔══██╗██╔═══██╗╚══██╔══╝
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗    ██████╔╝██║   ██║   ██║
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║    ██╔══██╗██║   ██║   ██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║    ██████╔╝╚██████╔╝   ██║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═════╝  ╚═════╝    ╚═╝
```

Screeps 自动化 Bot。一个具备**集体感知、统一世界模型、任务化调度、分层自治、统一行动仲裁、持久记忆**的自动化文明：集体决定目标，个体只负责执行；知识属于文明而不属于单个 Creep；Creep 死亡不导致知识死亡；失视、断网、CPU 紧张时系统降级运行而不崩溃。

- 语言 / 运行时：TypeScript（strict + verbatimModuleSyntax），Node ≥ 20，构建产物为单文件 `dist/main.js`
- 构建：rolldown；测试：node:test + screeps-sim；静态检查：oxlint / oxfmt / 架构守护脚本
- 状态：开发中（`dev` 分支），架构以 `docs/` 设计文档为唯一权威

## 架构总览

设计蓝本与工程约束见 `docs/Nexus-Bot-01-架构设计.md`（目标架构权威）与 `docs/nexus-design/`（各专题设计）。核心抽象链：

```
Screeps World
  → Perception（感知）
  → World Model（世界模型，唯一事实源）
  → Strategy（战略姿态与指令）
  → Cluster / Planner（局部规划，拆解为任务）
  → Task Board + Allocator（任务黑板与分配）
  → Agent（单机体执行，产生行动提案）
  → ActionBroker（仲裁冲突、统一提交）
  → Screeps 原生 API
  → 下一 Tick 的观测回流
```

三条控制原则：

1. **控制链单向**：上层只能对下层设目标与约束，反馈只经结果通道（ActionResult / 失败原因 / 速率）回流修正下一轮规划。
2. **观测与命令分离**：所有"改变游戏状态"的原生调用（move/attack/build/spawnCreep/createFlag…）收编到 ActionBroker 一个出口，由架构守护脚本强制（见下文"架构守护"）。
3. **单一写入方**：每份持久数据有唯一主要写入方（房间快照归感知、姿态归战略、任务归任务系统、账本归经济……），写入方表见 `docs/nexus-design/22`。

### Tick 生命周期

八个阶段顺序固定（`src/core/phases.ts` 为唯一权威），每个模块声明自己挂在哪个阶段：

| 阶段 | 职责 | 主要模块 |
|---|---|---|
| `perception` | 采集可见事实，更新房间快照 / Intel / 世界模型 | Perception |
| `emergency` | 不等规划的即时反应（塔控、应急） | Defense |
| `strategy` | 战略姿态重估（survive / develop / expand / war），产出 directive | StrategyCore |
| `planning` | 各域把 directive 拆解成任务，写入任务黑板 | Economy / Cluster / Expansion / Industry 各 planner |
| `reconcile` | 任务分配 / 续约 / 过期回收 | Allocator |
| `spawn` | 缺口聚合 → 孵化裁决 → 提交 | SpawnDirector |
| `agents` | 机体执行任务一步，产出行动提案 | Agents |
| `commit` | 行动仲裁与统一提交、编队驱动 | Broker / Teams |

模块是纯数据 + `run(ctx)` 的 `TickModule { name, phase, band, run }`，经 `createNexus(profile).use(...).loop()` 显式装配；禁用 = 不注册 = 零 CPU。内核（`src/core`）零业务模块依赖。

### CPU 分级

预算带 P0（安全关键）→ P3（优化分析），由 CpuBudget 治理：bucket 低时先砍 P3 分析、保 P0/P1 执行；预算器是"本 Tick 还能做多少事"的调度器，不是事后计数器。Pixel 生成在桶满时把富余 CPU 变现。

### Memory 模型

持久层收敛于 `Memory.Nexus` 一个根（`schemaVersion` + global/rooms/tasks/units/ledger/traffic/economy/defense/squads/spawn/layout/metrics/ownership），启动时经 schema 校准与迁移；各子系统损坏时按安全空状态隔离重置。原生目标对象在执行 Tick 用 `Game.getObjectById` 重新解析，绝不落 Memory。任务以序列化 DTO 持久化，Creep 的 `taskId` 只是指向任务租约的引用。

### 任务系统

任务生命周期 `Proposed → Available → Leased → InProgress → Completed/Failed/Cancelled`，状态存共享任务记录而非 Creep 内存。16 种任务类型（harvest / carry / fill_spawn / upgrade / build / scout / reserve / claim / defend / retreat / repair / attack / heal / boost / terminal_transfer / factory_produce）。分配器两段式：先硬性资格过滤，再贪心评分（能力匹配 + 优先级 − 路程 − 切换成本），切换付出迟滞代价，紧急任务可抢占；租约按任务类型定时限，超时自动回收。

### 资源账本

ResourceLedger 五态分账：观测库存（observed）/ 已预留（reserved）/ 已承诺（committed，带目的地的在途）/ 可用量（available = 库存 − 预留 − 承诺）/ 累计消耗（consumed）。经济决策一律看可用量而非表面库存。

### 编队系统（Teams）

多 Creep 协作编队（quad / line 阵型、指挥旗驱动），独立于单机体任务链：`ATK/...` 指令旗定义派兵（配置/孵化房/次数/间隔），TeamSpawner 生成队伍与孵化任务，TeamController 驱动队形、索敌、火力与移动。行动模式（normal/rush/press）与目标模式由旗色解析。要塞战变体在此之上实现三阶段闪电战锚点（集结 / 总攻 / 拆核心）。

## 目录结构

（`src` 顶层结构规范见 `docs/nexus-design/21`，此处只列主干）

```
src/
├── main.ts            # 官服变体入口（装配清单平铺挂载）
├── branch/            # 构建变体入口（一律 Nexus 架构，差异只在 profile 与垫片）
│   ├── compat.ts      #   私服共享垫片（缺 Power 类 / 市场 API 时补桩降级）
│   ├── local/ race/ season/ stronghold/
├── config/            # 常量配置（战略/经济/防御/编队/变体参数）
├── constant/          # 游戏侧常量（角色代号、部件表）
├── core/              # 内核：调度 / CPU 预算 / 错误边界 / 事件 / 遥测 / Memory 存取
├── console/           # 人机接口（游戏内控制台命令族）
├── modules/           # 功能域（TickModule）
│   ├── world/         #   感知与房间快照
│   ├── strategy/      #   姿态 / 指令 / 扩张评估
│   ├── cluster/       #   编队生命周期与槽位任务
│   ├── tasks/         #   任务黑板与分配器
│   ├── economy/       #   经济 / 物流 / 账本 / 配额 / 外矿 / pixel
│   ├── spawning/      #   孵化管线（需求聚合 → 裁决 → 体型生成）
│   ├── agents/        #   执行器 + ActionBroker（唯一原生调用出口）
│   ├── movement/      #   交通（BetterMove + trafficMonitor）
│   ├── planner/       #   布局规划
│   ├── defense/       #   威胁模型 / 塔控 / 应急
│   ├── industry/      #   lab / factory / powerSpawn / 市场 / 核弹
│   ├── teams/         #   编队战斗
│   ├── intershard/    #   跨 shard
│   ├── external/      #   外矿 / 扩张
│   └── visuals/       #   观测呈现
├── proto/             # 原型扩展与特性链
├── runtime/           # 行动体所有权运行时
└── utils/             # 纯工具
```

## 构建变体

全部变体共用同一 Nexus 架构与同一份严格 tsconfig，差异只在 profile（变体参数）与各入口的模块装配清单：

| 变体 | 入口 | 说明 |
|---|---|---|
| `main` | `src/main.ts` | 官服部署口径，全模块清单 |
| `race` | `src/branch/race/main.ts` | 冲级服，roomMode 固定 rush |
| `stronghold` | `src/branch/stronghold/main.ts` | 要塞挑战服，只挂孵化 + 战斗 |
| `season` | `src/branch/season/main.ts` | 赛季服（占位） |
| `local` | `src/branch/local/main.ts` | 本地客户端 / 私服 |

变体入口 `src/branch/<variant>/main.ts` 与上传目标 branch 同名，映射登记在 `.secret.json`（不入库）的 `branches` 表；rolldown 按 `VARIANT` 环境变量解析入口。

## 开发

```bash
pnpm install            # 安装依赖

pnpm typecheck          # tsc --noEmit（严格模式，必须全绿）
pnpm lint               # oxlint
pnpm fmt:check          # oxfmt 格式检查
pnpm test               # 单测（rolldown 打包 tests/ 后以 node:test 运行）
pnpm arch:guard         # 架构守护（原生调用豁免清单，见下）

pnpm build              # typecheck + 清理 + 构建 dist/main.js（可读混淆 + sourcemap）
VARIANT=race pnpm build:race        # 构建其他变体
NO_UPLOAD=1 VARIANT=main npx rolldown -c   # 仅打包不上传

pnpm sim                # 构建后跑 screeps-sim 场景回归
node scripts/sim-matrix.mjs          # sim 矩阵（speedrun/arena/sprint/boot 分段门）
```

### 部署与运维脚本

凭据与部署目标在 `.secret.json`（不入库，见 `.secret.example` 结构：`servers[].accounts` 与 `branches` 表）。

```bash
node scripts/submit.js [服务器[@账号]] [--branch 分支]   # 构建并上传（交互式选择，参数可缩写）
node scripts/console.js [服务器[@账号]]                  # 游戏内控制台（HTTP/WS）
node scripts/land.js [服务器[@账号]] [--room W5N8]       # 无 spawn 服务器落地放出生点
node scripts/eval.js                                     # 控制台表达式求值
```

### 架构守护

`scripts/arch-guard.mjs` 静态扫描全部"改变游戏状态"的原生方法调用（`MUTATION_METHODS`：move / attack / build / spawnCreep / createFlag / …），要求每一处都在 `config/arch-allowlist.json` 豁免清单内有登记条目（模块 × 方法），清单**单调收缩**：历史最小条目数记录在 `arch-allowlist.min.json`，回涨需要显式 `--allow-growth`。目的：观测与命令分离不被悄悄破坏——新的原生调用必须先走 ActionBroker 收编评审，而不是散落在业务模块里。

## 测试

三层，全部本地可跑：

1. **单测**（`tests/*.test.ts`，node:test）：任务索引一致性、Broker 仲裁幂等、执行器关键路径等纯逻辑契约。
2. **sim 场景**（`sim/*.sim.ts`，screeps-sim）：可复现的整局模拟——`speedrun`（冲级验收门）、`boot`（起步回归）、`sprint` / `arena`（诊断场）、`stronghold-door`（要塞战全链路）、`remote-mine` 等；`sim-matrix` 汇总各场 RCL 时间线与 CPU p95，与参考基线比对，退化标 RED/WARN。当前部分场景处于已知漂移观察期（红线以 `sim-matrix` 实时输出为准）。
3. **实服验证**：私有服务器落地观察（`land.js` + `submit.js`），缺陷与复盘记入 `docs/bugs/`。

## 文档地图

| 路径 | 内容 |
|---|---|
| `docs/Nexus-Bot-01-架构设计.md` | **目标架构权威**：六层职责、接口契约、Ownership、Memory schema、CPU 架构 |
| `docs/nexus-design/01–18` | 各专题设计（机制/架构原则/任务/经济/孵化/交通/战斗/性能/测试…） |
| `docs/nexus-design/19–24` | 智械连结分层、集群编队、架构定案、三循环公约、蓝图、冲级移植 |
| `docs/api/01–10` | API 契约（kernel / world / task / broker / economy / invariants…） |
| `docs/bugs/` | 缺陷清单与复盘（sim 审计 / 线上观察），与设计文档分离 |

冲突裁决顺序：`01 篇` > `nexus-design 专题篇` > 代码注释。当前目录结构与模块清单的现行权威分别是 `docs/nexus-design/21` 与各变体入口的 `nexus.use(...)` 清单。

## 许可

MIT
