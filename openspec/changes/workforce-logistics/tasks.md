# Tasks

> 验证口径（沿用户裁决 2026-10-12）：回归制 = 严格 typecheck + lint + sim 场景（报告 JSON / ticks CSV / --dump-memory）。
> 参照实现逐条语义对照锁定纯函数移植，行为正确性由 sim 场景作证；既有代码零 diff（宽松 typecheck + 变体构建作证）。

## 1. 纯函数与配置地基

- [x] 1.1 移植定编纯函数到 `src/modules/economy/workforce.ts`：升级 WORK 目标（收入基线×档位倍率 / 水位收缩 / 盈余 / 落地堆清理各项取 max，无缓冲收紧上限与模式下限）、count 折算 + RCL 人口上限表、carrier 运力下界公式（Σ2×路程×速率×冗余÷单件运力，实测缺失回退保守基线）、采集收入 WORK 口径现算（源容量封顶）。验证：`npm run typecheck` 绿；公式与参照实现 `roomWorkforce.ts:491-658` 逐条语义对照（对照记录进 PR 描述），全部阈值/系数入 `WORKFORCE_CONFIG`，grep 复核零散字面量
- [x] 1.2 移植就绪闸到 `src/modules/economy/productionGate.ts`：源采集定编（源再生上限折 WORK、可站位约束、低等多采集位/高等一源一采）+ `isProductionSecured`（在岗非孵化 ≥ 定编合计，每 tick 现算无锁存）。验证：typecheck 绿；与参照实现 `productionGate.ts:51-98` 逐条对照；行为分支（就绪/死亡回落/多采集位窗口）代码走查对照 spec 场景
- [x] 1.3 配置与 schema：`WORKFORCE_CONFIG`（含人口上限表、冗余系数、水位阈值、饥饿参数）、`RELAY_BODY_CONFIG`（容量基数/配比/等级门/路网阈值）入 `src/config/economy.ts`；Memory v9→v10（`rooms[x].upgradersStarved`、`rooms[x].sourceTiming` 可选字段 + 幂等迁移，参照实现口径 `roomWorkforce.ts:128-191` 惰性衰减）。验证：typecheck 绿 + 迁移幂等用例（空数据/旧数据/合法保留/坏条目）node 直跑全绿；boot 场景 `--dump-memory` 观察 v9→v10 执行

## 2. 孵化侧接线（定编 + 两闸）

- [x] 2.1 spawnDirector 定编消费：upgrader/carrier 的 unitTargets 改读 workforce 出口（WORK 折只 + 人口上限 clamp；carrier 单件运力读 bodyFactory 同口径体型）；`carryThroughputTarget` 退役删除（口径唯一化）。验证：typecheck 绿；dump-memory 对照机体/数量序列（boot 场景开局不变、rush 档升级体只数受人口上限表钳制）
- [x] 2.2 就绪闸接线：起步序列闸（未就绪时非采集面角色缺口置零，放行 harvester/upgrader/universal）+ 搬运开局闸（carrier effectiveTarget 与在岗采集体数比较）。验证：typecheck 绿；boot dump-memory 早期孵化序列只出现采集面角色，就绪后放行其余角色
- [x] 2.3 饥饿负反馈接线：agentSystem upgrade 分支取能落空（cc 空 + 工位旁无堆）时记账（降级风险窗口豁免），workforce 定编消费惰性衰减后收缩。验证：typecheck 绿；rcl-sprint dump-memory 观察 starved 记账涨落与升级定编联动、有界性（上限/衰减）

## 3. 供能专线（quota 主干）

- [x] 3.1 请求优先级序对齐：quota 塔常态优先级降序至 cc 之后（防御态提权路径保留最高档），配置化。验证：typecheck 绿；优先级序四场景（孵化线最高/塔受威胁提权/控制器线次之/常态最后）走查对照 spec
- [x] 3.2 在途认领先行扣减与专线只数：haul 任务认领即挂账（预留时点对齐任务创建），`controllerCarryQuota` 只数保留（空闲搬运力 ≤ 专线只数时收紧新 haul 放量，cc 缺位归零）。验证：typecheck 绿；sim 报告 delivery 分布中 cc 占比不回退，多车同目标（重复交付溢出）计数为 0
- [x] 3.3 顺手修三件：`spawnIdleSince` 持久化（超时降档兜底生效）、`ccBelowSpawnGate` 逐房判定、`deliverEnergy` 兜底限定配额目的地集合。验证：typecheck 绿；构造低容量场景 dump-memory 观察降档触发；交付兜底走查对照 spec 场景

## 4. 接力搬运

- [x] 4.1 移植交接判据纯函数到 `src/utils/`（相位相反/意图格互指/容量相等/TTL 下限/同 tick 防重），与参照实现 `haulerStrategy.ts:75` 逐条对照。验证：typecheck 绿；判据五分支（成立/容量不等/双空/TTL 不足/防重入）走查对照 spec
- [x] 4.2 agentSystem 交接口径：fill_spawn/haul（含 upgrade fetch 态）分支前统一检查，命中经 broker carry 管线提交 transfer，受方承接任务租约/供方释放回取货侧（复用 release+claim 原语），当 tick 受方以新载量继续、供方折返。验证：typecheck 绿 + lint 绿；sim 意图分布出现 relay transfer、任务无 lease-lost 告警（快递占位任务同类 bug 的前车之鉴）
- [x] 4.3 接力件体型档：bodyFactory carrier 分支改 `RELAY_BODY_CONFIG` 档表（容量基数倍叠加/路网达标转路面配比/达门大件直运），与 terrainProfile 沼泽档并存。验证：typecheck 绿；dump-memory 机体序列——接力期 [C4,M2] 基数口径、路网达标后配比变化、boot 平地行为不回退

