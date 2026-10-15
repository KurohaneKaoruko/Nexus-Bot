# Tasks

> 验证口径（用户裁决 2026-10-12）：vitest 套件已退役，回归制 = 严格 typecheck + sim 场景。
> 纯函数移植以「参照实现逐条语义对照 + typecheck」锁定，行为正确性由 sim 场景（报告 JSON / ticks CSV / --dump-memory）作证。

## 1. 参照实现纯函数移植与配置地基

- [x] 1.1 移植 rush 体型生成器到 `src/utils/`（harvester/upgrader/worker 预算现算纯函数，主线 TS 风格，算法语义与参照实现逐条对应）。验证：`npm run typecheck` 绿；抽样预算点输出与参照实现逐条对照一致（成本≤预算、下限拒绝、WORK 封顶、部件≤50、收尾 WORK 排布）
- [x] 1.2 移植冲级分段评估到 `src/utils/raceSegments.ts`（分段状态/ETA/判废 + 判废落账仅首次）。验证：`npm run typecheck` 绿；达成/落后/判废三分支与 ETA 公式对参照实现逐条对照，判废落账仅首次
- [x] 1.3 新增配置：`src/config/roomMode.ts` 档位参数表（upgradeIncomeMultiplier/courierEnabled，冲级档倍率固定 1 并注释定编教训）；`src/config/economy.ts` 扩 `CONTROLLER_BUFFER_CONFIG`/`COURIER_CONFIG`/`BODY_TERRAIN_CONFIG`。验证：`npm run typecheck` 绿，参数无散落魔法数（grep 复核新模块零字面量阈值）
- [x] 1.4 Memory schema v8→v9：`rooms[x].mode` 可选字段 + 迁移（缺省回填、版本推进）。验证：typecheck 绿 + sim boot 场景 `--dump-memory` 观察 v8→v9 迁移执行与 mode 回填（7.3 一并留档）；迁移行为六用例 node 直跑全绿（空数据/旧数据/合法保留/非法清洗/坏条目/幂等）

## 2. 房间模式档位

- [x] 2.1 实现 `src/modules/strategy/roomMode.ts` resolver（显式设置 > cpu 档默认 > main，非法值回退并限频告警），经 strategy 域 index 出口。验证：typecheck 绿；resolver 为纯读函数，三级优先级与回退路径以类型穷尽 + 代码走查对照 spec 场景；编译产物 node 直跑 8/8 用例（显式双向优先/auto 阈值/非法回退/确定性）
- [x] 2.2 消费接线：升级定编倍率与快递总闸改读 profile。验证：typecheck 绿；两场景（cpu 100 均解析 rush）报告 courier 孵化出现（boot 20k suicide 93 / sprint 50k suicide 25）；main 档零 courier 由 resolver 检查覆盖（courierEnabled=false → 总闸恒假）——原「boot 为 main 档」对照前提有误（boot 同为 rush），已记录
- [x] 2.3 HUD 房间行显示当前模式。验证：双场景 noErrors（面板路径执行）；`Nexus.modes()` 查询入口注册；dump-memory 抽查 mode 解析（cpu 100 → rush）

## 3. 控制器缓冲（P1-14 根因①③）

