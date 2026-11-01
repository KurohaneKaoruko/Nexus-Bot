# 单测汇总 awk 误报 (P1 流程缺陷)

**日期**: 2026-10-25
**发现场景**: legacy-consolidation 1.2 切换验证 (集成会话复跑单测)

## 缺陷

复跑单测核对时用了如下汇总命令:

```sh
npm run test 2>&1 | grep -E "^ℹ (pass|fail)" | awk '{s+=$3} END {print "total pass:", s}'
```

该 awk 只累加了 pass 行, fail 行完全没进汇总——**3 处失败被掩盖为「39 全绿」**,
3.2a send 切片 (283806c) 的测试断言笔误 ×2 与一处移植偏差自此未被发现:

1. `tests/send-ledger.test.ts` `dispatchableSendEntry(amount=5, 实存100)` 断言 false——
   原语义 `canDispatchSendTask` (manageMission.ts:388) 是 `min(amount, 批量)` 夹逼,
   min(5,100)=5 ≤ 100 → true, 断言写反 (测试笔误)。
2. `tests/manage-quota.test.ts` energy 补货分支断言 undefined——原口径
   `checkTerminalResourceBalance` 的 energy 键是 `totalRequestedAmount`
   (全资源请求总和, 发送交易费预留), U 请求 30k 时 energy 也该补 (测试笔误)。
3. `src/modules/economy/sendLedger.ts` `pruneByRoomStock` 只过滤不删——原
   `getSendMissionTotalAmount` (manageMission.ts:419) 对房间资源不足条目
   `deleteMissionFromPool` **原地删除**, 移植漂移 (实现缺陷, 已修复为原地删)。

## 修复

- 实现: `pruneByRoomStock` 改原地 splice 删不足条目 (保序), 与原池单删除语义一致。
- 测试: 两处断言修正 + 补真负例 (小实存 50 < 批量 100 → false)。
- 修复后 39/39 全绿 (逐 test 文件 fail 行核对)。

## 验证标准

- `npm run test` 输出末尾逐文件 `ℹ fail 0`;
- 汇总一律用 `awk '/^ℹ pass/{p+=$3} /^ℹ fail/{f+=$3} END{print p, f}'` 双计数, fail>0 即红。

## 影响

sim 惰性域 (sends 簿记 sim 恒空, RCL6+ terminal 人操链), 未上实服, 无线上影响;
但 3.2a 切片的「20/20 单测绿」记录不实, 以本档勘误。
