# Spec Delta

## Purpose

定义休眠与不可达代码的判定口径与退役契约：什么算休眠、退役必须连带清理什么、只服务人工操作的链路如何归属、「零引用」如何被客观验证。本 spec 钉死**休眠对象清单**（哪些子系统按什么口径判定、凭据落在哪里）与**判定/删除的固定程序**，实施会话 MUST 按清单与程序执行，MUST NOT 现场扩大或缩小退役范围。

## ADDED Requirements

### Requirement: 休眠判定必须同时满足三个口径

一个子系统 MUST 同时满足以下三条才可判定为休眠，判据 MUST 可审计：

1. **无挂载**：不在装配清单（`main.ts` / 变体入口 `nexus.use` 链）中挂载，且全仓无可达调用点（import 扫描 + 调用点扫描均为零，穿透再导出：`index.ts` 的 re-export 不算调用，须追到最终消费方）；
2. **仅残留声明/人操入口**：残留面仅类型声明（`.d.ts`）、console 人操入口或常量表，无运行时自动调用；
3. **场景不触发**：全场景门运行期（含 sim 插桩）不被触发执行。

任一不满足 MUST NOT 判为休眠（按活代码对待）。判定结论与三条凭据 MUST 落档在 0.3 摸底档（`docs/bugs/`），删除提交 MUST 引用该档。

#### Scenario: 缺一条即不得判休眠

- **WHEN** 某子系统无挂载点但运行时被间接调用（如经再导出被消费）
- **THEN** 该子系统按活代码对待，不得进入退役清单

#### Scenario: 判定留可审计凭据

- **WHEN** 某子系统被判定为休眠
- **THEN** 摸底档存在其条目，含装配清单核对结果、引用扫描输出、场景插桩结论三项凭据

### Requirement: 休眠对象清单固定

本变更 C 波的休眠/不可达对象固定为下列清单，实施 MUST NOT 清单外扩（新发现对象按同一三口径程序补档后，经 spec 修订入清单才可退役）：

| 对象 | 体量 | 判定要点 | 连带清理面 |
|---|---|---|---|
| `modules/external/mine/*`（analysis/math/runtime/shared/spawner/state） | ~2650 行 | 活链是 `economy/remoteMining`；全链无调用点（`outMine()` 原型方法零调用已由 features.ts 勘误证实） | `outMine.ts`/`externalMine.ts`/`externalScheduler.ts`、`Memory.OutMineData`（v14 或并入 v13）、console `mine.ts` 人操入口、`room.interface.d.ts` 的 `outMine` 系声明 |
| `proto/PowerCreep/mode/*` 休眠模式（assist/operate 中零触发路径部分） | 按扫描 | 仅 `pcHeal`/`assistHeal` 有活跃路径（A 波域 4 归位后确认） | 模式声明、`PowerCreep/index.ts` 注册、`power.interface` 残留 |
| `modules/visuals/highwayMine.ts` | ~469 行 | 零挂载（仅 `visuals/index.ts` re-export，无消费方） | re-export 行、对应视觉类型 |
| `core/qos.ts` 兼容读口 | 按扫描 | legacy 消费方随 A 波退场后的孤儿读口 | 读口函数与其独占辅助 |
| `core/store/accessor.ts` legacy getter | 按扫描 | `getOutMineData` 等随域删除后无消费方的 getter | getter、关联 Memory 类型字段 |
| 词表死角色（out-\* 无孵化源者、deposit-haul/take、power-haul/take 等零源条目） | 按扫描 | 已由 `role-registry-executor-gap.md` 摸底，A 波域 6 执行 | 词表条目、executor 字段、UnitLevelData、中文名、qos 冻结权重、boost 表行 |
| 死导出（`core/ai` 单消费方库面外的零引用导出等） | 按扫描 | 全仓引用扫描为零 | 导出及其文件（若整文件死） |

#### Scenario: 清单外对象不退役

- **WHEN** C 波实施中发现清单外的疑似休眠对象
- **THEN** 本变更不处理，仅补摸底档留证，待 spec 修订入清单

#### Scenario: 清单内对象逐项有档

- **WHEN** C 波完成
- **THEN** 清单每行对应摸底档条目与删除提交一一对应

### Requirement: 退役必须连带清理全部残留面

休眠代码退役 MUST 同批清理以下全部残留面，缺一即切片不完整：实现文件、类型声明（`.d.ts` 条目）、console 人操入口（删除或改指新实现 + 帮助文案同步）、Memory 结构（并入当波迁移版本）、常量词表条目、文档引用（`docs/` 死链修复）、豁免清单条目、structure/arch 白名单中的关联行。MUST NOT 留下悬空声明、指向已删符号的注释或 `docs` 死链。

#### Scenario: 退役后全仓无残留引用

- **WHEN** 任一休眠对象删除完成
- **THEN** 对该对象全部符号的全仓扫描（源码 + 类型 + console + docs + config）命中为零

#### Scenario: 文档死链同步修复

- **WHEN** 删除的对象被 `docs/` 引用
- **THEN** 同批修复引用文档（删除引用或改写为现行实现），`docs` 内无指向已删文件的链接

### Requirement: 仅服务人工操作的链路必须显式定性

只被人工操作使用的链路 MUST 二选一并留档：（一）迁为任务板任务（人操入口行为不变，目标可被任务消费）；（二）显式保留并登记为人操豁免（豁免清单 track 注记「人操豁免」+ 台账留档，该链路 MUST NOT 被自动流程调用）。MUST NOT 沉默保留（既不迁出也不登记）。本变更的既定定性：`proto/Flag/function/warSpawn.ts`（attack-claimer/logistic/dismantle 手动旗标孵化）登记人操豁免保留；console 命令族维持人操豁免身份不变。

#### Scenario: 未定性链路被列为待处置

- **WHEN** 某链路只有人操入口而无自动调用点，且未登记豁免
- **THEN** structure/arch 守护将其列为待处置项，要求给出迁移或豁免结论

#### Scenario: 显式保留的链路有边界

- **WHEN** warSpawn 链路登记人操豁免
- **THEN** 该链路无自动调用点（调用方扫描只有 Flag 特性链的人操触发），直连调用计入豁免清单且受单调约束

### Requirement: 零引用判定以全仓扫描为准

删除死符号/死角色/死导出前 MUST 执行固定的全仓扫描程序，MUST NOT 以「看起来没用到」作为判据。扫描程序固定为：

1. 符号名全仓文本匹配（`src/`、`tests/`、`sim/`、`scripts/`、`config/`、`docs/`、`openspec/`）；
2. 命中逐条人工归类：真引用 / 注释或文档提及 / 再导出穿透（追到最终消费方）；
3. 仅当真引用为零（注释与文档提及记入连带清理面）才可删除；
4. 扫描结论（命令、命中数、归类）附在删除提交说明或摸底档。

#### Scenario: 扫描为零才可删除

- **WHEN** 某导出符号扫描真引用为零
- **THEN** 可删除，提交说明附扫描结论

#### Scenario: 存在真引用则不得删除

- **WHEN** 扫描发现任一真引用（含再导出穿透后的消费方）
- **THEN** 该符号不得删除，须先处置引用方

#### Scenario: 再导出穿透

- **WHEN** 符号仅被 `index.ts` re-export
- **THEN** 追踪该 re-export 的下游 import；下游为零才算零引用
