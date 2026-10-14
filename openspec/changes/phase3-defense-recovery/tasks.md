# Tasks

## 1. 配置与 Memory schema v5

- [x] 1.1 新建 `src/config/defense.ts`：集中 Phase 3 全部参数（威胁能力权重/接近度权重/类别乘数/衰减率与有效期、war 进出阈值、塔能源储量线与补给触发线、SafeMode 政策参数、维修价值 tier 与维护线、威胁分级与编制映射、撤退锚点、战损统计窗口）。验证：`npm run typecheck` 通过且防御代码无魔法数
- [x] 1.2 实装 schema v5：`rooms[x].threat`（score/peak/category/firstSeenAt/lastSeenAt/confidence/hostileCount/reason，单条有界）与 `Memory.nexus.defense`（safeMode 簿记 + stats）；`SUBSYSTEM_DEFAULTS`/`SUBSYSTEM_KEYS` 扩展；`CURRENT_SCHEMA_VERSION = 5`。验证：tsc 通过，新增结构注释声明有界性与 GC 规则
- [x] 1.3 编写 `migrateV4ToV5`（空默认值补齐，幂等纯函数）并注册迁移链。验证：单测覆盖 v4→v5 升级、重复执行幂等、迁移计数递增、v1→…→v5 全链

## 2. 感知扩展与威胁模型

- [x] 2.1 快照契约扩展：`HostileCreepSummary`（主人/位置/存活部件 attack·ranged·heal·tough·move/boost 计数）、`TowerSummary`（能源）、`DamageableSummary`（hits/hitsMax）、`CreepSummary` 增战斗部件计数；perception 单趟 find 分发收集（不多扫）。验证：单测覆盖敌方/塔/受损结构观测聚合与部件计数
- [x] 2.2 实现 `src/modules/defense/threatModel.ts` 纯函数：能力估值 × 关键资产接近度 × 类别乘数评分 + 可归因 reason；失视 score/confidence 衰减；`rooms[x].threat` 更新与聚合读取 helper（maxThreatScore）。验证：单测覆盖部件构成差异、接近度加权、NPC/玩家分类、衰减至无害、失视降置信（threat-model spec 场景）
- [x] 2.3 战损统计归因：threat 窗口内 `ctx.world.dead` 计己方损失、可见敌方数下降且非失视计击杀；窗口折叠有界。验证：单测覆盖损失计入、击杀近似、窗口折叠长期不增长

## 3. ActionBroker 扩展与塔控

- [x] 3.1 broker 扩展：`ActionKind` 增 attack/rangedAttack/heal/repair/activateSafeMode，管线增 combat/tower/defense，结构 actor 解析（塔/controller）与每 actor 单意图仲裁，triage 补战斗错误码。验证：单测覆盖结构 actor 执行、同 actor 多提案仲裁、结果码分类记录
- [x] 3.2 实现 `src/modules/defense/towerControl.ts`：目标按「即刻危险×战略价值×击杀可行性」排序（敌方治疗量折算可行性）、多塔贪心分配防过度集火、能源低于储量线停修缮只开火。验证：单测覆盖关键资产优先、治疗者权重、多塔分配、低能源停修（tower-control spec 场景）
- [x] 3.3 塔补给接入配额：quota 目的地候选纳入低于补给触发线的塔（高优先级、高于普通 haul），在途承诺照常计入。验证：单测补塔任务优先级与候选排序、账本预留正确
- [x] 3.4 塔耗能统计：accepted 塔 action ×10 折窗口 EMA + 累计入 `defense.stats`。验证：单测覆盖累计与窗口折叠

## 4. 防御应急规划

