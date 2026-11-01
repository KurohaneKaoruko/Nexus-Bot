# Tasks: remote-defense

> 编排：0 分类 → 1 编队请求 → 2 止损 → 3 观测面 → 4 sim 验证 → 5 文档。
> 依赖：cluster 编队域现行为（不改动其语义）；一期 threat/暂停链（只扩展不重写）。

## 0. 威胁分类

- [ ] 0.1 threatModel：threat 记录增 `nature: "npc"|"core"|"player"` 与 core
  层级字段；updateRemoteThreat 观测链写入分类（hostile creeps owner 判定 +
  invaderCore 结构分层）。验证：单测三分支 + 既有 remote-threat 场景断言不回归
- [ ] 0.2 config：`REMOTE_CONFIG.defense`（配槽表 / engagementTimeout /
  retryCooldown / 请求 TTL 复用 cluster）。验证：types 通过 + 场景门绿

## 1. 清理编队

- [ ] 1.1 memorySchema：SquadKind 扩 "remote"；cluster model 白名单（若有）同步。
  验证：types + arch:guard 绿
- [ ] 1.2 defense/planners 增 remote 清理规划：active+paused(threat) 房 →
  nature∈{npc,core} → requestSquad(kind="remote", taskKind="defend",
  slots=配槽表)；player 不请求。验证：sim 微场景——invaderCore 出现 →
  编队请求成军（沿用 rt-micro 场景骨架扩展）
- [ ] 1.3 恢复链验证：清理完成威胁归零 → 编队 TTL 解散 → 外矿状态机
  resumeThreat 自动恢复（一期链路，只验证不改）。验证：sim 断言 active 恢复

## 2. 止损

- [ ] 2.1 engagementTimeout 超时撤请求 + retryCooldown 冷却（Memory
  defense.remoteCooldown 有界 Map）；单位全灭同口径。验证：sim 微场景——
  超时后编队解散、冷却期内无新请求

## 3. 观测面

- [ ] 3.1 console：`Nexus.remote.threats()` 列各外矿房 threat 摘要
  （nature/score/confidence/paused）。验证：console 单测 + sim 调用回显

## 4. sim 验证与门禁

- [ ] 4.1 remote-threat 场景扩展断言（分类/编队/恢复/止损四链）跑绿；
  全场景门其余场景逐位一致。验证：sim-matrix 基线说明更新
- [ ] 4.2 speedrun 场景抽查无防御行为变化（无外矿域不触发）。验证：逐位一致

## 5. 文档同步

- [ ] 5.1 docs/nexus-design/13 §24.2 三期标 ✅；19 号集群文档消费方表补
  remote（若该表存在）。验证：文档 grep 无悬挂
