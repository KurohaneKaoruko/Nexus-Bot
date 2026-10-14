# Tasks

## 1. Memory v2 与任务类型

- [x] 1.1 实装 v2 schema：`NexusTask` DTO（api/05 §5.2 字段）、`UnitRecord`（name/roleCode/homeRoom/bornAt/lastTaskChange）、`NewTaskInput` 创建合同；`CURRENT_SCHEMA_VERSION = 2`。验证：tsc 通过
- [x] 1.2 编写 `migrateV1ToV2`：为存量 v1 的 tasks/units 补默认结构，幂等纯函数。验证：单测覆盖 v1→v2 升级、重复执行幂等、迁移计数递增
- [x] 1.3 TaskKind 注册表：五类实装（harvest/haul/fill_spawn/upgrade/build）+ 战斗类占位，集中定义去重键约定与 `LeasePolicy`（按 kind 的租约与失败上限）。验证：单测覆盖去重键格式与策略读取

## 2. 感知与世界模型

- [x] 2.1 实现 `src/modules/world/` 感知模块：一次聚合 Source/能量结构/Container/落地资源/工地/本方 Creep 摘要为 `WorldView`（纯数据，挂 TickContext）。验证：单测以 stub 房间断言快照字段完整且不重复扫描
- [x] 2.2 Intel 增量更新：可见房间更新 lastSeen/置信度/SourceIds，不可见降置信但保留。验证：单测覆盖可见更新与不可见降置信
- [x] 2.3 死亡与失效发现：对比前后 Tick 本方 Creep 集合产出死亡信号；目标 ID 解析失败产出失效信号。验证：单测覆盖死亡信号与失效信号触发回收入口

## 3. TaskBoard

- [x] 3.1 实现 `src/modules/tasks/taskBoard.ts`：upsert（dedupeKey 幂等）、get/list 查询、claim/heartbeat/markProgress/complete/fail/release/cancel，含持有人校验与合法迁移表。验证：单测覆盖去重合并、非法迁移拒绝、非持有人拒绝
- [x] 3.2 租约与失败上限：按 kind 的 leaseTicks 与 maxAttempts，租约到期自动回 available 并清指针，达上限入 failed 终态。验证：单测覆盖过期回收与失败封顶
- [x] 3.3 reconcile：结合存活表与观测信号回收死亡持有者、失效目标、已达成目标（工地建成/满仓），输出统计。验证：单测覆盖死亡回收、目标达成终结、无孤儿租约

## 4. Allocator

- [x] 4.1 CapabilityProfile：由身体部件计算 work/carry/move/ttlRemaining 等，按 creep 名当 Tick 缓存。验证：单测覆盖部件→画像映射
- [x] 4.2 硬过滤与贪心分配：部件/spawning/TTL/容量/房间过滤 → 评分（权重集中于配置）→ 原子 claim。验证：单测覆盖无能力不分配、满容不分配、按分排序
- [x] 4.3 防抖动：切换需评分优势超阈值或 criticality 抢占；最短持有时间。验证：单测覆盖微小优势不切换与紧急抢占

## 5. Agent 与 ActionBroker

- [x] 5.1 AgentSystem：按任务 kind 产出 ActionPlan（范围外自动附 move 计划，双管线并行）。验证：单测覆盖 harvest/upgrade/haul/transfer 的计划形态
- [x] 5.2 ActionBroker：管线表（move/work/carry/controller）同 actor 同管线择优、跨管线并行；行动前校验（存活/租约/目标/部件/容量/范围）。验证：单测覆盖冲突抑制与跨管线并行
- [x] 5.3 返回码分流与提交：commit 统一调用原生 API，返回码分类（accepted/retryable/replan/invalid）并反馈任务系统；提交外零原生调用。验证：单测以 stub Creep 断言调用仅发生在 commit、NOT_IN_RANGE 分类 retryable、INVALID_TARGET 触发 replan

## 6. 经济任务源

- [x] 6.1 harvest/upgrade 规划器：按 Source 稳定任务（容量=相邻可行走格）、upgrade 常驻任务。验证：单测覆盖去重、容量互斥、常驻不堆积
- [x] 6.2 fill_spawn/haul 规划器：供能结构缺量生成补给任务（最高优先级），容器/落地能量到缺口的搬运任务，满仓终结。验证：单测覆盖缺货生成、满仓清理
- [x] 6.3 build 规划器与政策序：工地驱动建造任务；劳动力紧缺时 build/upgrade 让位于补给采集（评分 criticality 政策）。验证：单测覆盖工地终结、紧缺让位

## 7. SpawnDirector 与 BodyFactory

- [x] 7.1 缺口聚合：扫描未分配任务的 requiredCapabilities 生成去重的 SpawnRequest，缺口消失即撤销。验证：单测覆盖请求生成与撤销
- [x] 7.2 BodyFactory：universal/harvester/carrier/worker/upgrader 模板 × min/std/max，按预算扩展缩减，低于最低成本不生产。验证：单测覆盖三档边界与预算裁剪
- [x] 7.3 生产排程：房间队列按优先级消费，spawning 完成时间纳入排程，能量不足等待不空转。验证：单测覆盖优先级排序与等待
- [x] 7.4 替补窗口与死亡回收：lead = 3×部件 + 旅行估算 + 余量；死亡信号触发 UnitRecord 终结、租约释放、替补请求立即生效；命名走 `utils/naming`。验证：单测覆盖临期替补与死亡回收链路

## 8. 集成与 Phase 1 验收

- [x] 8.1 注册全部模块（含变体开关默认启用）并扩展 HUD：任务数按状态、Creep 按代号、Spawn 队列与闲置。验证：`npm run typecheck` + `npm test` 全绿
- [x] 8.2 上传 xx-local 冒烟：v1→v2 迁移执行、放置 Spawn 后 universal 起步、闭环逐步建立。验证：控制台核对迁移日志、任务出现、首批 Creep 出生并执行任务
- [x] 8.3 能源闭环 soak：数千 Tick 观察 Spawn 不断能、无重复无限任务、死亡回收、缺货自愈、无抖动停摆。验证：HUD/遥测指标 + 控制台零未捕获异常，对照 docs/nexus-design/14 Phase 1 验收清单逐项通过