- [x] 4.1 `taskSchema` 增 `retreat`/`repair` 任务类型（租约/重试上限），`TASK_PRIORITY` 定档 defend 92、retreat 90（抢占线）、repair 基线 45。验证：tsc + 单测覆盖租约时长与优先级查询
- [x] 4.2 实现 `src/modules/defense/planners.ts` `planDefenseRoom`：defend 任务（dedupe `defend:<room>:<tier>`、targetId=最高威胁敌方、威胁分级）、retreat 任务（dedupe `retreat:<room>:<creep>`、非战斗按部件判定、priority 90、锚点=Spawn）、威胁衰减 cancel + 恢复窗口迟滞。验证：单测覆盖生成幂等、非战斗判定、抢占释放后经济任务回 available、衰减终结无残留（defense-response spec 场景）
- [x] 4.3 SafeMode 政策：多条件评估（关键结构濒毁 + 预估火力不足 + 可用/冷却）产出 `activateSafeMode` 提案，`lastAttemptTick` 防重试，原因入日志。验证：单测覆盖濒毁触发、条件不足不触发、冷却不重复尝试
- [x] 4.4 war 姿态接线：`StrategyInputs` 增 maxThreatScore（纯 Memory 聚合）、`evaluatePosture` war 转移（阈值分离 + minDwell）、敌方首见调 `markUrgentReeval`、`postureBias.war` 填充（defend/repair/fill_spawn 正、build/upgrade 负）。验证：单测覆盖进/出 war、迟滞防抖、紧急重估触发、偏置作用于任务优先级
- [x] 4.5 Agent 战斗/撤退行为：defend 分支（射程判定、attack/rangedAttack 提案、友方损血超阈切 heal）、retreat 分支（锚点移动、到达保持）、目标消失/租约丢失停止产出。验证：单测覆盖接战、治疗切换、撤退移动、旧目标不再产出意图

## 5. 维修目标

- [x] 5.1 repair 规划：受损结构幂等任务（`repair:<room>:<structureId>`），排序 = 价值 tier × 损坏程度 × 威胁区域加成；目标线分级——和平修至维护线即完成、威胁期受威胁防线提权 75 抢修；结构消失终结。验证：单测覆盖排序、维护线即止、威胁期提权、完成/消失生命周期（structure-repair spec 场景）
- [x] 5.2 Agent repair 行为：空载复用既有取能链路、满载出 repair 提案。验证：单测覆盖取料-修缮循环与到线完成

## 6. 战斗单位生产

- [x] 6.1 bodyFactory 增 `defender` 段模板（远程为主 + move，min/max 段数，代号对齐 RoleConstant）。验证：单测覆盖预算伸缩、低于最小段不产、身体可行走
- [x] 6.2 SpawnDirector：`roleForTaskKind` 增 defend→defender、repair→worker；defender 编制 = 威胁分级映射（和平 0/低 1/高 2），不受 survive 暂停；Allocator 能力键扩展 attack/ranged/heal。验证：单测覆盖缺口排产、和平零编制、能力硬过滤
- [x] 6.3 生产能源账本预留：defender 请求排程时 reserve（owner=请求）、取消/过期 release。验证：单测覆盖预留后 available 扣减、释放回升、不与搬运承诺重复记账

## 7. 集成与 Phase 3 验收

- [ ] 7.1 注册 `defenseModule`（emergency，band P0）与 `defenseTowersModule`（agents 段 broker 前）、profile 变体开关、HUD 威胁行（分数/类别/战损计数）。验证：`npm run typecheck` + `npm test` 全绿；禁用防御模块时 Phase 2 行为回归通过；HUD 渲染冒烟
- [ ] 7.2 上传 local 变体冒烟：v4→v5 迁移执行、和平期零行为变化（无 defender/无防御任务/威胁行 0）。验证：控制台核对迁移日志与 HUD 威胁行
- [ ] 7.3 NPC Invader 实战观察：威胁行上升 → 非战斗撤退 → 塔开火 → 威胁分级生效（defender 排产/war 姿态如触发）→ 敌清后经济恢复。验证：控制台零未捕获异常，docs/nexus-design/09 §9.7 可观察项逐条记录
- [ ] 7.4 数千 tick soak（与 phase2 8.3 合并执行）：战损统计与 threat 记录有界、Memory 占用平稳、对照 docs/nexus-design/14 Phase 3 验收清单（响应合理/战后恢复/不长期困防御/战损有预算统计）逐项通过
