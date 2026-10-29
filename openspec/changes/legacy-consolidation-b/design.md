# Design

## Context

`legacy-consolidation` A 波已完成（19/33）：exec() 双轨、roleRegistry、mission pool 六池、economy/units 三族、词表死角色退场，任务板 + broker 成为唯一执行/供给路径。当前基线（2026-10-27，guard 实测）：>600 有效行文件 9 个、`@ts-nocheck` 31 文件（speedrun 隔离区 10 文件豁免不计）、显式 `any` 684（`as any` 471）、豁免清单 88 条（含 race 主链化新增的 28 条冲级直通）、typecheck 绿、双守护绿。回归线沿用 `legacy-consolidation/baseline/sim-matrix-reference.json`（speedrun L4@28316 / arena L3@11629 / sprint L3@36171 / boot L3@8889 / race L2@458 / remote-mine L3@0）+ run-residue/stronghold-door 单独跑。

关键事实漂移（A 波后实测，与旧 C 波清单的差异，决定本设计）：

- `Memory.OutMineData` 已是**活簿记**：mineralWork 写 power/deposit/highway 书（economy 生产路径挂载）、road 链读写 RoadData、console mine.ts 人操入口、statistics/roomVisuals/usePower 读——**不能随 external/mine 链删除**。
- `visuals/highwayMine.ts` 有活消费方（console mine.ts 三处人操调用）——不是零引用死文件。
- `PowerCreep/mode/assist|operate` 的 runAssist/runOperate 被 execute.ts 调用——是 PC 驱动链活模式，旧清单「零触发路径部分」需函数级复核。
- A 波后新超限 3 文件：actionBroker.ts（997）、spawnDirector.ts（619）、proto/Room baseFunction.ts（724）——旧拆分表未覆盖，需钉新边界。
- 豁免从 60 涨回 88：race speedrun 主链化（`413d872`）新增 28 条冲级直通豁免，物理隔离于 Nexus 管线。

约束：不整树搬目录（`02-architecture-charter.md` §21）；算法资产不动只拆形（Strangler 口径）；race 门 RCL 时间线逐位一致是硬指标；实服验证不落实、台账标注「实服待补」；一切验证以 sim 全场景门 + 双守护为回归制。

## Goals / Non-Goals

**Goals:**

- C 波：休眠链复核后真删（净删除 >2000 行），活簿记与人操面完整保留，台账逐行如实。
- A 波收口：88 条豁免按「赛区隔离区 + 非赛 ≤60」新口径对账归口。
- B 波：9 个超限文件拆至白名单外清零、ts-nocheck 31→0、any 684 单调收敛，全程行为零变化。
- 每个删除/拆分切片独立可回退，门禁读数留档。

**Non-Goals:**

- 不动 Movement/Teams/Planner/broker 的算法本体（只拆文件边界、收类型）。
- 不扩展 broker 管线；不改 cluster-squad spec。
- 不处理 race 冲级策略调优（归 race-speedrun 变更）；speedrun 隔离区的 ts-nocheck 是终态不清理。
- 不删除活簿记 `OutMineData` 与其 accessor、console mine 人操命令族、road 链（有活消费方）。
- core→modules 既有 6 处依赖违规只冻结不新增（清理由后续变更承担）。

## Decisions

### D1: 波序改定为「收口 → C → B」而非旧计划的「B → C」

**选择**：先对账豁免、删休眠代码，再拆文件、收类型。
**理由**：external/mine 链 ~2900 行是 C 波删除对象——先拆它/给它收类型是给将死代码做结构投资（B 拆 6 文件含 `mine/state.ts` 605 行、7.1 的 31 个 nocheck 文件含 mine 链文件，全成废功）；且休眠链运行期不可达，先删对回归门逐位一致零扰动，改序无风险。旧计划 B→C 的唯一理由（B 收口闸门做 C 前置）不成立：C 的删除对象不依赖结构治理。
**替代方案**：维持旧序 B→C——被否，见上；顺带收益是 `mine/state.ts` 免拆分（白名单登记「C 波删除对象」，删后摘行）。

### D2: C 波不升 Memory 版本（除非复扫描证实死子键）

**选择**：`OutMineData` 活簿记保留；仅当子键级复扫描发现仅由休眠链写入的死子键（如实测 `roadMemory` 写的 RoadData 若有休眠写入方残留）才做最小迁移。
**理由**：旧清单按「v14 迁移删 OutMineData」规划的前提（零活消费）已被 A 波数据面演进推翻——mineralWork/console/road 链/统计 HUD 都是活读写。升版本删活数据反而制造回归风险。迁移契约（纯函数/幂等/一次删净/run-residue 验证）沿用 mission-pool-retirement spec 口径，仅在死键实证时触发。
**替代方案**：按旧清单删 OutMineData 并把活簿记迁 `Memory.Nexus`——被否：纯搬迁无收益，触碰 economy 生产路径，违背「震荡纪律」。

### D3: 人操面显式定性为豁免保留，不迁任务板

**选择**：console mine.ts 命令族 + HighwayMineVisual 登记人操豁免保留（写 OutMineData 活簿记，mineralWork 消费面已就绪）。
**理由**：A 波已把 power/deposit 悬挂写入收口为簿记（3.2 注记），消费闭环成立；再迁任务板是人操语义重写，超出本轮「退役旧代码」的范围。豁免受单调约束即可审计。

### D4: actionBroker 拆分为四模块而非按管线逐个拆

