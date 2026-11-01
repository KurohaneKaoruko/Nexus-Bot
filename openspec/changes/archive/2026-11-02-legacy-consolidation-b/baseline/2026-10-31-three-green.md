# 2026-10-31 三绿收口读数 (4.3)

movement 拆分 + typing 收敛后的漂移修复收口存档。修复清单见 tasks.md 4.2 注记。

## 三绿

| 项 | 读数 |
| --- | --- |
| structure-guard | ✓ 316 文件 / ts-nocheck 0 / any 287 (as any 200) / 超 600 行 0 / 依赖违规 0 |
| typecheck (tsc --noEmit) | 0 error |
| 全场景门 (--build) | 8/8 |

## 全场景门读数 (与 baseline/sim-matrix-reference.json 逐位一致)

| 门 | ticks | RCL 时间线 | cpu p95 |
| --- | --- | --- | --- |
| boot | 20000 | L1@0 L2@330 L3@8557 | 9ms |
| arena | 40000 | L1@0 L2@330 L3@8352 L4@27618 | 9ms |
| sprint | 50000 | L1@0 L2@834 L3@38308 | 9ms |
| speedrun | 40000 | L1@0 L2@866 L3@3364 L4@6004 L5@12489 L6@32545 | 36ms |
| speedrun-upstream | 40000 | L1@0 L2@656 L3@3303 L4@5863 L5@12317 L6@32334 | 36ms |
| race-body-audit | 6000 | L1@0 L2@755 L3@3814 | 35ms |
| remote-mine | 30000 | L3@0 | 6ms |
| structure-guard | — | 见上 | — |

## 复核

首轮全量并行跑时 arena/sprint 的 cpu p95 出现 13ms（loadavg >6 并发负载噪声）；负载回落后单门复跑 arena p95 9ms / sprint p95 9ms，与参考一致。RCL 时间线全程逐位未动。

## 漂移根因 ( typing 收敛时引入, 本轮修正 )

1. **movementApi/movementTraffic `creepCache.dst`**：`{x, y}` 丢 roomName → `isEqual(toPos, dst)` 恒 false → 缓存路径"目的地没变"判定失效。boot L3 8557→8586 / arena L4 27618→29273 / sprint L3 38308→36172 的共同漂移源。
2. **deletePath**：`posArray = []` → 恢复 `map(invalidate)` 置 0 保长度（length 消费语义）。
3. **MyPath.idx**：多余键（HEAD 无），连带 4 处 `idx: 0` 赋值删除。
4. **delete path vs `path = undefined`**：键存在性语义。
5. **autoFactory 缺料判定**：`(store[c] ?? 0) < need` 反转 undefined 语义（原 absent 键 = 不缺）→ arena L4 27618→28428 漂移源。
6. **autoFactory factoryProduct**：`undefined` → 恢复 `null`（JSON 序列化差异）。
7. **TeamCache nearValues**：`?? 0` 改变 `+(undefined)` = NaN 语义（战局门无读数变化, 忠实性修正）。

## 定位方法存档

- 探针：bundle 尾部重包 `exports.loop`，每 25 tick 采样排序 creep 位置哈希 + RCL + progress 写 `Memory.__probe`，`--dump-memory` 落盘比对 → 首分歧 tick 2425~2450。
- 意图流：`--record-intents` 落 JSONL diff → 首分歧 tick 2438, 升级体 U-6E90 的注册意图目标 (29,31) vs (29,29)。
- 状态注入：在 `betterMoveApi.endTickResolve(isWorkTile)` 调用点前注入 dump（两版顶层作用域变量可直接读）→ 定位 dst 语义。
