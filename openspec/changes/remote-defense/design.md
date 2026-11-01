# Design: remote-defense

## 上下文

一期已有：threatModel 的 `scope=remote` 观测（最小评分 + 半衰置信度）、
暂停/恢复状态机、`remote:` 任务取消。cluster 编队域已有：requestSquad
需求方协议、TTL 解散、槽位任务、benefit 追踪（当前消费方 = 防御 emergency）。

三期把「威胁 → 被动暂停」补成「威胁 → 分类 → 可清的主动编队 → 恢复」。

## 决策

### D1: nature 分类进 threatModel——不另立观测

threat 记录增 `nature: "npc" | "core" | "player"`（+ core 层级 number）。
写入点 = 一期 updateRemoteThreat 的观测链（FIND_HOSTILE_CREEPS +
FIND_HOSTILE_STRUCTURES 里 STRUCTURE_INVADER_CORE）。分类是纯事实标注，
score 语义不变（一期校准的阈值全部沿用）。

### D2: 需求方 = 防御域 planners——remote 不直接指挥

`modules/defense/planners.ts` 增 remote 清理规划：扫 `memory.remotes` 的
active+paused(threat) 房 → threat.nature ∈ {npc, core} → `requestSquad(
kind="remote", roomName=外矿房, slots=配槽表, taskKind="defend")`。
编队域零改动（SquadKind 联合类型扩 "remote" 一行 + model 白名单若有则加）。
外矿 planner 不感知编队——恢复仍走一期 resumeThreat（威胁归零自动恢复），
形成闭环但不耦合。

### D3: 配槽表按 nature × 档位

- npc：score < 强档 1 攻击件；≥ 强档 2 攻击件（RCL 低时 3 小件——旧链
  level<4 maxNum=3 同语义）；
- core：层级 ≤2 单攻击件；3-4 攻击+治疗；5 攻击+治疗×2（旧链 out-2attack/
  out-2heal 双人组同构）；
- 槽位任务 kind="defend"（TaskKind 已有），dedupeKey `squad:{squadId}:{slot}`。

### D4: 止损与冷却

- engagementTimeout：编队成军后计时，威胁记录仍在（score>0）且超时 → 撤请求；
- retryCooldown：撤后该房冷却，期间 planners 跳过（Memory 记 `defense.remoteCooldown[room]`，
  有界 Map）；
- 单位全灭检测复用一期 deathWindow 语义（编队槽位任务全 cancelled/完成但威胁在）。

### D5: 玩家骚扰口径

nature=player 不开编队（一期暂停已止损；自动开战涉及战略决策，超本期能力）。
控制台 `Nexus.remote.threats()` 列各房 threat 摘要（nature/score/confidence/
scope），给人工介入提供观测面。

## 风险与守恒

- **不破坏 speedrun**：remote 清理只在 spawnShareCap 外矿域内，speedrun 无外矿；
- **CPU**：planners 扫描随 defense 阶段限频（既有节拍），编队数受 cluster 上限；
- **Memory**：cooldown Map 有界（外矿房数上限内），threat 记录单条不增负。
