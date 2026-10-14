# Design

## Context

- P1-14 三条根因（docs/bugs/sim-audit-2026-10-12.md）：① 升级工能量链路过长、无控制器容器缓冲（布局已留 cc 圈、选址权让位但决策未实现，见 `layoutPlanner.ts` L1146-1160 的跳过逻辑）；② 固定段 [W,C,M]/[C,C,M] 体型不感知地形，沼泽房 1 格/2tick 往返占比极高；③ carrier 交付优先级无 cc 口径，升级工经 spawn 折返被饿死。
- 参照实现能力齐备（Rush 冲级体系）：既有实现 `shared/rush.ts`（预算现算体型 + 分段评估）、`roomMode.ts`（四档参数表与解析）、`prototype/Room/function/rushSupport.ts`（五闸门快递）、`roomWorkforce.ts`（升级工位名册分配）。
- 现有可依托的 Nexus 机制：worksite 驻点与容器合一（P0-3）、quota 目的地配额 + ledger 在途承诺（phase2）、攒能定档（P2-13）、DOWNGRADE 紧急通道（P1-10）、RUSH_CONFIG 冲级面板、sim 双场景回归（boot / rcl-sprint，断言 `rclReachedBy 4 @40000`）。
- 约束：AGENTS.md 零硬编码、参数入配置；参照实现保持原貌，主线侧以薄适配进行；拒绝过度抽象。

## Goals / Non-Goals

**Goals:**

- rcl-sprint 3/3 断言通过（P1-14 验收 = speedrun 底线），boot/9 房场景不回退。
- cc 缓冲、地形感知体型、升级直供三条根因各自可独立验证（单测 + sim 指标）。
- roomMode 档位成为后续参数扩展（外矿/工业/low 降档）的公共参数入口。

**Non-Goals:**

- 不做外矿/接力搬运、Lab/Factory/市场、Team（后续变更）。
- 不做跨房间 mode 协同与 CPU 预算驱动的自动换档（自动档仅按 cpu.limit 默认值，换档靠显式设置）。
- 不重写 movement/交通（BetterMove 已在役）；不引入 storage/link 供能链（RCL5+ 正规链路另议）。

## Decisions

### D1 cc 决策归属 planner 域，消费归 economy 域

选址与落站点是建造关注点：cc 决策放进 `src/modules/planner/`（与 bootstrap Source 容器同一通道、同一失败分类与冷却口径），产出「期望 cc 点位」供后续消费；economy 侧（quota/agentSystem）只认「控制器配置范围内被采纳的那个容器」。备选是放 economy/construction（该文件已退役）或 world/worksite（那是 Source 驻点语义），前者无落站点通道，后者语义错位。采纳既有容器（任意来源）为 cc，避免与布局放量打架；`layoutPlanner` 控制器旁容器跳过逻辑保持，加回归用例锁定让位契约。

### D2 升级工位：task-per-slot（实现期修订）

规划期的名册方案（单位名排序对位 i mod n）在实现时升级为「每工位一条任务」：planners 对 cc 每个工位发 `upgrade:<room>:cc:<x>,<y>` 任务（targetPos=工位），与 harvest-per-source 同构——租约即分配，天然稳定/互不重复/免并行名册机制，复用任务板的 heartbeat/对账/取消生命周期。工位池本身（cc 相邻 ∩ 射程 ∩ 可站位）由感知每 Tick 枚举进快照（controllerBuffer.slots，固定顺序）。agentSystem upgrade 分支：有 cc 时钉在 task.targetPos 工位 withdraw cc + upgrade 原地，无 cc 回退既有 anchor 取能评分链路（P1-4 语义不回退）。

### D3 体型编译：utils 纯函数 + bodyFactory 薄适配，不做整文件移植

