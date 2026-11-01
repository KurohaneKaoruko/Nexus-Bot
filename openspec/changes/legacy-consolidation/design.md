# Design

## Context

基线 `dev` HEAD `4a3ee14`。`nexus-architecture-refactor` 已完成 58/61 任务：TickModule 相位管线、TaskBoard（dedupeKey/租约/TTL 对账）、ActionBroker（spawn/build/market/claim/PowerCreep 管线齐）、Actor Ownership（记录档）、架构守护（`scripts/arch-guard.mjs` + `config/arch-allowlist.json` 128 条 / 273 处直连）全部就位，sim 场景门回归线（`scripts/sim-matrix.mjs`，参考快照 speedrun L4@32160 / boot L3@8915 / race L2@458 等）是唯一活跃回归制。

但执行与任务供给仍是双轨（详见 proposal.md - Why）：

- **执行分水岭**在 `agentSystem.ts` 的 `NEXUS_TASK_DRIVEN_CODES`（10 个任务驱动角色）与 `config/capabilities.ts` 的 `legacyExecMode: 'on'`；集合外角色走 `Creep.prototype.exec()` → `roleRegistry`（15 个 handler，指向 `economy/units` 三族 + defense/teams 战斗 handler + `pcHeal`）。
- **任务供给双轨**：`RoomFeatures` 每 tick 对每个己方房跑 `room.MissionUpdate()`，驱动 `modules/spawning/mission/` 的 9 个更新器维护 7 个 `MissionPools`；任务板由 economy planners 独立产出。两轨**服务不同单位群**：任务板喂 `NEXUS_TASK_DRIVEN_CODES` 单位，mission pool 喂 `exec()` 单位（manager/transporter/miner 及 boost 链）。
- **结构性难点**：manager（storage↔link/terminal 调拨）、miner（元素矿）在 sim 的 RCL≤3 域**结构性不出现**，`external/mine` 2650 行全链休眠（活链是 `economy/remoteMining`）——这正是上一变更 9.2 无法推进的原因。
- **代码形态**：`@ts-nocheck` 35 文件、`: any` 466 处、>600 行文件 22 个（movement 3343 / TeamAction 1806 / agentSystem 1727——其中 `runCreep` 单函数 484 行 / 63Planner 1183）。

约束：不整树搬目录（`02-architecture-charter.md` §21 裁定）；Strangler 口径——Movement/Teams/Planner 的**算法资产不动，只拆形与收编**；本轮实服验证不落实，删除台账逐行标注「实服待补」；race 门的 RCL 时间线必须逐位一致（AGENTS.md 冲级硬指标是现存成果，不得回退）。

## Goals / Non-Goals

**Goals:**

- 任务板成为唯一任务事实源、broker 路径成为唯一执行路径，`exec()` 双轨与 mission pool 全链退场。
- 结构治理可度量：600 行上限、依赖方向、`@ts-nocheck` 清零、`any` 预算单调下降，全部纳入守护脚本。
- 休眠/不可达代码（external/mine 链、休眠 mode、零挂载面）按三口径判定后退役。
- 豁免清单收缩到 ≤60 条（清 P6 56 条 + economy/units 12 条），checkpoint 单调不增。
- 每个删除是独立可回退提交，台账如实登记。

**Non-Goals:**

- 不做目录重组/搬家（现行 `src` 顶层结构即权威）。
- 不动 Movement/Teams/Planner 的算法本体（只拆文件边界、收类型）。
- 不扩展 broker 管线（上一变更已完成）；不改 `cluster-squad` spec。
- 不动 `race-speedrun-10-20-40` 与 `refine-architecture-docs` 的范围；冲级策略调优仍归 race 变更。
- 不做实服门禁验证（用户已裁定：sim 验证 + 台账标注待实服）。
- 不重写 console 人操命令族的功能语义（只改写被退役结构的引用与帮助文案）。

## Decisions

### D1. A→B→C 波序，删除先于拆分

