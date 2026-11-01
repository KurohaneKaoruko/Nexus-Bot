# Proposal: remote-defense（外矿三期·防御）

## Why

外矿一期落地了威胁观测（threatModel scope=remote）与**暂停/撤回**——invader 出现时
停采集止损，这是被动的「避」。三期补主动的「清」：invader / invader core 的清理与
玩家骚扰应对。旧链 `externalMine.ts:2014-2069`（defend：out-defend / out-invader /
双人组按威胁配对）已删除。契约 `docs/nexus-design/13` §24.2 三期要求：防御域作为
需求方 → `cluster-squads`（`SquadKind = "remote"`）。

## What Changes

- **需求接入**：threatModel 的 remote 作用域威胁判定扩展「可清」分类——纯 NPC
  invader（owner=Invader，无核心）与 invader core（分级）区分玩家骚扰；
- **编队请求**：防御域对 paused-by-threat 的 active 外矿房发 `requestSquad(kind="remote")`，
  槽位任务 = `remote:defend` / `remote:clearCore`（清理 invader core 分级
  stronghold 层级），SquadKind 联合类型扩 "remote"；
- **威胁联动**：清理完成（威胁观测归零）→ 状态机自动恢复（一期 resumeThreat 链
  已有，无需改）；清理编队超时未成军 → 维持暂停（止损优先）；
- **玩家骚扰**：威胁源为玩家（owner ≠ Invader）时不开编队（一期暂停+人工介入
  口径保持），控制台提供 `Nexus.remote.threats()` 观测；
- **config**：`REMOTE_CONFIG.defense`（编队槽位表 / 分级阈值 / 请求 TTL）。

## Impact

- 代码：`src/modules/defense/`（threatModel 可清分类 + 需求方接入）、
  `src/core/store/memorySchema.ts`（SquadKind 扩 "remote"）、
  `src/modules/economy/remote/console.ts`（threats 观测）、`src/config/remote.ts`
- spec：`openspec/specs/` 增 remote-defense 能力增量
- 验证：sim remote-threat 场景扩展（invader 出现 → 编队请求 → 清理 → 恢复链），
  全场景门其余场景逐位一致
