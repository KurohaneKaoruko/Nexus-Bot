# Spec Delta

## Purpose

定义旧角色执行体（原型角色行为库、`economy/units` 三族、`exec()` 双轨、词表死角色）按职责域退役的判定与执行契约，使「任务 → Agent → ActionBroker」成为唯一存活执行路径。本 spec 同时钉死退役的**操作规程**（四步流水、域切分、波序、回滚纪律、度量口径），任何实施会话 MUST 按同一规程执行，MUST NOT 现场重新规划切分方式、验证方式或登记方式。

## ADDED Requirements

### Requirement: 存活单位只有一条执行路径

所有存活单位的行为 MUST 满足以下合法性判定之一：（一）持有任务板任务租约，经 `runAgents` 分派；（二）由注册的系统级管线驱动（Defense / Teams 编队运行时 / PowerCreep 驱动模块）。系统 MUST NOT 存在第三条可执行游戏动作的入口：`Creep.prototype.exec` 挂载、`roleRegistry` 分发表、`legacyExecMode` 开关、`NEXUS_TASK_DRIVEN_CODES` 分水岭集合，四者 MUST 全部不存在于源码中。

#### Scenario: 无任务指针的单位不再被执行兜底

- **WHEN** 一个属于已退役角色族的单位本 tick 没有任务租约，也不属于任何系统级管线
- **THEN** 该单位本 tick 不产生任何游戏动作提交
- **THEN** 系统以限频日志输出「无任务待派」诊断（含单位名与角色代号），日志频率 MUST 有上限，不得每 tick 每单位刷屏

#### Scenario: 双轨入口物理删除

- **WHEN** 全仓扫描 `exec`、`roleRegistry`、`legacyExecMode`、`NEXUS_TASK_DRIVEN_CODES` 四个标识
- **THEN** 除本变更的文档与台账引用外，源码命中数为零

#### Scenario: 孵化中单位不被驱动

- **WHEN** 单位处于 spawning 状态
- **THEN** 任何执行路径都不驱动它（保持既有 actor-missing-or-spawning 防护语义）

### Requirement: 每条动作提交可全量归因

任取一个 tick 的全部游戏动作提交，每一条 MUST 能归因到：（一）任务板中某任务的 handler；或（二）某注册的系统级管线。存在无归因来源的提交即判定为退役不完整。

#### Scenario: sim 插桩归因完备

- **WHEN** 在全场景门运行期对 broker 提交与直连豁免调用做归因插桩
- **THEN** 每条提交的归因字段非空，且指向合法来源之一

#### Scenario: 豁免条目全部有归因

- **WHEN** 架构守护扫描豁免清单
- **THEN** 每条豁免的 track 注记指向人操豁免、永久豁免或已登记的待收编轨道，无「无主」条目

### Requirement: 退役前等价接管必须已在生产装配路径生效

删除任一旧执行体前，其职责 MUST 已有等价实现并满足全部三条：（一）新实现位于生产装配路径（`main.ts` / 变体入口的 `nexus.use` 挂载链或 planning 阶段模块内），而非仅存在未挂载的代码；（二）任务供给快照对照通过（见 mission-pool-retirement spec 的对照程序）；（三）全场景门逐位一致。「新代码已写好但未挂载」「单测过了但任务供给没接上」MUST NOT 作为接管判据。

#### Scenario: 未挂载即删除被拒

- **WHEN** 某域的接管实现尚未进入 `nexus.use` 挂载链或 planning 模块
- **THEN** 该域旧执行体的删除被拒绝，并输出缺失的具体挂载点

#### Scenario: 接管后行为逐位一致

- **WHEN** 某域完成接管后跑全场景门
- **THEN** 绿门场景 RCL 时间线与接管前逐位一致；红门场景时间线漂移仅告警（沿用 sim-matrix 既有规则）

### Requirement: 退役按固定域清单切片，一次一个最小可回退单元

退役 MUST 按下列域清单逐片执行，每次改动只覆盖一个域，使该次提交可独立 revert；跨域合并删除 MUST 被拒绝。域清单固定为：

