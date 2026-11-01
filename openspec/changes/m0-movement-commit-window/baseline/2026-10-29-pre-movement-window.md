# M0 移动窗口变更前基线（2026-10-29）

## 环境与命令

- 代码基线：`fefacb3`（`dev`，已合入 PR #2–#5）
- 运行时：`nightx` 用户；系统 `node v24.19.0` 未启用 TypeScript stripping，无法直接加载 `.sim.ts`
- 本次 sim 运行时：Node `v26.8.1` 临时副本（`/tmp/opencode/node26/node`），`process.features.typescript = strip`
- 引擎：`screeps-sim 0.1.0`，本地 `target/release` 二进制

实际执行命令（均以 `nightx` 身份）：

```bash
PATH=/tmp/opencode/node26:$PATH node scripts/sim-matrix.mjs --build
PATH=/tmp/opencode/node26:$PATH npx screeps-sim test sim/run-residue.sim.ts --no-bundle-check
PATH=/tmp/opencode/node26:$PATH npx screeps-sim test sim/stronghold-door.sim.ts --no-bundle-check
```

矩阵命令先以 `SOURCE_MAP=0 NO_UPLOAD=1` 重建 `dist/main.js`，再逐场景执行。`stronghold-door` 的正式读数使用 stronghold 变体构建（`npm run build:stronghold`）。完整读数见 `/tmp/opencode/m0-pre-matrix.log`、`/tmp/opencode/m0-pre-run-residue.log`、`/tmp/opencode/m0-pre-stronghold-door-correct.log`。

## 六场景矩阵读数

| 场景 | 结果 | ticks | RCL 时间线 | cpu p95 | 参考 | 判定 |
|---|---|---|---|---|---|---|
| speedrun | ✗ | 40000 | L1@0 L2@458 L3@11839 L4@33413 | 9ms | L3@10399 L4@30960, 9ms | WARN（分段门漂移） |
| arena | ✗ | 40000 | L1@0 L2@330 L3@8352 L4@27618 | 9ms | L3@9780 L4@37090, 9ms | WARN（分段门漂移） |
| sprint | ✗ | 50000 | L1@0 L2@834 L3@38308 | 9ms | L3@35661, 10ms | WARN（分段门漂移） |
| boot | ✓ | 20000 | L1@0 L2@330 L3@8557 | 8ms | L3@9639, 8ms | RED（绿门时间线漂移） |
| race-body-audit | ✓ | 6000 | L1@0 L2@458 | 9ms | L2@458, 10ms | GREEN |
| remote-mine | ✓ | 30000 | L3@0 | 5ms | L3@0, 6ms | GREEN |

汇总：2 绿、3 WARN、1 RED；无 CPU p95 劣化（全部持平或低于参考），无新增运行失败。

## 独立场景

| 场景 | 结果 | ticks | RCL 时间线 | cpu p95 |
|---|---|---|---|---|
| run-residue | ✓ | 6000 | L1@0 L2@1059 | 4ms |
| stronghold-door | ✓ | 1200 | L8@0 | 2ms |

## 与旧参考的差异归因

旧参考 `openspec/changes/legacy-consolidation-b/baseline/sim-matrix-reference.json` 冻结于 PR #2–#5 合并前的 `eb85533` 代码。为排除运行时差异，使用同一 Node 26 运行时在合并前提交和 PR #2 合并点复跑：

| 验证点 | 代码 | boot 结果 | 结论 |
|---|---|---|---|
| 合并前基线 | `eb85533` | L1@0 L2@330 L3@9639, p95 8ms | 与旧参考逐位一致 |
| 仅合入 PR #2 | `df1d285` | L1@0 L2@330 L3@8557, p95 8ms | 与当前 `dev` 逐位一致 |
| 当前 `dev` | `fefacb3` | L1@0 L2@330 L3@8557, p95 8ms | 与 PR #2 合并点一致 |

同一 PR #2 合并点复跑分段门：

- speedrun：L3@11839 L4@33413，p95 9ms（与当前 `dev` 一致）
- arena：L3@8352 L4@27618，p95 9ms（与当前 `dev` 一致）
- sprint：L3@38308，p95 9ms（与当前 `dev` 一致）

结论：六场景相对旧参考的漂移全部可由已合入的 PR #2（`isWorkTile` 从错误的 `Memory.nexus` 改为 `Memory.Nexus`，工位锁开始生效）解释。PR #3–#5 未引入额外矩阵漂移；`race-body-audit` / `remote-mine` 时间线保持不变，`run-residue` / `stronghold-door` 绿。无未解释差异。

## 对 m0 的口径

- 本变更的对照基线为本次 `fefacb3` 读数，而不是旧参考快照。
- PR #2 已提前修复 B7；m0 只搬移当前 `isWorkTile` 实现，不改变其大写根语义，也不把 PR #2 的漂移计入 m0 行为变化。
- `stronghold` 现有 `StrongholdMoveStart` / `StrongholdMoveEnd` 窗口保持不变；本次单独复跑 `stronghold-door` 绿。
