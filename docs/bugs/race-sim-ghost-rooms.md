# sim 冲级场景幽灵房怪癖 (race 链模块清单约束)

- 优先级: P2 (不炸代码, 但约束架构决策)
- 发现: 2026-10-28 race 变体主链化融合期间
- 状态: 已确认, 设计已规避

## 现象

sim 官方冲级场景 (Speedrun-Bot/sim.mjs, 9 房 3×3 网格) 把全部 9 个房的
`controller.my` 报成 `true`, 但场景 JSON 里只有 home 房 (rooms[4], W2N2) 是
`mine:true`。8 个非 home 房是 rcl=0、无 spawn 的「幽灵房」。

## 实证链

- 场景文件 `rooms[4].controller = {level:1, mine:true}`, 其余 `{level:0}` 无 mine
- 引擎运行时 `Game.rooms[*.].controller.my === true` × 9 (TRACE 插桩逐房确认)
- 主链 Perception 的 `controller?.my` 守卫因此全数放行 → world.rooms 装入 9 房
- t0 主 Planner 即给 9 个房全部生成动态布局记录 (Memory.Nexus.layout 污染,
  PathFinder CPU 消耗 ×9), 若放工地会吃掉全局 100 工地配额

## 影响

任何遍历 `world.rooms` 并对"己房"产生动作 (孵化/工地/布局记录) 的主链模块,
挂上 race 链都会对 8 个幽灵房产生动作。冲级调优基线口径不容这种污染。

## 设计规避 (终态)

race 链模块清单 = 主代码内核 (装配/调度/校准/遥测/错误边界) +
ActorOwnership 双件 (纯 global 运行时层, 零 Memory/零原生调用) +
RaceSpeedrun (commit P0, 冲级行为单模块)。

主链行为模块 (Spawning/Planner/Economy/StrategyCore/Defense/Cluster/Tasks/
Teams/Industry/Expansion/Comms/...) 不挂: 除幽灵房污染外, Spawning 与引擎
spawnIt 同步直调互抢, Planner 的工地意图以 Broker 为唯一消费方 (链上无 Broker)。

## 验证标准

- race 链构建产物 `dist/main.js` 只含一个行为模块 (race-speedrun)
- 4×20k `[1071167,1080491,1074976,1079683]` / 4×40k
  `[2281648,2295520,2272884,2289314]` 逐位复现 (融合验收已两轮通过)
