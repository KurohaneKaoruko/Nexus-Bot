# Spec Delta

## Purpose

定义 mission pool 调度链退役后「任务板是唯一任务事实源」的契约：per-room 更新器退场、Memory 双写结构清理、任务供给在退役前后语义等价、人工目标数据归属处置。本 spec 钉死**语义映射表**（旧池语义 → 任务板承载方式）与**对照程序**（快照怎么取、差集怎么判、结论落在哪），实施会话 MUST 按映射表执行，MUST NOT 现场发明迁移方案。

## ADDED Requirements

### Requirement: 任务只存在于任务板

系统 MUST 以任务板作为任务的唯一读写载体。以下结构 MUST 全部不存在于源码与 Memory 中：`MissionPools` 存储结构（**spawn 池除外**——见下）、池读写 API（`addMissionToPool` / `getMissionFromPool` 系列 / `updateMissionPool` / `deleteMissionFromPool` 等）、`MissionUpdate`/`UpdateXxxMission` 调度方法、`MISSION_POOLS`/`MissionPoolName` 词表。任务 MUST 经任务板的 dedupeKey 幂等 upsert 写入。

**spawn 池归属（集成会话 2026-10-25 裁定，取证摸底档 J 节）**：spawn 池是孵化队列实现（`SpawnMissionAdd` 发单 → spawnDirector 消费），不是任务池——它是主线孵化链的一部分（与 warSpawn 族载载计数、rush 仲裁、statistics 队列长度共享），不在退役域。退役范围收窄为 transport/build/repair/terminal/mine/boost 六池；`Memory.MissionPools` 键在六池清空后若 spawn 队列仍驻留同键，则保留该键并登记为孵化域基建（域 5 孵化链收编时一并处置）。

#### Scenario: 第二任务池写入被拒

- **WHEN** 任一模块尝试把工作任务写入任务板之外的结构并在执行期读回
- **THEN** 该写入被判定违规（structure-guard 的 MissionPools 符号扫描红）

#### Scenario: 池符号全仓清零

- **WHEN** 全仓扫描上列池 API 与词表符号（含类型声明、console、文档）
- **THEN** 源码命中数为零

### Requirement: 任务供给语义按固定映射表迁移

旧池语义 MUST 按下列映射表迁移到任务板与计划阶段模块，实施 MUST NOT 偏离映射（新增映射或改映射需先修订本 spec）：

| 旧语义（更新器/池） | 任务板承载 | 供给方（planning 阶段模块） | 验证口径 |
|---|---|---|---|
| `UpdateManageMission`（storage↔link/terminal 调拨、manage 池） | `carry`（配额目的地）+ `terminal_transfer` + `fill_spawn` | economy planners 新增 manage 语义规划 | 快照对照：同资源压力下任务集合覆盖 manage 池语义 |
| `UpdateTransportMission`（工地/供能搬运、transport 池） | `carry` | economy planners 既有 carry 规划扩展目的地配额 | 快照对照：覆盖 transport 池语义 |
| `UpdateWorkMission`（build/repair 池） | `build` + `repair` | 既有（已在任务板，核对无缺口即可） | 快照对照：无未登记差集 |
| `UpdateBuildRepairMission`/`UpdateWallRepairMission` | `build` + `repair` | 既有 planner/defense 维修任务源 | 同上 |
| `UpdateMineMission`（元素矿/沉积矿定编 + directSpawn 桥接） | `harvest`（`resourceType` 区分元素矿）+ spawnDirector 需求源 | economy 计划阶段新模块（定编口径逐条搬运） | 单测：定编口径与退役前逐条一致 |
| `UpdateBoostMission`（boost 池） | boost 供给链整体随 boost 域切片处置：**boost 池不是任务板任务的退化副本，而是 boost 预订簿记**（`AssignBoostTask/SubmitBoostTask` 写入 owners/amount 预订记录，`UpdateBoostMission` 据此做 lab 预留/征用/清理/回运）。承载判定 = 预订簿记迁 `Memory.Nexus` 结构化域（labReservations 同层），`AssignBoostTask` 系改写簿记而非池，`UpdateBoostMission` 的 lab 管理逻辑迁 industry planning 模块；任务板 `boost` kind 保留给「单位去 lab 强化」的移动/执行任务（若需求出现）。该切片独立于域 1/2/3 执行（依赖：先于域 3 删池） | industry planning 新模块 + labReservations 簿记扩展 | 单测：预订/回收/超时清理口径与 boostMission 逐条一致；`boostFunction` 读池改读簿记 |
| `TransportMissionCheck`/`BuildRepairMissionCheck`（自检） | 任务板 TTL 对账与 reconciliation 既有机制 | 既有 | 全场景门 |
| `UpdateHighwayScan`（高速路扫描） | 按 0.3 摸底结论：活语义迁 economy 或随休眠链退役 | — | 摸底留档 |