1. `manager`/`transporter` 族（`economy/units/manager.ts`、`transporter.ts` 及其任务供给）
2. `miner` 族（`economy/units/miner.ts` + `mission/updaters/mineMission.ts` 活语义迁移）
3. mission pool 全链（`mission/pool/`、其余 updaters、`MissionUpdate` 调度入口、Memory v13）
4. registry 战斗族（defense 族直驱化、teams 族直驱化、`pcHeal` 归位）
5. `exec()` 双轨与开关退场
6. 词表死角色裁撤
7. `warSpawn` 旗标链定性登记
8. proto 角色行为库收缩为纯库

执行顺序以依赖类约束：{1,2} 的任务供给 MUST 先于 3 落地；4 MUST 先于 5；5 MUST 先于 6；全部域先于 A 波收口。依赖类内的域（如 {1,2}、{6,7,8}）MAY 并行创作，前提是文件域不相交；共享文件的集成点（角色词表 / 注册表 / 开关集合 / 调度表）由集成会话统一完成；多域的验证门 MAY 合并为一次运行，但任一域的删除步骤 MUST 在覆盖该域的门通过之后执行。

#### Scenario: 并行创作不破流水

- **WHEN** 域 1 与域 2 由不同会话并行创作且文件域不相交
- **THEN** 两域各自的删除步骤仍按序执行于合并验证门通过之后，台账各自登记

#### Scenario: 单域提交可独立回退

- **WHEN** 某域退役后需要回退
- **THEN** revert 该域的单次提交即恢复该域行为，不牵动其他域的接管状态

#### Scenario: 跨域合并删除被拒

- **WHEN** 一次提交同时删除清单中两个以上域的旧执行体
- **THEN** 该提交被判定不合规，必须拆分为逐域提交

#### Scenario: 顺序违规被拒

- **WHEN** 在域 1/2 的任务供给落地前尝试执行域 3
- **THEN** 该切片被拒绝并指出缺失的前置域

### Requirement: 每个退役切片走固定四步流水

每个域的退役 MUST 依次执行四步，步骤与产出固定如下：

1. **接管**：新实现进入生产装配路径，旧实现保留（双轨并存只允许存在于本步骤内，合入前必须完成切换）。
2. **验证**：全场景门逐位一致 + 该域新增单测绿 + `npm run arch:guard` 绿。
3. **删除**：同批删除旧实现、收缩豁免条目、同步清理词表/类型声明/console 引用/docs 死链、提交 Memory 迁移（如该域涉及）、台账新增一行。
4. **对账**：`npm run arch:guard` 条目数不大于上一检查点 + `npm run structure:guard` 绿 + `openspec validate legacy-consolidation --strict` 通过。

MUST NOT 跳步（如先删后测）、MUST NOT 把多步合并为一次不可区分的大提交。

#### Scenario: 四步产物齐备

- **WHEN** 任一域的退役切片完成
- **THEN** 能按上述四步各指出对应的提交/产物（装配挂载 diff、场景门读数、删除 diff、台账行）

#### Scenario: 先删后测被拒

- **WHEN** 某切片在未跑验证步骤的情况下删除了旧实现
- **THEN** 判定为流程违规，必须回退重走流水

### Requirement: 退役台账格式固定且如实登记四条件

每次退役 MUST 在 `docs/nexus-design/10-legacy-removal-ledger.md` 新增一行，列结构沿用现有表头（日期 / 删除单元（域）/ 豁免清单变化 / 四条件证据 / 结果），并遵守：

- 「豁免清单变化」写 `A→B（±n）` 格式；
- 四条件证据中实服条件未验证时 MUST 写「实服待补」，结果列 MUST NOT 标记为四条件齐备；
- 台账只增不改，回退以新行显式记录；
- 一次删除提交对应一行，一一对应。

#### Scenario: 缺台账行的退役被拒

- **WHEN** 存在删除旧执行体的提交但没有对应台账行
- **THEN** 该提交被判定不合规并拒绝合入

#### Scenario: 实服条件如实标注

- **WHEN** 退役只完成 sim 验证而未在私服跑满一个重置周期
- **THEN** 台账行实服列写「待补」，结论列不出现「四条件齐备」表述

#### Scenario: 台账不可涂改

- **WHEN** 某域退役后被回退
- **THEN** 原行保留，新增一行写「回退 + 理由」

