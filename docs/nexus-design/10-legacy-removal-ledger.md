# Legacy 删除门禁台账（任务 9.1，specs/legacy-removal-gate）

> 四条件门禁：删除任何 legacy 实现前必须四条件齐备并在此登记验证记录。
> 每次删除一个最小可回退单元（一个职责域），跨域批量删除被拒。
> 台账只增不改；回退需显式记录决策。

## 门禁四条件

1. **Nexus 等价存在**：接管职责的新实现已存在并在生产路径生效；
2. **实服验证**：对应行为在实服正常（本仓库口径 = 私服 47.100.24.220 一个 4wt 重置周期观察）；
3. **sim 验证**：对应场景全场景门绿（`scripts/sim-matrix.mjs`）；
4. **CPU 验证**：接管后 cpu p95 不劣化（同场景对比，劣化 > 2ms 拒绝）。

## 台账

| 日期 | 删除单元（域） | 豁免清单变化 | 四条件证据 | 结果 |
|---|---|---|---|---|
| 2026-10-17 | external/mine suicide + roadBuilder destroy/remove 直连（6 调用） | 334→328（−6） | ① destroyStructure/removeSite/suicide kind 既有；② 未上实服（人操不可达路径，sim 内亦不可达）；③ race L2@796 bit 一致；④ p95 5.0ms 持平 | ✅ 已删（8.7） |

> 注：external 域 6 处为「直连收编」而非 legacy 角色删除，实服条件按「路径不可达 + sim 互证」口径豁免；9.2 的角色库删除必须四条件齐全才可执行。

| 2026-10-25 | `rooms[].energyState`（energyState/energyStateTick） | 保留为 RoomFeatures 基础状态 | 5.1 裁定：活消费方在——statistics HUD（`core/statistics.ts:335,428`）、rush 仲裁、external/mine 休眠链（`state.ts:135` 经 `getEnergyState` 读）；transportMission 消费随域 3.4 删除但不影响保留判定。不迁移 v13（`room.memory` 域与 Nexus 结构化域分治，非退役对象） | sim 四场景门 + run-residue（随 5.2 总对账） |
| 2026-10-25 | `economy/units/manager.ts` + `transporter.ts` 原型执行体（468 行）+ registry 两绑定 + UnitData 两 executor 字段 | 128→120（−8，P7 industry-adapter 条目随文件归零） | ① 等价存在：linkQuota（planLinkTransfer 语义）+ manageQuota（terminal 平衡）+ executor 原生结构兜底已入 planning 生产路径；② 实服待补（RCL5/6 域 sim 不可达，语义等价由纯核单测 14 条 + 语义源逐条对照承担）；③ 合并门八门全绿（六场景 GREEN 逐位一致 + run-residue/stronghold-door，见摸底档 O 节）；④ p95 持平（speedrun +1ms 容差内） | ✅ 已删（域 1.3） |
| 2026-10-25 | `economy/units/miner.ts` + `mission/updaters/mineMission.ts`（UpdateMineMission/UpdateHighwayScan 调度行）+ `utils/moveWork.ts`（末位消费者随 miner 亡） | 120→116（−4，miner 直连条目） | ① 等价存在：mineralWork.ts（543 行 14 条语义，元素矿定编/沉积矿/highway 轮询两链合一）已入 economy planning 生产路径；② 实服待补（miner 零孵化源，本房元素矿活链是 out-mineral 外矿人操链）；③ 删除确认门八门全绿（六场景 GREEN 逐位一致 + run-residue L2@1059/stronghold-door L8@0）；④ p95 持平 | ✅ 已删（域 2.3） |
| 2026-10-25 | `mission/` 六池全链：`index.ts`（Mission 调度壳）+ updaters 四件（transportMission/manageMission/workMission/boostMission，~1761 行）+ MissionSubmit 六池方法 + MissionPools 六池死函数/词表副本/死缓存 + `MissionConstant` 词表收缩 ['spawn'] + `mission.interface.d.ts` 死声明/死类型（638→~225 行）+ accessor TASK_TYPE_TO_POOL/sanitize 收缩 + creep-cache 死字段 + proto/Room 八 extend 收缩 | 116→116（删除文件零豁免条目；min 检查点不变） | ① 等价存在：六池语义已由域 1/2/3 planning 迁移承接（linkQuota/manageQuota/sendLedger/boostLedger/mineralWork/任务板 carry），本切片三处池活写入改任务板——boostLabWork lab 填充（`carry:boost:` 键，能量向可执行/矿物向 allocator 闸拒领待矿物执行分支）、factoryControl 产出回灌（`carry:factory:`）、console resource.task 人操（`carry:manual:`）；spawn 池链全保（TeamSpawner/spawnLoad/statistics/rush/ExpandController/external-mine 消费面逐点核证）；② 实服待补（lab/factory RCL6+ sim 不可达）；③ 删除确认门八门全绿：三绿门逐位 + 三分段门逐位（speedrun L4@28316/arena L3@11629/sprint L3@36171 与 3.2 接受值一致零新漂移）+ run-residue L2@1059/p95 4ms + stronghold-door L8@0/p95 5ms，参考快照随读数推进；④ p95 持平（race 8ms 为单次噪声，快照回 7ms） | ✅ 已删（域 3.4） |
| 2026-10-25 | `exec()` 双轨全链：`proto/Creep/runtime/{registry,execute}.ts`（roleRegistry 11 绑定 + CreepExecute 调度壳）+ proto/Creep 挂载行 + agentSystem exec() 分支/NEXUS_TASK_DRIVEN_CODES（13 码）+ capabilities legacyExecMode 开关 + CreepConstant executor 字段（35 处）/EXECUTORS 表 + creep.interface exec 声明 | 116→116（删除文件零豁免条目） | ① 等价存在：I 节调研实证 registry 11 绑定中 10 个零调用（defense 族零孵化源/teams 族 TeamController 直驱/out-* 原型系休眠），唯 aio 经 warSpawn AIO 旗（4.4 人操豁免链）有理论消费——H 节实证其 handler 语义未坏且行为树由 teams 域保留，warSpawn 孵 aio 属人操应急链（实服待补验证）；任务驱动 13 码 + rush-courier 直驱 + TeamController（team-* 4 码）+ PowerCreep 链（pc.exec 独立）承接全部驱动；② 实服待补（warSpawn 人操链 sim 不可达）；③ 删除确认门八门全绿逐位一致（六场景 sprint L3@36171 零漂移 + run-residue L2@1059/p95 4ms + stronghold-door L8@0/p95 5ms）；④ p95 持平 | ✅ 已删（域 4.1+4.2） |
