# Tasks

> 编排：组 1 A 波收口对账 → 组 2 C 波（休眠退役，复核先行）→ 组 3 B 波一（巨型文件拆分）→ 组 4 B 波二（类型门禁清零）→ 组 5 总验收。
> **口径来源**：豁免对账口径与拆分边界/域序/闸门 → `specs/code-structure-standards`；休眠复核程序与钉死清单 → `specs/dormant-code-retirement`。实施 MUST 按 spec 口径执行，MUST NOT 现场重新规划切分、度量或验证方式。
> 每个删除/拆分切片走固定流水（复核实测 → 验证 → 删除/搬移 → 对账），完成后全场景门逐位一致（`node scripts/sim-matrix.mjs` + `run-residue`/`stronghold-door` 单独跑绿），任何漂移即回退该切片并在 `docs/bugs/` 留诊断后才可重试（震荡纪律）。

## 1. A 波收口对账（承接旧变更 5.2）

- [x] 1.1 豁免 88 条两分对账：`npm run arch:report` 逐条归类——28 条冲级赛直通隔离区（单列类目、终态登记、单调不增）+ 非赛 60 条三类归口（待收编轨道 / 永久豁免 / 随 C 波删除消失，与 dormant-code-retirement 清单联动）；无主条目即处置（接管计划/豁免登记/待删登记）；结论落 `docs/nexus-design/10-legacy-removal-ledger.md`；验证：arch:guard 绿 + 每条有明确类目与 track 注记 + 非赛 ≤60
- [x] 1.2 checkpoint 推进与台账核对：`config/arch-allowlist.min.json` 与 `config/code-quality.json` 对齐当前实测（88 条 / ts-nocheck 31 / any 684）；台账行与既有提交一一对应核验；验证：arch:guard + structure:guard 双绿 + `openspec validate legacy-consolidation --strict` 通过（旧变更 A 波部分）

## 2. C 波：休眠与不可达退役（复核先行，对象清单与程序按 `specs/dormant-code-retirement`，清单外只留档不动）

- [x] 2.1 复核实测总扫描（漂移裁定凭据源）：对清单 8 项逐一跑三口径复扫（全仓符号文本匹配 + 逐条归类真引用/注释/再导出穿透 + 场景不触发核对），结论增节留档 `docs/bugs/legacy-consolidation-survey.md`（含命令、命中、归类、裁定）；重点钉死：`OutMineData` 活子键 vs 死子键清单、`HighwayMineVisual`/console mine 人操面定性、PC `mode/assist|operate` 函数级零触发路径、road 链活消费方边界；验证：每对象有复核实测节且裁定与 spec 处置方向一致
- [x] 2.2 清单第 1 项 external/mine 链删除：删 `modules/external/mine/` 六文件、`outMine.ts`/`externalMine.ts`、`externalScheduler.ts`（注意：`road/` 目录与 `externalRoad.ts`/`expand/` 不在范围）、`proto/Room/index.ts` 的 OutMine import 与 extend 行、`room.interface.d.ts` outMine 系声明（outMine/EnergyMine/CenterMine）、`external/index.ts` 相关 re-export、`registerOutMineIncomeProvider` 存根及其消费方挂载行、structure-guard 白名单 `mine/state.ts` 行摘除、arch 豁免关联条目收缩、docs 死链同批修复；验证：全符号全仓扫描零（src/tests/sim/scripts/config/docs）+ 八门逐位 + run-residue 绿 + 台账行（实服待补）
  > 实现注记（2026-10-29）：连带删除 LookHighWay/PowerMine/DepositMine 声明与 RoomMemory 死域字段（powerMine/depositMine——写入方已亡，活面走 OutMineData 域）；PROTO_IMPORTS_FROZEN 留档行随文件消亡摘除。门跑归因：首轮对旧基线全红系基线过期（53 提交演进），按 0.2 先例 HEAD 重冻（baseline/2026-10-29-baseline-refreeze.md，U.12 三重对照证明删除零扰动）后八门全绿逐位一致
