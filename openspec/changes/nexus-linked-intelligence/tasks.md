# Tasks

## 1. Schema v4 与 global 运行时层

- [x] 1.1 扩展 `src/store/memorySchema.ts`：`NexusGlobalMemory` 增 `policy`/`goals`/`lastTransition`/`transitionCount`，`CURRENT_SCHEMA_VERSION` → 4，同步 `SUBSYSTEM_DEFAULTS`。验证：类型检查通过 + 既有 store 单测不回归
- [x] 1.2 `src/store/migrations.ts` 新增 v3→v4 纯函数迁移（补默认政策、缺 lastTransition/transitionCount 容错）。验证：`tests/store` 新增用例——旧 v3 样例迁移后字段齐全、重复迁移幂等、空 global 自愈默认
- [x] 1.3 新增 `src/store/runtime.ts`：`global.nexus.runtime` 类型化访问器（缺失返回默认值自愈）+ 运行时结构声明（结构类型集中于 runtime.ts；globals.d.ts 只声明沙盒原生全局，不重复声明自有挂载点）。验证：单测覆盖「global 为空/损坏/正常」三态读取
- [x] 1.4 新增 `src/config/strategy.ts`：重估周期、最小驻留、临界/健康/过剩库存系数、姿态偏置表、节流开关、环形日志上限——全部配置化无硬编码。验证：config 被后续模块引用且 lint 无魔数告警

## 2. NexusCore 战略模块（strategy 阶段）

- [x] 2.1 `src/core/phases.ts` 在 `emergency` 与 `planning` 之间追加 `strategy` 阶段；`TICK_PHASES` 顺序测试更新。验证：阶段顺序单测通过（strategy 先于 planning）
- [x] 2.2 `src/modules/strategy/core.ts`：姿态状态机纯函数 `evaluatePosture`（D2 转移表 + 驻留迟滞 + 原因字符串引用量化输入）。验证：单测覆盖 specs/strategy-core 全部场景（临界降级/迟滞不抖动/恢复回升/过剩扩张/war 不自动进入）
- [x] 2.3 战略模块 `nexus-core`（strategy 阶段、P2 预算带）：周期到点或 runtime 紧急标志触发时聚合 `StrategyInputs`（只读 memory.economy/ledger/快照，不遍历 Game）→ 重估 → 写 `memory.global` 与 runtime 转移日志。验证：单测覆盖「预算跳过沿用旧政策」「输入缺失安全默认」
- [x] 2.4 `src/modules/index.ts` 注册战略模块于 economy 之前；profile 开关禁用时零注册。验证：装配单测确认注册序与禁用路径

## 3. 指令连结（Directive）

- [x] 3.1 `src/modules/strategy/directive.ts`：`directiveOf(memory.global, config)` 纯派生（posture/reserveFloor/kindBias/suppressUpgradeBuild）。验证：单测覆盖各姿态派生 + global 结构缺失时中性退化不抛异常
- [x] 3.2 `src/core/tickContext.ts` 增惰性 `directive()`（每 Tick 首调用缓存）。验证：单测——同 Tick 多次调用返回同一引用；战略模块当 Tick更新政策后首次调用即见新值
- [x] 3.3 派生路径接入库存穿越检测：库存跌破临界线且姿态非 survive 时置 runtime 紧急标志（供 2.3 消费）。验证：单测覆盖穿越置位、消费清除、global 丢失后周期重估兜底

## 4. 局部规划层：经济系统接指令

- [x] 4.1 `src/modules/economy/planners.ts` 按房间化重构（提取 `planEconomyRoom`，逻辑原样，dedupe key/取消语义/账本预留不变），`economy/index.ts` 恢复 planning 阶段模块注册（`economy-planners`）。验证：一致性测试——同快照输入下任务集合（键/种类/目标）与重构前完全一致
- [x] 4.2 指令生效：upsert priority 加 `kindBias`；`suppressUpgradeBuild` 时 upgrade/build 不新建、既有任务降权保持存活（expected 集合仍收录，D5）。验证：单测覆盖 specs/strategy-directive「告急压制/恢复解除」两场景 + specs/room-planning「去重键稳定/主体消失回收」回归
- [x] 4.3 装配与开关：`src/modules/index.ts` 注册序 nexus-core → economy-planners → economy-model；变体开关禁用 economy-planners 零注册。验证：装配单测 + 既有 economy 测试全量通过

## 5. 生产侧接入与可观测性

- [x] 5.1 `src/modules/spawning/spawnDirector.ts` 读 `ctx.directive()`：survive 姿态暂停新排 builder/upgrader 类岗位（carrier/harvester 不受影响，不做身体缩水）。验证：单测——survive 下非关键岗位不进队、develop 恢复排队
- [x] 5.2 `strategySnapshot(ctx)`（姿态/驻留/偏置/节流/最近转移）+ HUD 增姿态行（实际落位 `core/boot.ts` worldHudLines——项目 HUD 渲染处）；转移 logger 限频一行。验证：单测快照字段齐全有界；HUD 集成冒烟渲染不抛异常
- [x] 5.3 指标接线：转移次数与当前驻留时长进既有 metrics 有界通道。验证：单测确认计数只增有界、快照可查询

## 6. 扩展契约文档与收尾

- [x] 6.1 撰写 `docs/nexus-design/19-智械连结扩展.md`：职能系统/集群概念区分（系统=职能域，集群=多 Creep 协作编队）、指令字段语义、防御系统接入点（emergency 阶段 + ThreatModel 作为 war/risk 输入）、扩张系统接入点（expand 动作位 + scout/reserve/claim 任务类型）、集群在单位层的扩展位、各层读取边界表、global 运行时分级规则（D9）与既有子系统迁移候选清单。验证：文档随代码评审通过，接入示例与 planning 阶段模块契约一致
- [x] 6.2 全量回归：`npm test`（vitest 全绿）+ `npm run build` 产物体积对比无异常增长。验证：CI/本地命令输出
- [x] 6.3 私服落地验证（W5N8）：重新落地（respawn 态 + place-spawn）→ 新代码以 run 2 启动；API 轮询 Memory 观察到完整闭环——`stock 6 < critical 40` 一次转移进 survive（期间 stock 157→302 迟滞不抖动、经济闭环正常生产）→ `stock 350 > healthy 100` 回 develop、政策随姿态切换（floorFactor 3↔2）；重传代码重载后 runtime 丢失自愈（姿态/计数保留、战略周期继续推进）；第二次降级发生在非周期 tick（10801301）证实紧急穿越检测线上生效。验证：上传 `submit.js 47.100.24.220@Nexus --branch main` + API 轮询取证，按 docs/nexus-design/02 §2.7 验收问题逐项核对通过（HUD 像素级渲染由 bootSmoke 集成测试覆盖，浏览器目视留作日常巡检）
