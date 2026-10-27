# 冲级期能量损耗台账（掉落衰减 / 临死携带）

优先级：**P1**（冲级分数上限的直接约束项，20k 场景约 15–24/tick）
状态：**机理已定量，修复方案未收敛**（下方"已验证无效/负优化"清单请勿重跑）

## 1. 现象

20k 官方场景守恒对账（`sim.mjs` 4 组，默认构建）：

| 项 | 值（20k 累计） | 折合 /tick |
| --- | --- | --- |
| harvested（bot 台账） | ≈ 1,872,000 | 93.6 |
| control（累计 control） | ≈ 1,076,000 | 53.8 |
| spawned（body 成本） | ≈ 450,000 | 22.5 |
| built | 41,000 | 2.0 |
| **未记账损耗** | **≈ 301,000** | **15.0** |

改造遥测场景（`srb2-rec-mem.json`，同一套代码）损耗更大：harvest 1,980,794 /
control 1,093,809 / spawn 394,650 / build 41,079 → 损耗 451,256（**22.6/tick**）。
两个场景损耗率差别来自房间数量与远征占比，机理相同。

## 2. 损耗机理（已确证）

`Screeps-Simulation` 引擎 `src/engine/tick.rs::tick_dropped_energy`：

```rust
let decay = (amount + ENERGY_DECAY - 1) / ENERGY_DECAY; // ENERGY_DECAY = 1000
```

即每堆掉落能量每 tick 衰减 `ceil(amount/1000)`。

**关键后果：小堆的损耗率被 ceil 放大。** 一堆 100 能量每 tick 也掉 1，100 tick 归零
（名义 0.1%/t 实际 1%/t）；50 个 100 的小堆 = 50/tick 的损耗。因此
"堆数"比"堆里总量"更重要。遥测 `L.decay` 逐 tick 累加 `ceil(pile/1000)`，
与守恒算出的真实损耗逐项吻合（23.5/t vs 22.6/t），说明**账没算错，能量确实被衰减吃掉**。

### 2.1 堆在哪里

给遥测加 `pr`（分房总量）与 `pp`（≥150 的堆坐标）后（`telemetry.ts`），稳态快照：

```
t=19600  W1N2:22,14=633  W2N1:29,28=559  W2N3:29,28=1253
         W2N3:22,14=4595 W3N2:22,14=658
```

- **绝大多数堆在源点矿工脚下/旁边**（各房同坐标，因九宫格地形一致），来源是
  `dropMiners: 1`（矿工无 CARRY，采到即掉地）。
- 第二大来源是**临死 hauler 掉包**：35 只 hauler / 1500 tick ≈ 0.023 死/tick，
  实测每死携带 ≈ 470–600 能量（接近满载），合计 ≈ 11/tick。

### 2.2 为什么远端矿点会积压成 4.8k

`Memory.srcs` 定编用的是 `reservedRate()`：未预定房间按 5/tick 估，预定/自占按 10/tick。
`W2N3:0`（dist 62，未预定）→ `slackUnreserved 0.77` × rate 5 →
`needCarry = ceil(5*(2*62+6)*0.77/50) = 10` → 只排 2 只 hauler；
但实际矿工 5 WORK 采 10/tick → 差额 5/tick 全部堆在源点并衰减。

实测各 key 定编（t=20k，共 35 hauler）：

```
W2N3:0 dist62 → 2 只   (堆 4595)   ← 未预定，欠编
W1N2:1 dist61 → 4 只
W1N2:0 dist55 → 4 只
...
W2N2:0 dist12 → 1 只   W2N2:1 dist11 → 3 只
```

**但补编不划算**：远矿一只 hauler 单趟 2×62+5 ≈ 130 tick 送 300 能量 ≈ 2.3/tick，
即 0.1/tick/part；而同样 1 part 放升级工是 0.86 WORK/tick。折算成 control
（当 WORK 与能量都紧时取 min）仍是亏损，故欠编是当前架构下的**理性选择**，
不要直接调 `slackUnreserved` / `reservedRate`。

## 3. 结构性结论：control 被"能量流量"和"WORK"同时卡住

稳态（5k–20k）实测：hauler 344 parts 交付 ≈ 83.5/tick（0.243/tick/part），
升级工 11 槽 × 6 WORK = 66 WORK 且 `upWorkFed == upWorkAvailable`（**满喂**），
spawn ≈ 20/tick。于是

```
control = min(0.857*U, 0.243*F - 20),  F + U = 421  (500 part 预算 - 矿工66 - 其他13)
解出 U=74.8, control≈64.1   ← 与实测 64 吻合
```

即当前编成已在该模型的**拐点**上：把 part 从 hauler 挪给升级工，能量先不够；
挪回来，WORK 先不够。**单纯调 slack / 加槽 / 加 hauler 都不会涨分**，
必须先降低损耗（等价于抬高 `0.243` 这个交付系数），WORK 与能量才有一并抬升的空间。
若损耗归零，同编成模型解出 control ≈ 82（+28%）。

## 4. 已验证无效 / 负优化（勿重跑）