- [x] 2.3 清单第 2 项 OutMineData 死键处置：按 2.1 复扫结论——若死子键实证存在则最小 Memory 迁移（纯函数/幂等/一次删净 + schema 单测 + run-residue 验证），无死键则仅台账登记「活簿记保留」；验证：复扫结论与处置一一对应 + mineralWork/road/console/statistics 活读写面全场景门内行为不变
  > 实现注记（2026-10-29）：复扫结论 U.2——全子键（energy/centerRoom/highway/powerMine/depositMine/RoadData/RoadVersion）均有链外活读写方，**无死键**；不升 Memory 版本、零迁移。energy 子键自动扩图写入方（mine/state.ts autoAddNearbyEnergyTargets）随 2.2 消亡，写入面收敛为人操（台账定性行登记）
- [x] 2.4 清单第 3–4 项 PC mode 与 HighwayMineVisual 定性：PC `mode/assist|operate` 按函数级复扫——零触发死函数退役、活模式（或整项）转显式保留 + 台账登记 + 摸底档留证；`HighwayMineVisual` + console mine.ts 命令族登记人操豁免保留（写 OutMineData 活簿记，无自动调用点）；验证：扫描结论附提交 + arch:guard 人操豁免 track 注记齐 + 八门逐位
  > 实现注记（2026-10-29）：U.3 结论——PC mode 整链是 PowerCreeps TickModule 主径（main.ts:49 挂载，pc.exec 每 tick 分发），「零触发路径部分」实为已删的 assistHeal.ts（4.5b）；整项转显式保留，零删除。U.4 结论——HighwayMineVisual 三处 console 消费实证，人操豁免保留（豁免 track 注记既有）。台账定性行已登记
- [x] 2.5 清单第 5–8 项死导出与孤儿读口：`qos.ts` 证死读口、`accessor.ts` 证死 getter（`getOutMineData` 保留）、`core/ai` 证死导出（behaviorTree 活消费保留）、`makeCombatHealHandler` 工厂、statistics/console 对已删域读口——逐符号零引用扫描程序四步（文本匹配 → 归类 → 真引用为零才删 → 结论附提交）；验证：各符号扫描归档 + structure-guard/arch:guard 绿 + `npm run lint` 绿 + 台账行
  > 实现注记（2026-10-29）：删除面——qos ROLE_CPU_FREEZE_PRIORITY 表 + shouldSkipCreepInEmergency（QoSAPI 聚合面/成员不动）、core/ai/{stateMachine,adapters}.ts 整文件（behaviorTree 留，aio.ts 活消费）、teams/units/combatHeal.ts 整文件 + barrel 行（工厂零消费；combatHeal 纯函数在 modules/combat 活）。U.6 结论——accessor getter 全活零处置；statistics energyState 读口活（5.1 既有裁定）。U.10——bucketGovernor 阈值消费方随 2.2 消亡，清单外只留档。lint 仅 speedrun 隔离区既有 warning（终态）
- [x] 2.6 C 波收口对账：豁免清单非赛条目数较 1.1 下降（external/mine 关联条目出清）、structure-guard 白名单只减不增、`mine/state.ts` 超限随删除出清；验证：双守护绿 + 台账 C 波行齐（每行实服列如实标「待补」）+ 摸底档复核实测节与删除提交一一对应
  > 实现注记（2026-10-29）：external/mine 链删除零豁免条目（2026-10-17 已收编）——非赛条目 60 不变（无 C 波关联条目，1.1 对账表已预告）；白名单/PROTO_IMPORTS_FROZEN 留档行随文件消亡摘除，超限 9→8（mine/state.ts 出清）；checkpoint 推进 {tsNocheck 31, any 670, asAny 463, lineLimitOver 8}；台账新增 3 行（切片一/切片二/定性行）实服列均标「待补」

## 3. B 波一：巨型文件拆分（行为零变化，拆分边界按 `specs/code-structure-standards` 表执行，表内文件串行）