**决定**：先退役（A 波删 mission pool / economy units / exec 双轨），再拆分（B 波只拆**存活**模块），最后清休眠（C 波）。

**理由**：拆分一个即将被删除的文件是纯浪费；A 波直接消掉 `agentSystem` 的双轨分支与 `spawning/mission/` 2722 行后，B 波的拆分对象（movement / agentSystem 剩余 / TeamAction / 63Planner）才是终态。C 波的 `external/mine` 依赖 A 波先迁移 `mineMission` 活语义，故置后。

**备选**：三波并行推进——被否，A 波改写 economy 任务供给面会移动 B 波要拆的代码，并行时 bit 一致门无法归因。

### D2. 三族任务化复用既有 task kind，不新增词表

**决定**：manager → `carry`（配额目的地已支持）+ `terminal_transfer`/`fill_spawn`（link/storage 调拨语义）；miner → `harvest`（矿点工位钉位复用 source 工位机制，`resourceType` 区分元素矿）；transporter → `carry`。任务供给补齐写在 economy planners（planning 阶段），不新增 `TaskKind`。

**理由**：`TASK_KINDS` 已含 17 种，三族语义都能落进既有 kind；新增 kind 会扩散到 broker 校验、分配器能力筛选与任务索引。

**备选**：为 manager/miner 各建新 kind——被否，词表膨胀且分配器要跟着改。

### D3. 战斗/防御执行体改为所属模块直驱，roleRegistry 整层退场

**决定**：`roleRegistry` 的 15 个 handler 中，defense 族（defend-*）改由 Defense 模块在 agents 阶段直接驱动（动作已经 8.1 任务收编为 Adapter 提交），teams 族（aio/double-*/one-ranged）由 Teams 编队运行时驱动（8.2 已 Adapter 化），`pcHeal` 归 PowerCreep 驱动模块；`economy/units` 三族随 D2 任务化消亡。`exec()` 分发、`legacyExecMode` 开关、`NEXUS_TASK_DRIVEN_CODES` 分水岭一并删除——所有存活单位要么持任务租约、要么由注册的系统级管线驱动。

**理由**：registry 只是 `exec()` 双轨的间接层；各域模块已是动作的真正所有者（Adapter 收编完成），分发层没有存在价值。删除后「无任务待派」路径输出诊断记录（spec `legacy-execution-retirement` 第一条要求）。

**备选**：保留 registry 作为 handler 表——被否，那等于保留第二执行入口，只是换个名字。

### D4. mineMission 活语义迁移为计划阶段模块

**决定**：`UpdateMineMission` 的活语义（元素矿/沉积矿定编与 `directSpawn` 桥接）迁为 economy 计划阶段模块（`planMineralWork` 一类），孵化走 spawnDirector 需求源；`MissionPools` 池化层与 `mineMission` 更新器随后删除。boost 池同理：`boostFunction` 读池改任务板 `boost` kind。

**理由**：`docs/bugs/role-registry-executor-gap.md` 已实证 deposit-*/power-* 是 mineMission 活角色；直接删会断元素矿链。迁移到 planning 阶段满足 spec `mission-pool-retirement`「任务产出只在计划阶段由模块承担」。

### D5. movement 拆分保持猴补丁挂载点与时序契约，不重写为 MoveIntent-only

**决定**：`movement/index.ts` 拆为六个内聚模块（路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动），`index.ts` 变薄装配层；`Creep.prototype.moveTo` 猴补丁挂载点、`preTickBetterMove → commit → endTickResolve` 调用序**原样保持**（P4 永久豁免主体身份不变）。

**理由**：`endTickResolve` 是全局单点契约，主循环不调用即全员冻结；Movement 是 race 门性能资产（缓存/绕行/推挤解算），重写风险与收益完全不成比例。

**备选**：收口为 broker `MoveIntent` 单通道——上一变更已裁定 P4 永久豁免，维持。

### D6. agentSystem 按 task kind 拆为 handler 表

