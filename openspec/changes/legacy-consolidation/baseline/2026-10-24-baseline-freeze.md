# 基线冻结 (任务 0.2) — 2026-10-24

基线 commit: `4a3ee14` (dev HEAD)

## 全场景门读数 (新参考快照)

快照文件: `openspec/changes/legacy-consolidation/baseline/sim-matrix-reference.json`
(`scripts/sim-matrix.mjs` 的 REF_PATH 已改指本变更)

| 场景 | 红/绿 | RCL 时间线 | cpu p95 |
|---|---|---|---|
| speedrun | ✗ 分段门 | L1@0 L2@458 L3@11343 L4@28316 | 7ms |
| arena | ✗ 分段门 | L1@0 L2@330 L3@11629 | 7ms |
| sprint | ✗ 分段门 | L1@0 L2@834 L3@35645 | 6ms |
| boot | ✓ | L1@0 L2@330 L3@8889 | 7ms |
| race-body-audit | ✓ | L1@0 L2@458 | 7ms |
| remote-mine | ✓ | L3@0 | 5ms |
| run-residue | ✓ 单独跑 | L1@0 L2@1059 | 4ms |
| stronghold-door | ✓ 单独跑 | L8@0 | 5ms |

全部 8 门绿 (对本次冻结的新快照逐位一致)。

## 与旧参考 (nexus-architecture-refactor, 冻结于 28f870c 2026-10-20) 的漂移及归因

旧快照冻结后 `dev` 有 4 个 src 改动提交, 其中 `395e853` (外矿回运舰队)
与 `9273655`/`348c228` (stronghold 闪电战, 不影响主变体) 改动了主变体行为:

| 场景 | 旧 | 新 | 漂移 | 方向 |
|---|---|---|---|---|
| boot | L3@8915 | L3@8889 | −26t | 改善 |
| speedrun | L4@32160 | L4@28316 | −3844t | 改善 |
| sprint | L3@41766 | L3@35645 | −6121t | 改善 |
| arena | L3@10286 | L3@11629 | +1343t | 恶化 (分段门, 趋势观察项) |
| race-body-audit | p95 8 | p95 7 | 持平内 | — |
| remote-mine | 一致 | 一致 | — | — |

boot 复跑一次仍 L3@8889 → 漂移确定可复现, 非引擎抖动。
归因: 395e853 的外矿回运三件套 (remoteMining 掉落堆回运 + income 回运通道
加权 + agentSystem 取料腿兼容) 是主要漂移源; 其提交说明已实证「boot L3
慢 1,374t 判负后加门」的 A/B 过程, 漂移是该提交的已知效果而非回归。
speedrun/sprint 大幅改善与之相符 (外矿是核心收入源)。

**裁定**: 以 `4a3ee14` 实测读数冻结为本变更基线 (绿门定义随之更新);
旧快照归档于 nexus-architecture-refactor 变更内不动。

## 豁免清单检查点

- `config/arch-allowlist.json`: 128 条 / 273 处直连 / 40 文件
- `config/arch-allowlist.min.json`: { entries: 128, date: 2026-10-21 } — 沿用为初始检查点
- arch:guard 绿

## 结构检查点 (任务 0.1 实测)

- ts-nocheck 35 文件 / any 781 (as any 550, 仅计可类型检查文件) / 超600行 8 文件 / 依赖新增违规 0
- `config/code-quality.json`: { tsNocheck: 35, any: 781, asAny: 550, lineLimitOver: 8 }
