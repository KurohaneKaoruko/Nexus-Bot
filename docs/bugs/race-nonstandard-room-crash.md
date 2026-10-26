# 冲级服落点非标准房 → 固定坐标布局每 tick 崩溃

- 优先级: P0 (已止血, 待观察)
- 日期: 2026-10-26
- 状态: 已修复 (guard 上线, race 分支 e89424b7)

## 现象

服务器报错, 每 tick 一次, 整个 loop 中断:

```
TypeError: Cannot read properties of undefined (reading 'id')
    at Object.miner (main:414:23)
```

## 根因

run 35 落地房 E3N3 不是标准九宫格房:

- 真实 source 位置 (经 /api/game/room-terrain 实测): 不在 (21,13)/(30,29)
- controller 不在 (17,25) (该坐标是墙)
- 固定坐标布局全部失效: miner 站上 (22,14) 后 `lookForAt(LOOK_SOURCES, 21, 13)`
  返回空 → `Game.getObjectById(undefined) || lookForAt(...)[0]` 为 undefined →
  `src.id` 抛 TypeError → 异常炸穿 ROLES.miner → loop 整体中断 → bot 瘫痪

落地证据: `Memory.boot = {id: af89fd33…, t: 40792452}`, `Memory.srcs` 首位
`E3N3:0 dist=17` (PathFinder 距离与标准房一致, 说明 sources() 按固定坐标算的
距离碰巧成立, 无法用作哨兵)。

## 修复 (双仓库同步)

loop 首帧标准房哨兵 (标准房一次通过后 Memory.roomOk 常驻, 零额外开销):

```js
const spawn0 = Object.values(Game.spawns)[0];
if (spawn0 && !Memory.roomOk) {
  const ctrl = spawn0.room.controller;
  Memory.roomOk = spawn0.room.lookForAt(LOOK_SOURCES, 21, 13).length > 0 &&
    spawn0.room.lookForAt(LOOK_SOURCES, 30, 29).length > 0 &&
    !!ctrl && ctrl.pos.x === 17 && ctrl.pos.y === 25;
  if (!Memory.roomOk) return; // 非标准房: 静默待机, 不崩
}
```

- Speedrun-Bot: src/main.js (build-server.mjs 产物已上传 race 分支)
- Nexus-Bot: src/branch/race/speedrun/loop.ts (build:race:speedrun 产物待下次部署)

## 验证

- 标准房 sim 2500t 冒烟: guard 前后 score/harvested/built/spawned 逐位一致 (17172)
- 服务器: 上传后 Memory.roomOk=false (E3N3 被正确识别), 不再报错

## 遗留

- run 35 无成绩 (该 run 已废, 等服务器 4wt 自动重开)
- 重开落点仍随机: 落标准房则正常跑, 落非标准房则待机。若要非标准房也能跑,
  需要动态布局 (与"尽量不对冲级做改动"冲突, 暂不做)
