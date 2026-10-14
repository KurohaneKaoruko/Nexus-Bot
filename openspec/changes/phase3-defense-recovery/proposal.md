# Proposal

## Why

Phase 0–2 已交付可运行的经济闭环、资源流与战略姿态骨架，但房间对敌对完全无响应：感知不看敌方单位、`defend` 任务无人生成、`war` 姿态无输入源永不进入、塔/墙/维修完全闲置。按 docs/nexus-design/14 路线图进入 Phase 3：让 Bot 在 NPC Invader 与常见敌对情景下能保护关键经济单位与结构、有控制地响应，并在攻击结束后自动恢复经济。

## What Changes

- **ThreatModel**（docs/nexus-design/09 §9.2、docs/nexus-design/19 §19.4）：感知快照补充敌方 Creep（部件构成/主人/位置）、己方塔、受损结构与墙体/城门观测；按房间产出结构化威胁摘要与威胁分（区分 NPC Invader 与玩家敌人），存 `Memory.rooms[].threat`（带 lastSeen/confidence，未观测衰减）。
- **防御应急规划**（docs/nexus-design/19 §19.3/§19.4，emergency 阶段）：`planDefenseRoom` 按房间读快照+指令，幂等产出 `defend`/`retreat` 任务；非战斗单位受威胁时撤退或停工，不再采集至死；敌人消失后任务自然终结、经济恢复。
- **Tower 控制**（docs/nexus-design/09 §9.3/§9.4）：塔能源最低储量与补给优先级、按「即刻危险 × 战略价值 × 击杀可行性」选目标、多塔分配避免过度集火；塔行动经 ActionBroker 统一提交（结构 actor 扩展）。
- **Safe Mode 政策**（docs/nexus-design/09 §9.3）：明确触发条件（关键结构濒毁且常规防御不足）、可用次数/冷却检查；禁止「敌人数量 > N」单一硬编码条件。
- **维修目标**（docs/nexus-design/09 §9.3、docs/api/08 §8.6）：新增 `repair` 任务类型，按威胁区域/战略价值/损坏程度排序，受攻击期间优先抢修，平时不把所有墙修到极限。
- **war 姿态输入源**（docs/nexus-design/19 §19.4）：`evaluatePosture` 增加 war 转移规则（威胁分超阈值 + 驻留迟滞 + 敌方出现置紧急重估标志）；`riskTolerance` 政策自此启用；威胁衰减后回 develop，压制自动解除。
- **Defender 生产**：BodyFactory 增加战斗角色（近战/远程 defender），SpawnDirector 按 defend 任务缺口与威胁分级生产，能源经共享账本预留。
- **战损预算与统计**（docs/nexus-design/14 Phase 3 验收）：塔能耗、战损单位、击杀数等有界统计，可经控制台/HUD 查询。

## Capabilities

### New Capabilities

- `threat-model`：威胁观测与评分——敌方单位/结构观测入快照、按房间威胁摘要与评分、NPC 与玩家敌人分类、Intel 新鲜度与置信度衰减、战损统计。
- `tower-control`：塔控制——目标选择排序、多塔分配防过度集火、塔能源最低储量与补给优先级、结构 actor 行动统一经 ActionBroker 提交。
- `defense-response`：防御应急响应——emergency 阶段按房间规划、defend/retreat 任务生成与终结、非战斗单位撤退/停工、Safe Mode 政策、war 姿态转移输入、攻击结束后经济恢复。
- `structure-repair`：维修目标——受损结构按威胁区域/价值/程度排序、攻击期抢修与平时维护分级、墙体/城门不无条件修满。
- `combat-spawning`：战斗单位生产——defender 身体模板与预算伸缩、按威胁缺口生产、能量预留走共享账本。

### Modified Capabilities

（无——主 specs 尚未从 phase0–2 变更同步；war 姿态转移在本期是给既有 strategy 实现补上 docs/nexus-design/02/19 已设计的输入源，属新增行为契约，落在 `defense-response` 内。）

## Impact

- **新增模块**：`src/modules/defense/`（`threatModel.ts` 评分纯函数 + 摘要、`planners.ts` emergency 规划、`towerControl.ts` 塔控、`index.ts` 装配）、`src/config/defense.ts`（全部防御参数）。
- **修改**：`src/modules/world/perception.ts` + `src/core/world.ts`（快照增敌方/塔/受损结构观测）、`src/modules/agents/actionBroker.ts`（attack/rangedAttack/heal/repair/tower 行动与结构 actor）、`src/modules/agents/agentSystem.ts`（defend/retreat/repair 行为分支）、`src/modules/spawning/bodyFactory.ts` + `spawnDirector.ts`（战斗角色与缺口）、`src/modules/strategy/core.ts`（war 转移规则）、`src/store/taskSchema.ts`（`retreat`/`repair` 类型、租约与优先级）、`src/store/memorySchema.ts` + `migrations.ts`（schema v5：`rooms[].threat` + `defense` 子系统，全部有界）、`src/modules/index.ts`（emergency/commit 阶段注册）、profile 开关与 HUD 威胁行。
- **不动**：TaskBoard/Allocator/Broker 架构与阶段顺序、BetterMove 代码、经济任务族行为（仅被 retreat 临时压制）；SquadPlanner 编队与跨房间援军（Phase 4+）、远程采集受袭（无远采）、进攻性行动（`attack` 任务族仅预留不实现）。
- **验收对齐**：docs/nexus-design/14 Phase 3——NPC/常见敌对情景合理响应、攻击后经济恢复、不长期全员防御、战损有预算与统计。
