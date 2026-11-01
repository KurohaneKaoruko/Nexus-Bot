# 基线快照：sim 场景矩阵（2026-10-17）

> 任务 1.1 存档。重构对照基线：commit `8512b30`（dev），bundle 构建自该工作区。
> 运行口径：`npm run sim`（screeps-sim 0.2.0，单进程串行，4 核机器）。
>
> 红绿口径（production-hardening spec）：冲级分段门未达 = “冲级目标未达成”，
> 不计为重构行为回归；`noErrors` 绿 + 无角色错轨/静默死锁 = 行为面干净。

## 总览

| 场景 | 红绿 | ticks | 用时 | t/s | RCL 时间线 | CPU P95 |
|---|---|---|---|---|---|---|
| boot-from-scratch | ✓ | 20000 | 47.8s | 419 | L2@749 | 4.0ms |
| race-body-audit | ✓ | 6000 | 14.5s | 414 | L2@991 | 4.0ms |
| remote-mine | ✓ | 30000 | 110.8s | 271 | L3@0（预置） | 6.0ms |
| speedrun | ✗（分段门） | 31000 | 84.6s | 367 | L2@991 L3@28028 | 5.0ms |
| arena | ✗（分段门） | 40000 | 136.3s | 293 | L2@749 L3@21139 | 7.0ms |
| sprint (rcl-sprint) | ✗（分段门） | 50000 | 116.1s | 431 | L2@1446 | 4.0ms |

**3/6 通过**；全部 6 场 `noErrors` 断言绿（bot 错误 tick = 0）——行为面无回归，失败全部是冲级速度未达分段目标。

## 分段门差距明细

| 场景 | 断言 | 实测 | 要求 | 差距 |
|---|---|---|---|---|
| speedrun | RCL2 ≤500 | 991 | 500 | +98% |
| speedrun | RCL3 ≤3000 | 28028 | 3000 | 9.3× |
| speedrun | RCL4 ≤5000 | None | 5000 | 未达 |
| speedrun | RCL5 ≤15000 | None | 15000 | 未达 |
| speedrun | RCL6 ≤30000 | None | 30000 | 未达 |
| arena | RCL3 ≤8000 | 21139 | 8000 | 2.6× |
| arena | RCL4 ≤20000 | None | 20000 | 未达 |
| arena | RCL5 ≤35000 | None | 35000 | 未达 |
| sprint | RCL4 ≤40000 | None | 40000 | 未达 |

## boot-from-scratch 关键读数（引擎完整报告）

- CPU：均值 3.205ms / P50 3.0 / P95 4.0 / P99 5.0，超限 tick 0（limit 100）
- **Memory 峰值：25778 字节**（~25KB，远低于 2MB 引擎上限，无增长问题）
- 能量流：采集 112458 / 建造 15000 / 升级 40072 / 孵化 46900
- 单位：生产 194 / 死亡 175 / 存活 19
- 意图分布：move 37171 / harvest 37126 / upgradeController 24327 / withdraw 4291 / build 3000 / transfer 1018 / repair 1001 / pickup 1375 / drop 50 / spawnCreep 194 / suicide 9 / createConstructionSite 3
- 移动执行率：96.1%（34867/36284）
- 分相耗时/tick：JS 2.219ms（parse 0.096 / 重建 0.099 / 收尾 0.174）+ 引擎 0.088ms
- GCL 1（40072/1000000），RCL 时间线 L1@0 L2@749（断言 ≤5000 绿）

## bundle 预检警告（与基线一并记录，非本次引入）

`dist/main.js` 静态检查报 5 类常量疑似拼写警告（L11924/L11933 `RESOURCE_ENERG`、L25050/L25051 `BOOST_POWER`、L29097 `LAB_PRODUCTION`、L31051 `RESOURCE_`）——疑似 minifier 截断或属性访问误判，待后续核查源头（不阻断，`--no-bundle-check` 口径跑）。

## 对照用法

后续每完成一个任务跑场景门回归时：

- 行为红线 = 任一场景 `noErrors` 转红、或上表 ✓ 场景转 ✗（boot/race-body-audit/remote-mine 必须保持绿）；
- 性能红线 = CPU P95 较本表同场景劣化 >2ms 或 Memory 峰值显著上涨（>2×）；
- 冲级分段门（speedrun/arena/sprint 的 rclReachedBy）作为趋势观察项，非阻断。
