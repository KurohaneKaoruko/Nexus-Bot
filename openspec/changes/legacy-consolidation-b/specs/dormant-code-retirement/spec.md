# Spec Delta

## Purpose

把 C 波休眠与不可达代码退役落成可执行契约：A 波后事实漂移的复核程序、复核后钉死的删除范围、人操链路显式定性、残留面连带清理与台账登记。实施会话 MUST 按复核程序与钉死范围执行，MUST NOT 现场扩大或缩小退役范围。

## ADDED Requirements

### Requirement: 休眠判定以 A 波后事实复核为准

旧清单基于 A 波前的摸底（`docs/bugs/legacy-consolidation-survey.md`）；A 波的数据面演进可能改变消费关系。任一清单对象删除前 MUST 先跑三口径复核实测（无挂载全仓扫描 / 残留面定性 / 全场景门不触发），并按下列裁定规则处置漂移：

- 复核确认真休眠 → 按休眠退役程序删除；
- 复核发现活消费方（含人操入口、活簿记读写）→ 该对象的**休眠子面**（证死的函数/模式/导出）与**活面**（消费方在用的函数/数据）分开处置：死子面退役、活面保留并在台账登记保留理由；MUST NOT 因「所在模块判休眠」而连带删除活面；
- 复核发现仅人操消费 → 按「人操链路显式定性」处置，不按休眠删除。

复核实测结论 MUST 增节留档在摸底档（`docs/bugs/legacy-consolidation-survey.md`），删除提交 MUST 引用该节。

#### Scenario: 活簿记不被连带删除

- **WHEN** `Memory.OutMineData` 被复核证实为活簿记（mineralWork/道路链/console 人操入口读写）
- **THEN** `OutMineData` 结构与 `getOutMineData` accessor 保留，仅其休眠写入方（external/mine 链）删除，台账登记保留理由

#### Scenario: 漂移裁定留档

- **WHEN** 某清单对象复核结论与旧摸底不一致
- **THEN** 摸底档新增该对象的复核实测节（扫描命令、命中、归类、裁定），删除提交引用该节

#### Scenario: 复核后仍需三口径齐备

- **WHEN** 某对象复核无漂移、维持休眠判定
- **THEN** 删除前仍需三口径凭据齐备（无挂载、仅残留面、场景不触发），任一缺失即不得删除

### Requirement: C 波退役范围钉死

本波退役对象钉死为下列清单，MUST NOT 清单外扩（新发现对象按同一三口径程序补档后，经 spec 修订入清单才可退役）：

| # | 对象 | 复核起点（2026-10-27 基线） | 处置方向 |
|---|---|---|---|
| 1 | `modules/external/mine/*`（analysis/math/runtime/shared/spawner/state，~2650 行）+ `outMine.ts`/`externalMine.ts` + `externalScheduler.ts` | outMine 原型方法零调用（features.ts 勘误）；road 链（RoadBuilder/RoadMemory/CostMatrixCache/PathPlanner/RoadVisual）有活消费方**不在本项范围** | 整链删除：`mine/` 目录 + 三入口文件 + proto/Room 的 extend 行与 import + `room.interface.d.ts` outMine 系声明 + `registerOutMineIncomeProvider` 存根 + structure-guard 规模白名单中的 `mine/state.ts` 行 |
| 2 | `Memory.OutMineData` | **活簿记**：mineralWork（power/deposit/highway 书，economy 生产路径）、road 链 RoadData、console mine.ts 人操入口、statistics/roomVisuals/usePower 读 | 保留；仅当子键级复扫描证实存在仅由休眠链写入的死子键时，做最小迁移（幂等 + run-residue 验证）后删除死键，否则不升 Memory 版本 |
| 3 | `proto/PowerCreep/mode/assist.ts` + `mode/operate.ts` | `runAssist`/`runOperate` 被 `execute.ts` 调用——是 PC 驱动链的活模式而非零引用死文件；旧清单「零触发路径部分」需逐函数复核 | 零触发路径的死函数退役、活模式保留；若复核为全活则整项转「显式保留 + 台账登记」并在摸底档留证 |
| 4 | `modules/visuals/highwayMine.ts`（~469 行） | 有活消费方：console `mine.ts` 人操入口三处调用 | 按人操链路定性处置（豁免登记保留），MUST NOT 按零引用删除 |
| 5 | `core/qos.ts` 兼容读口 | `getRoomQosLevel` 类读口随 A 波回收期已不存在；文件本体是活 QoS 基建（noteTickCpu/shouldRun 等有全仓消费） | 仅删证死的孤儿读口函数与其独占辅助，文件本体不动 |
| 6 | `core/store/accessor.ts` legacy getter | `getOutMineData` 是活簿记 accessor（保留）；仅删随域删除后零消费方的 getter | 逐 getter 零引用扫描，证死才删 |
| 7 | `core/ai` 零引用导出 | behaviorTree 有活消费方（teams/units/aio.ts）；stateMachine/adapters 待零引用扫描 | 证死导出退役，活导出保留 |
| 8 | 死导出收敛：`makeCombatHealHandler` 工厂、statistics/console 对已删域的读口 | A 波 4.5b 注记登记的零消费方工厂；statistics 读 `OutMineData`/spawn 池属活消费 | 证死才删；活读口随其数据面保留 |

