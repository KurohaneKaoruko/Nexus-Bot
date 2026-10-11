# Spec Delta

## Purpose

任务属于蜂群而非某只 Creep：TaskBoard 维护任务生命周期与租约，Allocator 以能力画像把任务匹配给合适的机体，并抑制无意义的任务切换。

## ADDED Requirements

### Requirement: 任务创建与去重
任务必须以去重键（`kind:room:targetId` 形式）幂等创建：同一意图的重复提案合并为同一任务（更新字段而非新建），不同意图不得互相覆盖。

#### Scenario: 重复提案合并
- **WHEN** 同一去重键的任务在任务存续期内被再次提案
- **THEN** 既有任务被更新（如优先级、截止），不产生第二条记录

#### Scenario: 跨类型互不覆盖
- **WHEN** 同一目标上产生不同 kind 的任务（如 upgrade 与 repair）
- **THEN** 两条任务并存，互不去重

### Requirement: 任务状态机
任务生命周期必须只走合法迁移：available → leased → in_progress → completed；leased/in_progress 可回到 available（释放/租约到期/可恢复失败）；达到失败上限进入 failed；战略取消进入 cancelled。终态不得自动复活。

#### Scenario: 非法迁移被拒绝
- **WHEN** 对 completed 任务调用 claim 或对 cancelled 任务调用 complete
- **THEN** 操作被拒绝且任务状态不变

#### Scenario: 失败上限
- **WHEN** 同一任务累计失败次数达到其类型上限
- **THEN** 任务进入 failed 终态，不再被分配，计入指标

### Requirement: 租约与持有者校验
分配必须写入持有者与租约到期 Tick；只有当前持有者可以心跳、报告进展、完成或释放任务；租约到期后任务自动回到可分配状态并清除旧持有指针。

#### Scenario: 非持有人操作被拒
- **WHEN** 非当前持有者的 Creep 对任务执行心跳或完成
- **THEN** 操作被拒绝

#### Scenario: 租约过期回收
- **WHEN** 任务租约到期且未续约
- **THEN** 任务回到 available，持有指针清除，可被重新分配

### Requirement: 死亡与失效回收
对账（reconcile）必须结合存活表与观测：持有者死亡的任务立即释放；目标失效或已被达成（如工地建成、Spawn 已满）的任务被清理或终结；所有回收都更新统计，不得产生孤儿租约。

#### Scenario: 死亡后任务回池
- **WHEN** 持有任务的 Creep 被观测确认死亡
- **THEN** 其任务回到 available（或按价值取消），替补需求被更新

#### Scenario: 目标达成即终结
- **WHEN** 建造任务的工地已建成
- **THEN** 任务进入 completed 终态而不是继续存在

### Requirement: 分配硬过滤与评分
分配必须先做硬性资格过滤（存活、非 spawning、身体部件满足任务能力、TTL 足够、目标房间可达、目标容量未满），再按 criticality/urgency/utility/capabilityFit 与 travel/risk/switch 成本评分排序；不可执行的候选不得依赖扣分排除。

#### Scenario: 无能力不分配
- **WHEN** Creep 身体不含任务所需部件（如无 CARRY 的任务需要搬运）
- **THEN** 该 Creep 不进入该任务的候选集

#### Scenario: 容量已满不指派
- **WHEN** 任务目标（如 Spawn 补给）的剩余容量为零
- **THEN** 任务不参与本轮分配

#### Scenario: 按评分排序分配
- **WHEN** 多个候选竞争同一任务
- **THEN** 综合评分最高者获得租约，分配原子生效

### Requirement: 分配防抖动
任务切换必须付出代价：新任务的评分优势必须超过切换阈值（含切换成本）才发生切换，紧急任务可无条件抢占；持有中的任务有最短持有时间。系统不得出现单位长期在任务间抖动而无所产出。

#### Scenario: 微小优势不切换
- **WHEN** 新任务评分仅略高于当前持有任务且低于切换阈值
- **THEN** Creep 维持当前任务

#### Scenario: 紧急任务抢占
- **WHEN** 出现 criticality 显著更高的任务（如 Spawn 断能）
- **THEN** 持有者可被立即切换，不受最短持有限制
