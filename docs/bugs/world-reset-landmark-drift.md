# 世界重开地标重摆 → roomOk 整场静默 0 分

- 优先级: P0 (已修复, 重锚定上线)
- 日期: 2026-10-28
- 状态: 已修复 (src/branch/race/speedrun/layout.ts reanchor)

## 现象

服务器世界于 ~tick 42.5M 重开 (run 35 E3N3 起算)。此后所有 run 引擎跑满但
speedrun 得分恒 0, 全服账号无一例外。榜单停留在重开前的历史最佳。

## 根因

世界重开时**地形逐位不变, 但地标重摆**。W5N8 实测 (eval 探针写 Memory 回读):

| 地标 | 旧世界 | 新世界 |
|------|--------|--------|
| controller | (17,25) | (18,24) |
| spawn | (17,31) | (26,24) |
| source 1 | (21,13) | (21,13) 不变 |
| source 2 | (30,29) | (30,29) 不变 |
| mineral | 34,6 | 34,6 不变 |

源位不动、地形不动, 但 ctrl/spawn 双双移位。roomOk 守卫按设计拦截
(ctrl 不在 17,25) → 整场静默待机 → 0 分。守卫本身没坏——它拦的正是
「布局几何对不上」的世界, 只是这次的世界**只差一个刚体平移**, 本可救活。

## 修复: 运行时重锚定 (reanchor)

`layout.ts` 新增 `reanchor()` (configure 尾部调用, profileReady 之后):

1. 探测实际 ctrl/spawn 位置, 计算双系偏移:
   - ctrl 系 `cx,cy = ctrl.pos - (17,25)`: 升级块三箱/槽位/lane/BOX/CTRL/LANE_Y/K.park
   - spawn 系 `sx,sy = spawn.pos - (17,31)`: SPAWN/HUBS 模板/BAY/泊位/EXIT(基准档)
   - SRC 系 (源位) 新旧世界相同, 不动
2. 平移合法性校验: 箱体/lane (硬几何) 逐点查地形, 落墙即放弃 (回退 roomOk 静默保底);
   槽位允许落墙 (事后按地形剔除)
3. 槽位按距 hub 升序重排: 世界重摆后 hub 可能不在 lane 正南, 基线的 lane-first
   序会让喂料堆落在入口端而升级工在远端饿死
4. `ANCHOR_OFF.re` 置位, loop 的 roomOk 守卫放行重锚定成功的世界
5. 诊断: `Memory.anchor = {ctrl, spawn, off, slots, t}` (eval 回读, 无 console 噪音)

升级块三箱从 spawn 模板解耦, 改 ctrl 系派生 (`CTRL_BOX_OFF = [[-2,2],[0,2],[2,2]]`
相对 ctrl, 不再是模板的 -3): 旧世界三箱跟随 hub 模板, 是因为 hub 恰在 ctrl 下方;
世界重摆后该耦合即错。

刻意不做: 朝向旋转 (LANE_Y 横行语义不可保, 那类世界仍走 roomOk 静默保底)。

## 修复过程中一并解决的四缺陷

1. **reanchor 被 profileReady 吜死**: t0 无 spawn 时 reanchor 跳过且不再重试
   → `anchorDone` 标志只在真正执行后才置位
2. **configure 的 openEast 字面量覆盖**: reanchor 移到 configure 尾部最终位,
   避免平移被字面量赋值抹掉
3. **槽位排序排了 filter 副本**: 且 h0 用平移前坐标 → 修为原位排序 + 平移后 hub
4. **want 队头死锁**: 重锚定世界 ext 慢导致 cap 低位时队头付不起卡死整条 spawn 队列
   → loop.ts 队头付不起时顺扫可付候选 (仅 `ANCHOR_OFF.re` 门控, 标准世界不走此路径)

## 验证

- 标准世界 4×20k 逐位回归 (官方 harness): `[1071167, 1080491, 1074976, 1079683]`
  与基线完全一致——恒等退化成立, 零漂移
- 新世界测试床 (ctrl 18,24 / spawn 26,24): 0 分死亡螺旋 → L2@609 L3@9480 L4@18835,
  40k 时 RCL4+292959, 存活 16, err 0
- 四门禁: tsc / arch-guard (211 处) / structure-guard (301 文件) / run-tests (47/47)

## 遗留

- 新世界吞吐上限 (喂料接力带宽): 8 槽 48W × 0.85 duty = upRate ~41/t (基线 11 槽
  66W ~60/t)。墙带吞掉 row25 三个升级槽是几何事实, 贴箱补偿位为零 (lane 南沿
  补偿槽挡 hauler 卸货路径, 实测 L3 3860→6337 净负收益已弃)。突破需结构性改动
  (接力工/双 lane), 风险大回报仅限 40k 档, 暂缓
- lane 占位格派生化已修 (laneUnload free tile 枚举 14-20 → BOX.x±3), 新世界
  L3@3643 L4@7083 L5@16009, 40k 升级 1654697
- 下一世界重摆生存率 (按服务器实测地形全房枚举): lane 校验分层后 ctrl 摆位
  生存率 59% → 65%; 箱列偏移探测 (d∈{0,±1,±2}, 三箱/lane 核心段/槽位锁定同列
  横移避墙带, 槽位另加 ctrl Range3 剪枝) 后 65% → **82%** (1549 个摆位存活
  1263)。实测救活摆位 (ctrl off +2,-3, 旧口径整场拒绝): d=+2 → 20k upCum
  475123。标准世界 d=0 恒等, 4×20k 逐位不变
- 快照还原周期脏账 (2026-10-28 实测): 服务器 40k 后快照还原, Game.time 回退而
  Memory/spawn.id 原样残留, `newRun` 的 boot.id 闸门会放行上一 run 的陈旧
  upCum/anchor/roomOk。已修 (spawning.ts newRun): `Memory.lt` 存 last-seen
  tick, 落到「未来」即回退, 强制清账重开新 run。rollback 测试床 (预置 lt=19000
  脏账从 t0 重跑) 实测清账生效: upCum 归零重计, boot.t/anchor 重写
- 服务器 runtime 停摆中 (全服最后 record 10-26 15:34 UTC, 三分支 activeWorld:false,
  console 表达式不执行)。代码已部署 (race 分支, 部署字节本地复测标准世界逐位
  1071167 + 新世界 L5@16009 + 降级世界 L4@8398 三重验证), 等 runtime 恢复即自动出分
- 重锚定按「同一 global 生命周期内世界不变」假设设计 (anchorDone 每 global 一次);
  服务器 4wt 自动重开会连 global 一起重置, 假设成立。快照还原周期 tick 回退已由
  newRun 的 lt 检测兜住 (清账后 configure/reanchor 随新 global 重跑)。若未来出现
  一个 global 内房间地标不同的情况, 需改为 spawn.id 键控 + 增量平移