rush.ts 的体型生成器是零依赖纯算法（部件成本表 + 预算循环），按「不重写算法，只移植边界」移植到 `src/utils/`（主线严格 TS 风格改写，算法语义逐条对应；不变量——预算界/下限拒绝/封顶——以严格类型 + 参照实现逐条对照锁定，行为由 sim 场景回归），bodyFactory 以角色+预算+地形档调用。地形感知：新纯函数按房间地形数据（沼泽密度 + 关键通道路网覆盖率，低频有界缓存）输出 move 配比档（即 rush 生成器的 `speed` 参数语义：无路网沼泽房 speed=1，路网达标回落路面组 0.5/0.33 档），阈值入 `BODY_TERRAIN_CONFIG`。选择参数化而非新写一套「沼泽体型表」：避免两套口径漂移（upgradeBody 实现 同理由共用 buildRushUpgraderBody）。

### D4 roomMode：配置表 + strategy 域 resolver + schema v9 只加可选字段

档位参数表入 `src/config/roomMode.ts`（本期只放有消费方的参数：upgradeIncomeMultiplier、courierEnabled；后续参数扩展再扩），resolver 入 `src/modules/strategy/roomMode.ts`（战略域拥有指令类状态）。解析优先级：`Memory.nexus.rooms[x].mode`（显式）> 配置默认（cpu.limit 阈值）> main。schema v8→v9 只加可选字段、迁移仅推进版本号与回填默认，无破坏性。**定编教训固化**：冲级档升级定编倍率固定 1.0（对齐实测收入）——实测 ×1.5 会让升级任务永久欠账、持续抢占 spawn 反而饿垮搬运（roomMode.ts rush 注释），此教训直接写入配置注释。

### D5 courier 不走任务板

快递生命周期以秒计（取满即自爆），任务板的租约/对账/冷却开销无收益。结构：economy planning 段产出「快递孵化请求」（五闸门在此判定，全部参数入 `COURIER_CONFIG`），spawnDirector 按请求排产（低于基础编制优先级），agentSystem 按 `rush-courier` 角色分支直接驱动（withdraw→移动→suicide，意图经 broker；suicide 意图若缺则补分类与计数）。墓碑能量由既有 dropped/tombstone 机制进入升级圈，升级工 fetchEnergy 的 pile/tombstone 路径天然承接——不新增拾取逻辑。

### D6 分段判废：纯函数移植 + 面板消费，快照有界

evaluateRaceSegments/applySegmentVerdicts 移植为 `src/utils/raceSegments.ts`，raceVisual 消费渲染达成/落后/判废行；判废快照（census/upgradeWork/cc 存量/能量态）仅首次判废写入 Memory（单条覆盖、有界），限频 warn 日志。不接自动重启/自动降档——判废先只做观测与归因（docs/02 原则 F：无证据不行动）。

### D7 验收判据与防回退

主线判据 = rcl-sprint 3/3（`rclReachedBy 4 @40000`、`cpuP95Below 20`、`noErrors`）；防回退 = boot-from-scratch（RCL2@5000 窗口）+ 9 房场景（跨房泄漏指标不回退）。体型/定编改动风险最高，双场景 + 参数分档确保平地行为不变（bodyFactory 平地输出与旧模板的等价性由 boot 场景回归与 dump-memory 机体对照锁定）。

## Risks / Trade-offs

- [cc 选址与布局点位冲突] → 让位契约已有跳过逻辑，加布局回归用例；cc 采纳既有容器优先，绝不二次放量。
- [墓碑 decay 口径在 sim 与官服不一致] → 快递行为优先向 cc 相邻格自爆（能量直接可收）；sim 回归观察 tombstone 利用率，若 decay 损失超阈值，配置开关降级为「快递直接 transfer 入 cc」路径（闸门逻辑不变）。
- [体型改动波及平地场景] → 双场景回归 + 平地等价断言；`BODY_TERRAIN_CONFIG` 分档保守起步（只有明显沼泽房才提高 move）。
- [roomMode 增加决策面] → 本期只接 2 个消费点，参数表空转成本为零（读档 O(1)）；非法值回退 main 并告警。
- [快递挤占孵化] → 五闸门里 spawn 忙/队列积压/底仓/运作线四重防护 + 请求优先级低于基础编制；闸门分支以针对性 sim 场景（dump-memory/报告计数）覆盖。
- [cc 补货与 fill_spawn 争运力] → cc 优先级档位介于 tower 与 spawn 之间可配，冲级档提权；诊断窗口观察 delivery 分布校准。