**决定**：`runCreep`（484 行 switch）拆为 `handlers/<kind>.ts` 分派单元，公共取料/送货辅助（`fetchEnergy`/`deliverEnergy`/`nearestStore` 等）独立成 `logistics.ts` 一类共享模块；远程采集族（`runRemoteHarvest`/`runRemoteCarry`/relay 接力）独立成 `remote.ts`。`runAgents` 主循环只做分派与所有权登记。

**理由**：kind 分支天然内聚边界；拆后每个 handler 可单测（spec `code-structure-standards` 的拆分判据），公共面（`runAgents` 签名）不变。

### D7. TeamAction / 63Planner 拆形不改面

**决定**：`TeamAction`（单对象 30+ 方法）按队形集结 / 移动执行 / 代价矩阵 / 路径缓存四域拆为内部模块，对外仍以 `TeamAction` 命名空间整体导出（调用方零改动）；`63Planner` 的 `ensurePlannerState` 与 `autoPlanner63` 各阶段按规划步骤拆分，导出面不变。

**理由**：teams/planner 是战斗与布局的算法资产，消费方多；改面对放大 diff 且违反「拆分后公共面不变」。

### D8. structure-guard 脚本统一承载结构公约

**决定**：新增 `scripts/structure-guard.mjs`（接入 `npm run structure:guard` 与 pre-commit，与 arch-guard 同框架）：① >600 有效行文件扫描 + 白名单（初始白名单钉死于 spec：`ResourceConstant.ts`、`config/economy.ts`、`types/*.d.ts` 天然豁免）；② `@ts-nocheck` 计数目标态为 0（分阶段：先冻结不准增、随 B 波清零）；③ 显式 `any` 计数对 `config/code-quality.json` 检查点单调不增（计数正则与域序钉死于 spec）；④ 依赖方向断言（四条规则钉死于 spec：core 不 import modules/proto/console、modules 不 import console、modules→proto 仅白名单纯库面、branch 只被构建入口引用）；⑤ 词表三方一致断言（executor ↔ 可执行路径 ↔ 孵化源，A 波域 6 后生效）。

**理由**：spec `code-structure-standards` 的五条要求都需要客观度量入口；复用 arch-guard 的「扫描 + 检查点 + 白名单」模式，学习与维护成本最低。度量口径全部钉死在 spec，避免每次实施重新定义「怎么数」。

### D9. Memory v13 单版本迁移，删除域一次清干净

**决定**：A 波删除 mission pool 时 schema v12→v13：一次性删除 `Memory.MissionPools` 与随域确认无活消费方的 legacy 键，迁移函数纯函数、幂等、`run-residue` 场景验证。C 波若再删 `OutMineData`/`energyState` 等域则 v13→v14。**不**做每池一版本。

**理由**：退役按域分批提交，但 Memory 迁移以「波」为单位合并成少数版本，避免版本号碎片化；旧代码对缺失的池结构是惰性重建（`initMissionPool` 的 `??=` 模式），回退到旧代码安全。

**备选**：每域一版本——被否，迁移链无谓增长。

### D10. warSpawn 旗标链定性为人工操作豁免

**决定**：`proto/Flag/function/warSpawn.ts`（attack-claimer/logistic/dismantle 的手动旗标孵化）**显式保留**，登记为人操豁免（台账 + 豁免清单 track 注记），不任务化。

**理由**：低频人操面（玩家放旗才激活），任务化收益趋零；spec `dormant-code-retirement` 要求「仅服务人工操作的链路显式定性」——保留+登记即合法终态。

## Risks / Trade-offs