- [x] 3.1 cc 选址决策（`src/modules/planner/controllerBuffer.ts`，design D1）。验证：typecheck 绿；sim verbose 确认 t0 选址落位 (26,25)；采纳/重建/冷却四路径走查对照 spec 场景
- [x] 3.2 cc 站点落位接通（Planner.run 主循环，布局前后两路径均调用）。验证：sim 确认 cc 工地出现且控制器圈无布局重复容器；layoutPlanner 控制器旁容器跳过分支未动（走查锁定）
- [x] 3.3 cc 补货配额（quota 目的地新类型）。验证：typecheck 绿；floor/诊断偏移/committedTo/冲级提权代码路径对照 spec 三场景走查；cc 存量曲线受建造节奏限制（7.2 未过），观测留待校准后复测
- [x] 3.4 升级工位（design D2 修订：名册机制升级为「每工位一条任务」——与 harvest-per-source 同构，租约即分配，稳定且免并行名册机制）。验证：boot 20k dump-memory 出现 6 条 `upgrade:W5N8:cc:x,y` 槽位任务；无 cc 阶段升级不中断（upgradeController 意图持续）
- [ ] 3.5 sim 中程检查：rcl-sprint 20k 采样对比基线（采集利用率、升级速率、cc 存量曲线）。验证：报告 JSON 三项指标相对 2026-10-12 基线改善并留档。【2026-10-12 部分证据】升级速率 0.02/t→0.63/t（t20k-40k 稳定窗口，路网修复后不再衰减）、50k 升级总量 894→17658~19437（~20×）、采集 4.6-5.6/t、RCL2@1653 优于基线 1841；cc 存量决赛局近满 (1799) 但曲线受建造节奏支配——升级与采集达标，cc 曲线留待 7.2 通过后正式留档。【2026-10-15 进展】采集与升级 WORK 密度成套提效后重跑四场景（remote-mine 30k：harvested 54492→133922（+145.8%）、controller control 244→290（+18.9%）、爬数 14→10、cpu p95 持平；boot L3@17371 较基线 19721 改善；arena L3 17684 较基线 16998 小幅劣化，判为随机流漂移，docs/bugs (四)）。【2026-10-15 派发段修复】升级任务派发段三缺陷成套修复（亲和加分/无 cc 多工位/cc 工地豁免节流，docs/bugs (八)）：remote-mine control 225→2416（10.7×）、arena 89416（2.24/t）、boot 46293、speedrun 49124，cc 在四场景实际建成——升级执行率 ~1% 存量瓶颈解除；采集侧 (8.4/t vs 20/t) 与孵化 churn (39%) 成为剩余瓶颈。**不勾销**：采集利用率基线对照仍未达标。

## 4. 地形感知体型（P1-14 根因②）

- [x] 4.1 房间地形分析（`src/modules/spawning/terrainProfile.ts`）。验证：typecheck 绿；seed7 沼泽房实测 swampRatio 0.28 → 阈值校准 0.2 后地形档生效（出生日志出现 [C,M,M] 搬运体）；缓存进程级每房一条有界
- [x] 4.2 bodyFactory 重构（design D3）。验证：typecheck 绿；默认路径与参照实现 diff 2310 例一致（除 4 例参照实现超预算边界修正）；defender/universal 段模板不变；boot 3/3 断言通过（RCL2@941 ≤5000，rush 偏置下能量再分配略慢于旧基线 539，断言未回退）
- [x] 4.3 typicalSpawnTime 随体型口径自动更新（满配 buildBody 现算）。验证：typecheck 绿；boot RCL2@5000 断言通过、无替补空转告警

## 5. 拉能快递

- [x] 5.1 发车闸门（`src/modules/economy/courier.ts` + runtime 队列）。验证：typecheck 绿；五闸门逐条对照 spec 场景走查；sim 报告 courier 孵化与 suicide 意图出现（boot 93 / sprint 25）
- [x] 5.2 快递角色行为（纯 CARRY 现算 + courierTask 分支 + broker suicide 意图）。验证：typecheck 绿；sim 意图分布含 suicide；四行为分支走查对照 spec（满载/断供带货/空载限时/底仓预算）
- [x] 5.3 模式总闸与特化子模式判定（specialRushActive）。验证：typecheck 绿；main 档零 courier 由 resolver 检查覆盖；RCL>3 停止与 link 退位为配置门（sim 不可达 RCL5/link，走查记录）——原「boot 为 main 档」前提有误，已记录

## 6. 冲级分段判废接线

- [x] 6.1 raceVisual 消费 utils/raceSegments（删除文件内重复评估器）+ 判废快照。验证：boot 20k dump-memory raceVerdict 快照字段齐全（failedSegment=3 @+5001t，census/upgradeWork/controllerBuffer/energyState 在册）
- [x] 6.2 判废快照有界性：applySegmentVerdicts 单条覆盖 + v9 迁移清洗非法形状。验证：dump-memory 每房 raceVerdict 恒为单对象（覆盖写入）；迁移幂等用例绿

## 7. 集成回归与勾销

> **本族为 P1-14 相关验收门的主责族**（2026-10-15 变更族收口）：`rcl-sprint` RCL4 验收（§7.2）、P1-14 文档勾销（§7.4）、私服冲级实测（§7.5）三门仅在本族留待办；`workforce-logistics` §5.2 / §5.4 / §5.5 的同门项已改为交叉引用，验收标准原文保留在该族内但不再并列为待办。

