# Tasks

> 编排：组 0 地基 → 组 1–5 为 A 波（旧执行体与旧任务源退役，组内按 spec 钉死的 8 域清单切片串行）→ 组 6–7 为 B 波（结构治理）→ 组 8 为 C 波（休眠退役）→ 组 9 总验收。
> **口径来源**：域清单与顺序、四步流水、波间闸门、回归门统一口径 → `specs/legacy-execution-retirement`；旧池语义映射表与快照对照程序 → `specs/mission-pool-retirement`；600 行白名单/拆分边界/依赖规则/any 域序/ts-nocheck 顺序 → `specs/code-structure-standards`；休眠对象清单与扫描程序 → `specs/dormant-code-retirement`。实施 MUST 按 spec 口径执行，MUST NOT 现场重新规划切分、度量或验证方式。
> 每个退役切片走四步流水（接管 → 验证 → 删除 → 对账），完成后必须全场景门逐位一致（`node scripts/sim-matrix.mjs` + `run-residue`/`stronghold-door` 单独跑绿），任何漂移即回退该切片并在 `docs/bugs/` 留诊断后才可重试（震荡纪律）。

## 0. 地基：结构守护与基线冻结

- [x] 0.1 新增 `scripts/structure-guard.mjs` + `config/code-quality.json` 检查点，五项断言按 `specs/code-structure-standards` 钉死口径实现：① >600 有效行扫描（有效行 = 非空且非纯注释行；初始白名单 `ResourceConstant.ts`/`config/economy.ts`，`.d.ts` 天然豁免）；② `@ts-nocheck` 计数冻结（初始检查点 35）；③ 显式 `any` 计数（正则 `: any`/`as any`/`<any>`/`any[]`，`as any` 单独计数）对检查点单调不增（初始 466）；④ 依赖方向四规则断言（core 不 import modules/proto/console、modules 不 import console、modules→proto 仅白名单纯库面、branch 只被构建入口引用，既有违规留档冻结不新增）；⑤ 词表三方一致断言（executor ↔ 可执行路径 ↔ 孵化源，域 6 后生效）。接入 `npm run structure:guard` 与 pre-commit；验证：当前基线全绿，伪新增 any / 伪反向依赖各实测一次必红
- [x] 0.2 冻结回归基线：全场景门跑一遍并存档读数（对照 `nexus-architecture-refactor/baseline/sim-matrix-reference.json`：speedrun L4@32160 / boot L3@8915 / sprint L3@41766 / arena L3@10286 / race L2@458 / remote-mine L3@0），豁免清单检查点 128 条入 `config/arch-allowlist.min.json` 对照；验证：本基线全绿、arch:guard 绿（273 处/128 条）（实测：旧快照冻结于 28f870c，其后的 395e853 外矿回运三件套造成漂移——boot L3@8889/−26t、speedrun L4@28316/−3844t、sprint L3@35645/−6121t 均为改善方向且可复现；以 4a3ee14 实测冻结为新参考快照 `legacy-consolidation/baseline/sim-matrix-reference.json`，REF_PATH 已改指，8 门全绿含 run-residue/stronghold-door 单独跑；归因留档 `baseline/2026-10-24-baseline-freeze.md`）
- [x] 0.3 摸底扫描留档（C 波三口径判定的凭据源）：`rooms[].energyState` 活消费方、`Memory.MissionPools` 读写点、`roleRegistry` 15 handler 的真实调用频次（sim 全场景插桩或静态扫描）、`MineMission`/`mineMission` 活语义清单（元素矿/沉积矿定编与 directSpawn 桥接路径）、`UpdateHighwayScan` 活语义归属、休眠对象清单 7 项各自的三口径凭据（无挂载核对/引用扫描输出/场景插桩结论）、旧池任务产出快照（boot + sprint，任务类型/目标类别/数量档/频率，供映射表对照程序用）；产出 `docs/bugs/` 摸底留档一份；验证：扫描结论落档，A/C 波各切片以此为引用（留档 `docs/bugs/legacy-consolidation-survey.md`：四场景 Memory 落盘互证 legacy exec 0 调用、7 池全程空、terminalControl 活代码消费 terminal 池的依赖链、mineMission 常量写死即坏、operate 非休眠/pre判、孵化源六处画像、energyState 倾向保留）

## 1. A 波域 1：manager/transporter 任务化（economy/units 退役）

