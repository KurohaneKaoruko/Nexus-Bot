# Tasks

> 编排说明：组 0–2 为串行地基（按序执行）；组 3–8 为并行轨道（可开子代理并行，文件域互不相交）；组 9 为收尾门禁（全部轨道完成后）。每任务完成须跑场景门回归（见 9.4）。触碰同一文件域时，缺陷组（组 4）优先于重构组。

## 1. Phase 0 — 基线冻结与架构守护

- [ ] 1.1 记录当前基线：sim 场景矩阵全量跑一遍（boot/speedrun/sprint/remote-mine/arena/race-body-audit），存档各门红绿与关键读数（RCL 时间线、CPU、Memory 体量），作为重构对照基线
- [ ] 1.2 新增架构守护脚本：扫描 `src/` 动作类原生调用（spawnCreep/createConstructionSite/moveTo/transfer/withdraw/attack/heal/deal/send/cancel/remove/claim 等）并与豁免清单比对；清单条目无对应调用时要求删除条目，有调用无条目时红
- [ ] 1.3 建立豁免清单基线：以本次审计快照（prototype ~115 / teams ~45 / economy-units ~70 / planner 12 / spawning 6 / market-terminal 10 / visuals 1 + `src/console/` 人操豁免）为初始清单，注明每条的计划收编轨道与期限
- [ ] 1.4 守护脚本接入 CI/预提交流程，验证"新增直连调用必红、删除调用促清单收缩"两个方向的行为

## 2. Phase 1 — Actor Ownership（轨道 A，先行）

- [ ] 2.1 新建 `src/runtime/actorOwnership.ts` + `actorRegistry.ts`：acquire/release/ownerOf/assertOwner + 租约续期 + 死亡自动释放 + 孵化中名单不可夺取
- [ ] 2.2 租约数据落 `global` 运行时层（单 Tick 重建），跨 Tick 持久索引仅存 owner 名与到期 Tick；定义可序列化 schema 与版本
- [ ] 2.3 三档模式（记录/告警/拦截）配置化接入（配置文件管理，不硬编码），默认"仅记录"上线
- [ ] 2.4 agentSystem 与 legacy 执行路径、teams 直操路径各自注册为 owner 候选；记录模式跑 sim 收集真实冲突面，输出冲突热点报告
- [ ] 2.5 sim 验证：冲突被记录且行为零变化（记录模式）；死亡释放与孵化保护有断言场景

## 3. Phase 2 — Command Boundary 扩管线（轨道 A，先行）

- [ ] 3.1 `ActionResult` 语义修正：五分类 category + 可选 nativeReturnCode，未触达原生 API 不伪造返回码；改造现有 triage 与消费方
- [ ] 3.2 broker 新增 construction 管线：工地创建/移除/拆除命令；planner 五处直连点（index/controllerBuffer/sourceExtensions/sitePlacement×2）改提交意图
- [ ] 3.3 broker 新增 spawn 管线：孵化命令接口（含 spawning.cancel 受管化）；spawnDirector 两处直连 spawnCreep 改经管线提交
- [ ] 3.4 broker 新增 market/terminal 管线：autoMarket/terminalControl/FunnelModule 直连点收编；`src/console/` 人操操作登记豁免
- [ ] 3.5 broker 新增 claim/reserve 管线：agentSystem 内直连 claimController/reserveController（L745/L796）改经管线
- [ ] 3.6 broker 新增 PowerCreep 能力管线：usePower/enableRoom 收编（prototype PowerCreep 直连点经 Adapter）
- [ ] 3.7 commit 阶段插入 assertOwner：非 owner 命令拒绝并分类记录；与 2.3 的三档模式联动
- [ ] 3.8 Ownership 切"告警"档跑 sim：冲突面收敛至零新增后切"拦截"档，验证拦截下主循环稳定
- [ ] 3.9 豁免清单收缩：本组收编的直连点从清单移除，守护脚本绿
- [ ] 3.10 `endPhase.ts` 内核纯化：硬编码业务 import 链改为 TickModule `end` 钩子注册制（Event/Funnel/InterShard/Clear/Statistics 各自向 commit 相位注册），内核零业务依赖；QoS 与 cpuBudget 并存治理收口——cpuBudget 为尊，QoS 降级为 legacy 侧兼容读口（随 legacy 删除逐段摘除）

## 4. 缺陷修复轨道（组 4，与其他轨道并行，同域优先）

