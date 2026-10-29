# 基线重冻归因档（legacy-consolidation-b，2026-10-29）

> 任务 2.2 删除确认门的基线处置留档（0.2 先例路径：归因 → HEAD 重冻 → REF_PATH 改指）。

## 为什么重冻

旧参考快照冻结于 4a3ee14（2026-10-24，`legacy-consolidation/baseline/`）。其后 53 提交改变了行为时间线，其中直接影响：

- `413d872` race 变体主链化：speedrun 引擎并入主代码调度链（六场景全部走主链）；
- 重锚定族 5 提交（`2cb2b83`/`24375cc`/`7913bd2`/`cc43dd2`/`60f494c`/`40a2397`）：世界重摆保活 / lane 校验分层 / 箱列·块行·槽位探测，生存率 65%→89%，改写 speedrun/arena/sprint 时间线。

## 归因三重对照（2026-10-29 实测，survey U.12 节同步留档）

| Bundle | boot | race-body-audit | 结论 |
|---|---|---|---|
| 4a3ee14（旧基线冻结点，worktree 重建） | L3@8889 / p95 7ms | — | 门可信，精确复现旧基线 |
| 6856eb6 HEAD（无 C 波删除，worktree 重建） | L3@9639 / p95 8ms | L2@458 | 漂移在 HEAD 已存在（53 提交演进） |
| 工作树（含 C 波删除，重建） | **L3@9639 逐位一致** | **L2@458 一致** | C 波删除零行为扰动 |

首轮 p95 全场 +3~6ms 系并行负载噪声（跑门期间并行 typecheck/构建；静机复跑回落）。

## 新基线读数（HEAD 6856eb6，静机串行，2026-10-29）

speedrun L4@30960（p95 9）/ arena L3@9780+L4@37090（p95 9）/ sprint L3@35661（p95 10）/ boot L3@9639（p95 8）/ race L2@458（p95 10）/ remote-mine L3@0（p95 6）。

时间线注记：speedrun L3 10399（旧 11343）与 L4 30960（旧 28316）为 race 探测族演进；arena 新见 L4@37090（40k 窗口内冲 4）；sprint L3 35661（旧 36171）。boot 绿门 8889→9639 系主链化调度开销（speedrun 引擎并入每 tick 链）。

p95 注记：新基线 p95 较旧 +2~3ms 全场景同向，与主链化（更多代码进主循环）方向一致，race 门 10ms 仍在本机历史带（7-11ms）内。C 波删除对照以时间线逐位为准（p95 有 ±2ms 方差）。

## 处置

- 新参考快照：`legacy-consolidation-b/baseline/sim-matrix-reference.json`（本目录）；`scripts/sim-matrix.mjs` REF_PATH 已改指。
- C 波切片（2.2/2.5 删除）验证口径：对照**新基线**时间线逐位一致 + run-residue/stronghold-door 单独跑绿。
- 旧快照保留于 `legacy-consolidation/baseline/`（A 波历史资产不覆盖）。