- [x] 3.1 `movement/index.ts`（2483）拆为路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动六模块 + 薄装配层；`preTickBetterMove → commit → endTickResolve` 时序与 `Creep.prototype.moveTo` 猴补丁挂载点原样保持（P4 豁免身份不变）；验证：全场景门逐位 + `run-residue`/`stronghold-door` 单独绿（时序旁证）+ 拆分前后导出面 diff 为空 + 提交内除搬移/导入/类型标注外零变更行
  > 处置注记（2026-10-29，用户裁定）：**本变更不拆**。前置分析实证 46 个函数经 40+ 个模块级共享可变绑定（ops/toPos/path/idx/creepCache/costMatrixCache 等，`costMatrixCache` 被 22 函数引用）连通成单一分量——ES 模块 import 绑定跨模块只读（tsc TS2539），六模块拆分与「除搬移/导入/类型标注外零变更行」验证条款互斥。处置：structure-guard 白名单登记（同 mine/state.ts 先例）；状态命名空间化（S.xxx 属性访问改写）后另立变更执行拆分。三入口时序/挂载点/P4 豁免身份不动
- [x] 3.2 `agentSystem.ts`（1648）拆分：`runCreep`（484 行）按 task kind 拆 handler 单元（scout/harvest/carry+fill_spawn/upgrade/build/repair/claim/reserve/defend/retreat），公共取料/送货辅助独立 `logistics` 模块，远程采集族（remoteHarvest/remoteCarry/relay 接力）独立 `remote` 模块，rush-courier 族（runCourierCreep/submitCourier*）独立 `courier` 模块；`runAgents` 签名与所有权登记主循环不变；为拆出 handler 补分派单测；验证：全场景门逐位 + 新单测绿 + 导出面 diff 为空
  > 实现注记（2026-10-29）：落位 agentLogistics.ts（辅助族 + RANGE 常量，475 行）/agentHandlers.ts（runCreep 11 路分派，504 行）/agentCourier.ts（129 行）/agentRemote.ts（668 行）+ agentSystem.ts 薄核心（runAgents + reportIdleUnit，144 行）。依赖图单向无环、零模块级可变状态跨段；29 函数体与 HEAD 逐字 diff 一致。分派单测 tests/agent-dispatch.test.ts 10 例（57/57 绿）。八门逐位齐（arena/sprint 首轮 p95 +3ms 系外部构建负载，静机复跑 GREEN）
- [x] 3.3 `TeamAction.ts`（1284）拆为队形集结 / 移动执行 / 代价矩阵 / 路径缓存四域内部模块，对外仍以 `TeamAction` 命名空间整体导出（调用方零改动）；验证：全场景门逐位（含 arena/stronghold-door）+ 导出面 diff 为空
  > 实现注记（2026-10-29）：落位 teamActionData（数据属性，32）/teamActionGather（集结族，622）/teamActionMove（推进执行，655）/teamActionDirection（方向解算，352）/teamActionCostMatrix（190）/teamActionPathCache（85）+ spread 装配层 TeamAction.ts（22）。27 成员体与 HEAD 逐字 diff 一致；this 互调经合并对象绑定语义不变。两处边界内最小调整：① moveExec 域 798 有效行超 600，域内二分 move+direction；② ts-nocheck 债务同源计量（5 域文件共享原 1 份，guard 计 1）；③ arch 转发豁免随 move 域迁移至 teamActionMove.ts（211 处直连总数不变）。八门逐位齐（speedrun/sprint/boot 首轮 p95 +3ms 系外部构建负载，静机复跑 GREEN）
- [x] 3.4 `actionBroker.ts`（997）拆为类型契约（ActionKind/Payload/Result/Deps 接口族）/ creep 管线执行器（case 表）/ structure+flag 执行器（executeStructureAction/executeFlagAction 及 case 表）/ broker 核心与共享单例 四模块；全部导出名与 `ActionBroker` 接口不变；验证：全场景门逐位 + 导出面 diff 为空 + 既有 broker 单测绿
  > 实现注记（2026-10-29）：落位 brokerTypes.ts（类型契约 + CREEP/BATCH_PIPELINES 导出）/brokerExecutorsShared.ts（ExecutorBase/makeInvalid/resolveTarget/triageCode 纯函数）/brokerCreepActions.ts（creep case 表 19 case）/brokerStructActions.ts（flag/structure/system 执行器 23 case）+ actionBroker.ts 薄核心。导出面 12 = 12（调用方零改动）；commit/submit/单例段与 HEAD 逐字 diff 一致；case 表逐字搬移（仅 dedent + helper 改名）。重写期曾漏 commit 尾部 onReplan/warn 块，逐字核对抓出修复后跑门。豁免条目 88→91：attack/heal/repair 拆入两执行器文件后 per-file 计量双登记（非新调用点，211 处总数不变，--allow-growth 留档）；structure-guard 超限 9→7 出清。六门 GREEN 逐位 + p95 带内 + run-residue L2@1059/p95 4ms ✓ + stronghold-door L8@0/p95 5ms ✓（八门齐绿）
