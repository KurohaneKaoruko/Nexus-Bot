# 24 · race 冲级机制复刻 (Rosmarin race → Nexus)

上游 Rosmarin race 分支 40k speedrun 实测 (同机同场景): L4@10,304 / L5@24,658,
升级 1.41M, 采集 3.09M——为 Nexus 当前 (L4@28,316, 升级 230k) 的 4~6 倍。
差距不是单点参数, 是一整组互相咬合的机制。本文档是逐机制复刻清单,
按依赖顺序排列, 每项含上游源码位置、Nexus 落点、验收口径。

> 原则 (用户口径 2026-10-20): 机制级复刻, 不搬文件不搬代码风格——
> "直接照搬那我为什么不直接用 Rosmarin"。每项用 Nexus 自己的模块
> 架构 (任务板/定编/孵化链) 表达, 语义与上游一致。

## 与上游的关键差异总表

| 轴 | Rosmarin race | Nexus 现状 | 差距判定 |
|---|---|---|---|
| 升级定编 | 实测 income 驱动 maxWork, spawnBalance 乘数 1~1.2 | 收入打折+固定口径 | 定编引擎缺实测 income |
| 搬运定编 | CARRY 部件计数 (numCarry<maxCarry 才孵), 15/6 分档 | 单位数计数 | 口径不同 (部件 vs 只) |
| 外矿选择 | 背包 DP (value/weight, spawn 容量约束) | 密度排序 + 3 房预算 | 算法不同 |
| 外矿执行 | 驻源矿工 + porter 链 + value/weight 记账 | harvest 任务 + 跨房 carry | 语义近似 |
| 闲职转岗 | pullIdler 按 body 重分类 (upgrader/porter) | 单位绑定 taskId | 无此机制 |
| 升级体体型 | carryRatio=4 自适应 W/C/M, WORK 垫尾 | carryEnergyPerWork | 公式不同 |
| 孵化用量 | spawnUsage 逐源扣减 (porter/升级体 CARRY) | 按任务优先级排队 | 口径不同 |

## P0 · 收入引擎 (income 实测口径)

**上游**: `remoteUtils.ts:114` `room.memory.defaultIncome` 逐源累计净收入;
`roomUtils.getRoomStats(room).income` 直接读该值; `getMaxWork()` 用
income×multiplier 定升级定编。

**语义** (上游 `computeSourceIncome`):
```
本矿源: energyPerTick − minerCost/(LIFE−distance) − haulerCost/LIFE − loss
  minerCost = 体型造价 / (CREEP_LIFE_TIME − distance)
  haulerCost = energyPerTick × distance × 0.04 × (容器?75:100) / LIFE   (link 期=0)
  loss = 容器期 CONTAINER_REPAIR_LOSS_OWNED, 裸源 1
远程源: computeRemoteSourceIncome 同式 + 预订容量加权
```

**Nexus 落点**: `src/modules/economy/income.ts` 新增 `netIncomeOfSource(ctx, info)`:
- 本矿源: 采集能量/t − (矿工造价/(1500−距离)) − (回运成本/t) − 维护损耗
- 远程源: 按预订状态乘 2.0 (订满 3000) / 1.0 (未订 1500), 再减跨房增量成本
- `defaultIncome` = Σ 净收入, 写入 room memory, 升级定编直接消费

**验收**: speedrun 40k, sim 里 Nexus defaultIncome 与 Rosmarin 同场景数值
同数量级 (>10/t); 升级定编随实测收入浮动。

## P1 · 升级定编 (maxWork = f(income))

**上游**: `roomUtils.getMaxWork`:
```
LCL<2: 5
LCL8 且非 building: upgradeNeeded ? 15 : 帝国能量水位门
其余:
  lower = upgradeNeeded ? 5 : 0
  upper = getUpgradeCapacity (link 期 800/(range+1), 无 link 90)
  terminal 期: clamp(energyLevel−90, lower, upper)
  storage 期: <90 → ceil(income×energyLevel/100)
              >moreUpgraders → ceil(income + energyLevel − 90)
              其间 → ceil(income)
  无仓期: floor(clamp(income × (spawnBalance/2+0.8), 1, 1.2))
```
`manageUpgrade.ts:100`: 角色转岗——**闲置 upgrader 转岗前置**: 升级定编缺口
先从 idler 里找 (有 W 有 C 的) 转岗, 转满才考虑孵化; `2×(maxWork−numWork)<
bodyNumWork` 不孵 (防小体 churn)。

**Nexus 落点**: `src/modules/economy/quota.ts` (或 workforce) 的
upgraderCountTargetOf 改为 income 驱动三段式; `demandSources` 的半缺口不孵闸
(已有, 4.3) 保留; **新增 idler 转岗**: agents 侧"无任务 carrier/harvester
且带 W+C"可被升级任务临时征用 (任务优先级机制内表达, 不改角色字段)。

