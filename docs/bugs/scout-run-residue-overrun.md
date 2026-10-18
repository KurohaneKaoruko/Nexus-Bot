# 实服 4wt 重开残留: scout 任务永生 + 定编视野漏计 → 无限补孵

- 优先级: **P0**（实服 run#19 落地后 ~1250 tick 内孵出 20 只侦察体，孵化槽被废单占满）
- 发现: 2026-10-18，实服 W8N5 run#19（世界重置后 re-land）
- 状态: 已修复（2026-10-18），sim 六场景全绿，已部署实服

## 病理（三层叠加）

1. **触发器 — 跨 run 任务残留**：服务器 4wt 自动重开清空 Game 对象但 Memory 持久，
   旧 run 的 scout 任务（roomName=W2N4/W5N8 等已非我房）残留任务板。这些任务无人
   生产、无人认领、无 deadline，`reconcile` 只回收「assignee 不存活」的——但它们
   从未被认领过，状态恒 `available`，永生。
2. **放大器 — 定编视野漏计**：`staffingCount` 的活体计数遍历 `world.rooms`（视野
   口径）。侦察体到达邻房后脱离本房视野 → `staffed(scout)=0` → `staffed < target`
   恒成立 → spawnDirector 无限补孵。20 只侦察体（15 只堆在 W9N5）即此机理；
   远程 harvester/reserver 同理会超编。
3. **永生键 — 到达不终结**：agentSystem scout case 到达目标房后只删 creep 的
   taskId 指针、不 `complete()` 任务；且规划器每拍 `upsert` 同键任务会刷新
   `updatedAt`/priority，lease 过期回 `available` 后又被认领——正反馈永生。

## 修复（三层对因 + 一处回归事故）

| 层 | 位置 | 改动 |
|---|---|---|
| A 到达即终结 | `agentSystem.ts` scout case | 到达目标房 `board.complete(task.id, …)`（下一 tick 指针清除链已有） |
| B 定编口径 | `demandSources.ts` `staffingCount` | 活体计数改 `ctx.memory.units` 注册表（spawnDirector 死亡回收逐 tick 对账，与 Game.creeps 同步；出视野仍计数）；**键口径**: 注册表存角色名，查询用代号——经 `unitCode()` 归一（首版漏归一导致全岗位恒缺编 → carrier 88 优先级永动孵化 → run#20 升级 0 死锁，sim speedrun 复现 L2@806→None，已修复并对齐参考） |
| C 残留清理 | `tasks/index.ts` reconcile 前置 | ①非终态任务 roomName ∉ 当前我房集合 → `cancel("room-lost")`（claim 特赦）；②远程经济任务 (harvest/haul, 目标房 ≠ 挂靠房) 目标房无视野 → `cancel("room-lost")`（旧世界远程任务 targetId 已死，矿工领到即站桩到老死——run#20 主死因；planners 的 subject-gone 扫描对远程任务一律特赦漏杀） |

`board.ts` 顺带导出 `TERMINAL_STATUSES`（C 层判据复用）。

## 验证

- sim 复现取证: 预置残留任务场景 (`sim/run-residue.sim.ts` + binary 直跑 dump) — scout 残留→room-lost ✓ 远程 harvest 残留→room-lost ✓ 幽灵源同房任务→subject-gone ✓；
  B 层键事故复现: speedrun CLI 全场景 bot 空转 (upgrade 0 / carrier-only)，修复后 L2@806 bit 对齐参考。
- 实服取证：run#19 清任务板后 30s 零新孵（病理确认）；run#20 死锁全程取证（carrier-only + 任务全悬空 + posture survive 横跳 152 次为伴生症状非根因）。
- 修复后 sim 六场景矩阵全绿 + 单测 5/5 + tsc/oxlint/arch-guard(123) 绿。
- run#21 (完整修复版) 实服落地验证: 1844t RCL2、4379t RCL2 prog 9795，编制 harvester4/upgrader6/carrier4 均衡，无异常补孵。

## 遗留

- `memory.units` 注册表口径与 `creepTickIndex`（war/team directSpawn 计数）并存：
  两口径覆盖面不同（后者含蛋期与 team 单位），不合并；SpawnUnit 定编面只信注册表。
- sim 预置任务场景曾因 root 属主 dist 静默构建失败产出陈旧 bundle（对照实验假阴性）——
  dist 属主回归检查已列入运维清单（AGENTS.md 已有约定，本次再犯）。
