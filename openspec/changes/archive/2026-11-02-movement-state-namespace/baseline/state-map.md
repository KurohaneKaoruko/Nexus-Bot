# Movement State Map

Generated from `src/modules/movement/index.ts` before refactor. All 74 top-level variable declarations are classified: 65 state bindings plus 9 exported constants. No binding is left unclassified.

## Group Summary

| Group | Count | Responsibility |
| --- | ---: | --- |
| `config` | 5 | 运行时可调参数与工作位判定 |
| `cache` | 10 | 跨 tick 持久缓存、CostMatrix 缓存与清理计时 |
| `tick` | 12 | 每 tick 意图、队伍索引、检查表与配对表（`resetTickState()` 清空 8 个 Map/Set，复位两个索引） |
| `scratch` | 28 | 寻路/路径计算的临时变量；每次调用覆盖，不跨 tick 语义 |
| `stats` | 6 | CPU/路径计数与缓存命中统计，持久累计 |
| `proto` | 3 | 原型 patch 前捕获的原始函数引用 |
| `constants` | 9 | 不可变参数、障碍集合与默认函数/样式 |

## Binding Map and Replacement Table

| Group | Old bare name | Kind | Declaration | New path | Observed references (first 8 lines) |
| --- | --- | --- | ---: | --- | --- |
| `config` | `pathClearDelay` | let | 36 | `movementState.config.pathClearDelay` | 36, 1518, 1529, 1530, 1532, 2056, 2070, 3207 |
| `config` | `hostileCostMatrixClearDelay` | let | 37 | `movementState.config.hostileCostMatrixClearDelay` | 37, 808, 811, 812, 814, 3216, 3219 |
| `config` | `avoidRooms` | let | 38 | `movementState.config.avoidRooms` | 38, 826, 827, 838, 845, 1015, 1117, 1267 |
| `config` | `avoidExits` | let | 39 | `movementState.config.avoidExits` | 39, 1118, 1338, 3293, 3294, 3296, 3308, 3309 |
| `config` | `isWorkTile` | let | 2096 | `movementState.config.isWorkTile` | 2016, 2096, 2880, 2882 |
| `cache` | `globalPathCache` | let | 49 | `movementState.cache.globalPathCache` | 49, 1408, 1409, 1412, 1413, 1415, 1427, 1450 |
| `cache` | `pathCacheTimer` | let | 51 | `movementState.cache.pathCacheTimer` | 51, 1529, 1530, 1532, 2064, 2069, 2074 |
| `cache` | `creepPathCache` | let | 53 | `movementState.cache.creepPathCache` | 53, 1134, 1570, 2058, 2060, 2161, 2287, 2646 |
| `cache` | `creepMoveCache` | let | 54 | `movementState.cache.creepMoveCache` | 54, 1580, 1747, 1784, 2143, 2211, 2228, 2239 |
| `cache` | `emptyCostMatrix` | let | 55 | `movementState.cache.emptyCostMatrix` | 55, 1023, 1045, 1177, 1271, 1286, 1358 |
| `cache` | `costMatrixCache` | let | 57 | `movementState.cache.costMatrixCache` | 57, 791, 874, 892, 897, 918, 923, 1022 |
| `cache` | `costMatrixCacheTimer` | let | 59 | `movementState.cache.costMatrixCacheTimer` | 59, 811, 812, 814, 853, 854, 856, 2076 |
| `cache` | `autoClearTick` | let | 60 | `movementState.cache.autoClearTick` | 60, 2312, 2314 |
| `cache` | `roomNameCache` | const | 61 | `movementState.cache.roomNameCache` | 61, 117, 122, 128, 140, 147, 153, 158 |
| `cache` | `tile2PosCache` | const | 62 | `movementState.cache.tile2PosCache` | 62, 211, 222 |
| `tick` | `IntentTiles` | const | 70 | `movementState.tick.intentTiles` | 70, 71, 1888, 1890, 2447, 2466, 2467, 2898 |
| `tick` | `Priorities` | const | 71 | `movementState.tick.priorities` | 71, 1887, 2956, 2962 |
| `tick` | `cachedMoveIntents` | const | 73 | `movementState.tick.cachedMoveIntents` | 73, 1886, 2424, 2443, 2444, 2464, 2478, 2504 |
| `tick` | `creepToSquad` | const | 75 | `movementState.tick.creepToSquad` | 75, 1229, 1895, 1896, 1905, 1912, 1917, 1921 |
| `tick` | `squadToCreeps` | const | 77 | `movementState.tick.squadToCreeps` | 77, 1903, 1904, 1908, 1913, 1918, 1923, 2890 |
| `tick` | `squadNextTile` | const | 78 | `movementState.tick.squadNextTile` | 78, 3159 |
| `tick` | `rerouteSquad` | const | 79 | `movementState.tick.rerouteSquad` | 79, 1229, 1938, 2722, 2762, 3160 |
| `tick` | `squadIdx` | let | 80 | `movementState.tick.squadIdx` | 80, 1920, 3165 |
| `tick` | `creepIdx` | let | 81 | `movementState.tick.creepIdx` | 81, 1886, 1887, 1888, 1890, 3164 |
| `tick` | `checkedTiles` | const | 82 | `movementState.tick.checkedTiles` | 82, 1870, 1937, 1955, 1960, 1970, 1974, 2481 |
| `tick` | `nameToIntentIdx` | const | 83 | `movementState.tick.nameToIntentIdx` | 83, 2969, 2981, 3162 |
| `tick` | `pullPair` | const | 84 | `movementState.tick.pullPair` | 84, 2408, 3093, 3114, 3138, 3163 |
| `scratch` | `startTime` | let | 92 | `movementState.scratch.startTime` | 92, 2045, 2048 |
| `scratch` | `startCacheSearch` | let | 93 | `movementState.scratch.startCacheSearch` | 93, 1444, 1483, 2346, 2348 |
| `scratch` | `temporalAvoidFrom` | let | 935 | `movementState.scratch.temporalAvoidFrom` | 935, 947, 975, 986 |
| `scratch` | `temporalAvoidTo` | let | 935 | `movementState.scratch.temporalAvoidTo` | 935, 947, 975, 987 |
| `scratch` | `curAvoidRooms` | let | 935 | `movementState.scratch.curAvoidRooms` | 935, 938, 977, 1117, 1337 |
| `scratch` | `curAvoidExits` | let | 935 | `movementState.scratch.curAvoidExits` | 935, 941, 1118, 1338 |
| `scratch` | `findPathIgnoreCondition` | let | 1012 | `movementState.scratch.findPathIgnoreCondition` | 923, 1012, 1023, 1045, 1088, 1177, 1205, 1256 |
| `scratch` | `bypassRoomName` | let | 1013 | `movementState.scratch.bypassRoomName` | 1013, 1018, 1040, 1092, 1172, 1201, 1205 |
| `scratch` | `bypassCostMat` | let | 1013 | `movementState.scratch.bypassCostMat` | 1013, 1020, 1042, 1088, 1090, 1120, 1174, 1205 |
| `scratch` | `userCostCallback` | let | 1013 | `movementState.scratch.userCostCallback` | 1013, 1026, 1027, 1048, 1049, 1093, 1179, 1180 |
| `scratch` | `costMat` | let | 1013 | `movementState.scratch.costMat` | 897, 902, 923, 927, 1013, 1020, 1023, 1029 |
| `scratch` | `route` | let | 1013 | `movementState.scratch.route` | 1013, 1039, 1121, 1122, 1125, 1127, 1284, 1339 |
| `scratch` | `combinedX` | let | 1401 | `movementState.scratch.combinedX` | 1401, 1406, 1408, 1409, 1412, 1413, 1415, 1449 |
| `scratch` | `combinedY` | let | 1401 | `movementState.scratch.combinedY` | 1401, 1407, 1410, 1412, 1413, 1415, 1451, 1452 |
| `scratch` | `minX` | let | 1433 | `movementState.scratch.minX` | 1433, 1445, 1449, 1484, 1488, 3243, 3245, 3247 |
| `scratch` | `maxX` | let | 1433 | `movementState.scratch.maxX` | 1433, 1446, 1449, 1485, 1488, 3244, 3246, 3247 |
| `scratch` | `minY` | let | 1433 | `movementState.scratch.minY` | 1433, 1447, 1451, 1486, 1490, 3245, 3249 |
| `scratch` | `maxY` | let | 1433 | `movementState.scratch.maxY` | 1433, 1448, 1451, 1487, 1490, 3246, 3249 |
| `scratch` | `startRoomName` | let | 1512 | `movementState.scratch.startRoomName` | 1512, 1520, 1523, 1524, 1525, 1526 |
| `scratch` | `endRoomName` | let | 1512 | `movementState.scratch.endRoomName` | 1512, 1521, 1523 |
| `scratch` | `tempArray` | let | 1539 | `movementState.scratch.tempArray` | 1539, 1550, 1551, 1555, 1558, 1560 |
| `scratch` | `ops` | let | 2107 | `movementState.scratch.ops` | 2107, 2126, 2129, 2131, 2132, 2137, 2139, 2144 |
| `scratch` | `toPos` | let | 2107 | `movementState.scratch.toPos` | 2107, 2125, 2128, 2134, 2137, 2139, 2144, 2175 |
| `scratch` | `creepCache` | let | 2107 | `movementState.scratch.creepCache` | 1134, 1135, 1138, 1151, 1161, 1167, 1253, 1570 |
| `scratch` | `path` | let | 2107 | `movementState.scratch.path` | 1453, 1457, 1458, 1459, 1460, 1463, 1492, 1496 |
| `scratch` | `idx` | let | 2107 | `movementState.scratch.idx` | 533, 534, 536, 538, 539, 547, 548, 549 |
| `scratch` | `posArray` | let | 2107 | `movementState.scratch.posArray` | 283, 869, 871, 873, 874, 876, 898, 901 |
| `scratch` | `found` | let | 2107 | `movementState.scratch.found` | 2107, 2300, 2304, 2345 |
| `stats` | `analyzeCPU` | let | 94 | `movementState.stats.analyzeCPU` | 94, 2043, 2048, 2049, 3150, 3151, 3152, 3318 |
| `stats` | `pathCounter` | let | 101 | `movementState.stats.pathCounter` | 101, 1455, 1494, 3336 |
| `stats` | `testCacheHits` | let | 102 | `movementState.stats.testCacheHits` | 102, 2307, 3323, 3324 |
| `stats` | `testCacheMiss` | let | 103 | `movementState.stats.testCacheMiss` | 103, 2310, 3323, 3325, 3326 |
| `stats` | `cacheHitCost` | let | 104 | `movementState.stats.cacheHitCost` | 104, 2346, 3324 |
| `stats` | `cacheMissCost` | let | 105 | `movementState.stats.cacheMissCost` | 105, 2348, 3325 |
| `proto` | `originMove` | const | 87 | `movementState.proto.originMove` | 87, 3095, 3097, 3116, 3118, 3140, 3142 |
| `proto` | `originPull` | const | 88 | `movementState.proto.originPull` | 88, 2405 |
| `proto` | `originCancelOrder` | const | 89 | `movementState.proto.originCancelOrder` | 89, 2483 |
| `constants` | `unWalkableCost` | const | 63 | `movementConstants.unWalkableCost` | 63, 488, 489, 503, 504, 544, 545, 598 |
| `constants` | `halfWorldSize` | const | 64 | `movementConstants.halfWorldSize` | 64, 183, 184, 219, 220, 1852, 1853 |
| `constants` | `activeMoveScore` | const | 65 | `movementConstants.activeMoveScore` | 65, 66, 1983, 2956, 2962 |
| `constants` | `ultraMoveScore` | const | 66 | `movementConstants.ultraMoveScore` | 66, 2923, 2934 |
| `constants` | `passiveMoveScore` | const | 67 | `movementConstants.passiveMoveScore` | 67, 2011, 2014, 3015, 3022 |
| `constants` | `badMoveScore` | const | 68 | `movementConstants.badMoveScore` | 68, 2017, 3018 |
| `constants` | `obstacles` | const | 86 | `movementConstants.obstacles` | 86, 445, 453, 642, 740 |
| `constants` | `defaultIsWorkTile` | const | 2091 | `movementConstants.defaultIsWorkTile` | 2091, 2096, 2882 |
| `constants` | `defaultVisualizePathStyle` | const | 2098 | `movementConstants.defaultVisualizePathStyle` | 1553, 2098 |