## 校准实测记录 (2026-10-12, sim rcl-sprint seed7 沼泽房)

- 已生效并改善：rush 升级偏置 (upgradeBias 55, RCL≤4)、ext/cc/路网建造梯次 (25/25/20)、
  地形档体型 ([C,M,M] 搬运组 / speed=1 采集)、落地堆按坐标去重、carrier 常驻优先级 72、
  取料锚定 (build/repair) 与供能结构兜底取料、低水位 12 持续放量、starvation 计数含
  extension (destination 分支抬配额水位——实测承重, 勿"修复")。
- 试过并回退：fill_spawn 按水位截断 (饿死出生引擎, 升级 8297→4083)、extension 低水位
  (同类)、分配器角色匹配加分 (劳力灵活性损失, 8297→2874)、ext 优先 35 (压制过狠 →2900)、
  haulBias (确定性零差异, 已移除)。
- 第二轮校准（继续会话）：
  ① 动态布局 road 曾被门控在 RCL4（`getLayoutPointsForRcl` roomLevel<4 return []）——
    沼泽房 50k 零道路, 交付 10t/格封死; 放开到 RCL2 + road 优先 40 后路网落地 (50k 52 站点),
    升级速率 0.63/t 首次全程稳定 (t20k-40k 无衰减);
  ② carrierMultiplier 衰减下限入配置 (min 2);
  ③ 修复快递致命 bug: 合成占位任务触发 broker lease-lost, 快递 withdraw 从未执行过
    (全程空载自爆白烧 spawn 能量, warn 日志实锤); 修后新增墓碑漏损 (升级 19437→9324),
    按 design 风险预案落地 deliveryMode 开关, 默认直投 transfer 入 cc 复跑。
- 结果（最终配置 50k）：升级总量 894→17658~19437 (20×)，升级速率 0.63/t 稳定窗口
  t20k-40k，RCL2@1653 (基线 1841 略优)，boot 平地 3/3 不回退 (RCL2@924)。
  **RCL4@40000 仍未过** (50k 停在 RCL2 进度 ~17k/45k, 需求 4.5/t vs 实际 ~0.4/t 均值)。
- 瓶颈归因（判废快照 + 出生日志 + 50k 曲线）：交付速率封顶 2.4/t (transfer 1182/50k)
  vs 采集 13/t——carrier 数量受出生槽竞争压制; TTL churn 437 出生/79k 能量;
  曲线峰值后回落说明 ext/路网投资与升级争夺同一批劳力。
- 后续方向（需超出本变更的移植）：race 的源旁 extension 直填 (绕开 carrier 腿)、
  专用建造部队 + carrier 供料到工地、关键岗位大身体摊薄 TTL、或按 7.5 先私服实测
  (实服无 sim 的 spawn 自动回能口径差异可能改变经济形态)。
- 第三轮校准（2026-10-12 续, 源旁直供链）：
  ① ring-2 ext 落位 + 矿工直填泵 (work/carry 跨管线同 tick) 复刻入主线;
  ② 强制 harvester 带 carry (RCL2 档 550 容量 → 4W2C1M): 升级 17658→4614——
    -1 WORK 削总供给, 且源能量被导向 ext/spawn 而非 cc 升级链, 已撤销;
  ③ 落位降到 RCL2 起而无泵: 17658→14157——carrier 补能腿被拉到矿区, 纯负;
  ④ 最终 minRcl=3 (1-CARRY 下限免费窗口): RCL2@1895 不变, 50k 升级 19674
    (基线带 17658~19437 上沿), 采集 4/t。结论: 直供链只在与 carry 免费窗口
    重叠时为正; RCL4 瓶颈仍在 carrier 出生槽竞争 (下一步 = roomWorkforce
    定编/productionGate 校准)。