#### Scenario: 清单外对象不处理

- **WHEN** 复核中发现清单外的疑似休眠对象
- **THEN** 本波只留档（摸底档补条目），不删除，待 spec 修订入清单

#### Scenario: road 链不被误删

- **WHEN** 删除清单第 1 项 external/mine 链
- **THEN** `modules/external/road/` 的 RoadBuilder/RoadMemory/CostMatrixCache/PathPlanner/RoadVisual 及其活消费方（proto/Room baseFunction、console、teams）不受影响

#### Scenario: 删除范围与清单一致

- **WHEN** C 波完成
- **THEN** 清单每行对应摸底档复核实测节与删除提交一一对应，无清单外删除

### Requirement: 休眠退役必须连带清理全部残留面

休眠代码退役 MUST 同批清理以下全部残留面，缺一即切片不完整：实现文件、类型声明（`.d.ts` 条目）、console 人操入口（删除或改指新实现 + 帮助文案同步）、Memory 死键（走最小迁移）、常量词表条目、文档引用（`docs/` 死链修复）、豁免清单条目、structure/arch 白名单中的关联行。MUST NOT 留下悬空声明、指向已删符号的注释或 `docs` 死链。

#### Scenario: 退役后全仓无残留引用

- **WHEN** 任一休眠对象删除完成
- **THEN** 对该对象全部符号的全仓扫描（src/tests/sim/scripts/config/docs/openspec）命中为零（文档与台账的历史引用除外）

#### Scenario: 文档死链同步修复

- **WHEN** 删除的对象被 `docs/` 引用
- **THEN** 同批修复引用文档（删除引用或改写为现行实现），现行文档内无指向已删文件的链接

### Requirement: 零引用判定以固定扫描程序为准

删除死符号/死导出/死读口前 MUST 执行固定扫描程序，MUST NOT 以「看起来没用到」作为判据：

1. 符号名全仓文本匹配（`src/`、`tests/`、`sim/`、`scripts/`、`config/`、`docs/`、`openspec/`）；
2. 命中逐条人工归类：真引用 / 注释或文档提及 / 再导出穿透（追到最终消费方）；
3. 仅当真引用为零（注释与文档提及记入连带清理面）才可删除；
4. 扫描结论（命令、命中数、归类）附在删除提交说明或摸底档。

#### Scenario: 扫描为零才可删除

- **WHEN** 某导出符号扫描真引用为零
- **THEN** 可删除，提交说明附扫描结论

#### Scenario: 存在真引用则不得删除

- **WHEN** 扫描发现任一真引用（含再导出穿透后的消费方）
- **THEN** 该符号不得删除，须先处置引用方或转保留定性

### Requirement: 仅服务人工操作的链路必须显式定性

只被人工操作使用的链路 MUST 二选一并留档：（一）迁为任务板任务（人操入口行为不变，目标可被任务消费）；（二）显式保留并登记为人操豁免（豁免清单 track 注记「人操豁免」+ 台账留档，该链路 MUST NOT 被自动流程调用）。MUST NOT 沉默保留。本波既定定性：console `mine.ts` 命令族 + `HighwayMineVisual`（人操外矿管理面，写 `OutMineData` 活簿记）登记人操豁免保留；`warSpawn` 旗标链维持 A 波既有豁免身份不变。

#### Scenario: 人操链路登记后受边界约束

- **WHEN** console mine 命令族登记人操豁免
- **THEN** 其直连调用计入豁免清单且受单调约束，无自动调用点新增

#### Scenario: 未定性链路被列为待处置

- **WHEN** 某链路只有人操入口而无自动调用点，且未登记豁免
- **THEN** 守护将其列为待处置项，要求给出迁移或豁免结论

### Requirement: C 波对 B 波的让位关系

对已判休眠待删的代码，MUST NOT 执行 B 波的拆分与类型修复（避免对将死代码做结构投资）；`mine/state.ts` 的 >600 行超限因整文件待删而登记白名单豁免（理由：C 波删除对象），C 波删除后白名单行同步摘除。C 波 MUST 先于 B 波完成（或至少 external/mine 链删除先于 movement/planner 拆分），B 波的 ts-nocheck/any 清理 MUST NOT 触及已列入 C 波删除清单的文件。

#### Scenario: 将死代码不进拆分表

- **WHEN** B 波钉拆分表时 `mine/state.ts` 仍超 600 行
- **THEN** 它以「C 波删除对象」理由入白名单，不出现在拆分任务中

#### Scenario: C 删后白名单同步收缩

- **WHEN** external/mine 链删除完成
- **THEN** structure-guard 白名单中对应行同批摘除，白名单只减不增
