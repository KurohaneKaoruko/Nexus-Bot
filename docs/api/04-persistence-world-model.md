# API-04：持久化、数据迁移、Perception 与 World Model

## 4.1 持久化职责

Screeps 每个 Tick 都会重新生成运行时的 `Game` 快照。可跨 Tick 保存的数据放入 `Memory`（或在需要时使用 `RawMemory` segment）。只存 JSON 兼容的持久数据，不存函数、闭包、原生对象实例或循环引用。

```ts
export interface NexusMemory {
  schemaVersion: number;
  global: GlobalMemory;
  rooms: Record<string, RoomIntelMemory>;
  tasks: Record<string, TaskMemory>;
  units: Record<string, UnitMemory>;
  economy: EconomyMemory;
  navigation: NavigationMemory;
  operations: OperationsMemory;
  telemetry: TelemetryMemory;
}
```

正式代码应把以上接口与 `declare global` 中的 `Memory` 类型对接，但不能同时维护互相矛盾的两份全局 schema。

## 4.2 Bootstrap / Migration API

```ts
export interface MemoryMigration {
  readonly from: number;
  readonly to: number;
  migrate(input: unknown): unknown;
}

export interface MemoryBootstrap {
  load(raw: unknown): NexusMemory;
  migrate(raw: unknown): NexusMemory;
  validate(memory: unknown): memory is NexusMemory;
  compact(memory: NexusMemory, now: number): void;
}
```

规范：

- `schemaVersion` 必须单调递增；迁移按连续版本顺序执行，不允许静默跳过中间迁移。
- 迁移必须幂等或保证每次只执行一次，并且对字段缺失、旧字段、错误类型有确定策略。
- 遇到不可恢复的数据时，优先保留安全关键与可重建信息；无效任务可以重建，历史遥测可降级丢弃，不能让非法记忆导致整个 Bot 永久崩溃。
- Bootstrap 不应进行全地图昂贵扫描。
- 每个顶层 Memory 区域必须有清理策略、最大记录数或过期时间。

## 4.3 World Observation 与 World View

```ts
export interface WorldObservation {
  tick: number;
  visibleRooms: RoomObservation[];
  aliveUnits: UnitObservation[];
  visibleThreats: ThreatObservation[];
}

export interface WorldView {
  atTick: number;
  visibleRooms: ReadonlyMap<string, VisibleRoomView>;
  intelRooms: ReadonlyMap<string, RoomIntelView>;
  units: ReadonlyMap<string, UnitView>;
  threatLevel(roomName: string): number;
  getRoom(roomName: string): RoomKnowledge | undefined;
}
```

若目标工程不希望在运行时使用 `Map`，可改用只读记录类型；关键是暴露只读视图并避免业务模块各自重复扫描 `Game`。

观察与情报必须区分：

- `visible`: 本 Tick 实际有视野，可以读取当前游戏对象；
- `remembered`: 上一次有视野的观测摘要；
- `inferred`: 从路径、敌方行为或周边情况推断；
- `unknown`: 从未观察或信息不足。

所有 remembered / inferred 数据必须带 `lastSeen` 或 `computedAt` 和置信度/过期等级。未看见敌人不代表当前安全。

## 4.4 Perception API

```ts
export interface Perception {
  collect(ctx: TickContext): WorldObservation;
}

export interface RoomObservation {
  roomName: string;
  tick: number;
  controller?: ControllerObservation;
  sources: SourceObservation[];
  minerals: MineralObservation[];
  structures: StructureObservation[];
  creeps: UnitObservation[];
  droppedResources: DroppedResourceObservation[];
  constructionSites: ConstructionSiteObservation[];
}
```

具体 Observation DTO 应保存原始 API 对象的必要字段和 ID；禁止把 Room/Source/Creep 实例直接放进 DTO 再持久化。

性能规则：

- 每 Tick 每房间尽量收集一次，后续模块读取共享摘要。
- 只收集业务实际使用的字段；昂贵或低频信息延迟获取。
- 发现对象死亡/消失后，通过当前可见事实更新数据库；房间不可见时不能仅因对象未出现在 `Game` 里就立即认定它已死亡。
- Creep 是本方活动机体的集合；死亡任务回收以单位记录、租约和可见事实共同判断，不使用单一查询做强结论。

## 4.5 Intel Freshness

```ts
export type IntelConfidence = "fresh" | "aging" | "stale" | "unknown";

export interface RoomIntelMemory {
  roomName: string;
  lastSeen: number;
  ownerUsername?: string;
  reservationUsername?: string;
  controllerLevel?: number;
  sources: Array<{ id: string; x: number; y: number }>;
  mineral?: { id: string; type: string; x: number; y: number };
  exits: Partial<Record<1 | 3 | 5 | 7, string>>;
  threatScore: number;
  threatLastSeen?: number;
  confidence: IntelConfidence;
}
```

示例字段是项目 schema，不是 `Room` 原生对象形状。位置数据采用序列化的 `x/y/roomName`，而非 RoomPosition 实例。

建议 Freshness API 使用可配置阈值而不是散落常数。核心策略：情报越旧，风险评估越保守；对高价值扩张和驻军撤离应主动重侦察。

## 4.6 Room Knowledge 的只读接口

```ts
export interface RoomKnowledge {
  roomName: string;
  source: "visible" | "memory" | "inferred";
  lastSeen: number;
  confidence: IntelConfidence;
  threatScore: number;
  canUseForExpansion: boolean;
  canUseForMining: boolean;
}
```

`canUseForExpansion` 与 `canUseForMining` 必须包含情报新鲜度、路线可达性、敌方威胁、资源潜力和己方经济承受能力；不要只用“房间曾经可见”判断。
