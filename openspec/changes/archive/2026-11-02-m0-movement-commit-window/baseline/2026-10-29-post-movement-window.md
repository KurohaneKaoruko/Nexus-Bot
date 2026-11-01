# M0 移动窗口变更后对照（2026-10-29）

## 口径

- 变更前基线：`openspec/changes/m0-movement-commit-window/baseline/2026-10-29-pre-movement-window.md`（代码 `fefacb3`）
- 变更后：工作区 m0 实现（未提交），`MovementStart` / `MovementEnd` 已装配到 main/local/season
- 运行时与命令同基线：`nightx` 用户，Node `v26.8.1` 临时副本

```bash
PATH=/tmp/opencode/node26:$PATH node scripts/sim-matrix.mjs --build
PATH=/tmp/opencode/node26:$PATH npx screeps-sim test sim/run-residue.sim.ts --no-bundle-check
PATH=/tmp/opencode/node26:$PATH npx screeps-sim test sim/stronghold-door.sim.ts --no-bundle-check
```

完整矩阵读数见 `/tmp/opencode/m0-post-matrix.log`；独立场景见 `/tmp/opencode/m0-post-run-residue.log`、`/tmp/opencode/m0-post-stronghold-door.log`（stronghold 使用 stronghold 变体构建）。

## 逐门对照

| 场景 | 变更前 | 变更后 | 漂移 | CPU p95 变化 |
|---|---|---|---|---|
| speedrun | L1@0 L2@458 L3@11839 L4@33413, 9ms | L1@0 L2@458 L3@11839 L4@33413, 9ms | 无 | 0 |
| arena | L1@0 L2@330 L3@8352 L4@27618, 9ms | L1@0 L2@330 L3@8352 L4@27618, 9ms | 无 | 0 |
| sprint | L1@0 L2@834 L3@38308, 9ms | L1@0 L2@834 L3@38308, 9ms | 无 | 0 |
| boot | L1@0 L2@330 L3@8557, 8ms | L1@0 L2@330 L3@8557, 8ms | 无 | 0 |
| race-body-audit | L1@0 L2@458, 9ms | L1@0 L2@458, 9ms | 无 | 0 |
| remote-mine | L3@0, 5ms | L3@0, 5ms | 无 | 0 |

结论：race 门 `L2@458` 逐位一致；六场景时间线与 CPU p95 全部逐位一致，无劣化。

## 独立场景

| 场景 | 变更前 | 变更后 | 结论 |
|---|---|---|---|
| run-residue | L1@0 L2@1059, 4ms | L1@0 L2@1059, 4ms | 逐位一致 |
| stronghold-door | L8@0, 2ms | L8@0, 2ms | 逐位一致 |

## 漂移归因

本轮没有产生 m0 归因项：

- 六个矩阵场景均不挂载 `Teams` / `PowerCreeps` 晚段移动生产链，`stronghold-door` 走独立的 `StrongholdMoveStart` / `StrongholdMoveEnd` 窗口；因此 B1 修复不会改变现有场景的 RCL 时间线。
- `MovementStart` / `MovementEnd` 已进入构建产物（`dist/main.js` 含 `movement-start` / `movement-end`），入口注册序满足 D2：start 在 `Perception` 前，end 在 `ActorOwnershipPersist` 后、`Visuals` 前。
- `sim-matrix.mjs` 仍会因旧参考快照（PR #2 合并前）把 `boot` 标成 RED；该漂移已在变更前基线归因于 PR #2，不是 m0 引入。任务 4.2 将把共享回归线重冻到当前读数。
- 本轮没有出现 `arena` / `stronghold-door` 的 B1 行为漂移，因此没有「晚段移动意图生效」需要接受或拒绝的归因项；B1 的代码路径由入口顺序与模块契约验证，后续编队/Power Creep 场景产生漂移时按 spec 重新归因。
