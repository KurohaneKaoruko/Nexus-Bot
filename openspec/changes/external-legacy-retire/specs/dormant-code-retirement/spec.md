# Spec Delta

## MODIFIED Requirements

### Requirement: 休眠对象清单固定

本清单新增 C 波收尾批次（`external-legacy-retire`）。清单内对象实施 MUST NOT 清单外扩
（新发现对象按三口径程序补档后，经 spec 修订入清单才可退役）：

| 对象 | 体量 | 判定要点 | 连带清理面 |
|---|---|---|---|
| 旧外矿词表死角色 `out-build / out-defend / out-2attack / out-2heal / out-invader / out-attack / out-ranged / out-mineral / out-repair` | 9 词条 + 4 分级表 + 3 体型特例 | 无孵化源（`UNIT_DRIVE_ATTRIBUTION` 归 `dormant-spawn`），`GetUnitBodys` 全仓仅以 `UNITS.harvester` 调用 | `UnitData` 条目、`UnitLevelData` 分级表、`UNITS` 中文名、`bodyFunction.ts` 三个 `case` 分支、structure-guard 驱动面登记行、文档引用 |
| console `mine.ts` 旧外矿人操面（`mine.add/adds/remove/list/clearRoad` + `road.*`） | ~500 行 | 外矿目标管理已由 `Nexus.remote.pin/ban/clear/list` 覆盖；旧桶（`energy`/`centerRoom`）无自动消费方 | 入口函数、`helpMine`/`helpRoad` 文案、`OutMineData.energy/centerRoom` 类型、HUD 统计消费口径 |
| `modules/external/externalRoad.ts` + `modules/external/road/*`（roadBuilder / pathPlanner / roadMemory / roadVisual / costMatrixCache） | ~2070 行 | 全仓无自动调用点：仅 console 人操面与 `bodyFunction.ts` carrier 死分支引用；活链路面配比已由 `spawnArbiter` 消费 `roadCoverageOf` | `externalRoad.ts` 入口、`modules/external/index.ts` 再导出、`bodyFunction.ts` carrier 分支、`RoadData`/`RoadVersion`/`OutMineRoadMemory`/`RoomMemory.road` 类型、console `road.*`、帮助文案、结构/架构豁免行 |

#### Scenario: 清单外对象不退役

- **WHEN** 本轮实施中发现清单外的疑似休眠对象
- **THEN** 本变更不处理，仅补摸底档留证，待 spec 修订入清单

#### Scenario: 清单内对象逐项有档

- **WHEN** 本批次完成
- **THEN** 清单每行对应摸底档条目与删除提交一一对应，扫描命令/命中数/归类随提交说明留档

### Requirement: 退役必须连带清理全部残留面

休眠代码退役 MUST 同批清理以下全部残留面，缺一即切片不完整：实现文件、类型声明（`.d.ts` 条目）、console 人操入口（删除或改指新实现 + 帮助文案同步）、Memory 结构（并入当波迁移版本）、常量词表条目、文档引用（`docs/` 死链修复）、豁免清单条目、structure/arch 白名单中的关联行。MUST NOT 留下悬空声明、指向已删符号的注释或 `docs` 死链。

本轮补充口径：

- 删除 `OutMineData.energy/centerRoom` 后，其**读取方**（HUD 统计）MUST 改读
  `Nexus.remotes` 同义数据，不得以删字段方式静默丢统计；
- `OutMineData.highway / powerMine / depositMine` 是活链（`mineralWork` 消费），
  MUST 保留且 MUST NOT 被本批清理波及；
- 存量 Memory 旧字段不做破坏性迁移（读取方退场后由字段自然过期）。

#### Scenario: 退役后全仓无残留引用

- **WHEN** 任一休眠对象删除完成
- **THEN** 对该对象全部符号的全仓扫描（源码 + 类型 + console + docs + config）命中为零，
  仅注释/文档提及按连带清理面同步改写

#### Scenario: 文档死链同步修复

- **WHEN** 删除的对象被 `docs/` 引用
- **THEN** 同批修复引用文档（删除引用或改写为现行实现），`docs` 内无指向已删文件的链接

### Requirement: 仅服务人工操作的链路必须显式定性

只被人工操作使用的链路 MUST 二选一并留档：（一）迁为任务板任务（人操入口行为不变，目标可被任务消费）；（二）显式保留并登记为人操豁免（豁免清单 track 注记「人操豁免」+ 台账留档，该链路 MUST NOT 被自动流程调用）。MUST NOT 沉默保留（既不迁出也不登记）。

本轮新定性：

- `mine.power / mine.deposit / mine.cancel / mine.auto / mine.mapShow / mine.mapHide`
  维持人操豁免：写 `OutMineData.powerMine/depositMine` 与
  `RoomData.outminePower/outmineDeposit`，由 `mineralWork` 自动消费；入口本身无自动调用点；
- `mine.add / mine.adds / mine.remove / mine.list / mine.clearRoad` 与 `road.*`
  不登记豁免，直接退役（能力由 `Nexus.remote.*` 取代）。

#### Scenario: 未定性链路被列为待处置

- **WHEN** 某链路只有人操入口而无自动调用点，且未登记豁免
- **THEN** structure/arch 守护将其列为待处置项，要求给出迁移或豁免结论

#### Scenario: 显式保留的链路有边界

- **WHEN** `mine.power/deposit/cancel/auto/mapShow/mapHide` 登记人操豁免
- **THEN** 该链路无自动调用点（调用方扫描只有 console 入口），直连调用计入豁免清单且受单调约束

## REMOVED Requirements

（无）
