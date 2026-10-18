# 04. 世界模型、Intel 与持久化记忆

> ⚠ Memory 分层权威改向：Memory schema 字段表模板、NexusMemory 顶层结构与 Memory/Runtime 分界线已由 `docs/Nexus-Bot-01-架构设计.md` §24 承载（本篇保留 intel 与记忆分层的演进描述）。冲突时以 01 篇为准。

## 4.1 记忆分层

建议分四层管理数据：

1. **Live Snapshot**：`Game` 中本 Tick 可见的对象；只读临时使用。
2. **Tick Cache**：本 Tick 内可重用的对象列表、距离、能力画像等；Tick 结束即可丢弃。
3. **Persistent Memory**：需要跨 Tick 保留的任务、战略、房间 Intel、单位状态和资源承诺。
4. **Segmented/Arcnexus Data**：只有在确实需要保存大规模长周期数据时使用 RawMemory segments；低频读写并设置数据格式版本。

切勿将 live object（例如 `Creep`、`Room`、`Structure`）直接写入 Memory。保存对象 ID，使用时通过 API 重新获取，并容忍 ID 失效。

## 4.2 推荐 schema

这是概念 schema，实际接口可以按工程拆分。所有持久化结构都应保留 `schemaVersion`，并由统一迁移逻辑升级。

```ts
interface NexusMemoryV1 {
  schemaVersion: number;
  global: {
    posture: "survive" | "develop" | "expand" | "war";
    lastStrategicTick: number;
    goals: Record<string, number>;
    policy: {
      minEnergyReserve: number;
      expansionRiskTolerance: number;
    };
  };
  rooms: Record<string, RoomIntel>;
  tasks: Record<string, NexusTask>;
  units: Record<string, UnitRecord>;
  economy: {
    reservations: Record<string, ResourceReservation>;
    commitments: Record<string, number>;
  };
  routes: Record<string, RouteRecord>;
  metrics: MetricsSummary;
}

interface RoomIntel {
  lastSeen: number;
  confidence: number;          // 0..1; does not mean the room is currently visible
  owner?: string;
  reservation?: { owner: string; untilTick: number };
  rcl?: number;
  sourceIds: string[];
  mineralType?: string;
  threatScore: number;
  threatLastSeen?: number;
  exits: string[];
  estimatedRouteCost?: number;
}

interface UnitRecord {
  schemaVersion: number;
  homeRoom?: string;
  taskId?: string;
  bornAt: number;
  lastTaskChange: number;
  lastProgressTick?: number;
  blockedCount?: number;
  roleHint?: string;           // optional hint, never the source of capability truth
}
```

不要每 Tick 把所有 `Game.rooms` 重新序列化进 Memory。持久化 Intel 要按观察变化增量更新。

## 4.3 Intel 的新鲜度

对于每条可变化情报，记录 `lastSeen`，必要时带 `confidence` 和 `source`。

推荐策略示例（需按实际玩法调参）：

- 敌方 Creep 坐标：只视为当次观察结果；超过一个 Tick 就不再叫“实时坐标”。
- 房间 owner/reservation/RCL：可在一段时间内作战略估计，但要随着未观测时间增长降低置信度。
- 道路与建筑布局：被观测一次后相对稳定，但战争可能改变道路或建筑状态；路线缓存仍需要失效条件。
- Source 和 Mineral ID：只有当房间曾经可见且目标 ID 重新确认有效时才能使用；通过 API 找不到时要重新侦察。

“未知”“已知为空”“已知存在但过期”应是三个不同状态。

## 4.4 Memory schema 迁移

迁移流程：

1. 检查 `Memory.nexus` 是否存在。
2. 缺失时初始化当前 schema 的最小有效结构。
3. 低版本时逐版本迁移，不要直接把任意旧对象当作新类型。
4. 迁移失败时备份关键战略值（若可控），清理受影响的子系统并记录告警。
5. 迁移完成写入当前版本，避免每 Tick 重复迁移。

建议每个版本单独编写 `migrateV1ToV2` 等纯函数，并对样例 Memory 做单元测试。

## 4.5 Memory 膨胀与垃圾回收

需要维护的清理规则：

- 删除长时间没有对应 Creep 的 `units` 条目；但先检查这只单位的任务是否需要重新分配。
- 删除完成且超过保留期的任务；为排错只保留统计摘要，不保留无限事件记录。
- 丢弃过期 Route Cache 与低置信度 Intel；重要的敌对历史可保存聚合统计。
- 对历史指标只保留最近窗口、均值、分位数和计数等压缩值。
- 定期统计 JSON 序列化大小，并设置警戒阈值，不能等到 Memory 写入失败才处理。

官方文档说明主 Memory 容量有限（目前说明为 2 MB）。RawMemory segments 可作为扩展，但每段与激活规则也有限制，所以应以精简数据为第一原则。

## 4.6 跨 Shard 数据

若使用 InterShardMemory/Shard 相关 API，应把跨 Shard 消息作为独立子系统设计：

- 传输紧凑摘要，而非复制完整 Memory；
- 每条消息包含 schema、来源 Shard、发送 Tick、过期 Tick 与去重 ID；
- 无法读取或数据不可信时降级到本地战略，不阻塞主循环；
- 不能假设门户永远存在或所有 Shard 永远可访问。

这部分只有在目标玩法确实需要跨 Shard 时再实现。单 Shard 起步不应该为其付出常态 CPU 与维护成本。

## 4.7 WorldModel 接口建议

`WorldModel` 应向策略模块提供查询方法，而不是暴露底层 Memory 原始对象：

- `getRoomIntel(roomName)`：获取 Intel 及新鲜度状态。
- `getVisibleRoomSummary(room)`：将当前可见对象聚合为成本可控的摘要。
- `getThreat(roomName)`：当前可见威胁与历史风险分开返回。
- `getRoomCapabilities(roomName)`：按可见 RCL、建筑和权限判断能力。
- `markObserved(...)`：由 Perception 更新当前事实。
- `expire(now)`：低频清除过期缓存。