## Read/Write Spot Checks

The line list above is produced by the TypeScript symbol checker, so local variables that shadow a state name are excluded. Ten representative bindings:

- `pathClearDelay` (config, let, decl L36): refs L36, L1518, L1529, L1530, L1532, L2056, L2070, L3207, L3210.
- `avoidRooms` (config, let, decl L38): refs L38, L826, L827, L838, L845, L1015, L1117, L1267, L1337, L2084, L3274, L3283.
- `globalPathCache` (cache, let, decl L49): refs L49, L1408, L1409, L1412, L1413, L1415, L1427, L1450, L1452, L1453, L1489, L1491, L1492, L3248, L3250, L3251.
- `costMatrixCache` (cache, let, decl L57): refs L57, L791, L874, L892, L897, L918, L923, L1022, L1029, L1044, L1051, L1083, L1088, L1176, L1182, L1205, L1270, L1285, L1310, L1357, L1384, L1789, L1792, L1993, L1996, L1997, L2082, L2250, L2624, L2627, L2666, L2689, L2692, L2743, L2860, L2866, L2867, L2995, L2996, L3199, L3227.
- `IntentTiles` (tick, const, decl L70): refs L70, L71, L1888, L1890, L2447, L2466, L2467, L2898, L2900, L2949, L2950, L3101.
- `Priorities` (tick, const, decl L71): refs L71, L1887, L2956, L2962.
- `cachedMoveIntents` (tick, const, decl L73): refs L73, L1886, L2424, L2443, L2444, L2464, L2478, L2504, L2896, L2901, L2947, L3079, L3156.
- `checkedTiles` (tick, const, decl L82): refs L82, L1870, L1937, L1955, L1960, L1970, L1974, L2481, L2503, L2906, L3030, L3035, L3040, L3161.
- `analyzeCPU` (stats, let, decl L94): refs L94, L2043, L2048, L2049, L3150, L3151, L3152, L3318, L3319, L3327, L3330, L3333.
- `isWorkTile` (config, let, decl L2096): refs L2016, L2096, L2880, L2882.
- `defaultCheckTile`: top-level function, not a state binding.
- `ops` (scratch, let, decl L2107): refs L2107, L2126, L2129, L2131, L2132, L2137, L2139, L2144, L2146, L2147, L2154, L2175, L2182, L2193, L2199, L2216, L2218, L2219, L2222, L2230, L2231, L2234, L2241, L2242, L2244, L2245, L2247, L2258, L2259, L2261, L2265, L2266, L2268, L2273, L2274, L2276, L2292, L2293, L2294, L2295, L2302, L2303, L2318, L2332, L2333, L2334, L2351, L2552, L2555, L2557, L2567, L2615, L2677, L2694, L2695, L2710, L2719, L2730, L2754, L2770, L2790, L2806, L2823, L2846.
- `posArray` (scratch, let, decl L2107): refs L283, L869, L871, L873, L874, L876, L898, L901, L902, L906, L924, L926, L927, L1135, L1138, L1139, L1151, L1152, L1157, L1158, L1519, L1520, L1521, L1710, L1734, L1738, L1745, L1749, L1772, L1775, L1782, L1787, L2107, L2172, L2174, L2175, L2178, L2180, L2184, L2201, L2212, L2242, L2244, L2247, L2259, L2261, L2266, L2268, L2270, L2274, L2276, L2658, L2660, L2662, L2682, L2685, L2695, L2715, L2717, L2739, L2795.

## Not State

- `betterMoveApi` is the public API object; it stays in `movementApi.ts` and is re-exported by `movement/index.ts`.
- `moveMatch` is an imported algorithm asset; it remains in `moveMatch.ts` unchanged.
- Top-level functions are not state. Their move plan is recorded in `design.md` and `tasks.md`.

## Tick Reset Contract

`resetTickState()` clears exactly: `cachedMoveIntents`, `creepToSquad`, `squadToCreeps`, `squadNextTile`, `rerouteSquad`, `checkedTiles`, `nameToIntentIdx`, `pullPair`; then sets `creepIdx = 1`, `squadIdx = 1`. It does not clear `intentTiles`, `priorities`, persistent caches, stats, config or prototype references.