- [ ] 4.1 P0-16a/b/c 孵化期 Memory 清理竞态：ClearModule 排除 `Game.spawns` 孵化白名单（或延后一 tick 宽限）；roomVisuals 对无 unit 孵化单只告警不 cancel；courier 提交前过滤 spawning。验证：探针断言连续 500t 孵化名单无 MISSING、`warn.broker.invalid.withdraw actor-missing-or-spawning` 归零、speedrun 无双轨兜底命中
- [ ] 4.2 P1-17 expansion 半球硬编码：`findExpandTarget` 复用 `neighborRooms` 的 E/W 镜像换算；GCL 门槛否决时输出明确原因不静默。验证：speedrun expand 姿态激活后 1000t 内出现对真实邻房的 claim/扩张意图或明确 GCL 不足日志
- [ ] 4.3 P1-18 外矿链路静默（scout 孵化饥饿）：scout 需求参与孵化仲裁优先级竞争。验证：remote-mine 场景 scout 于外矿目标设定后 500t 内出现、30k 内 W5N9/W4N8 有远程采集收入记录
- [ ] 4.4 P1-19 upgrader 断档：水位门对"升级体归零"的房强制豁免（保级优先于节水）或降级紧急度阈值前移。验证：speedrun 全程 upgrader 在岗为 0 的连续区间 < 500t、控制器进度无 1000t 级停滞
- [ ] 4.5 P2-20 RCL3 建造风暴：建造放量与在岗 worker 吞吐联动（积压 sites > N×worker 承载时暂缓新工地）。验证：sprint 场景 L4@40000 通过或 sites 积压峰值 < 3×worker 数
- [ ] 4.6 role-registry-executor-gap：按文档要求统一角色注册与执行器缺口
- [ ] 4.7 race-strategy-port W1 波（reserver/未预订 ept 减半/远程搬运自查改独立 carrier 链/skipBuildTypes）与 W2 波（远程容器道路/porter 直供），按文档波次推进并在 docs/bugs 勾销
- [ ] 4.8 每项修复完成后在对应 `docs/bugs` 文档勾销并跑 sim 场景回归（组 3–8 触碰同域时本组先行）

## 5. Phase 3–5 — 移动/任务/Agent（轨道 A 续 + 轨道 D 前置）

- [ ] 5.1 Movement 收口：agentSystem 产出 MoveIntent（目标/优先级/理由），movement 引擎定位为 broker 移动执行器；legacy moveTo 猴补丁通道登记豁免
- [ ] 5.2 按单位类别分批关闭 legacy moveTo 通路（收编一类清一类豁免），traffic/path cache 行为保持（sim 对比移动执行率不低于基线）
- [ ] 5.3 TaskIndex：在既有 TaskBoard（dedupeKey 幂等/租约/TTL 对账已成熟）之上按 room/kind/state/assignee 哈希索引，创建/指派/迁移/过期/取消同步更新；分配扫描成本与任务总量解耦（单测断言）
- [ ] 5.4 任务生命周期闭环加固：执行者死亡回收、租约丢失回收、终结不可复活、无主任务泄漏检出（遥测计数）
- [ ] 5.5 Agent 单路径：Task→Agent FSM→Intent 统一；角色判定 Memory 权威化（`unit`/`unitCode` 第一来源，名称解析仅 fallback）；legacy 执行路径（`NEXUS_TASK_DRIVEN_CODES` 分水岭与 `exec()` 双轨）按类别/房间/全局三级开关分阶段关闭
- [ ] 5.6 workforce 双实现定于一尊（workforce.ts 快照口径为尊，roomWorkforce.ts legacy 口径随 P1-14 域收编退役）；角色注册与执行器缺口按 role-registry-executor-gap 文档收口
- [ ] 5.7 Movement 单点契约锚定：`preTickBetterMove → broker commit → endTickResolve` 时序作为 Broker 模块契约固定（破坏即全员冻结），sim 场景含移动执行率断言（不低于基线 97% 水平）
- [ ] 5.8 sim 验证：legacy 全关后采集/搬运/升级/建造吞吐不低于关闭前基线

## 6. Phase 6–7 — 孵化建造管线（轨道 C）

