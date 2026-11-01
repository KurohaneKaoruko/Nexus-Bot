# Final Readings (after refactor)

## Structure Guard

`node scripts/structure-guard.mjs --report`:

```
源文件: 316
@ts-nocheck 文件: 35 (检查点 35)
显式 any: 758 (检查点 781), 其中 as any 501
>600 有效行 (白名单外): 0 (检查点 0)
依赖方向: core 违规 6 (冻结 6), modules→console 0, modules→proto 白名单外新增 0
```

LINE_WHITELIST entry `src/modules/movement/index.ts` removed; `config/code-quality.json` `lineLimitOver` advanced 9 → 0.

## Module Sizes

| File | Raw | Effective |
| --- | ---: | ---: |
| movement/index.ts | 15 | 10 |
| movementState.ts | 139 | 115 |
| movementGeometry.ts | 370 | 255 |
| movementCostRoute.ts | 645 | 505 |
| movementPathCache.ts | 538 | 390 |
| movementIntentSquad.ts | 385 | 262 |
| movementTraffic.ts | 760 | 600 |
| movementApi.ts | 526 | 405 |

All ≤600 effective lines.

## @ts-nocheck Ledger

Markers carried by `movementCostRoute`, `movementPathCache`, `movementIntentSquad`, `movementTraffic`, `movementApi` (five, D4 fallback used for `movementApi`). `movementState`, `movementGeometry`, `movement/index.ts` have no marker. Repo total 35 = cap 35; 31 (pre-change) − 1 (old index marker) + 5 = 35.

## Static Gates

- `npm run typecheck` — green
- `npm run lint` — 0 errors / 71 warnings. 66 warnings are `no-this-in-exported-function` on the moved prototype-wrapper functions (betterMove/betterMoveTo/betterPull/betterCancelOrder/findSquadPathTo), newly visible because those functions are now module exports instead of file-local helpers; behavior is unchanged because they are only ever invoked through `.call`/prototype patches. The other 5 are the pre-existing race isolation-area shadow warnings
- `npm test` — 15 files, all green (movement-state / movement-geometry / movement-intent added)
- `npm run arch:guard` — green
- `npm run structure:guard` — green (readings above)
- `npm run build` — success (`dist/main.js`, 1,676.88 kB)
- `npm run build:stronghold` — success

## Behavior Gates

Six-scene matrix (all GREEN, timelines bit-identical to `legacy-consolidation-b/baseline/sim-matrix-reference.json`):

| Scene | Ticks | RCL timeline | cpu p95 | Baseline |
| --- | ---: | --- | ---: | --- |
| speedrun | 40000 | L1@0 L2@458 L3@11839 L4@33413 | 9.0ms | identical |
| arena | 40000 | L1@0 L2@330 L3@8352 L4@27618 | 9.0ms | identical |
| sprint | 50000 | L1@0 L2@834 L3@38308 | 9.0ms | identical |
| boot | 20000 | L1@0 L2@330 L3@8557 | 8.0ms | identical |
| race-body-audit | 6000 | L1@0 L2@458 | 9.0ms | identical |
| remote-mine | 30000 | L3@0 | 5.0ms | identical |

Auxiliary scenes:

| Scene | Result | Ticks | RCL | cpu p95 | Baseline |
| --- | --- | ---: | --- | ---: | --- |
| run-residue | ✓ | 6000 | L1@0 L2@1059 | 4.0ms | identical |
| stronghold-door | ✓ | 1200 | L8@0 | 5.0ms | identical |

No cpu p95 regression >2ms.

## Contract Diff

`betterMoveApi` property order and all 22 property signatures unchanged (`movementApi.ts` re-declares the same object, shorthand bindings resolve to the same moved functions). Prototype patch targets and values unchanged: 8 patches (`Creep/PowerCreep.prototype.move|moveTo|cancelOrder`, `Creep.prototype.pull`, `RoomPosition.prototype.findSquadPathTo`), installed once each in `movement/index.ts`; `originMove`/`originPull`/`originCancelOrder` captured in `movementState.proto` before patching. `MovementStart`/`MovementEnd` registration order and the stronghold independent window are unchanged. `moveMatch.ts`, `arrival.ts`, `trafficMonitor.ts` have empty `git diff`.