- [x] 7.1 全量门禁。验证：typecheck 0 错误 + lint 0 错误（顺带修复遗留 3 处：autoPlanner new Array×2、model.ts 未用 import）+ sim 双场景 noErrors
- [ ] 7.2 sim rcl-sprint 50k（P1-14 验收，主责项）：3/3 断言（`rclReachedBy 4 @40000`、`cpuP95Below 20`、`noErrors`）。验证：报告 JSON + ticks CSV 留档。【2026-10-12 最新】模拟器已迁移 screeps-sim npm 包（`npm run sim`，.sim.ts 用例驱动，见 sim/sprint.sim.ts）；最新一轮 50k：RCL2@1895、cpu p95 3.0ms ✓、noErrors ✓、RCL4 未达成 ✗（经济校准未到位，见 design 校准记录）。【2026-10-15 进展】采集与升级 WORK 密度成套提效落地（升级体改 WORK 递减试装 `UPGRADER_BODY_CONFIG`、人口上限表降级为兜底护栏、采集定编单一来源与时间去向取证），remote-mine 30k 实测产能双升、cpu p95 持平（docs/bugs (四)）。【2026-10-15 派发段修复】升级任务派发段三缺陷成套修复落地（allocator 亲和 + 无 cc 多工位 + cc 工地豁免节流，docs/bugs (八)）：sprint 50k control 19674→28950（+47%）、cpu p95 5ms、noErrors ✓，RCL4 仍未达成——剩余瓶颈转移到采集侧（沼泽 3.7/t vs 天花板 20/t）与孵化 churn（双孵化器分治，审计 (三) 存量）。**RCL4 仍未达成，不勾销**
- [x] 7.3 防回退回归：boot-from-scratch（RCL2@5000 窗口、迁移执行）+ 9 房场景（跨房泄漏指标、移动执行率不回退）。验证：两场景报告逐项对照基线。【2026-10-12】新模拟器下 boot 3/3 通过（RCL2@913、cpu p95 4ms、noErrors）；rcl-sprint（9 房沼泽）noErrors ✓ / cpuP95 ✓，RCL4 断言未过归 7.2
- [ ] 7.4 文档同步（主责项）：docs/bugs P1-14 勾销附 sim 证据；docs/14 进度快照（Phase 2 沼泽项）；docs/21 进度标记；参数校准结论回写 config 注释。验证：文档与代码一致、无「待跑」遗留。【2026-10-15】前置仍是 §7.2 的 RCL4 达成，未达成前 P1-14 不得在 docs/bugs 勾销；本项已归集本轮已落地事实（docs/bugs (四)），`workforce-logistics` §5.4 的同门项已并入本项
- [ ] 7.5 私服冲级实测（可选收尾，主责项）：`submit.js` 落地 W5N8，观察 mode/快递/判废面板与 RCL 时间线对齐 speedrun 榜口径。验证：控制台/API 取证记录。【2026-10-12 晚 复产观测】重置后 land.js 复产 + 部署直供链构建: 上一周期 (旧代码) 判废 segment 2 (RCL1@+1001t), 本周期已过 RCL2 (<+2324t); 实服 ~10t/s, 40k 窗口 ≈67 分钟; 早期斜率 0.27/t; 能量注入口径差实锤 (delivered EMA 19.7 vs produced 4.3)。新增 `scripts/eval.js` 非交互取证入口。RCL 时间线持续观察, 完整判据待 workforce 移植后闭环。【2026-10-15 收口】本项为私服实测的唯一留档处，`workforce-logistics` §5.5 的取证项（定编/接力/专线）随本项落地一并回填【2026-10-16 实测】(十二)~(十五) 成套修复链上载 @main（bundle 特征三证）；4wt 重置对账缺陷修复（陈旧 units 27 条清理，docs/bugs (十六)）；**榜口径破解：score = RCL 累计门槛 + 当前 progress，bracket 20000/40000 双档**，榜首 1007122 = 50.4/t（外矿结构铁证），Nexus rank 13/16 (48292)；RCL 时间线取证钩子落地（rclTimeline 跨周期留证，(十七)）；**实服自举死锁实锤与修复**（7.4k tick 无 RCL2 → 修复后 L2@540 与 sim 同量级，(十八)）。观察窗口持续：服务器存在非计划重置（周期随时被打断），时间线钩子为唯一可靠口径。
