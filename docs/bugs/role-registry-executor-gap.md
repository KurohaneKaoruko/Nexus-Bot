# roleRegistry 执行断链：执行器覆盖缺口（含休眠双体系）

- 优先级: P1
- 发现日期: 2026-10-16
- 状态: 主线断链已收口 2026-10-17 (任务 4.6); 死 handler 五件 (harvester/carrier/upgrader/worker/universal) 已裁撤 2026-10-17 (任务 5.2 批次一); 剩余批次见任务 5.2 注记
- 来源: 全面重构 wave 4 后排查 teams/units 归位时的连锁发现

## 现象

词表 `UnitData`（src/constant/CreepConstant.ts）声明 48 个执行器，`roleRegistry`（src/modules/prototype/Creep/runtime/registry.ts）只注册 20 个；`NEXUS_TASK_DRIVEN_CODES`（agentSystem.ts）任务驱动集另有 9 角色（无 executor 字段）。三类之外存在 28 个"有 executor 声明但无处理器"的角色。

## 执行链结构（取证）

- 分水岭: `agentSystem.ts:1177` `NEXUS_TASK_DRIVEN_CODES`。集合内走任务板+broker（需 taskId 租约）；集合外走原型 `exec()` → roleRegistry。
- 词表两类: 任务驱动角色故意无 `executor` 字段；原型角色有。
- **外矿 B 线休眠勘误（重要）**: `prototype/features.ts:52-56`（2026-10-15 勘误）——外矿由任务板系 `planRemoteHarvest` 独家驱动；原型系 `outMine()/ExternalMine` 全链**保持休眠**（全仓无 `room.outMine()` 调用点）。因此 out-\*×9 / reserver 的"孵化源"（ExternalMineSpawner）是休眠代码，**运行时并未孵化空转单位**。
- warSpawn（旗标战争孵化 attack-claimer/logistic/dismantle）: 手动旗标触发，玩家放置才激活，sim 不覆盖。

## 真实的活跃缺口（修复目标）

| 线 | 角色 | 现状 | 判定 |
|---|---|---|---|
| ExpandController（Expansion 域模块已挂载） | claimer | `directSpawn` 孵化但无 taskId → 在任务驱动集内却不被驱动 → 空转 | **活跃断链**（扩张触发即触发） |
| ExpandController | aid-build/carry/upgrade | 无处理器、不在任务驱动集 → `exec()` null handler 日志跳过 | **活跃断链** |
| 词表遗留 | ~~deposit-\*×5, power-\*×4, cleaner, up-\*×2~~ 勘误: deposit-harvest/transfer 与 power-attack/heal/ranged/carry 是 mineMission 活角色 (5.2 批次日已桥接 directSpawn); cleaner/dismantle/logistic/attack-claimer 是 warSpawn 旗操活角色 (同上); 词表实际不存在 deposit-haul/take、power-haul/take; **真死角色仅 up-upgrade/up-repair** (AID 旗退役后零孵化源) | 已裁撤 2026-10-17 (5.6): 词表条目 + UnitLevelData 分级 + qos 冻结权重 + boost 表 + spawnRules prune 过滤分支 + UnitConstant 中文名, 全部移除 |
| 休眠 B 线 | out-\*×9, reserver | 全链休眠（features 勘误） | 任务化时一并收编或裁撤 |
| warSpawn 旗标 | attack-claimer, logistic, dismantle | 手动旗标触发 | 低频，随任务化批次处理 |

## 修复方向（已定：任务化）

用户已定路线：**任务化**——对齐 docs 21 "外矿同名-role / 扩张 claim 已按任务板主线化" 既定方向。
1. ExpandController 的 claimer/aid-\*：改产任务（kind: claim/build/haul/upgrade 复用现有任务类型），孵化走 spawnDirector `unitForTaskKind`，行为走 agentSystem 既有分支——消灭 directSpawn 旁路。
2. 休眠 B 线（ExternalMine/ExternalMineSpawner/outMine 挂载）：随任务化推进裁撤（行为已由 remoteMining A 线承接）。
3. 词表死角色（deposit-\*/power-\*/cleaner/up-\*）：逐个确认后裁条目。
4. warSpawn 旗标线：低频手动线，后续批次评估任务化或保留旗标语义。

## 已修复 (2026-10-16)

- **`in` on Set 闸门失效 (实服刷屏根因)**: `agentSystem.ts:1204` 用 `unitCode in NEXUS_TASK_DRIVEN_CODES` 判任务驱动集——`in` 是属性键检查, 对 Set 成员恒 false。闸门从未生效: 全部任务驱动角色 (harvester/carrier/upgrader/worker/universal/defender/scout/claimer/rush-courier) 无 taskId 时都漏进原型 `exec()`, 其中 scout/claimer (有 executor 无处理器) 每 tick 报错空转。已改 `Set.has`。
- 副作用口径: 修复后任务驱动角色不再走 exec() 兜底 (此前被 bug 意外驱动, registry 的 economy 处理器在接盘), 全靠任务板驱动。sim 回归 (boot/remote-mine) 待跑。

## 验证标准

- 每个词表 `executor` 字段对应的处理器在 roleRegistry 存在，或角色进 NEXUS_TASK_DRIVEN_CODES（executor 字段应删）
- sim remote-mine 30k tick 全程无 `[CreepExecute] ... 不存在` 日志
- boot/remote-mine 回归通过
- 扩张线（ExpandController）sim 或实服验证 claimer/aid-\* 到岗工作


## 收口实录 (2026-10-17, 任务 4.6)

| 线 | 处置 | 实改 |
|---|---|---|
| claim 任务映射 | `unitForTaskKind("claim")` 曾映射 universal (无 CLAIM 部件, 任务卡 available; claimer 定编通道又不在 standingRoles 永不触发) → 改映射 claimer; claim 链已任务化 (expansion.ts 产任务 + spawnDirector 活跃任务定编 + bodyFactory [CL,M] + agentSystem case claim) | spawning/spawnDirector.ts |
| aid-* ×3 (活跃断链) | 词表/分级表/UnitBodys/中文名/qos 权重/boost 表/follower 集合/transportMission 计数/help 文案全数裁撤; ExpandController 跨 shard 援建改主线活体 (worker/carrier/upgrader, 任务板执行器齐全) | CreepConstant.ts, UnitConstant.ts, qos.ts, boostFunction.ts, controllerFunction.ts, baseFunction.ts, transportMission.ts, help.ts, ExpandController.ts |
| 词表遗留 (deposit-haul/take, power-haul/take, cleaner, logistic, dismantle, out-carry/repair/take/heal/haul) | 存量引用为零或仅在休眠 B 线 (external/mine 链) —— 留 5.5/8.5 任务化批次裁撤, 本任务不扩面 | (未动) |
| 休眠 B 线 (out-*/reserver 原型链) | external/mine spawner 等 9 处引用全在休眠链路; A 线 remoteMining 已承接行为 | 留 8.5 |

回归: boot L1@0 L2@728 L3@15764 / remote-mine L3@0 逐位一致; tsc/oxlint/arch-guard 绿。