- [manager/miner 在 sim 不可达，等价证明薄弱] → 单测覆盖 handler 决策逻辑 + 任务供给快照对照（退役前后同场景任务集合语义比对，差集登记台账）+ 台账标注「实服待补」；上线后实服观察期回流 `docs/bugs`。
- [A 波改任务供给面导致 race 门漂移] → 每切片独立提交 + 全场景门逐位一致才过；任何 RCL 时间线漂移即回退该切片，禁止「改一点测不好再回退」的震荡（AGENTS.md）。
- [movement 拆分破坏 endTickResolve 时序 → 全员冻结] → 薄装配层保持三个入口签名与调用序不变；race/boot 门逐位 + `run-residue` 场景；拆分 PR 不混入任何逻辑改动。
- [exec() 删除后出现无任务空转单位] → 词表↔处理器↔孵化源三方一致断言入 structure-guard（A9）；`runAgents` 对无任务单位输出限频诊断。
- [`@ts-nocheck` 清理引入隐性行为变化] → 类型化 PR 只做类型收窄不改逻辑；逐文件小步 + typecheck + 场景门逐位；`noUncheckedIndexedAccess` 收紧处的访问改写必须显式判空。
- [Memory 迁移破坏旧存档] → 迁移幂等 + `run-residue` 场景 + schema 单测；回退安全依赖旧代码惰性重建（D9）。
- [CPU 劣化] → 每切片跑 sim 门 cpu p95 对比，劣化 >2ms 拒绝（既有红线）。
- [删除量级大导致评审困难] → 最小可回退单元纪律（spec `legacy-execution-retirement` 第三条）+ 台账行与提交一一对应。

## Migration Plan

每个退役切片走同一条四步流水（对应 spec 的等价接管与台账要求）：

1. **接管**：新实现进生产装配路径（任务供给补齐 / 模块直驱生效），旧实现仍在（双写期只存在于单个切片内，合入前完成切换）。
2. **验证**：全场景门逐位一致 + 新增单测绿 + arch/structure guard 绿。
3. **删除**：同批删旧实现 + 豁免条目收缩 + 词表/类型/文档同步清理 + Memory 迁移 + 台账新增行（实服条件列写「待补」）。
4. **对账**：`npm run arch:guard` 输出的条目数 ≤ 上一检查点；`openspec validate` 通过。

**回滚**：单域 git revert 即恢复（Memory 迁移单向但旧代码惰性重建，见 D9）。

**波间闸门**：A 波全部切片完成且豁免清单降到 ≤60 条后才开 B 波；B 波 structure-guard 全绿（600 行白名单外清零、ts-nocheck=0）后才开 C 波；C 波完成跑总验（全场景门 + CPU 对照 + 台账对账）。

## Open Questions

（无——`rooms[].energyState` 的去留虽留待 0.3 扫描结论，但其两个处置选项（保留为 RoomFeatures 基础状态 / 随域清理）已写入任务 5.1 与 v13 迁移设计，扫描只是二选一的依据，不改变规格与波序；`any` 预算终态数值由检查点制自然收敛，spec 已钉死「B 波收口 ≤150 或实际收敛值」。）

## 口径钉死索引

实施会话 MUST 从 spec 读取以下已钉死口径，MUST NOT 现场重新规划：

- 退役域清单（8 域）与顺序 → `specs/legacy-execution-retirement/spec.md`
- 四步流水与波序闸门 → `specs/legacy-execution-retirement/spec.md`
- 台账行格式与「实服待补」标注 → `specs/legacy-execution-retirement/spec.md`
- 旧池语义 → 任务板映射表（8 行）→ `specs/mission-pool-retirement/spec.md`
- 快照对照程序（4 步）→ `specs/mission-pool-retirement/spec.md`
- 600 行白名单初始集、五文件拆分边界表 → `specs/code-structure-standards/spec.md`
- 依赖方向断言四规则、any 计数正则与域序、ts-nocheck 清理顺序 → `specs/code-structure-standards/spec.md`
- 回归门统一口径（场景门/逐位一致/CPU 红线/基线存档）→ `specs/legacy-execution-retirement/spec.md`
- 休眠对象清单（7 项）与三口径判定程序、零引用扫描程序（4 步）→ `specs/dormant-code-retirement/spec.md`