**选择**：类型契约 / creep 执行器 / structure+flag 执行器 / broker 核心+单例 四模块。
**理由**：actionBroker 是 A 波后新超限（997 行），其内聚边界天然是「接口族 / 两族执行器 case 表 / 组合与生命周期」；executeStructureAction/executeFlagAction 已是独立函数（L621/L675），case 表块状清晰，搬迁零逻辑改动。相比按 ActionPipeline 逐管线拆文件（30+ kind 拆十几文件），四模块保持 case 表完整性、diff 可核对。
**替代方案**：不拆、白名单豁免——被否：997 行且持续增长（A 波加了 renew 等 kind），豁免理由（纯数据表）不成立。

### D5: agentSystem 拆分增加 courier 域（相对旧表）

**选择**：旧表「handler 按 kind 拆 + logistics + remote」基础上，把 rush-courier 族（runCourierCreep/submitCourierAction/submitCourierTransfer，L970–1087）独立 `courier` 模块。
**理由**：A 波后 rush-courier 直驱链成为活路径（4.2 注记），该族函数自成体系（快递取送货 + 意图提交），与任务 kind handler 和 remote 族正交，不拆则装配层仍 >600 行。

### D6: 豁免对账引入「赛区隔离区」类目而非压回 ≤60

**选择**：28 条冲级直通豁免单列为物理隔离区类目（终态登记，单调不增），≤60 闸门只考核非赛 60 条。
**理由**：race 主链化（`413d872`）把上游单文件血统的 speedrun 引擎并入主代码调度链，其直连是血统约束（单文件性能优先），按 Nexus 管线收编会破坏冲级硬指标。闸门口径改分治而非总量，既保 race 时间线又保非赛收敛可度量。
**替代方案**：把闸门抬高到 ≤88——被否：掩盖非赛域回涨；把 28 条收编进 broker——被否：触碰冲级链性能。

### D7: B 波二与 C 波的 any/ts-nocheck 记账联动

**选择**：C 波删除文件携带的 any/nocheck 随文件消亡自然出账（检查点同批推进，参照 A 波「registry.ts @ts-nocheck 随文件消亡」先例）；B 波人工清理只对存活文件按域序执行。
**理由**：避免对将死文件的类型修复投资，与 D1 同理；检查点单调性由 guard 断言保证。

### D8: baseFunction 拆分走 mixin 单元而非函数搬移

**选择**：proto/Room baseFunction（724 行）按成员函数职责域拆成多个 mixin 单元文件，`export default class BaseFunction` 聚合面（extend 链）不变。
**理由**：baseFunction 是原型继承链一环（`proto/Room/index.ts` extend 序列），调用方（含外部索引签名）依赖类形态；拆函数会改继承结构，mixin 单元（类片段文件 + 聚合）保持 extend 链零改动，导出面 diff 为空。

## Risks / Trade-offs

- [C 波复扫描发现更多活消费方，删除范围缩小] → 漂移裁定规则（dormant-code-retirement spec）已定：死子面退役、活面保留+台账登记，范围缩不视为失败；每对象删除前摸底档复核实测节是硬前置。
- [movement 拆分动到时序敏感的猴补丁挂载点] → 拆分边界钉死「挂载点原样保持、P4 豁免身份不变」；run-residue/stronghold-door 单独跑绿做时序旁证；漂移即回退（震荡纪律）。
- [ts-nocheck 清零中 noUncheckedIndexedAccess 改写引入行为变化] → 逐文件小步 + 每文件过全场景门逐位；MUST NOT `!`/`as any` 逃逸（guard 断言）。
- [31 文件×全场景门的迭代成本高] → 允许同域多文件合并一次门跑（门是回归线不是单步闸），但单文件 typecheck 绿是每步硬前置；race 场景（6k tick）可做快速预检、八门总验收收口。
- [豁免对账发现非赛 60 条内有回涨] → 对账只登记不追责；回涨源头若为 race 主链化溢出，划归赛区类目并在台账注明，闸门口径不因此再改。
- [PC mode 函数级复核可能全活] → 转显式保留+台账登记是合法出口（spec 场景已定），不强迫产出删除。

## Migration Plan

1. **组 1 收口对账**：arch:guard --report 逐条归类 88 条 → 台账 + 检查点；发现无主条目即处置（接管计划/豁免/待删登记）。
2. **组 2 C 波**：每对象四步（复核实测 → 三口径凭据 → 删除+连带清理 → 对账），切片顺序：external/mine 链（最大且最确定）→ 死导出/孤儿读口（makeCombatHealHandler、qos/accessor/ai 逐符号扫描）→ PC mode 函数级复核 → 台账行齐。删除提交独立可回退；revert 即恢复。
3. **组 3 B 波一**：按拆分表逐文件（movement → agentSystem → TeamAction → actionBroker → 63Planner → baseFunction → rosManor → spawnDirector），每切片全场景门逐位 + 导出面 diff 空；`mine/state.ts` 白名单登记随 C 波完成自动出清。
4. **组 4 B 波二**：ts-nocheck 域序清零（planner 13 → visuals 3 → teams 3 → movement 2 → proto 5 → 其余 5）→ any 域序收敛（检查点单调推进）。
5. **组 5 总验收**：八门逐位 + p95 对比 + 双守护绿 + 台账/文档同步 + 旧变更 tasks 处置注记（A 波成果归档口径）。
6. **回滚**：每切片单提交；C 波删除 revert 恢复文件与白名单行；B 波拆分 revert 恢复单文件；Memory 不动版本（D2）使回滚无迁移负担。

## Open Questions

- PC mode 复核若发现「半死」函数（如 assist 内仅个别分支零触发），删除粒度到函数还是整模式留待复核实测定（不改变 spec 的处置规则，只影响该切片大小）。
- any 收敛终值（≤300 是目标上限）允许实施中按域实测微调检查点落点，spec 只约束单调与域序。
