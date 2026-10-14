# 22. 三循环与数据所有权 (架构对齐公约)

> 本篇把分层智能体架构的建议对齐到项目现行结构, 固化为公约。
> 结论: 现行架构已实现建议的绝大部分支柱 (分层模块化 / 任务驱动 / 分层自治 / 行动协调 / 可恢复);
> 本篇补齐的是显式契约——三循环模型、数据所有权表、CPU 分级语义。

## 22.1 三循环模型

三个循环对应不同的更新频率与职责, 映射到 TICK_PHASES 与模块:

| 循环 | 职责 | 落点 | 频率 |
|---|---|---|---|
| 战略循环 | 姿态/目标/预算/风险政策 | `strategy` 阶段 → `modules/strategy` (posture + directive) | 低频重估 + 紧急重估标志 |
| 调度循环 | 目标 → 任务生成/去重/分配/续约 | `planning`+`reconcile` 阶段 → 各域 planners + `modules/tasks` (board+allocator) | 每 Tick, 贪心+迟滞 |
| 执行循环 | 机体按任务执行一步, 提交行动 | `agents`+`commit` 阶段 → `modules/agents` (提案) → ActionBroker (仲裁+唯一原生调用点) | 每 Tick |

控制链 (单向, 反馈经结果通道回流):

```
World Model (core/world + modules/world)  → 提供事实
NexusCore (modules/strategy)              → 定义目标与约束 (directive)
Cluster (modules/cluster + 各域 planner)   → 拆解局部工作
Task System (modules/tasks)               → 分配任务 (S = 权重·优先级 + 能力匹配 − 路程 − 风险 − 切换成本)
Agent (modules/agents)                    → 执行任务一步, 产行动提案
Action Layer (actionBroker + movement)    → 仲裁冲突 / 交通协调 / 提交原生指令
结果 (ActionResult / 失败原因 / 速率)       → 回写任务与账本, 修正下一轮规划
```

## 22.2 数据所有权表

单一写入方原则 (避免多系统各自估算同一份资源):

| 数据 | 唯一主要写入方 | 读取方 |
|---|---|---|
| 房间快照与 Intel | `modules/world/perception` (写 `Memory.nexus.rooms`) | 所有规划器 |
| 战略姿态与政策 | `modules/strategy/core` (写 `Memory.nexus.global`) | 各域 (经 `directiveFor`) |
| 任务状态与分配 | `modules/tasks` (board + allocator) | Agent、各域 planner |
| Creep 执行进度 | `modules/agents` (任务租约回写) | allocator、agentSystem |
| 资源预留与承诺 | `modules/economy/ledger` (reserve/commit/release) | economy、spawning、industry(未来) |
| 移动请求与路权 | `modules/movement` (BetterMove + trafficMonitor) | Agent、Broker |
| 行动结果 | `modules/agents/actionBroker` | 任务生命周期、遥测、账本速率 |
| 布局记录 | `modules/planner` → `Memory.nexus.layout` | construction、worksite |

三类信息的生命周期 (世界模型铁律):
- 当前可见状态: `core/world` 快照, 仅本 Tick 有效;
- 持久化情报: `Memory.nexus.rooms` Intel, 必须带过期/衰减;
- 临时计算缓存: TickContext / runtime 层, 不落 Memory。

## 22.3 CPU 分级语义 (已实现, `core/cpuBudget`)

| 带 | 内容 | 策略 |
|---|---|---|
| P0 | 紧急防御、关键生存、Broker 提交 | 永远执行, 保最低成本 |
| P1 | 核心经济、Agent 执行、孵化 | 高频, 预算内优先 |
| P2 | 任务重分配、布局放量、面板 | 周期/变化触发 |
| P3 | 昂贵分析、扩张比较、市场 | bucket 低于阈值时暂停; 饥饿保护兜底 |

衡量标准是单位 CPU 产出 (每百 CPU 净收益 / 完成任务数 / RCL 达成时间), 不是缓存命中率。

## 22.4 建议对照与采纳决定

| 建议 | 现状 | 决定 |
|---|---|---|
| 模块化单体 + 分层多智能体 + 任务驱动 | 已实现 (nexus + phases + tasks) | ✅ 维持 |
| Tick Kernel / CPU 预算 / 异常隔离 | 已实现 (core/ 四件套) | ✅ 维持 |
| 世界模型三类信息 | 已实现 (快照/Intel/runtime 三级) | ✅ 维持 |
| Task Board + 评分分配 | 已实现 (17 种 kind、dedupeKey、租约、迟滞) | ✅ 维持 |
| Action Layer / IntentBroker | 已实现 (管线仲裁、唯一原生调用点、结果回写) | ✅ 维持 |
| Traffic Manager | 已实现 (BetterMove endTickResolve + trafficMonitor) | ✅ 维持 |
| Resource Ledger | 已实现 (economy/ledger) | ✅ 维持 |
| 三循环模型 / 数据所有权表 | 隐式存在 | ✅ 本篇显式化为公约 |
| Goal Board (战略目标显式化) | posture+policy 已有, 目标列表未显式 | ⏳ 路线图 (扩张/工业阶段需要时引入) |
| Agent FSM 显式化 | 任务 handler 内隐式状态 | ⏳ 路线图 (远程采集/战斗任务接入时重构) |
| 轻量 tick 内事件 | 结果通道隐式 | ✅ EventBus 已归位 core |
| platform/screeps 适配层 | 无独立适配层 (Broker 收口行动 + sim 全链路验证) | ❌ 不采纳 (企业级六边形对 Screeps 过重) |
| 建议的扁平目录 (kernel/persistence/...) | 已有等价结构 | ❌ 不采纳 (与既定 src 规范冲突: core≈kernel, core/store≈persistence, modules/*≈领域) |

## 22.5 开发顺序对照 (建议 §8 vs 现行路线)

1. 工程基础 ✅ (TS 严格门禁 / 双 tsconfig / 构建 / sim 回归 / 部署链)
2. Kernel + Memory + World Model ✅
3. 最小 Task Board ✅ (采集/搬运/升级/建造/补员闭环, sim 验证)
4. Agent + 行动协调 ✅ (提案制 + Broker 仲裁 + 交通)
5. NexusCore + 房间自治 ✅ 最小版 (posture 驱动) — 后续增强
6. 高级玩法 ⏳ 路线 (布局→Rush→外矿→工业→编队)