- [ ] 3.5 `63Planner.ts`（898）按规划阶段拆分（`ensurePlannerState`/`autoPlanner63` 导出面不变）；`baseFunction.ts`（724）按成员函数职责域拆 mixin 单元（`export default class BaseFunction` 聚合面与 extend 链零改动）；验证：全场景门逐位 + 导出面 diff 为空 + typecheck 绿
- [ ] 3.6 `rosManor.ts`（717）与 `spawnDirector.ts`（619）拆分：庄园几何按内聚判据（computeManor/MANOR_SPAWN_CHEBYSHEV 导出面不变）；spawnDirector 拆主排程 / directSpawn 面板 / race 远程定编族（三组导出签名不变）；验证：structure-guard 规模扫描白名单外清零（`mine/state.ts` 已随 2.2 出清）+ 全场景门逐位

## 4. B 波二：类型门禁清零（域序/预算口径按 `specs/code-structure-standards`，逐文件小步）

- [ ] 4.1 `@ts-nocheck` 31 文件清零，域序固定：planner（13）→ visuals（3，`highwayMine.ts` 按 2.4 定性处置）→ teams（3）→ movement（2）→ proto（5）→ 其余（5：console/core/utils）；每文件：移除标记 → 类型收窄与显式判空（MUST NOT `!` 断言与 `as any` 逃逸）→ typecheck 绿 → 全场景门逐位（同域多文件 MAY 合并一次门跑）→ 下一文件；验证：全仓 `@ts-nocheck` 计数 0（speedrun 隔离区不计）+ typecheck 绿 + 检查点推进
- [ ] 4.2 显式 `any` 684 按域序收敛：planner → movement → teams → visuals → proto → console → core → utils；改精确类型或 `unknown` + 收窄；`config/code-quality.json` 检查点每切片推进（单调不增，目标 ≤300）；验证：structure-guard 绿 + 检查点达标值落档
- [ ] 4.3 B 波收口闸门（总验收前置）：structure-guard 全绿（600 行白名单外 0、ts-nocheck 0、any 达标、依赖方向零新增违规、词表三方一致绿）+ `npm run typecheck` 绿 + 全场景门 8 门逐位；验证：三绿读数存档本变更 `baseline/` 目录

## 5. 总验收与对账

- [ ] 5.1 全场景门总验：8 场景全绿逐位一致 + cpu p95 对基线不劣化（>2ms 拒绝）+ `run-residue`/`stronghold-door` 绿；读数存档本变更 `baseline/`；race 门 L2@458 逐位（AGENTS.md 冲级硬指标不回退）；验证：读数档 + 与 `legacy-consolidation/baseline/sim-matrix-reference.json` 对照结论
- [ ] 5.2 指标对账：净删除行数、豁免清单终值（赛区 28 单列 + 非赛 ≤60 每条归口三类之一）、ts-nocheck 0、any 检查点终值、600 行白名单外 0、词表三方一致绿、依赖方向零新增违规；台账逐行核对（每行实服列如实标「待补」，行与提交一一对应）；验证：对账结论落台账 + 双守护绿
- [ ] 5.3 文档与旧变更收尾：`docs/nexus-design/02-architecture-charter.md` §21 结构注记更新（休眠链退场 + 拆分完成态）、`10-legacy-removal-ledger.md` 台账行齐、旧变更 `legacy-consolidation/tasks.md` 剩余任务（5.2/6.x/7.x/8.x/9.x）加处置注记（由本变更承接，指向本变更任务号）；AGENTS.md 准则核对（无参考来源注释、属主 nightx:night、未擅自提交）；验证：`openspec validate legacy-consolidation-b --strict` 通过 + 旧变更注记与本文档任务号一一对应
