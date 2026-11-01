# 2026-10-31 指标对账 (5.2)

## 指标终值 (guard 实测, 2026-10-31)

| 指标 | 终值 | 口径 |
| --- | --- | --- |
| ts-nocheck | 0 | structure-guard（31 → 0, B 波二清零） |
| 显式 any | 287 (as any 200) | structure-guard / `config/code-quality.json` 检查点（≤300 达标） |
| >600 有效行白名单外 | 0 | structure-guard |
| 依赖方向违规 | 0 | structure-guard |
| 词表三方一致 | 绿 | structure-guard 内置断言（executor ↔ 可执行路径 ↔ 孵化源） |
| arch 豁免清单 | 91 条（在-call 91, 已收编 0） | arch:guard 绿 |

## 豁免清单终值结构

- **赛区 28**（单列隔离区, `branch/race/speedrun`, 只减不增）。
- **非赛 63**：P8 broker 执行层 24 / P2 command-boundary 14 / 人操豁免 14（console 13 + warSpawn 1）/ P7 industry-adapter 4 / 编队域 5 / P8 spawn-arbiter 1 / P4 movement-adapter 1。每条归口三类之一（永久豁免 / 待收编 / 随删除消失——mine 链 0 条已核销）。
- **60→63 演化归因**：3.4 actionBroker 拆分时 attack/heal/repair 三方法随 case 表进入两个执行器文件，per-file 计量下双条登记（直连调用总数 211 不变，非新调用点，`--allow-growth` 留档）——台账 3.4 行已登记，非无主新增。3.1 movement 拆分的 `movement/index.ts::pull` → `movementIntentSquad.ts::pull` 为路径迁移（同 track 同 calls, 总数不变）。
- 1.1 闸门「非赛 ≤60」的完整口径为「非新调用点」——63 条中 60 条与 1.1 一致, 3 条为已登记计量口径涨；**净新增豁免 0**。

## 净删除行数 (未提交工作区 vs HEAD, 4.1 起)

105 files changed, **2220 insertions(+), 8023 deletions(-)**（净 −5803 行, B 波一拆分新增模块 + B 波二 typing + C 波遗留）。

## 台账核对

- 台账 15 行, 每行四条件证据齐, 实服列均如实标「待补」。
- 本轮新增 B 波二 4.2 漂移修复行（语义回正, 零豁免变化）。
- 「行与提交一一对应」：4.1 起全部改动尚未提交（等用户分批提交指令）, 提交后逐行补提交号核对。

## 双守护

- structure-guard ✓（316 文件 / ts-nocheck 0 / any 287 / 超限 0 / 依赖违规 0）
- arch:guard ✓（212 处直连 / 25 文件, 全部在豁免清单内, 清单 91 条）
