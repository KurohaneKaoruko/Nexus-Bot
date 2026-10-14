# API-07：经济账本、物流与 Spawn API

## 7.1 经济系统的三个概念

1. **Observed Inventory**：当前可见对象上的实际库存。
2. **Reserved Inventory**：为未来任务预留、尚未扣除的数量。
3. **Committed Flow**：已安排的输入/输出/生产/运输量。

它们不能合并成一个 `energy` 数字。“资源存在”不意味着它可自由使用，也不意味着它能在需要的 Tick 到达正确房间。

## 7.2 Resource Ledger

```ts
export interface ResourceReservation {
  id: string;
  owner: string;
  roomName: string;
  storeId?: string;
  resourceType: ResourceConstant;
  amount: number;
  createdAt: number;
  expiresAt: number;
  status: "reserved" | "committed" | "released";
}

export interface ResourceRequest {
  id: string;
  owner: string;
  roomName: string;
  resourceType: ResourceConstant;
  amount: number;
  priority: number;
  deadline?: number;
}

export interface EconomyLedger {
  getAvailable(roomName: string, resourceType: ResourceConstant): number;
  reserve(request: ResourceRequest, now: number, ttl: number): ResourceReservation | undefined;
  commit(reservationId: string, amount: number, now: number): boolean;
  release(reservationId: string, reason: string, now: number): boolean;
  expire(now: number): number;
  reconcile(observed: InventorySnapshot, now: number): LedgerSummary;
}
```

合同：

- 可用量 = 已观测实际量 − 有效预留 − 安全储备；不得小于 0。
- 预留操作必须幂等，并防止同一请求重复预留。
- 实际观测发生变化时，使用新的库存快照 reconcile；不要把旧库存作为当前真值。
- 任务取消或超时后释放预留。
- 跨房间 Terminal 运输要预留资源与交易能源，并考虑 Terminal 冷却和运输到达情况。
- 市场请求还要预留 Credits、交易费用及每 Tick 成交次数等限制，细节参照官方 [Market API/Market System](https://docs.screeps.com/market.html)。

## 7.3 InventorySnapshot

```ts
export interface StoreInventory {
  objectId: string;
  roomName: string;
  amounts: Partial<Record<ResourceConstant, number>>;
  capacities: Partial<Record<ResourceConstant, number | null>>;
}

export interface InventorySnapshot {
  tick: number;
  stores: StoreInventory[];
}
```

这是供账本使用的轻量摘要。容量优先由对应 Store 方法/对象属性读取，不应把所有结构的容量规则硬编码为统一值。

## 7.4 Logistics API

```ts
export type LogisticsIntentKind = "fetch" | "deliver" | "relocate";

export interface LogisticsRequest {
  id: string;
  kind: LogisticsIntentKind;
  fromId?: string;
  toId?: string;
  roomName: string;
  resourceType: ResourceConstant;
  amount: number;
  priority: number;
  deadline?: number;
  reservationId?: string;
}

export interface LogisticsPlanner {
  buildRequests(ctx: TickContext, world: WorldView): readonly LogisticsRequest[];
  estimateTrip(request: LogisticsRequest, unit: CapabilityProfile): number | undefined;
  reconcileRequests(now: number): void;
}
```

运输规划不应只按“谁离能量最近”分配，还要考虑装载容量、到达时间、目标存储空间、往返距离、Source 产出节奏以及路径拥堵。固定矿工站和固定容器可减少无效移动；搬运需求应围绕生产和消费节点建模。

## 7.5 Spawn API

```ts
export interface SpawnRequest {
  id: string;
  purpose: string;
  homeRoom: string;
  targetRoom?: string;
  taskId?: string;
  priority: number;
  energyBudget: number;
  requiredCapabilities: string[];
  desiredThroughput?: number;
  expectedTravelTicks?: number;
  safetyMarginTicks?: number;
  replacementFor?: string;
  expiresAt?: number;
}

export interface BodyPlan {
  body: BodyPartConstant[];
  energyCost: number;
  estimatedSpawnTicks: number;
  capabilities: CapabilityProfile;
}

export interface BodyFactory {
  plan(request: SpawnRequest, roomEnergy: number, constraints: BodyConstraints): BodyPlan | undefined;
}

export interface SpawnDirector {
  enqueue(request: SpawnRequest): void;
  cancel(requestId: string, reason: string): boolean;
  reconcile(ctx: TickContext, world: WorldView): void;
  plan(ctx: TickContext, world: WorldView): readonly SpawnCommand[];
}
```

`BodyConstraints` 和 `SpawnCommand` 应在项目中明确定义，例如最大 Body 部件数、需求能力最小值、允许的部件比例、预留能源线与命名策略。`energyCost` 要依据当前身体部件成本计算或由经过测试的函数生成；不得仅凭角色模板填入常数。

Spawn 流程：

1. 通过任务和库存模型计算能力缺口。
2. 创建带去重键与过期时间的 `SpawnRequest`。
3. BodyFactory 根据预算和任务吞吐量生成候选身体。
4. SpawnDirector 选择可用 Spawn 与能源来源，检查请求合法性。
5. 生成唯一 creep 名称并调用原生 spawn API。
6. 依据真实返回码更新请求；成功时记录对应任务、出生 tick 和替补关系。
7. 失败时区分忙碌、资源不足、身体非法、名称冲突、目标无效等原因。

不要将“现在有多少钱”作为 Spawn 的唯一决策指标；要计算生成时间、旅行时间、任务收益和已有单位的剩余寿命。

## 7.6 生命周期与替补

```ts
export interface LifecycleManager {
  scan(ctx: TickContext, world: WorldView): LifecycleEvent[];
  requiredReplacementTick(unit: UnitView, task: NexusTask): number | undefined;
  createReplacementRequest(event: LifecycleEvent): SpawnRequest | undefined;
}
```

替补应提前计划：普通 Creep 有固定寿命（常规 Creep 1,500 Tick，某些特殊类型例外，必须以官方规则为准），远程单位还需要把 travel time 计入。若替补生产太早，会浪费能源和人口配额；太晚则导致工作空窗。策略应按岗位生产率和单元到位时间校准。
