# Movement Baseline (before refactor)

Frozen at: 2026-10-29, before any movement source edit.

## Source Size

| Metric | Value |
| --- | --- |
| `src/modules/movement/index.ts` raw lines | 3344 |
| effective lines (structure-guard strip-comments口径) | 2483 |
| top-level function declarations | 67 |
| top-level variable declarations | 74 (49 `let`, 25 `const`) |
| `@ts-nocheck` | absent |
| structure-guard whitelist entry | present, sole >600 effective-line entry |

## Public Surface

`baseline/export-surface.json` is the machine-readable contract. It records:

- `betterMoveApi` property count: **22**
- prototype patch targets: **8** (planning text said 6; actual source has 8)
  - `Creep.prototype.move`
  - `PowerCreep.prototype.move`
  - `Creep.prototype.moveTo`
  - `PowerCreep.prototype.moveTo`
  - `Creep.prototype.cancelOrder`
  - `PowerCreep.prototype.cancelOrder`
  - `Creep.prototype.pull`
  - `RoomPosition.prototype.findSquadPathTo`
- patch values (original function identity):
  - `move`: `wrapFn(betterMove, "move")`
  - `moveTo`: `wrapFn(betterMoveTo, "moveTo")`
  - `cancelOrder`: `betterCancelOrder`
  - `pull`: `wrapFn(betterPull, "pull")`
  - `findSquadPathTo`: `wrapFn(findSquadPathTo, "findSquadPathTo")`
- original prototype references: `originMove = Creep.prototype.move`, `originPull = Creep.prototype.pull`, `originCancelOrder = Creep.prototype.cancelOrder`.

## Tick Order

`MovementStart` is registered first in `src/main.ts` (line 35) and calls `betterMoveApi.preTickBetterMove()` in perception/P0.

Commit movement producers register intents between the two windows. `MovementEnd` is registered after commit producers and before visualization consumers (`src/main.ts` line 63), and calls `betterMoveApi.endTickResolve(isWorkTile)`, then `trafficMonitor.updateCongestion`.

The `stronghold` branch uses its own pre/end movement window and is not changed by this refactor.

## Structure Guard Baseline

`node scripts/structure-guard.mjs --report` (captured in `structure-baseline.txt`):

```
源文件: 309
@ts-nocheck 文件: 31 (检查点 35)
显式 any: 698 (检查点 781), 其中 as any 473
>600 有效行 (白名单外): 0 (检查点 9)
依赖方向: core 违规 6 (冻结 6), modules→console 0, modules→proto 白名单外新增 0
```

The `>600` violation count is 0 only because `src/modules/movement/index.ts` is still whitelisted. `config/code-quality.json` still carries the stale `lineLimitOver: 9` checkpoint; task 6.5 advances it to 0 after the whitelist entry is removed.

## Behavior Baseline

Full six-scene matrix (`sim-baseline.txt`), all GREEN against `legacy-consolidation-b/baseline/sim-matrix-reference.json`:

| Scene | Ticks | RCL timeline | cpu p95 |
| --- | ---: | --- | ---: |
| speedrun | 40000 | L1@0 L2@458 L3@11839 L4@33413 | 9.0ms |
| arena | 40000 | L1@0 L2@330 L3@8352 L4@27618 | 9.0ms |
| sprint | 50000 | L1@0 L2@834 L3@38308 | 9.0ms |
| boot | 20000 | L1@0 L2@330 L3@8557 | 8.0ms |
| race-body-audit | 6000 | L1@0 L2@458 | 9.0ms |
| remote-mine | 30000 | L3@0 | 5.0ms |

Auxiliary scenes (`aux-baseline.txt`):

| Scene | Result | Ticks | RCL | cpu p95 |
| --- | --- | ---: | --- | ---: |
| run-residue | ✓ | 6000 | L1@0 L2@1059 | 4.0ms |
| stronghold-door | ✓ | 1200 | L8@0 | 5.0ms |

Command note: `sim-matrix.mjs --only=race` matches no reference key because the actual reference key is `race-body-audit`; the race baseline above was reproduced with `--only=race-body-audit`. All six keys were also run together.

## Pre-Refactor Checks

- `node scripts/structure-guard.mjs --report` matches the readings above.
- `node scripts/sim-matrix.mjs --only=race-body-audit` reproduces L2@458 and p95 9ms.
- `moveMatch.ts`, `arrival.ts`, `trafficMonitor.ts` are out of scope and must remain diff-free.
