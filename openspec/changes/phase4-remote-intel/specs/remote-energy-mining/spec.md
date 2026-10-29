# Spec Delta

## Purpose

外矿能源闭环：active 外矿的源由驻点采集体采入工位容器，外矿搬运体经 quota 主干送回母房，预定体维持控制器预定；任务归属母殖民地，Allocator 按殖民地分配，定编按殖民地记账。

## ADDED Requirements

### Requirement: 任务归属与去重
外矿任务的 `roomName` 必须是母房，dedupeKey 以 `remote:` 为前缀并包含母房与目标标识；外矿暂停或剔除时其任务必须被取消。

#### Scenario: 同一源不重复
- **WHEN** 规划器连续多次为同一外矿源生成采集任务
- **THEN** 任务板中该源只有一条存活的采集任务

### Requirement: 工位容器
每个 active 外矿源旁必须有且只有一个容器（工地或已建成）。采集体工地存在时优先建造；容器建成后采集并卸入容器；容器耐久低于阈值时就地维修。

#### Scenario: 首次到岗
- **WHEN** 采集体到达外矿源工位且源旁没有容器
- **THEN** 规划器已放置容器工地，采集体先采后建

#### Scenario: 稳态
- **WHEN** 容器已建成
- **THEN** 采集体不离开工位，满载即卸入容器

### Requirement: 外矿搬运与母房交付
外矿搬运任务的取货端是外矿容器，交付端必须由 quota 主干在母房分配；交付量记入账本 `remote:<home>:<room>` 速率键。

#### Scenario: 交付
- **WHEN** 外矿搬运体满载回到母房
- **THEN** 交付到 quota 分配的母房目的地，账本记录该外矿房的交付量

#### Scenario: 不跨殖民地交付
- **WHEN** 另一个己方房的 spawn 有空位
- **THEN** 外矿搬运体仍只交付到母房

### Requirement: 预定
满足预定条件的 active 外矿房，在预定剩余低于刷新阈值时必须生成预定任务；预定动作经 ActionBroker 的 `reserveController` 提交。

#### Scenario: 刷新预定
- **WHEN** 外矿房本方预定剩余低于 `REMOTE_CONFIG.reserveRefreshBelow`
- **THEN** 生成预定任务，由 `reserver` 单位执行

### Requirement: 殖民地资格
Allocator 必须以单位的 `homeRoom` 等于任务 `roomName` 作为跨房资格条件（`claim` 例外保留）；跨房路程取外矿记录中的路程。

#### Scenario: 外矿房内续接
- **WHEN** 外矿采集体在外矿房完成容器建造
- **THEN** 它可以直接被分配同殖民地的采集或维修任务，无需回到母房

### Requirement: 按殖民地定编
外矿的 harvester / carrier / scout / reserver 需求必须按母房计算，只由母房 spawn 承接；单殖民地时家内定编结果与变更前一致。

#### Scenario: 单殖民地等价
- **WHEN** 只有一个己方房且无 active 外矿
- **THEN** 各角色编制与变更前相同

### Requirement: 外矿能量的去处
外矿能量交付进母房 quota 主干，storage 为兜底目的地；家内升级定编通过既有的 storage 水位 / 盈余项消化外矿收入，不修改家内采集收入口径。

#### Scenario: spawn 与 extension 已满
- **WHEN** 外矿搬运体满载回到母房且 spawn / extension 均满
- **THEN** 能量交付到 storage，搬运体不原地持能等待

### Requirement: 清扫豁免
家内经济规划器的「主体消失」清扫不得取消 `remote:` 前缀的任务；外矿任务的取消只由外矿规划器负责。

#### Scenario: 跨 tick 稳定
- **WHEN** 外矿采集任务已被认领
- **THEN** 下一 tick 家内经济规划器运行后，该任务 id 与租约不变

### Requirement: 外矿单位隔离
外矿单位在孵化时必须带外矿标记；外矿任务只分配给同殖民地、带标记的单位，家内任务只分配给不带标记的单位；scout 与 reserver 只接外矿任务。

#### Scenario: 家内矿工不外派
- **WHEN** 家内 harvester 空闲且有外矿采集任务可用
- **THEN** 家内 harvester 不被分配该任务

### Requirement: 外矿角色可孵化
主线孵化器必须能孵化 scout 与 reserver：二者进入孵化单位集合与体型工厂，侦察与预定任务各自映射到对应单位。

#### Scenario: 侦察需求
- **WHEN** 存在未被认领的外矿侦察任务
- **THEN** 主线孵化器产出 scout 单位