执行顺序 MUST 与 legacy-execution-retirement spec 的域清单一致：manage/transport 先（域 1）、mine/boost 次（域 2）、其余更新器随域 3 删除。

#### Scenario: 映射表被执行无偏离

- **WHEN** A 波域 1/2/3 的迁移实现完成
- **THEN** 每行映射对应的供给方模块、任务 kind、验证口径与表一致，无表外自创迁移

#### Scenario: 表内语义无遗漏

- **WHEN** 旧更新器的职责逐条核对映射表
- **THEN** 每条职责都能在表中找到承载行，找不到的先修订表再实施

### Requirement: 任务供给快照对照程序固定

语义等价 MUST 用以下固定程序证明，MUST NOT 用「看起来覆盖了」替代：

1. **取快照**：退役前在 sim 场景（至少 boot + sprint，覆盖任务池活跃期）对每个旧池录制任务产出快照：任务类型、目标结构类别、数量档位、触发频率；
2. **取对照**：退役后在同场景同 seed 对任务板同语义任务录制相同字段；
3. **判差集**：旧快照中每条语义在新快照中必须有覆盖（按映射表的承载行列判定）；允许新快照多出（改进），不允许旧语义缺失；
4. **落档**：对照结论写入 `docs/bugs/` 摸底档（0.3 建立）的对应小节，差集每项登记处置结论。

#### Scenario: 快照对照执行留档

- **WHEN** 域 1/2/3 任一切片的验证步骤执行
- **THEN** 摸底档存在对应小节，含两份快照与差集结论

#### Scenario: 旧语义缺失即切片失败

- **WHEN** 对照发现某旧池语义在新任务板中无覆盖且未登记处置结论
- **THEN** 该切片验证不通过，必须补齐供给或修订映射表（经 spec 修订）后再删除

### Requirement: 按房间的任务产出只在计划阶段由模块承担

任务产出 MUST 全部发生在 planning 阶段的 TickModule 内；`RoomFeatures` 的 per-room 特性链 MUST NOT 再调度任何任务产出型更新器（`MissionUpdate` 调用点删除）。`RoomFeatures` 保留的职责收敛为：结构状态维护、旗标链、能量状态（若 5.1 裁定保留）——不含任务产出。

#### Scenario: 计划阶段写入可全归因

- **WHEN** 检查某 tick 任务板的新增任务来源
- **THEN** 每条 upsert 都归因到已声明的 planning 模块（economy planners / defense / spawning / expansion），无原型挂载点来源

#### Scenario: 供给不饥饿

- **WHEN** `MissionUpdate` 入口摘除后跑全场景门
- **THEN** RCL 时间线逐位一致，不出现任务饥饿导致的停摆（绿门转红即回退）

### Requirement: Memory 迁移按波合并、纯函数、幂等

Memory schema 版本递增 MUST 按波合并（A 波 v12→v13 一次，C 波若删 `OutMineData` 等再 v13→v14 一次），MUST NOT 每池一版本。迁移函数 MUST：纯函数（不读全局可变量）、幂等（同存档二次执行无变化无报错）、一次删净被废弃结构（不留悬挂键）、坏条目剔除。迁移 MUST 有 schema 单测 + `run-residue` 场景验证。

#### Scenario: 旧存档升级无残留

- **WHEN** 用含 `Memory.MissionPools` 的旧存档启动新版本
- **THEN** 迁移后 `MissionPools` 键不存在，任务板数据完整可读

#### Scenario: 幂等重放

- **WHEN** 同一存档连续两次执行迁移
- **THEN** 第二次不改变任何字段且不报错

#### Scenario: 回退安全

- **WHEN** 迁移后回退到旧代码
- **THEN** 旧代码对缺失的池结构惰性重建（`??=` 模式），不抛错

### Requirement: 人工目标数据必须明确归属

仅由人工操作写入的目标数据（`Memory.OutMineData` 人操目标等）在退役时 MUST 按下列二选一处置并留档：（一）迁入任务板（对应目标能产出可分配任务，人操入口行为不变）；（二）随所属域一并删除（人操入口同步删除或改指新实现，帮助文案更新）。MUST NOT 出现「池已删除但目标仍被写入」的悬挂写入。

#### Scenario: 悬挂写入被检出

- **WHEN** 任务池结构已删除但仍有代码写入原人工目标结构
- **THEN** 全仓扫描检出该写入，判定缺陷并要求清理或迁移

#### Scenario: 迁入后目标可被消费

- **WHEN** 人工目标迁入任务板
- **THEN** 对应目标产出可分配任务，console 入口语义与迁移前一致