- [ ] 1.1 任务供给补齐：按 `specs/mission-pool-retirement` 映射表执行——manage 池语义 → `carry` 配额目的地 + `terminal_transfer` + `fill_spawn`，transport 池语义 → `carry` 目的地配额，供给方均为 economy planners，复用既有 TaskKind 不新增词表；验证用固定快照对照程序（0.3 快照 → 同场景同 seed 对照 → 差集判定 → 落档摸底档对应小节，旧语义缺失即失败）；单测覆盖任务生成决策
- [ ] 1.2 切换与验证（四步流水·步骤 1–2）：`NEXUS_TASK_DRIVEN_CODES` 加入两族角色，接管进生产装配路径；全场景门逐位一致（manager/transporter 在 sim RCL≤3 结构性不出现，行为等价由快照对照 + 单测承担）+ `run-residue`/`stronghold-door` 绿 + cpu p95 劣化 >2ms 即回退
- [ ] 1.3 删除（四步流水·步骤 3–4）：删 `src/modules/economy/units/{manager,transporter}.ts` + `utils/moveWork.ts` 侧信道（移动意图改 broker `MoveIntent`，工位钉位语义并入任务 targetPos）；豁免清单收缩（economy/units 相关条目）并推进 `arch-allowlist.min.json` 检查点；台账新增行（格式按 spec：`A→B（±n）`、实服列写「待补」）；对账：arch:guard 绿 + structure:guard 绿 + `openspec validate --strict` 通过
  > 并行编排注记（spec 修订允许）：域 1 与域 2 的任务供给创作可并行（文件域不相交：planners/quota ↔ mine 迁移模块）；1.2/1.3 的切换、删除与合并验证门由集成会话串行执行

## 2. A 波域 2：miner 任务化 + mineMission 迁移

- [ ] 2.1 按映射表执行 mine 行：`UpdateMineMission` 活语义迁为 economy 计划阶段模块（元素矿/沉积矿定编逐条搬运 + directSpawn 桥接改 spawnDirector 需求源），产出 `harvest` 任务（`resourceType` 区分元素矿）；`UpdateBoostMission` 行：`boostFunction` 读池改任务板 `boost` kind；单测：定编口径与退役前逐条一致（0.3 摸底清单为对照源）
- [ ] 2.2 切换与验证：`NEXUS_TASK_DRIVEN_CODES` 加入 miner；全场景门逐位 + 快照对照落档（mine/boost 两行）
  > boost 分歧裁决（集成会话 2026-10-25）：映射表 boost 行已修订——boost 池是预订簿记而非工作任务流，承载 = 簿记迁 `Memory.Nexus`（labReservations 同层）+ `UpdateBoostMission` 的 lab 管理迁 industry planning；该处置独立为 boost 切片，在域 3 删池前完成。域 2.1 的 mineralWork 已用 `AssignBoostTask` 原型面下订（池写入侧不变），断链随 boost 切片统一收口
- [ ] 2.3 删除与对账：删 `src/modules/economy/units/miner.ts` 与 `mission/updaters/mineMission.ts`；豁免收缩 + 检查点推进 + 台账行（实服待补）；arch:guard + structure:guard 绿

## 3. A 波域 3：mission pool 全链退役

- [x] 3.1 按映射表核对剩余行：work/buildRepair/wallRepair（既有 board 覆盖核对）、`TransportMissionCheck`/`BuildRepairMissionCheck`（board TTL 对账承担）、`UpdateHighwayScan`（按 0.3 摸底结论：活语义迁 economy 或随休眠链退役）；快照对照差集逐项登记处置结论；验证：对照结论落档摸底档（J 节：spawn 池定性孵化域、work 族纯死写零消费、usePower.ts:72 读 mine 池新发现——改读 OutMineData 簿记随 boost/terminal 切片落地）
- [ ] 3.2 切换与验证：`RoomFeatures` 摘除 `room.MissionUpdate()` 调度入口（`RoomFeatures` 职责收敛为结构状态/旗标链/能量状态——按 5.1 裁定）；全场景门逐位（任务供给全部来自 planning 阶段模块，upsert 归因插桩核对）
  > 进展注记（集成会话）：terminal send 语义已收编——`economy/sendLedger.ts`（`Memory.Nexus.economy.sends` 簿记）+ console `send` 人操面改写 + `terminalControl` 读簿记 + `manageMission` 阈值读簿记（20/20 单测绿，含 min-Batch/Goods 分档/巡检清理/只增不减语义）；boost 簿记切片（boost 行裁决）与 `usePower` 读 mine 池改读 OutMineData 待做
