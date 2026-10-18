# 21. 架构定案

> Nexus 架构定案: 全部域按 TickModule 架构挂载, 统一运行时结构。
> 本篇记录架构定案与 src 顶层结构规范, 供后续开发参照。

> ⚠ 目录结构裁定：01 篇 §29 的目标目录（kernel/world/state/…）是长期方向，但**不做整树搬移**——现行 src 顶层结构（本篇 21.1）即当前权威，目录重组只在模块收编自然发生时顺带进行（nexus-architecture-refactor design.md 裁定）。冲突时：目标态看 01 §29，现行态看本篇。

## 21.1 src 顶层结构规范

src 顶层只保留主要分类与入口, 其余一律收进分类内:

```
src/
├── main.ts            # 主入口 (Nexus 架构, 官服口径; 装配清单平铺挂载)
├── branch/            # 构建变体入口 (一律 Nexus 架构, 差异只在 profile 与垫片)
│   ├── compat.ts      #   私服共享垫片 (缺 Power 类/市场 API 时补桩降级)
│   ├── local/         #   本地客户端/私服变体
│   ├── race/          #   冲级服变体 (roomMode 固定 rush)
│   ├── season/        #   赛季服变体 (占位, 规则明确后裁剪)
│   └── stronghold/    #   要塞挑战服变体 (占位, 待规则适配)
├── config/            # 常量配置 (战略/经济/防御/编队/冲级/布局/变体开关)
├── constant/          # 角色代号等游戏侧常量表
├── core/              # 内核 (调度/预算/内存/世界快照 + ai 库 + qos/event 等基建)
├── console/           # 人机接口 (控制台命令族)
├── types/             # 全局类型声明
├── modules/           # 功能域 (蓝图 L2-L7 域化落位)
│   ├── world/         #   [L2 感知]
│   ├── strategy/      #   [L3 帝国]  姿态/指令/扩张
│   ├── cluster/       #   [L4 集群]  编队生命周期/槽位任务
│   ├── tasks/         #   [L5 任务]  黑板与分配
│   ├── economy/       #   [经济+物流] 任务源/诊断/账本/配额/外矿
│   ├── spawning/      #   [孵化]     排程+替补+directSpawn, 体型编译
│   ├── agents/        #   [L6+L7 行动] 执行器/意图网关/共享 Broker
│   ├── prototype/     #   [原型拓展] 方法挂载+特性链驱动 (角色行为库现行 API)
│   ├── movement/      #   [交通]     BetterMove + trafficMonitor
│   ├── planner/       #   [基建]     布局规划
│   ├── defense/       #   [安全]     威胁/塔控/应急
│   ├── industry/      #   [工业]     结构链+自动化链
│   ├── teams/         #   [编队战斗]
│   ├── intershard/    #   [跨 shard]
│   ├── external/      #   [外矿/扩张]
│   └── visuals/       #   [观测呈现]
└── utils/             # 纯工具
```

## 21.2 定案

- 全部功能域已按 Nexus TickModule 架构挂载 (Teams/PowerCreeps/Industry/EventBus/Nukes/
  InterShard/Expansion 正式域模块), 五变体入口统一装配
- 孵化链主线化: 编队/扩张/pc 陪护走 directSpawn; 角色族定编判定保留在
  spawning mission 孵化主链 (modules/prototype 提供原型方法挂载驱动)
- 外矿同名-role / 扩张 claim 已按任务板主线化 (kind scout/claim)
- 类型债: nocheck 152 → 33 件 (-78%), 错误 4109 → ~660 (-84%)
- 开发历程详见 git log
