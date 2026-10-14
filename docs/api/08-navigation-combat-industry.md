# API-08：导航、战斗、扩张与工业 API

## 8.1 导航 API

```ts
export interface RoutePolicy {
  allowRooms?: string[];
  avoidRooms?: string[];
  avoidHostileRooms: boolean;
  plainCost: number;
  swampCost: number;
  maxOps: number;
  maxRooms: number;
  flee?: boolean;
}

export interface NavigationService {
  findRoomRoute(fromRoom: string, toRoom: string, policy: RoutePolicy): RoomRoute | undefined;
  findPath(origin: SerializedPosition, goals: PathGoal[], policy: RoutePolicy): PathPlan;
  nextStep(creepName: string, plan: PathPlan): DirectionConstant | undefined;
  invalidateTarget(targetId: string): void;
  invalidateRoom(roomName: string): void;
  detectStuck(unit: UnitView, now: number): boolean;
}
```

这些是项目 API，不是 `PathFinder` 原生签名。具体 `PathFinder.search` 参数、`PathFinder.CostMatrix` 方法和返回字段必须从官方 API Reference 与锁定类型定义获取。

路径系统要分两层：

- `RoomGraph`：房间之间的战略路线、边界、威胁、已知可达性与跨房间代价。
- `CostMatrix`：单个房间内道路、墙、建筑、危险格和拥堵格的局部代价。

缓存键应包括起点/目标范围、路线策略版本、地形/建筑变更版本及危险策略版本。不能仅以 creepName 做唯一缓存；也不能假设路径在建筑改变后仍有效。

移动失败应形成状态迁移：目标不可见或失效、路径不完整、被阻挡、跨房间边界、交通拥堵、疲劳等分别处理。不要让一个“卡住”的检测直接不断提升移动成本而永远不重规划。

## 8.2 Traffic Manager

```ts
export interface TrafficManager {
  reserveStep(creepName: string, from: SerializedPosition, to: SerializedPosition, priority: number): boolean;
  resolveConflicts(plans: readonly MovementPlan[]): readonly MovementPlan[];
  recordOutcome(results: readonly ActionResult[], nextObservation: WorldObservation): void;
  releaseExpired(now: number): void;
}
```

交通管理只是一种预测和协调；实际移动冲突仍由游戏引擎规则结算。设计要允许错开拥堵、提高固定道路流量和避免互相顶住，但不能把本地预订等同于引擎保证。

## 8.3 Defense / Threat Model

```ts
export interface ThreatObservation {
  roomName: string;
  tick: number;
  hostileCreepCount: number;
  hostileStructureCount: number;
  estimatedIncomingDamage: number;
  estimatedFriendlyHealing: number;
  criticalTargets: string[];
}

export interface ThreatModel {
  observe(ctx: TickContext, world: WorldView): void;
  scoreRoom(roomName: string, now: number): number;
  proposeEmergencyTasks(ctx: TickContext, world: WorldView): readonly NexusTask[];
}

export interface DefensePlanner {
  chooseSafeModeAction(roomName: string, threat: ThreatObservation, world: WorldView): boolean;
  assignTowers(roomName: string, threats: readonly ThreatObservation[]): readonly ActionPlan[];
  createSquadPlan(roomName: string, objective: string): SquadPlan | undefined;
  shouldRetreat(squad: SquadState, threat: ThreatObservation): boolean;
}
```

Threat score 必须区分可见敌人与过期情报；玩家敌人、NPC Invaders、Keeper、Invader Core 与特殊房间机制不可粗暴合并为同一种威胁。防御模块应评估威胁、关键设施、撤离路径、塔能源和友方治疗，而不是“看见敌人就全员冲锋”。

Safe Mode 的使用条件、可用次数、冷却与效果应根据实际 `StructureController` 属性和官方防御说明判断；禁止依赖一个硬编码“敌人数量大于 N 就启动”的唯一条件。

## 8.4 扩张与侦察

```ts
export interface ExpansionScore {
  roomName: string;
  resourcePotential: number;
  travelCost: number;
  threatCost: number;
  infrastructureCost: number;
  controllerCost: number;
  intelPenalty: number;
  strategicValue: number;
  netValue: number;
}

export interface ExpansionPlanner {
  requestScouting(ctx: TickContext, targets: readonly string[]): readonly NexusTask[];
  scoreRoom(roomName: string, world: WorldView): ExpansionScore;
  planExpansion(ctx: TickContext, world: WorldView): readonly ExpansionOrder[];
  reevaluate(world: WorldView, now: number): void;
}
```

扩张评估至少考虑资源与矿物、交通、敌方风险、周边空间、控制等级、采集点可停留位置、运输所需 Creep 数量、可用 Spawn 与后备能源。未知信息使用 `intelPenalty` 扣分，并触发侦察，而不是默认房间安全。

## 8.5 工业与市场

工业系统采用请求/配方/输入输出计划，不应让 Lab/Factory/Terminal 模块各自私占库存。

```ts
export interface IndustryOrder {
  id: string;
  kind: "lab_reaction" | "boost" | "factory_produce" | "terminal_send" | "market_deal";
  roomName: string;
  inputs: Partial<Record<ResourceConstant, number>>;
  outputs: Partial<Record<ResourceConstant, number>>;
  priority: number;
  deadline?: number;
  reservationIds: string[];
  status: "planned" | "reserved" | "running" | "completed" | "failed";
}

export interface IndustryPlanner {
  planLabReactions(ctx: TickContext, world: WorldView): IndustryOrder[];
  planBoosts(ctx: TickContext, world: WorldView): IndustryOrder[];
  planFactoryProduction(ctx: TickContext, world: WorldView): IndustryOrder[];
  planTerminalTransfers(ctx: TickContext, world: WorldView): IndustryOrder[];
  planMarketDeals(ctx: TickContext, world: WorldView): IndustryOrder[];
}
```

工业请求必须关联 EconomyLedger 预留；执行前按原生 API 确认反应配方、结构状态、资源、冷却、终端容量、交易费用、订单有效性、市场限制和成交上限。不要在规划期间就假设输入已消费或输出已生成。

## 8.6 施工与布局接口

```ts
export interface ConstructionPlanner {
  selectRoomBlueprint(roomName: string, constraints: RoomConstraints): RoomBlueprint | undefined;
  queueConstruction(blueprint: RoomBlueprint, roomName: string): void;
  prioritizeSites(ctx: TickContext, world: WorldView): readonly BuildTaskSpec[];
  prioritizeRepairs(ctx: TickContext, world: WorldView): readonly RepairTaskSpec[];
}
```

施工计划必须检查 RCL/结构数量限制、地形与占位冲突、construction site 数量限制、可用施工位置与道路 ROI。结构蓝图应有版本号；升级蓝图时要迁移施工队列而不是把旧任务无限保留。
