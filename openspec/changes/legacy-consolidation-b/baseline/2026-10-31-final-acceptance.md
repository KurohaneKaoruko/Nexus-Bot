# 2026-10-31 总验收读数 (5.1)

承接 `2026-10-31-three-green.md`（4.3 三绿）。本轮补齐 5.1 专属验证项。

## 全场景门 (8 门逐位, 对照 baseline/sim-matrix-reference.json)

| 门 | ticks | RCL 时间线 | p95 | 判定 |
| --- | --- | --- | --- | --- |
| speedrun (race 变体) | 40000 | L1@0 L2@866 L3@3364 L4@6004 L5@12489 L6@32545 | 36ms | 逐位 |
| race-body-audit (race 变体) | 6000 | L1@0 L2@755 L3@3814 | 35ms | 逐位 |
| speedrun-upstream (race 变体) | 40000 | L1@0 L2@656 L3@3303 L4@5863 L5@12317 L6@32334 | 36ms | 逐位 |
| arena | 40000 | L1@0 L2@330 L3@8352 L4@27618 | 9ms | 逐位 |
| sprint | 50000 | L1@0 L2@834 L3@38308 | 9ms | 逐位 |
| boot | 20000 | L1@0 L2@330 L3@8557 | 9ms | 逐位 |
| remote-mine | 30000 | L3@0 | 5ms | 逐位 |

p95 对照参考无劣化（>2ms 拒绝线内；首轮全量跑的 arena/sprint 13ms 系 loadavg>6 并发噪声，静机复跑 9ms 一致，见 4.3 注记）。

## 辅门

| 门 | ticks | 读数 | 判定 |
| --- | --- | --- | --- |
| run-residue | 6000 | L2@1059 / p95 7ms | 绿（与 3.1 注记一致） |
| stronghold-door | 1200 | L8@0 / p95 9ms | 绿 |

## race 门与 AGENTS.md 冲级硬指标

- **race 门现口径**：`race-body-audit`（2026-10-29 勘误后 race 引擎专用场, dist-race 产物）——本轮 L2@755 L3@3814 与参考逐位。旧参考 `legacy-consolidation/baseline` 的 L2@458 属勘误前旧场景（flat 地形, 审计的是 main 变体）, 非现行门口径。
- **AGENTS.md 冲级硬指标**（speedrun 门守住）: 10k 内 RCL4 → L4@6004 ✓；20k 内 RCL5 → L5@12489 ✓；40k 内 RCL6 → L6@32545 ✓。
- speedrun-upstream（上游基线场）L6@32334, 本体 32545, 差 211 tick（0.65%）——两场各自逐位稳定。

## 对照结论 (vs `legacy-consolidation/baseline/sim-matrix-reference.json`)

旧参考（2026-10-27 冻结）为 C 波前口径：speedrun L4@28316 / arena L3@11629 / sprint L3@36171 / boot L3@8889 / race-body-audit L2@458（勘误前场）。该口径已被 `legacy-consolidation-b/baseline/sim-matrix-reference.json`（2026-10-29 重冻结 + 本轮验证）取代——场景口径勘误（race 引擎场）、race 主链化与 A/B/C 波演进均为任务书内预期变更, 时间线逐位判定以本变更参考为准。冲级硬指标（10k/20k/40k）全程无回退。