- [ ] 3.3 Memory v13 迁移：删除 `Memory.MissionPools`，迁移纯函数 + 幂等 + 一次删净；schema 单测入 `tests/`；`run-residue` 验证旧存档升级无残留、二次迁移无变化、回退安全（旧代码 `??=` 惰性重建）
- [ ] 3.4 删除与对账：删 `src/modules/spawning/mission/`（pool + updaters，~2722 行）、`MissionConstant` 词表、`mission.interface.d.ts` 声明、池 API 全部符号（structure-guard 的 MissionPools 符号扫描断言启用）；console 引用改写（`mine.ts` 的 OutMineData 入口随 C 波处置，本切片只断 mission 依赖）；台账行；全仓引用扫描（源码+类型+console+docs）为零 + arch:guard 绿

## 4. A 波域 4–8：exec() 双轨与 roleRegistry 退场

- [ ] 4.1 域 4 registry 绑定退场（调研修正版，取证见摸底档 I 节）：defense 族四角色孵化源为零（主线只孵任务驱动的 defender，defend-* 无任何 directSpawn/需求源）、teams 族由 Teams 编队运行时驱动（registry 只是失管兜底，sim 0 调用）、pcHeal 归 PowerCreep 驱动链——**三族均无活跃 exec() 调用面，不需要新增直驱运行时**；本步处置 = registry 摘除 15 绑定中已无调用面的条目（与域 5 删 registry 合并执行）、defend-*/词表孤儿移交域 6 裁撤判定、defendSingle/defendDuo/combatHeal 算法资产保留；全场景门逐位 + `run-residue`/`stronghold-door` 绿
- [ ] 4.2 域 5 删除 `exec()` 双轨：`Creep.prototype.exec` 挂载、`roleRegistry`、`legacyExecMode` 开关、`NEXUS_TASK_DRIVEN_CODES` 分水岭全部退场（四符号全仓扫描零命中，允许文档/台账引用）；`runAgents` 对无任务单位输出限频「无任务待派」诊断；sim 插桩确认每存活单位归因完备（任务租约或系统级管线）
- [ ] 4.3 域 6 词表死角色裁撤：按 0.3 摸底确认零孵化源的角色删词表条目 + executor 字段 + UnitLevelData + 中文名 + qos 冻结权重 + boost 表行；structure-guard 词表三方一致断言启用并绿；全场景门绿
- [x] 4.4 域 7 warSpawn 定性：显式保留并登记人操豁免（豁免清单 track「人操豁免 (warSpawn 旗标战争孵化, 域7定性保留)」+ 台账留档 + 调用方扫描确认无人操触发外调用点）（取证补充：attack-claimer/cleaner/dismantle/logistic 四角色 executor 在 registry 无 handler 且行为字段无消费点——人操链语义已坏，词表条目留给域 6 三方一致断言处置，见摸底档 H 节）
- [ ] 4.5 域 8 proto 角色行为库收缩为纯库：`src/proto/Creep/function/*` 残留突变方法逐个处置（有用语义迁 economy/agents handler，无用删除），`proto/` 公共面仅剩 `ensureMemoryCache`/`clearMemoryCache`/`getBoostCache`/`evaluateSourceWorkTiles` 纯库面；豁免清单 P6 条目清零（56 条 150 处）+ modules→proto 白名单收缩为实际存活纯库面；arch:guard 条目 ≤60

## 5. A 波收口：Memory v13 稳定与豁免对账

- [ ] 5.1 `rooms[].energyState` 处置：按 0.3 扫描结论二选一（保留为 RoomFeatures 基础状态 / 随域清理并入 v13 迁移），处置结论落台账；验证：全场景门绿 + run-residue 绿
- [ ] 5.2 A 波总对账：豁免清单 ≤60 条且每条有接管计划或永久豁免登记、checkpoint 推进、台账行与提交一一对应；验证：arch:guard + structure:guard 双绿 + `openspec validate legacy-consolidation` 通过

## 6. B 波一：巨型文件拆分（行为零变化，拆分边界按 `specs/code-structure-standards` 表执行）

- [ ] 6.1 `movement/index.ts`（3343 行）按表拆为路径缓存 / 代价矩阵 / 路由 / 意图仲裁 / 交通执行 / 编队移动六模块 + 薄装配层；`preTickBetterMove → commit → endTickResolve` 时序与 `Creep.prototype.moveTo` 猴补丁挂载点原样保持（P4 豁免身份不变）；PR 内零逻辑改动（diff 仅 import 重排/代码搬移/类型标注）；验证：全场景门逐位 + `run-residue`/`stronghold-door` 单独绿（时序旁证）+ 拆分前后导出面 diff 为空
- [ ] 6.2 `agentSystem.ts`（1727 行）按表拆：`runCreep`（484 行）按 task kind 拆为 handler 单元（scout/harvest/carry+fill_spawn/upgrade/build/repair/claim/reserve/defend/retreat），公共取料/送货辅助独立 `logistics` 模块，远程采集族（remoteHarvest/remoteCarry/relay 接力）独立 `remote` 模块；`runAgents` 签名与所有权登记主循环不变；为拆出的 handler 补分派单测；验证：全场景门逐位 + 新单测绿 + 导出面 diff 为空
- [ ] 6.3 `TeamAction.ts`（1806 行）按表拆为队形集结 / 移动执行 / 代价矩阵 / 路径缓存四域内部模块，对外仍以 `TeamAction` 命名空间整体导出（调用方零改动）；验证：全场景门逐位（含 arena/stronghold-door）+ 导出面 diff 为空
- [ ] 6.4 `63Planner.ts`（1183 行）按表拆分，`ensurePlannerState`/`autoPlanner63` 导出面不变；其余 >600 行非白名单文件（`moveMatch`/`rosManor`/`TeamSpawner`/`statistics` 等）按同一内聚判据逐个拆分；验证：structure-guard 规模扫描白名单外清零

