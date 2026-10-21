# 要塞服盾队过房门死锁 + 脱奶团灭 (sim 复现修复)

- 状态: **已修复** ✅ (2026-10-20)
- 优先级: P0
- 影响分支: stronghold (要塞挑战服)

## 现象 A: 门口死锁

盾队推进到房界永久卡死: 3 只站上出口格被引擎自动传送弹回
(对岸 y=0 ↔ 这岸 y=49 每 tick 往返), 1 只在出口前一格振荡
(fatigue 70→0 循环), 800+ tick 无推进。线上对应 W6N7→W5N7 门口。

## 现象 B: 脱奶团灭 (错误修复引入)

首版修复直接删除疲劳冻结 → 散装推进时奶盾分离, T盾脱奶被
塔伤逐个点死。**盾队是奶盾一体, 阵型同步是生存前提**。

## 根因

`TeamClass.execMove` 的全队疲劳冻结与引擎传送规则冲突:

- 引擎规则: 站出口格那 tick 不发指令 → 自动传送到对面;
  发过移动指令则不传送。
- 冻结规则: 任一成员疲劳 → 全队零指令。

跨房穿边过渡态: 掉队者踩出口格带 70 fatigue 冻结全队 →
已过界站对岸出口格的成员零指令 → 被传送弹回 → 无限循环。

## 修复 (冻结保留 + 出口格豁免)

疲劳冻结保留 (奶盾一体), 仅对「站出口格且无疲劳」的成员放行
一步向房内移动:

- 在锚点房: 朝锚点走一步 (getDirectionTo, 方向须指向房内)
- 在路径房: 朝下一出口走一步 (routeExitDir, 方向指向房外的
  等传送不发——由 combatMove 出口格拦截层处理)

其余成员照旧冻结; 掉队者疲劳恢复后 Gather 收紧阵型。

附带健壮性: `TeamCache.getTowerDamageMap` 补 `if (!Memory.rooms)`
初始化 (未建房首算塔伤崩溃, sim 实锤 reading 'W5N7')。

## 验证 (sim/stronghold-door.sim.ts)

场景: W5N8 家 + 南邻 W5N7 要塞房 (15..35 墙圈 + 南门 24-26@y35 +
核心 (25,25) 地形墙 23..27 护壳 + 南开口 (25,27)), 盾队
(T40M10 + 3×M5H40M5) + 蓝球 (R40M10) 从南缘出发。

- 原版: t300 起死锁 (800 tick 爬位不变)
- 当前: t100 过界 → t200-400 绕墙圈 (st0 全程无卡死) →
  t500-600 贴核心开口 → **t800 核心拆除** (100k hp)
- 回归: stronghold-door 全绿 (noErrors + 5 爬存活)

## sim 排障备忘

- 场景预置 Memory 的 `Nexus.schemaVersion` 必须 = CURRENT_SCHEMA_VERSION,
  否则迁移失败 → Nexus 整体重建 → 预置 TeamData 被清。
- 预置爬不能带 memory (引擎 CreepSpec 无此字段); 用 `Memory.creeps[名]`
  预置 unit/teamID, TeamData.creeps=[] 走 rejoin 归队。
- TeamData.status 必须 'ready' (attack + 空 creeps 会被当全灭解散)。
- sim 引擎 `room.find(FIND_HOSTILE_STRUCTURES)` 未实现, 查 invaderCore
  用 `FIND_STRUCTURES` + 类型过滤。
- `screeps-sim test` 的 -v 不透传 console; 用 `--scenario <json>` 直跑
  可见 console.log。