- [ ] 6.1 spawnDirector 拆分：Demand Sources（定编/替补/防务/扩张/编队/特需）→ SpawnArbiter（全局裁决）→ BodyFactory（纯函数）→ SpawnQueue → SpawnCommand；legacy spawnControl 四处直连改经管线
- [ ] 6.2 directSpawn 改造为 emergency/direct 模式 SpawnRequest，TeamSpawner/ExpandController 等调用方迁移；UnitDefinition 统一角色定义源（capabilities/body policy/population class 唯一来源）
- [ ] 6.3 孵化中名单统一接口 `isSpawning(name)`：ClearModule/visuals/courier/普查全部改用（收编 4.1 的近期修复为架构层接口）
- [ ] 6.4 孵化链路可审计：队列深度/优先级等待时长/取消原因计数入遥测；单需求方异常不阻断孵化线
- [ ] 6.5 Construction 意图化完整版：建造放量与在岗产能联动（N×worker 承载阈值，配置化）；结构优先级表配置化并受战略阶段调制（冲级期产业让位）
- [ ] 6.6 外部道路 roadBuilder 三处直连 + miner 自放容器收编：经建造管线提交
- [ ] 6.7 sim 验证：speedrun 分段门无新增红；建造风暴指标（sites 积压/worker 比）达 4.5 验证线

## 7. Phase 8 — 经济账本（轨道 D）

- [ ] 7.1 ResourceLedger 五态分账（Observed/Available/Reserved/Committed/Consumed + 预计收入）：按房间能量账先行，预留绑定任务/命令生命周期
- [ ] 7.2 预留泄漏防护：任务终结/命令失败同步释放 + 超龄预留强制回收（阈值配置化）
- [ ] 7.3 收入口径统一：采集/外矿/预订加成统一折算（未预订减半），定编与孵化门同源引用；remoteMining 满采上限折算修正
- [ ] 7.4 饥饿与瓶颈指标入遥测（需求长期缺供/库存满空/链路断供），Memory 无界流水不入库
- [ ] 7.5 孵化/建造/升级供给决策全部切换到 Available 口径，sim 验证无超发与饥饿误判
- [ ] 7.6 Memory 双轨收敛预处理：legacy accessor 域（RoomData/MissionPools/TeamData 等随对应 legacy 域删除）标记消亡路径，不提前大迁移；`bucketGovernor` 散键写入收进 Nexus 命名空间

## 8. Phase 9–11 — 战斗/产业/外域收编（轨道 E + F，与 6/7 并行）

- [ ] 8.1 defense 需求化：threat model → demand → intent 单向流；defense/units（defendDuo/defendSingle）直操动作改经 Adapter 提交；塔/安全模式保持 broker 提交
- [ ] 8.2 teams Adapter 化：TeamAction/TeamBattle/units 直连动作（move/attack/heal/rangedAttack ~45 处）经编队 Adapter 汇入边界，内部战斗算法不动；所有权由 Adapter 持有；解散交接无真空（控制权先归还再释放任务）
- [ ] 8.3 sim 场景验证编队行为等价（攻防场景回归，算法资产保全）
- [ ] 8.4 industry 逐子系统 Adapter 化：autoMarket/terminalControl/lab/factory/nuker 直连点收编；console 人操豁免登记
- [ ] 8.5 external 扩张意图纳入边界：claim/reserve 经 3.5 管线；expand 链路可观测（否决必有原因输出）
- [ ] 8.6 intershard 调度意图可审计（决策记录可查询，无静默丢弃）；Memory 写入受 schema 与容量约束
- [ ] 8.7 豁免清单收缩：defense/teams/industry/external 域条目清零或仅剩登记 Adapter

## 9. Phase 12–15 — 删除门禁与生产硬化（全部轨道完成后）

- [ ] 9.1 四条件删除门禁落地：删除操作关联验证记录（Nexus 等价存在/实服验证/sim 验证/CPU 验证），按最小可回退单元执行，跨域批量删除被拒
- [ ] 9.2 legacy 删除执行：prototype 角色库/economy legacy units/legacy spawnControl 按域逐个删除，每删一域跑全场景门 + 实服落地观察一个 4wt 重置周期；实服缺陷回流 `docs/bugs`
- [ ] 9.3 豁免清单收敛度量：按域输出收敛百分比；除人操豁免外清单趋零；守护脚本验证清单不回涨
- [ ] 9.4 生产级不变量监控固化：owner 唯一/任务必终结/孵化名单一致/Memory 有界/CPU 预算五项不变量的限频告警接入遥测；全场景门回归线一键化（一条命令跑完输出逐门红绿）
- [ ] 9.5 实服落地总验证：指定私服连续运行 ≥ 一个完整重置周期，孵化/采集/升级/扩张/防务关键行为正常，CPU 与 Memory 稳定；docs/bugs 全部 P0/P1 勾销或降级
- [ ] 9.6 收尾对账：AGENTS.md 准则核对（无硬编码/无参考注释/属主 nightx:night/未擅自提交），openspec 变更可归档