| 变体 | 场景 | 结果 | 结论 |
| --- | --- | --- | --- |
| `dieMargin: 30`（临死回程余量 5→30 tick） | 官方 4×20k | 1,076,579（+0.36%，4 seed 全正） | **已转正为新默认**，见第 6 节 |
| `dieMargin: 30` | 遥测 | 损耗 22.0 vs 22.6 | 死亡携带没被回收，收益来自别处 |
| `lanePileMax: 500`（巷道堆上限 3000→500） | 遥测 | control 931,396（**-14.8%**），损耗 30.6/t，pileA 13k | hauler 卸不掉→堵在原地，远端堆反而暴涨 |
| `dropMiners: 0`（矿工带 1 CARRY 直接 transfer） | 遥测 | 1,097,212（+0.3%），损耗 21.5/t，pileA 10,088 | 只是把堆从地面搬到矿工身上再落到 hauler，未消除 |
| `pileNear: 1`（源点拾取扩到 range 1，捡临死掉包） | 遥测 | 1,095,290（+0.1%），损耗 22.0/t | 掉包主要不在源点相邻格 |
| 扩建线（`extMax4:20` 系列 + `extHold`/`haulMax`/`upMul`） | 官方 4×20k | 953k–976k（-9%~-11%） | 见 `ring-upgrade-block-throughput.md`：cap 抬升必吃升级能量，L5 晚 ~1,400 tick |
| `slot25: 1`（controller 行加 4 槽，11→15 槽 = 90 WORK） | 官方 4×20k | 1,031,791（**-3.8%**） | 多 4 个升级工必然从 hauler 抽 28 part，交付量掉 → L5 晚到 12,454–12,886，harvest 掉到 1.82–1.84M。**"加 WORK"单独做必然掉分**，与第 3 节模型一致 |

## 5. 仍待验证的假设（按优先级）

1. **满箱 → hauler 停车带载死亡**：`boxE` 长期 7,885（三箱 6,000 + 巷道堆），
   `laneUnload` 在箱子满时让 hauler 停 (28,34) 等；这批 hauler 到点死亡时满载掉包，
   落点在家房且无人回收。
2. **临死出勤（`keepHome`）**：hauler 在家卸完货后若剩余寿命 < 一趟往返
   （`2*dist+12`），当前逻辑仍会再跑一趟，到源点被装满 300~550 后死在半路，
   货直接变远端堆。`K.keepHome` 让这类 hauler 留在家空身死亡（默认 0）。
   单独做预计只有 +0~2%（control 被 WORK 卡在 64），**与 `slot25` 同测才有空间**。
3. **矿工容器存不进（真缺陷）**：`types.ts` miner 分支注释写着
   "the miner keeps its own container: energy in a container doesn't decay"，
   但实际代码只有 `repair(box)`，**没有任何 `transfer(box)` 分支**；
   在 `dropMiners: 1`（矿工无 CARRY）下能量只会掉地，容器完全无效。
   若要让容器缓冲生效，需 `dropMiners: 0` + miner 分支补一个
   `if (box && c.store.energy && 无 adjacent hauler) c.transfer(box)`
   （同时 `minerBoxRcl` 降到 4~5）。注意：这只会缓冲**采矿掉堆**，
   而实测远端堆主要来自**hauler 临死掉包**，所以单独做容器收益有限。
4. **升级工扩容（槽位）**：控制器行 y=25 地形为
   `x=14,15 空地 / 16,17,18 墙 / 19,20 空地`，(14,25)(15,25)(19,25)(20,25)
   都在 controller 3 格内且与 row26 槽位上下相邻。已实现 `K.slot25`（默认 0），
   但单独开为 -3.8%，只能在损耗修复后作为配套。
5. **道路（paved 身体）**：只省 part 不增能量，当前拐点下不涨分，
   且 550 格道路 ≈ 165k 能量一次性支出（= 165k control），暂不做。

## 6. 默认基线回归（已验两轮）

**第一步：新增旋钮全部默认关闭时，逐位复现旧基线。**
`dieMargin`(当时 5) / `pileNear`(0) / `slot25`(0) / `haulMax`(0) / `extHold`(0) / `upMul`(0)/`keepHome`(0)
全部默认值下，官方 4×20k：

```
[1067305, 1071434, 1075888, 1076177]  mean 1072701
rcl@  L2 656/699  L3 3268-3335  L4 5819-5901  L5 12235-12328
```

**第二步：`dieMargin` 转正为 30，新默认基线（已复验逐位一致）。**

```
[1071167, 1080491, 1074976, 1079683]  mean 1076579  (+0.36%)
rcl@  L2 656/699  L3 3237-3303  L4 5807-5863  L5 12181-12317
4 seed 相对旧基线: +3862 / +4603 / +3542 / +3506
```

其余旋钮（`pileNear`/`slot25`/`keepHome`/`haulMax`/`extHold`/`upMul`）默认仍为 0。

## 7. 验证标准

- 官方 `sim.mjs --ticks 20000 --jitter 0:4 --parallel 4` 4 组均值 ≥ 1,076,579（当前默认基线）；
- 损耗口径：遥测 `srb2-rec-mem.json` 守恒损耗从 22.6/t 降到 ≤ 15/t，且 `control` 上升；
- 任何针对本缺陷单的改动，默认旋钮必须保持 4 组新基线逐位一致
  `[1071167, 1080491, 1074976, 1079683]`。
