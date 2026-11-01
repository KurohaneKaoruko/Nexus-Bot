# phase4-remote-intel 8.6 + nexus-architecture-refactor 9.2/9.5/9.6 私服实测与收尾对账

- 日期: 2026-11-02
- 服务器: 47.100.24.220 (W5N8, 账号 Nexus)
- 变体: main (v17, 多房 Intel 与外矿子系统全量)

## 部署过程 (8.6 前置)

1. `node scripts/submit.js 47.100.24.220@Nexus --branch main` 上传 (2.45MB 含 sourcemap);
2. 服务器世界已重置 (world-status=empty), `node scripts/race.js land` 落地 W5N8 (17,31);
3. 世界激活分支自 race 切 main: `POST /api/user/set-active-branch {branch:'main', activeName:'activeWorld'}`
   (Speedrun-Bot deploy-round120 同款端点), `$activeWorld` 哨兵分支校验 checksum 一致;
4. 自举确认: schemaVersion 16 (旧 race run 残留) → 迁移 17, 19 单位, posture develop,
   RCL3@~30s。

## 8.6 断言逐项

| 断言 | 结果 | 证据 |
|---|---|---|
| 钉选房生效 | ✅ | `Nexus.remote.pin("W5N9")/("W4N8")` console 回执 ok; Memory `remotes.W5N8.rooms` 双房 `manual:'pin'`, state candidate, reason console-manual |
| 外矿房预定与容器建成 | ⏳ 观察中 | RCL4+storage 前状态机停在 candidate (§24.7.1 storage 开闸条件, sim 同口径) |
| 实测净收入为正 | ⏳ 观察中 | 同上, active 后每 foldInterval 折叠 |
| invader 暂停与恢复 | ⏳ 观察中 | 威胁链 sim 已实证 (rt-micro), 私服等 invader 波次 |
| SK / 高速路识别排除 | ✅ (代码路径) | roomKind 候选过滤 + kindOverride, 单测在案; 私服邻房均为 normal 无现场样本 |
| 编队单位跨房记忆保留 | ✅ | sim roster-probe 1400t 全程保留 (P1-18 修复有效); 私服 remoteUnits 计数待 active 后复核 |

观察数据落盘: /tmp/opencode/srv-remote-watch.jsonl (4 分钟采样循环)。

## 9.2 legacy 删除执行 (台账核对)

10 号台账 12 删除域全 ✅: prototype 角色库 (域 8 批一/批二), economy units
(域 1.3 manager/transporter, 域 2.3 miner), mission 六池, external/mine 整链
(C 波), spawnControl 孵化消费端 (directSpawn 主线化注记)。本次 main 部署即
「删除后产物在实服跑一个重置周期」的观察载体——无 legacy 命名空间回退、无
OutMineData 写入 (Memory keys 无 OutMineData 新写, 旧残留只读)。

## 9.5 实服总验证 (进行中)

- 关键行为: 自举 ✓ (19 单位 RCL3), 姿态 develop ✓, 无 console 异常刷屏
  (观察窗口持续); CPU/Memory 稳定性随采样循环积累;
- docs/bugs P0/P1 状态盘点 (2026-11-02): 全部已修复/已闭环/已止血——
  race-nonstandard-room-crash (P0 已修复 guard), cross-room-agent-deadlock
  (P1 已修复), role-registry-executor-gap (P1 断链收口), room-observation-growth-audit
  (P1 已闭环), race-strategy-port (P1 追踪档, 榜一目标进行中), sim-audit 系列
  (已修复/待回归确认)。无未处置 P0/P1。

## 9.6 收尾对账 (AGENTS.md 准则)

| 准则 | 状态 |
|---|---|
| 缺陷清单与设计文档分离 (docs/bugs vs docs/nexus-design) | ✓ |
| 新缺陷及时追加带优先级与验证标准 | ✓ (本轮无新增缺陷) |
| 高内聚低耦合/模块化 | ✓ (remote/ 五模块: planner/estimate/stateMachine/counts/console) |
| 注释只描述功能不描述迁移来源 | ✓ (抽检 remote/ + defense/ 零参考来源注释) |
| 不擅自提交/范围隔离 | ✓ (提交按主题分批, 均在授权变更范围内) |
| 一切测试优先 sim | ✓ (8.2/8.3/8.4 全场景门留档后才上服) |
| 文件属主 nightx:night / git 身份 KurohaneKaoruko | ✓ (收尾 chown + 提交记录核对) |
| 硬指标 10k RCL4 / 20k RCL5 / 40k RCL6 | ✓ sim run127 5790/11788/32172; 私服 AF 7230/14528/33751 |
| bot 通用性 (注释无私服/官服功能区分) | ✓ (compat 垫片是环境适配非功能分叉, main.ts 零环境词) |

openspec 变更归档状态: phase4-remote-intel (8.6 观察完成后可归档),
race-speedrun-10-20-40 (7.3 守榜收口后可归档), nexus-architecture-refactor
(9.5 观察周期满后可归档)。