## 7. B 波二：类型门禁清零（清理顺序按 `specs/code-structure-standards` 钉死域序/文件序）

- [ ] 7.1 `@ts-nocheck` 35 文件清零，文件序固定：planner（13）→ visuals（3）→ teams（4）→ movement（2）→ proto（8，A 波收缩后余量）→ 其余（5）；逐文件小步（移除标记 → 类型收窄与显式判空，禁 `!` 断言与 `as any` 逃逸 → typecheck 绿 → 全场景门逐位 → 下一文件）；验证：全仓 `@ts-nocheck` 计数 0 + typecheck 绿
- [ ] 7.2 显式 `any` 466 处按钉死域序收敛：planner → movement → teams → visuals → proto → console → core → utils；改精确类型或 `unknown`+收窄；`config/code-quality.json` 检查点每切片推进（单调不增）；验证：structure-guard 绿 + 检查点 ≤150 或实际收敛值
- [ ] 7.3 B 波收口闸门（C 波前置）：structure-guard 全绿（600 行白名单外 0、ts-nocheck 0、any 检查点达标、依赖方向零新增违规、词表三方一致绿）；验证：`npm run structure:guard` + `npm run typecheck` + 全场景门三绿

## 8. C 波：休眠与不可达退役（对象清单与程序按 `specs/dormant-code-retirement` 执行，清单外对象只留档不动）

- [ ] 8.1 清单第 1 项 `modules/external/mine/*`（~2650 行）：三口径凭据核对（0.3 摸底档）→ 删 `mine/` 目录、`outMine.ts`/`externalMine.ts`/`externalScheduler.ts`、`room.interface.d.ts` 的 outMine 系声明、console `mine.ts` 人操入口同步处置、`Memory.OutMineData`（v14 迁移或并入 v13，迁移幂等 + run-residue 验证）；台账行（实服待补）；验证：全符号全仓扫描零（含 docs 死链修复）+ run-residue 绿
- [ ] 8.2 清单第 2–5 项：`proto/PowerCreep/mode/*` 休眠模式（A 波域 4 归位后确认仅存零触发路径）、`visuals/highwayMine.ts`、`core/qos.ts` 兼容读口、`accessor.ts` legacy getter（`getOutMineData` 等）——逐项按零引用扫描程序（4 步：全仓文本匹配 → 逐条归类真引用/注释文档/再导出穿透 → 真引用为零才删 → 结论附提交）；台账行；验证：structure-guard + arch:guard 绿 + 各符号扫描归档
- [ ] 8.3 清单第 6–7 项与死导出收敛：词表死角色已在域 6 裁撤的复核、`core/ai` 零引用导出、statistics/console 对已删域的读口清理、docs 死链同步修复；验证：全仓引用扫描零 + `npm run lint` 绿

## 9. 总验收与对账

- [ ] 9.1 全场景门总验：8 场景全绿逐位一致 + cpu p95 对 0.2 基线不劣化（>2ms 拒绝）+ `run-residue`/`stronghold-door` 绿；产出读数存档到本变更 `baseline/` 目录
- [ ] 9.2 指标对账：净删除行数、豁免清单终值（≤60 条且每条归口三类之一）、ts-nocheck 0、any 检查点终值、600 行白名单外 0、词表三方一致断言绿、依赖方向零新增违规；台账逐行核对（每行实服列如实标「待补」，无虚报，行与提交一一对应）
- [ ] 9.3 文档同步：`docs/nexus-design/02-architecture-charter.md` §21 结构注记更新（mission pool/exec 双轨退场）、`10-legacy-removal-ledger.md` 台账行齐、AGENTS.md 准则核对（无参考来源注释、属主 nightx:night、未擅自提交）；`openspec validate legacy-consolidation --strict` 通过
