# Tasks: remote-keeper

> 编排：0 地基 → 1 keeper 准入 → 2 覆盖编队 → 3 撤离节律 → 4 元素矿 → 5 sim 验证 → 6 文档。
> 依赖：三期 remote-defense 的 SquadKind="remote" 与配槽协议（先完成三期）。

## 0. 地基

- [ ] 0.1 config：`REMOTE_CONFIG.keeper`（keeperMinRcl / 配槽表 / 刷新周期与
  avoidWindow / 矿物阈值）。验证：types + 场景门绿
- [ ] 0.2 perception：keeper/center 房 lair 观察（位置 + lastSpawn 有界记录）。
  验证：sim 微场景 lair 记录落 Intel

## 1. keeper 准入

- [ ] 1.1 candidatesOf：auto 档排除 keeper/center；pin 放行 + RCL 门槛。
  验证：单测（pin keeper 房进 scouting，auto 不含）
- [ ] 1.2 estimate：keeper 产出/编队成本口径（3 源窗口模型 + 摊销）。
  验证：单测净收益数值口径

## 2. 覆盖编队

- [ ] 2.1 defense/planners：active keeper/center 房常驻 keeperHold 请求
  （配槽按 lair 数）。验证：sim 断言编队成军与续期
- [ ] 2.2 采集前置门：无覆盖撤 remote:harvest 单、恢复重建。验证：sim 断言
  （编队解散 → 任务消失 → 编队恢复 → 任务重建）

## 3. 撤离节律

- [ ] 3.1 危险窗口计算（Intel lairs 查表）写入任务权重/标记；agent 执行层
  读同一 Intel 回避。验证：sim 断言刷新窗口采集单位撤出 lair 半径

## 4. 元素矿

- [ ] 4.1 remote:mineral 任务登记/撤单（resourceType 口径复用）；extractor
  放量走 sitePlacement 意图。验证：sim 断言任务出现与矿物采空撤单

## 5. sim 验证与门禁

- [ ] 5.1 新场景 remote-keeper（SK 房 pin → 编队 → 采集节律 → 元素矿全链）
  跑绿入基线；其余场景逐位一致。验证：sim-matrix 基线新增说明
- [ ] 5.2 speedrun 抽查逐位一致（pin-only 不触发）。验证：逐位比对

## 6. 文档同步

- [ ] 6.1 docs/nexus-design/13 §24.2 四期 ✅ + §24.11 收尾清单核对（旧链
  残留对象是否全清）。验证：13 号文档分期表全 ✅