- 第四轮校准（2026-10-12 续二, 孵化侧手术——**全部负收益, 已整体撤销**）：
  实验序列 (50k control / RCL2@t): 基线 19674/1895 → urgent 资格收紧+harvester 等待
  2000t+缺口门 11193/2813 → +运力分支放宽 8793 → +库存剔除落地堆 4177 →
  +开局解禁+rush 搬运托底 3265/2564。逐项撤销后精确回到基线 (确定性 sim 复核)。
  **结构归因** (出生普查 + 能量平衡): control = 采集 − 孵化 sink (1.6~1.9/t) −
  建造 (~0.6/t) − 落地衰减 (2~3/t); 搬运腿天花板 ~3/t (2.5 只 6 部件 carrier,
  沼泽往返 ~200t/200 能量); 大身体提升采集 (+52% 至 6.1/t) 但增量全部烂在矿区,
  且孵化能耗反升 (94k vs 81k)——**小身体快循环在当前经济形态下优于大身体慢循环**。
  缺口门的 count 口径移植还有语义错误 (既有 是 WORK 缺口, count 会把 gap=1
  的合理增长永久堵死)。
  **结论**: 定编/物流问题不能在孵化层打补丁, 必须成套校准 workforce
  机制——productionGate (产出就绪闸)、接力搬运 (OC 微型件多跳)、吞吐现算定编
  (buildCarryPlan: Σ2×距离×ept×系数)、路网协同 (道路减半往返)。即外矿前置件
  外矿的前置件, 作为下一个完整变更执行。
- 第五轮校准（2026-10-12 续三, 冲级物流车道——负收益, 已撤销）:
  沿「源驻点 → cc」Bresenham 直线放路 (并发 4, RCL2..4 窗口)。单车吞吐理论
  ~5× (沼泽 1格/5t → 道路 1格/1t), 但实际触发建造潮: build 意图 9009、建造
  能耗 29.5k→45k, 采集 +2.8/t 的增量全被建造吸走, control 19674→8322。
  **跨轮总结论 (四/五轮合并)**: 该经济是强耦合能量预算系统——孵化侧、诊断侧、
  建造侧任何单杠杆的增益都会被其余 sink 的反噬吃掉; 唯一被验证为正的例外是
  直供链 (与 carry 免费窗口重合的真零腿化)。RCL4 修复必须整体校准
  workforce 机器 (定编/接力/路网/闸门同拍), 拆散单点是死路。
- 实服取证 (2026-10-12 晚, scripts/eval.js 非交互控制台求值上线):
  服务器 ~10 t/s, 40k 窗口 ≈ 67 分钟/周期; 账号 4wt 自动重置后经 land.js 复产。
  上一周期 (旧代码) raceVerdict 判废 segment 2 (RCL1@+1001t);
  本周期 (直供链构建) 已过 RCL2 (<+2324t)。早期升级斜率 0.27/t (t≈3.4k 窗口)。
  **口径差实锤**: 服务器存在能量注入 (ledger delivered EMA 19.7 vs produced 4.3,
  sim 无此机制), 但早期斜率与 sim 同数量级——workforce 移植对实服同样必要,
  「随移植一并解决」的裁决不变; sim 断言仍是有效的主线回归口径。

## Migration Plan

1. 合入顺序 = 任务组顺序（纯函数/配置 → cc → 体型 → mode → courier → 判废 → 回归），每组独立可回滚（纯增量，无删除路径）。
2. Memory v9 迁移幂等（缺字段回填默认），回滚到 v8 代码时多余字段被旧 schema 忽略，无破坏。
3. 上线验证：sim 双场景全绿后，`submit.js 47.100.24.220@nexus --branch main` 落地 W5N8 冲级实测（speedrun 榜口径），观察 mode/快递/判废面板与 RCL 时间线。

## Open Questions

（无——cc 最低 RCL 门控、闸门阈值等均为配置校准项，不改变规格与结构。）
