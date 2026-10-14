# 16. 术语表、规则核验与参考资料

## 16.1 术语表

| 术语 | 含义 |
|---|---|
| Tick | Screeps 游戏循环的一次迭代；Bot 在该周期读取状态并提交行动意图 |
| Creep | 玩家通过 Spawn 生产、由身体部件组合能力的普通单位 |
| Power Creep | 拥有特殊 Power/技能系统的账户级单位，生命周期与普通 Creep 不同 |
| Room | 50×50 网格房间，是地图、控制权、基础设施与局部规划的重要单位 |
| Shard | 世界的分片；不同 Shard 间通过特定门户/机制连通 |
| RCL | Room Controller Level；决定房间结构容量与可用能力 |
| GCL | Global Control Level；影响可控制房间数量，并在相关官方账户机制下与 CPU 限额有关 |
| Intel | 对不可见房间的持久化观测摘要；必须带新鲜度，不能等同实时视野 |
| Nexus Core | 本架构的全局战略大脑，是设计概念，不是游戏内原生对象 |
| Cluster | 房间/房间群级局部规划模块，是设计概念 |
| Task Board | 存储任务生命周期与租约的共享黑板，是设计概念 |
| Action Broker | 统一校验、仲裁并提交行动的执行层，是设计概念 |
| Lease | 任务的临时所有权，超时或持有者失效时可回收 |
| Capability Profile | 根据身体部件、负载与寿命计算的能力画像 |
| CPU Bucket | 未使用 CPU 可积累的预算池，适合可延迟计算 |
| CostMatrix | Pathfinder 的房间内移动成本表示 |
| Resource Reservation | 为未来生产/扩张/交易预留的资源承诺记录，不是额外库存 |

## 16.2 官方规则来源

以下官方页面在 2026-10-10 编写本文时已核对。游戏规则、API 与账户机制可能变化；正式部署应再次查看官方文档和目标服务器当前配置。

1. [Introduction](https://docs.screeps.com/introduction.html) — 世界与房间、地形、Source、Spawn 等基础规则。
2. [Understanding game loop, time and ticks](https://docs.screeps.com/game-loop.html) — Tick 快照、执行和状态生效时序。
3. [Simultaneous execution of creep actions](https://docs.screeps.com/simultaneous-actions.html) — Creep 行动依赖管线和同 Tick 冲突优先级。
4. [Creeps](https://docs.screeps.com/creeps.html) — 身体部件、单位能力与生命周期。
5. [Control](https://docs.screeps.com/control.html) — GCL、RCL、结构数量与 Controller 降级。
6. [CPU limit](https://docs.screeps.com/cpu-limit.html) — 在线 CPU 预算与 Bucket。
7. [Global objects](https://docs.screeps.com/global-objects.html) — Game、Memory 与持久化限制。
8. [Resources](https://docs.screeps.com/resources.html) — Energy、Minerals、Labs、Commodities 等资源系统。
9. [Market System](https://docs.screeps.com/market.html) — Terminal、交易单、市场费用与交易规则。
10. [Defending your room](https://docs.screeps.com/defense.html) — Safe Mode、墙、Rampart、Tower 与主动防守。
11. [NPC Invaders](https://docs.screeps.com/invaders.html) — NPC 入侵、突袭与 Stronghold。
12. [Power](https://docs.screeps.com/power.html) — Power、Power Spawn、Power Creep 与技能。
13. [API Reference](https://docs.screeps.com/api/) — 当前可用对象、方法、常量及结构属性。
14. [Organizing scripts using modules](https://docs.screeps.com/modules.html) — 脚本模块组织方式。
15. [Start Areas](https://docs.screeps.com/start-areas.html) — 新手区域、复活区域及特殊规则。
16. [screepers/screeps-typescript-starter](https://github.com/screepers/screeps-typescript-starter) — TypeScript 工程构建与上传起步项目。

## 16.3 规则核验流程

遇到规则差异或官方更新时：

1. 先看对应官方 Gameplay 文档；
2. 再看 API Reference 对象和方法的当前定义；
3. 检查官方 changelog 或目标私服的版本/Mod；
4. 为关键规则写一个最小模拟测试；
5. 将变化集中更新在 `GameRules`/配置模块，避免多个子系统各自保留旧假设。

## 16.4 文档边界

本文没有声称已实现所有系统，也不把机凯种的虚构设定当成 Screeps 的原生功能。文档提供统一的工程设计、规则映射与实现路线；对 Spawn 配方、结构冷却、市场成本、特定 Power 效果以及私服差异等精确数值，代码中应尽可能从 API 状态读取或集中维护，并在目标环境测试。