## 5. 集成回归与勾销

> **2026-10-15 变更族收口**：P1-14 相关验收门的主责族为 `fix-p1-14-rush-sprint`。本族 §5.2 / §5.4 / §5.5 三项与该族同门，已改为交叉引用（验收标准原文保留，但不再作为本族待办）；本族保留的 §5.3 中，rcl-sprint 侧三项指标基线对照由 `fix-p1-14-rush-sprint` §3.5 主责留档。

- [x] 5.1 全量门禁：typecheck 0 错误 + lint 0 错误 + 宽松 tsconfig 过（零 diff 作证）+ race/season 变体构建过。验证：命令输出留档

> **§5.2 sim rcl-sprint 50k（P1-14 验收）已由 `fix-p1-14-rush-sprint` §7.2 承接**（P1-14 RCL4 验收门的主责留档处为该族，本族不再留同门待办）。验收标准原文保留：3/3 断言（RCL4@40000 / cpuP95<20 / noErrors），验证口径为报告 JSON + ticks CSV 留档；未过则按校准记录流程迭代配置（冗余系数/人口上限/专线常数），不改结构。**当前状态：RCL4 未达成**（docs/bugs 2026-10-15 (四)：采集与升级产能双升，但 RCL 进度瓶颈未破）。

- [ ] 5.3 防回退回归：boot-from-scratch 3/3（RCL2@5000 窗口、v10 迁移执行）+ 采集利用率/升级速率稳定窗口/cc 存量曲线/TTL churn 四项指标对照 2026-10-12 基线。验证：两场景报告逐项对照留档。【2026-10-15 收口】rcl-sprint 侧的采集利用率/升级速率稳定窗口/cc 存量曲线三项基线对照由 `fix-p1-14-rush-sprint` §3.5 主责，本族不重复留档；本族保留 boot 3/3 + TTL churn + 迁移执行。【2026-10-15 进展】boot-from-scratch 绿（L3@17371，基线 19721 改善；schema 已由 v10 推进至 v11，迁移判据随之顺延）；TTL churn 与 rcl-sprint 三项指标未取证 —— **不勾销**

> **§5.4 文档同步已由 `fix-p1-14-rush-sprint` §7.4 承接**（P1-14 文档勾销门的前置为 RCL4 达成，未达成前不得勾销 P1-14）。验收标准原文保留：docs/bugs P1-14 勾销附 sim 证据；外矿前置件标记完成；docs/14 进度快照；docs/21 视角更新；参数校准结论回写 config 注释；验证为文档与代码一致、无「待跑」遗留。

> **§5.5 私服实测（可选收尾）已由 `fix-p1-14-rush-sprint` §7.5 承接**。验收标准原文保留：`submit.js 47.100.24.220@nexus --branch main` 落地 W5N8，eval.js 取证定编/接力/专线行为与 RCL 时间线，控制台取证记录回填 bugs 文档；本族取证项随该族落地一并回填，本族不再留同门待办。

> **2026-10-13 实施与校准实录**: 主体 12/17 落地 (纯函数/配置/schema/孵化接线/专线/接力全链),
> 迁移六用例 12/12 绿, typecheck/lint 双绿, boot RCL2@549 (新模拟器基线 1462 的 2.7×)。
> 校准二分 16 轮 (design 校准记录): pile 项正反馈炸弹摘除 (+4223)、交付兜底配额白名单 (+6151)、
> relay (+1222)、carrier 吞吐编制 (+2915) 为正; capacityWait 实验/专线收紧闸/优先级回退为负并留档。
> 当前 sprint control 12387 vs 当日基线 14428 (−14%), RCL2@1379 略优; RCL4 断言仍未过
> (2026-10-15 收口: 该门转 `fix-p1-14-rush-sprint` §7.2 继续),
> 剩余差距指向「空闲运力口径 / EMA 供给信号」的稳态化, 禁止单旋钮 (见 design 校准史)。

## 6. carrier 交付侧行为校准 (2026-10-13 增补)

- [x] 6.1 顺路灌注: deliver 路径相邻配额目的地就地交付 (白名单同源, 非任务目的地), 参数入 CARRIER_BEHAVIOR_CONFIG。验证: typecheck 绿; sim 报告 delivered EMA 提升; 非配额相邻结构零灌注 (走查)
- [x] 6.2 溢流落堆闸: 无可投目的地 + cc 在位 + 升级圈饥饿 → 落堆 cc 位 (上限入配置); 无饥饿消费者持能待命。验证: typecheck 绿; cc 满场景 dump-memory 观察落堆与拾取; 无饥饿场景零落堆
- [x] 6.3 回归: boot 3/3 ✓ + 双场景 noErrors ✓。【校准裁决】两闸同拍开启 control 12387→11259 (−9%) 且 RCL3 时间线劣化 (顺路灌注与 cc 专线抢边际能量), 已默认关停回稳 12387——机制保留, 重启前置=灌注/专线的配额再平衡 (design D9 留档)
- [x] 6.4 cc 取能水位排他 (P2-15): nearestStore 按 `ccUpgradeReserveOf` 水位排他/开放——cc 高于升级保底作交换枢纽、低于保底护升级底线。验证: 全量排他 5442 (大负) vs 水位排他 **15044@50k (超基线 14428)** / 65k 17944; bugs P2-15 留档
