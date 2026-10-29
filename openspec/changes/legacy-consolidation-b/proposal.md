# Proposal: legacy-consolidation-b

## Why

`legacy-consolidation` 的 A 波（旧执行体与旧任务源退役）已完成 19/33 任务：`exec()` 双轨、roleRegistry、mission pool 六池、`economy/units` 三族、词表死角色均已退场，任务板 + broker 成为唯一执行/供给路径。但变更止步于 A 波，剩余三块工作悬置：

- **B 波（结构治理）未动**：>600 有效行文件仍有 9 个（`movement/index.ts` 2483、`agentSystem.ts` 1648、`TeamAction.ts` 1284、`actionBroker.ts` 997、`63Planner.ts` 898、`baseFunction.ts` 724、`rosManor.ts` 717、`spawnDirector.ts` 619、`mine/state.ts` 605）；`@ts-nocheck` 31 文件、显式 `any` 684 处（`as any` 471）。其中 `actionBroker`/`spawnDirector`/`baseFunction` 是 A 波后新超限的，旧 spec 拆分表未覆盖。
- **C 波（休眠退役）未动**：`modules/external/mine/*` 六文件 + `outMine.ts`/`externalMine.ts`/`externalScheduler.ts`（合计 ~2900 行）休眠链仍在仓；PC 休眠模式、孤儿读口、死导出待清。且 A 波的数据面演进让旧 C 波清单**事实漂移**——`Memory.OutMineData` 已是 mineralWork/道路链的活簿记（power/deposit/highway 书 + RoadData），`HighwayMineVisual` 已有 console 人操消费方——直接按旧清单删会砍断活链，必须先复核再退役。
- **A 波收口（旧 5.2）未对账**：豁免清单已从 60 涨到 88（race 主链化新增 28 条冲级直通豁免），需按「非赛 ≤60 + 赛区隔离区登记」口径完成对账。

旧变更以 A 波切片为主线，剩余任务跨度大（B/C 两波 + 收口），承接为独立变更可让每波有独立验收边界；旧变更保留 A 波成果与基线资产（`baseline/sim-matrix-reference.json` 续用）。

## What Changes

- **A 波收口对账**（承接旧 5.2）：豁免清单 88 条逐条归口（28 条冲级赛直通隔离区 + 60 条非赛条目按 ≤60 闸门核对三类归口）、checkpoint 推进、台账行与提交一一对应。
- **C 波先行——休眠与不可达退役**（复核修正版清单）：external/mine 休眠链整链退役（连带 proto extend 行、`room.interface.d.ts` outMine 系声明、`registerOutMineIncomeProvider` 存根）；`OutMineData` 活簿记与 `mine` console 人操入口**保留**（仅删扫描证死的子键，无死键则不升版本）；PC `mode/assist|operate` 按「仅服务人工操作」显式定性（豁免登记或零触发部分退役）；qos/accessor 孤儿读口、`core/ai` 零引用导出、`makeCombatHealHandler` 等死导出按零引用扫描程序清理。
- **波序改定：C 波先于 B 波**——先删休眠代码再拆文件/收类型，避免对将死代码做拆分与类型修复（`mine/state.ts` 605 行因此豁免拆分登记）；休眠链运行期不可达，删除对回归门逐位一致无扰动，改序安全。
- **B 波一——巨型文件拆分**（行为零变化）：按当前基线钉死的拆分表执行——movement 六模块、agentSystem 按 task kind 拆 handler + logistics/remote/courier 模块、TeamAction 四域、63Planner 按规划阶段、actionBroker 拆类型契约/creep 执行器/structure+flag 执行器/broker 核心、rosManor/spawnDirector/baseFunction 按内聚判据——至 structure-guard 白名单外清零。
- **B 波二——类型门禁清零**：`@ts-nocheck` 31→0（speedrun 隔离区不计）、显式 `any` 684 单调降至收敛值，域序固定 planner→visuals→teams→movement→proto→console→core→utils。
- **总验收**：全场景门 8 门逐位一致 + cpu p95 不劣化 + 双守护绿 + 台账/文档同步 + 旧变更遗留任务处置注记。

## Capabilities

**New Capabilities**:

- `code-structure-standards`：B 波完成态契约——当前基线的拆分边界表（含 A 波后新超限文件）、波序改定（C 先 B 后）、类型逃逸清零域序与预算、B 波收口闸门。延续 `legacy-consolidation` 同名 change-local delta（归档时先归档旧变更）。
- `dormant-code-retirement`：C 波复核版契约——三口径事实复核程序（A 波后事实漂移的裁定规则）、复核后钉死的删除范围（OutMineData 活簿记保留边界）、人操链路显式定性、残留面连带清理与台账。

**Modified Capabilities**: 无（`openspec/specs/` 现仅 `cluster-squad`，不涉其需求）。

## Impact

- **代码**：`src/modules/external/`（mine 链删除）、`src/modules/movement|agents|teams|planner|spawning`、`src/proto/Room|PowerCreep`、`src/core/qos.ts|store/accessor.ts|ai`、`src/modules/visuals/highwayMine.ts`（定性后处置）——净删除预估 >2500 行 + 拆分搬移 ~9000 行。
- **守护与检查点**：`config/code-quality.json`（ts-nocheck/any/超限检查点推进）、`config/arch-allowlist.min.json`（随死导出清理收缩）、`scripts/structure-guard.mjs`（`mine/state.ts` 拆分豁免登记）。
- **Memory**：`OutMineData` 活簿记驻留；仅当复扫描证实存在仅由休眠链写入的死子键时才做最小迁移（幂等 + run-residue 验证），否则不升版本。
- **文档**：`docs/nexus-design/10-legacy-removal-ledger.md`（每删除单元一行）、`docs/bugs/legacy-consolidation-survey.md`（复核实测增节）、`02-architecture-charter.md` §21 结构注记、旧变更 tasks 处置注记。
- **回归线**：全部门禁沿用 `legacy-consolidation/baseline/sim-matrix-reference.json`（speedrun L4@28316 / arena L3@11629 / sprint L3@36171 / boot L3@8889 / race L2@458 / remote-mine L3@0 + run-residue/stronghold-door 单独跑），race 冲级时间线不得回退。