**验收**: speedrun L4 时点 maxWork 数值与本矿+外矿 income 匹配;
sprint/arena 不回退。

## P2 · 外矿背包选择 (spawn 容量约束下的 value/weight DP)

**上游**: `remoteUtils.ts:190-310`: 逐远程源算 {value=净收入, weight=spawn
用量}, 01 背包取 max value, `resultStats` 按 value/weight 降序即发展顺序;
`spawnCapacityForRemotes = floor(totalSpawnUsage)` 为容量。

**Nexus 萪点**: `src/modules/economy/remoteMining.ts` 现密度排序+3 房预算
改背包: weight = 逐源 spawn 用量 (矿工体型/寿命 + porter 增量), value = 净收入
(P0), 容量 = 总 spawn 吞吐 − 本矿刚需 (矿工/搬运/升级体占用)。

**验收**: speedrun t5k 时点外矿房数与上游同场景一致 (±1); L3 前完成首批
外矿孵化。

## P3 · porter CARRY 部件定编

**上游**: `manageLogistics.ts:152-185`: `numCarry = Σ 活跃 CARRY (剔除将死)`,
`maxCarry = 6×spawnUsage (LCL<7) + controllerNumCarry (无 controller link 期)
+ DELIVER_ENERGY 任务 +16`; 缺口时先 pullIdler (纯 C+M 体) 转岗, 无才孵
`getHaulerBody(room.energyAvailable)` (注意: **energyAvailable** 不是容量)。

**Nexus 落点**: demandSources carrier 定编改 CARRY 部件口径: 目标部件数 =
6×spawn 吞吐占比 + 升级投喂位 (无 controller link 时); 身体计数沿既有
unitTargets; 拉伸型: 缺口时优先低代价转岗 (已有 universal 兜底)。

**验收**: speedrun 40k 存活 porter 总 CARRY 与上游同数量级; fill_spawn 饥饿
tick 占比 < 1%。

## P4 · 升级体体型公式 (carryRatio=4)

**上游**: `spawnUtils.getUpgraderBody(energyCapacity, maxWork, carryRatio=4)`:
贪心组装 W/C/M, 约束 `(CARRY_CAPACITY×carry)/work ≥ carryRatio` 且
`work/move ≥ 4` 补 MOVE, WORK 垫尾 (重伤减速保 W)。无仓期 carryRatio=1
(tight CPU 期=5)。

**Nexus 贽点**: `src/utils/remoteBody.ts` 新增 `buildUpgraderBodyConfig`
(或改 bodyFactory upgrader 档): 按 carryRatio 组装, W 垫尾。

**验收**: speedrun RCL3 期孵化出的 upgrader 体型与上游 sim 对齐 (W/C/M 比)。

## P5 · 闲职转岗 (pullIdler 语义)

**纯机制**: 任何角色孵化后按 body 能力被"最近的缺口"认领: 有 W+C →
upgrader/porter 候补; 纯 C+M → porter 候补。上游 `roomUtils.pullIdler`。

**Nexus 落点**: 已有 universal 兜底 + allocator 的 capability 匹配, 缺
"孵化后动态转岗"。表达: agents 认领任务时放宽 (任务 requiredCapabilities
满足即可认领, 不查单位角色绑定)——**与 P1 的 idler 转岗同一处**。

**验收**: sim 探针: 换代潮窗口 (t≈8-10k) 无"空闲且能量>0"的成体 >20t。

## 实施顺序与验证

1. P0 income 引擎 (无依赖) → 40k speedrun 跑分
2. P1 升级定编 (依赖 P0) → 40k
3. P2 外矿背包 (依赖 P0) → 40k + 外矿房数探针
4. P3 porter 定编 (独立) → 40k
5. P4 体型公式 (独立) → 40k
6. P5 转岗 (独立) → 40k
每步 40k speedrun A/B, 负收益即回退留档 (docs/bugs/race-strategy-port.md)。
全部落地后跑六场景矩阵, 全绿后更新 sim-matrix-reference.json。

## 已复刻项核对 (防重复劳动)

- link 吞吐 800/(range+1): 已在 (4.1)
- 止升让位 (building&&!upgradeNeeded → 0): 已在 (4.2)
- 半缺口不孵闸: 已在 (4.3)
- energyStandard 档位: 已在 (4.4)
- spawnBalance EMA: 已在 (3.3)
- 替补错峰: 已在 (2.1/2.2)
- 开局序列 harvester→upgrader→carrier: 已在 (5.1)
- 外矿密度排序: 已在 (5.2) —— **P2 将替换为背包 DP**
