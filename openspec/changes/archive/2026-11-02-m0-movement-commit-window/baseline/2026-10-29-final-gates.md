# M0 总验收（2026-10-29）

## 范围

- 本文件记录 `m0-movement-commit-window` 任务 4.4 的门禁结果。
- 工作区同时包含独立的布局单轨清理（删除 63/静态可选布局，保留 auto/mini/race），不属于 M0；两者均未提交。
- 运行身份：`nightx`；sim 使用 `/tmp/opencode/node26/node`（Node `v26.8.1`）。

## 命令与结果

```bash
PATH=/tmp/opencode/node26:$PATH npm run typecheck
# 通过

PATH=/tmp/opencode/node26:$PATH npm run lint
# 通过（仅 5 条既有 no-shadow warning：race/speedrun economy/spawning/types/towing）

PATH=/tmp/opencode/node26:$PATH npm run test
# 60 tests / 12 suites 全部通过

PATH=/tmp/opencode/node26:$PATH npm run arch:guard
# ✓ 212 处直连调用 / 25 文件，全部在豁免清单内（91 条，历史最小 91）

PATH=/tmp/opencode/node26:$PATH npm run structure:guard
# ✓ 300 文件 / ts-nocheck 31 / any 681 (as any 470) / 超 600 行 4 / 依赖违规 0

PATH=/tmp/opencode/node26:$PATH npx openspec validate m0-movement-commit-window --strict
# Change 'm0-movement-commit-window' is valid

PATH=/tmp/opencode/node26:$PATH npm run build
# 通过（入口 src/main.ts，main 变体）

PATH=/tmp/opencode/node26:$PATH npm run build:stronghold
# 通过（入口 src/branch/stronghold/main.ts）
```

## 全场景门

命令：`PATH=/tmp/opencode/node26:$PATH node scripts/sim-matrix.mjs --build`

| 场景 | 参考 | 本次 | 结果 |
|---|---|---|---|
| speedrun | L1@0 L2@458 L3@11839 L4@33413, 9ms | 同左 | GREEN |
| arena | L1@0 L2@330 L3@8352 L4@27618, 9ms | 同左 | GREEN |
| sprint | L1@0 L2@834 L3@38308, 9ms | 同左 | GREEN |
| boot | L1@0 L2@330 L3@8557, 8ms | 同左 | GREEN |
| race-body-audit | L1@0 L2@458, 9ms | 同左 | GREEN |
| remote-mine | L3@0, 5ms | 同左 | GREEN |

独立场景：

- `run-residue`：L1@0 L2@1059，p95 4ms，通过。
- `stronghold-door`：L8@0，p95 2ms，通过（stronghold 变体构建）。

结论：六场景逐位一致，M0 无新增漂移；race 门 `L2@458` 保持逐位一致。

## 工作区

- M0 变更文件与布局清理文件均未提交。
- 新增/修改文件统一由 `nightx:night` 持有；未执行 `git add` / `git commit` / `git push`。
- `tests/` 为 gitignore 范围；`tests/movement-window.test.ts` 已通过本地测试，但不会出现在 `git status`。