### Requirement: 词表三方一致断言

角色词表（`UnitData`）必须满足三方一致：每个带 `executor` 声明的角色都有可执行的处理路径（任务 handler 或系统级管线）；每个有孵化需求源的角色都有可执行路径；反之每个可执行路径声明的 `executor` 都有词表条目。孤儿（任一侧缺失）MUST 清理或补齐，断言 MUST 由 structure-guard 自动执行。

#### Scenario: 词表无孤儿执行器

- **WHEN** structure-guard 运行三方一致断言
- **THEN** `executor` 声明集与可执行路径集与孵化源集的差集为空，越差集逐条列出

#### Scenario: 新增角色必须三方同步

- **WHEN** 后续新增一个角色
- **THEN** 词表条目、执行路径、孵化源必须同批出现，否则断言红

### Requirement: 豁免清单单调收缩与条目归口

豁免清单（`config/arch-allowlist.json`）MUST 满足：

- 条目总数对检查点文件（`config/arch-allowlist.min.json`）单调不增；每次退役后 MUST 推进检查点；
- 每条 track 注记 MUST 归属且仅归属三类之一：人操豁免（console 永久）、永久豁免（P4 movement 执行层）、待收编轨道（注明域）；
- A 波结束时总数 MUST ≤60；
- 无 track 或 track 不属于三类的条目 MUST 被守护标红。

#### Scenario: 退役后清单不回升

- **WHEN** 完成一次域退役并运行架构守护
- **THEN** 守护绿，且条目总数 ≤ 检查点值；若下降则检查点同批推进

#### Scenario: 无归口条目被标红

- **WHEN** 某条目的 track 为空或不在三类归口内
- **THEN** 守护输出该条目为待处置红项

### Requirement: 波序固定与震荡纪律

本变更三波顺序固定：A 波（域清单 1–8，即执行体与任务源退役）→ B 波（结构治理：拆分与类型清零）→ C 波（休眠与不可达退役）。波间闸门：A 波完成且豁免清单 ≤60 条才允许 B 波首个提交；B 波 structure-guard 全绿才允许 C 波首个提交。C 波对象依赖的活语义（如 `mineMission` 元素矿定编）MUST 已在 A 波迁移完成。

任何切片因门禁失败回退后，MUST 先在 `docs/bugs/` 留诊断记录（失败现象、归因、修正方案）才允许重试；未留诊断的表面改动重试（改一点再试、不行再回退的震荡循环）MUST 被拒绝。

#### Scenario: 波序闸门生效

- **WHEN** 豁免清单仍 >60 条时出现 B 波提交
- **THEN** 该提交被判定越波违规

#### Scenario: 震荡重试被拒

- **WHEN** 某切片回退后没有诊断记录就再次提交同类改动
- **THEN** 该重试被拒绝，要求先补诊断

### Requirement: 回归门与度量口径全变更统一

全变更的验证口径固定如下，任何切片 MUST 引用同一口径，MUST NOT 各自发明：

- **全场景门** = `node scripts/sim-matrix.mjs`（必要时 `--build`）覆盖参考六门（speedrun / boot / sprint / arena / race-body-audit / remote-mine），另加 `sim/run-residue.sim.ts` 与 `sim/stronghold-door.sim.ts` 单独跑绿；
- **逐位一致** = 参考快照中绿门场景的 RCL 时间线（L1–L4 到达 tick）与快照逐键相等；红门场景漂移仅告警不阻断；
- **CPU 红线** = 任一场景 cpu p95 较基线劣化 >2ms 即拒绝该切片；
- **基线** = A 波开工前冻结的读数（含豁免检查点、any/ts-nocheck 检查点、场景门快照），存档于本变更 `baseline/` 或既有 `sim-matrix-reference.json`。

#### Scenario: 口径引用一致

- **WHEN** 任一切片的验证说明声称「行为一致」
- **THEN** 其证据是上述口径的产出（sim-matrix 输出、p95 读数），而非其他自定义比较

#### Scenario: p95 劣化拒绝

- **WHEN** 某切片使任一场景 cpu p95 劣化超过 2ms
- **THEN** 该切片被回退，不得以「功能正常」为由放行
