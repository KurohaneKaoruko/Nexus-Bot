# Tasks

## 1. 批次 A：断言与基线

- [x] 1.1 speedrun 断言三档化：`sim/speedrun.sim.ts` 断言改为 RCL4≤10000 / RCL5≤20000 / RCL6≤40000（删 L2≤500/L3≤3000/L4≤5000/L5≤15000/L6≤30000 五档，保留 noErrors + cpuP95Below 20），场景 ticks 延长至 45000（RCL6 门 + 余量）；验证：`npm run sim` 跑 speedrun 场景，断言口径生效（红是预期——目标态断言）
- [x] 1.2 三轴基线探针采集：跑一轮 speedrun 固化当前数据——升级均速曲线（每 1kt 的升级量）、孵化节律（相邻出生间隔均值）、人口曲线（每 1kt 存活数），存档到 race-strategy-port.md 遗留段；验证：三轴数据有明确数值（当前 L4=None 的瓶颈轴可判读）
- [x] 1.3 Rosmarin 口径核对清单：对 race bot 源码逐项核对并列表——energyStandard 表、upgradeNeeded 触发线（ticksToDowngrade 阈值）、building 标志语义、CONTROLLER_DOWNGRADE 表、carryRatio 缺省值；验证：清单落 race-strategy-port.md，每项带源码行号引用

## 2. 批次 B1：同龄批死亡潮根治

- [x] 2.1 替补错峰窗口离散：demandSources.ts 替补触发点增加单位名哈希离散项，均匀分布于 [0, 孵化周期×同批规模] 窗口（复用既有名称哈希函数，参数进 config/economy.ts：disperseWindowFactor）；验证：sim run-residue + speedrun 人口曲线无 V 型谷（峰谷差 ≤30%），同一单位名多次运行离散点恒定
- [x] 2.2 numWork 剔除将死体：workforce 定编统计加 `ticksToLive > body.length×CREEP_SPAWN_TIME` 过滤（对齐 race bot manageUpgrade 口径），避免将死体占编导致替补延迟；验证：单测覆盖将死体不计入定编、替补不与将死体重复孵化

## 3. 批次 B2：填充动力学 + spawnBalance

- [x] 3.1 fill_spawn 认领即锁定：孵化需求任务发布 Tick 内完成能量认领（账本 reserve 即时生效，TTL 兜底），消除跨 Tick 认领延迟；验证：sim 探针显示孵化槽空闲→蓄能开始间隔显著缩短，涓流场景孵化节律 ≤120t/只
- [x] 3.2 孵化槽空闲前瞻：spawn 空闲前 N tick 预备能量（N=最小体型孵化时间，config 化），spawn 出槽即有能量可孵；验证：speedrun 冲级期孵化节律统计达标
- [x] 3.3 spawnBalance EMA 移植：两路信号（搬运需求未满足 → +1 目标 / 搬运空转或建造断粮 → 0 目标）驱动 EMA（α=1−2^(−1/50)），无仓期（RCL1–3）升级定编乘数 `clamp(balance/2+0.8, 1, 1.2)`；storage 建成后停用；信号源映射 Nexus 的 fill/haul 任务队列状态；验证：无仓期定编动态可见（sim 探针），storage 期行为不变（回归）
- [x] 3.4 porter 直供收益评估（不实施）：用 3.1–3.3 落地后的探针对比 race bot manageLogistics 体系覆盖面，评估结论（含数据）记入 race-strategy-port.md；验证：评估结论有 sim 数据支撑，明确"移植/不移植"决策

## 4. 批次 B3：升级定编四口径对齐

- [x] 4.1 link 吞吐封顶对齐：controller link 期升级定编上限改 `floor(800/(range+1))`（range=两 link 切比雪夫距离，无 link 期 90），替换现行几何吞吐公式族；验证：单测覆盖 range 各档位（4/6/10/∞）的封顶值，speedrun RCL5 期定编不超上限
- [x] 4.2 止升让位：`building && !upgradeNeeded` 时 upgrader 定编归零（upgradeNeeded 按 ticksToDowngrade 低于降级线触发，对齐 race bot manageUpgrade L78-81 口径）；验证：建造高峰期 upgrader 定编归零、降级风险时恢复，单测覆盖两态切换
- [x] 4.3 半缺口不孵闸：`2×(maxWork−numWork) < bodyNumWork` 时放弃孵化（防小体 churn，对齐 race bot manageUpgrade L133）；验证：单测覆盖半缺口场景不孵化、全缺口场景正常孵化
- [x] 4.4 energyStandard 档位核对：Nexus energyLevelOf 与 race bot config 表 {1-3:10000, 4:20000, 5:40000, 6:80000, 7:160000, 8:320000} 逐档比对，不一致以 race bot 为准；验证：逐档数值表落 race-strategy-port.md，代码对齐

## 5. 批次 B4：开局序列 + 外矿评分

- [x] 5.1 开局序列按 roomMode 分档：rush 模式开局序列改 harvester→upgrader→carrier（首只采集体先于搬运体），main 档保持现行；分档走 config；验证：speedrun L2 达成时间较 1117 基线缩短 ≥300t，boot 场景 L2 漂移 ≤10%
- [x] 5.2 外矿激活评分排序：remoteAutoMaxRooms 固定上限改价值密度排序（value/distance，预算内贪心取前 K），rush 模式预算保底不因本地紧张清零；验证：speedrun 冲级期外矿激活数随预算扩展（≥3 房），收入曲线上升；remote-mine 场景断言不红

## 6. 批次 C：冲刺迭代（循环直至三档全绿）

- [ ] 6.1 冲刺循环：跑 speedrun → 读三档达成 → 未达标轴定位（升级均速/采集面/孵化节律）→ 针对 race bot 对应机制移植或调参 → 全场景回归 → commit；每轮记录到 race-strategy-port.md（含负收益撤销留档）；验证：RCL4≤10000 达成（用户口径 2026-10-20：RCL2 ≤500 为达标线、≤1000 为合格线——批次 Q 已达 458，见档案）
- [ ] 6.2 冲刺循环（续）：同 6.1 程序推进；验证：RCL5≤20000 达成
- [ ] 6.3 冲刺循环（续）：同 6.1 程序推进；验证：RCL6≤40000 达成，且 speedrun 全断言（三档 + noErrors + cpuP95Below 20）全绿
- [ ] 6.4 全场景回归总验：六场景门（boot/sprint/remote-mine/arena/speedrun/run-residue）+ tsc + oxlint + arch-guard 全绿；boot L2 漂移 ≤10% 核对；验证：`npm run sim` 全场景输出全绿留档

## 7. 批次 D：实服落地（三档全绿后）

- [ ] 7.1 提交冲级代码：按主题分批 commit（错峰/填充/定编/序列/外矿各一批），推 main；验证：git log 分批清晰，arch-guard 钩子全绿
- [ ] 7.2 实服落地：`node submit.js 47.100.24.220@nexus --branch main` 上传，落地 W5N8 从零开局；验证：私服 console 无异常刷屏，bot 自举正常（L2 时间线与 sim 口径同数量级）
- [ ] 7.3 4wt 周期观察：观察一个完整 4wt 重置周期内 RCL 时间线（对照 10kt/20kt/40kt 三档），实服特有缺陷按 03 §41 流程登记 docs/bugs；验证：实服 RCL4 达成时间记录在案，与 sim 差异有归因（或缺陷登记回流）
