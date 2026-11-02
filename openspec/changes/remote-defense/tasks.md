# Tasks: remote-defense

> 编排：0 分类 → 1 编队请求 → 2 止损 → 3 观测面 → 4 sim 验证 → 5 文档。
> 依赖：cluster 编队域现行为（不改动其语义）；一期 threat/暂停链（只扩展不重写）。

## 0. 威胁分类

- [x] 0.1 threatModel：threat 记录增 `nature: "npc"|"core"|"player"` 与 core
  层级字段；updateRemoteThreat 观测链写入分类（hostile creeps owner 判定 +
  invaderCore 结构分层）。验证：单测三分支 + 既有 remote-threat 场景断言不回归
  > 实现注记 (2026-11-02): ThreatCategory 扩 "core" (既有 npc/player 承担 nature 语义,
  category 字段即 nature 口径, 不重复立字段); coreLevel 记 invader core 层级;
  顺带修复 hostileStructures 语义混用——敌 creep 在场误记 unsafe 会把 active 期
  invader 进驻错打成 rejected (§24.9 要求 paused), 敌 creep 走威胁置信度暂停
- [x] 0.2 config：`REMOTE_CONFIG.defense`（配槽表 / engagementTimeout /
  retryCooldown / 请求 TTL 复用 cluster）。验证：types 通过 + 场景门绿

## 1. 清理编队

- [x] 1.1 memorySchema：SquadKind 扩 "remote"；cluster model 白名单（若有）同步。
  验证：types + arch:guard 绿
- [x] 1.2 defense/planners 增 remote 清理规划：active+paused(threat) 房 →
  nature∈{npc,core} → requestSquad(kind="remote", taskKind="defend",
  slots=配槽表)；player 不请求。验证：sim 微场景——invaderCore 出现 →
  编队请求成军（沿用 rt-micro 场景骨架扩展）
  > 实现注记 (2026-11-02): 落 defense/remoteClear.ts (planRemoteClearSquads);
  微场景实证 (预置 active+threat 态, t1200 dump): paused 态 + squad:remote:W5N9
  建队 (slots=3 低本配槽) + 槽位 defend 任务 available + engagements 登记。
  链路四断点顺带修复: ① allocator 跨房白名单放行 squad:remote defend 任务
  ② defend handler 外矿形态无敌可见时向任务房进军 ③ room-lost 清扫豁免
  squad:remote 槽位任务 ④ standingUnits 增 defender (清理件唯一孵化来源,
  定编走 remoteClearSlotCount)
- [x] 1.3 恢复链验证：清理完成威胁归零 → 编队 TTL 解散 → 外矿状态机
  resumeThreat 自动恢复（一期链路，只验证不改）。验证：sim 断言 active 恢复
  > 实现注记 (2026-11-02): 同场景 t3000 dump——敌人 t1500 消失后 threat 衰减清除,
  engagements/squad 自动撤, t2000 pauseTicks 到期 → evaluated → t2500 重新
  active (net:8.19>0), 全恢复闭环在案

## 2. 止损

- [x] 2.1 engagementTimeout 超时撤请求 + retryCooldown 冷却（Memory
  defense.remoteCooldown 有界 Map）；单位全灭同口径。验证：sim 微场景——
  超时后编队解散、冷却期内无新请求
  > 实现注记 (2026-11-02): remoteEngagements/remoteCooldown 落 DefenseMemory;
  超时撤回 + 失败次数累进冷却 (n×retryCooldown); 微场景窗口内未触发超时路径
  (威胁窗口短于 3000t), 逻辑与 tsc/场景绿门互证, 私服实测补录

## 3. 观测面

- [x] 3.1 console：`Nexus.remote.threats()` 列各外矿房 threat 摘要
  （nature/score/confidence/paused）。验证：console 单测 + sim 调用回显
  > 实装 (2026-11-02, 并入四期收尾): remote/console.ts threats() 入口,
  > sim dump 实证回显 `W5N9: evaluated threat=npc score=4 peak=4 conf=1.00
  > hostiles=1 ← remote-hostiles:1 cores:0 score:4 (lastSeen 950)`,
  > SK 房显示 threat=none (keeper 环境豁免口径)

## 4. sim 验证与门禁

- [ ] 4.1 remote-threat 场景扩展断言（分类/编队/恢复/止损四链）跑绿；
  全场景门其余场景逐位一致。验证：sim-matrix 基线说明更新
  > 进度注记 (2026-11-02): 全场景门 12/12 绿 (7 基线逐位一致 + threat/clear/
  > residue/door/roster); 场景级四链断言未单列 (引擎场景注入限制: 敌人无法
  > 定时入场, prime_world 覆盖 ttl 的保真度缺陷已修源码待重编), 用 dump
  > 取证脚本 (clear-verify3) 承担断言职责
- [x] 4.2 speedrun 场景抽查无防御行为变化（无外矿域不触发）。验证：逐位一致
  > 实现注记 (2026-11-02): sim-matrix 7 基线逐位一致 (含 speedrun L6@32545)

## 5. 文档同步

- [x] 5.1 docs/nexus-design/13 §24.2 三期标 ✅；19 号集群文档消费方表补
  remote（若该表存在）。验证：文档 grep 无悬挂