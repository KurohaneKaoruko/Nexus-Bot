# Proposal

## Why

docs/bugs P1-14（沼泽地形经济低均衡陷阱）未修复：rcl-sprint 场景（seed=7 沼泽墙地形）采集利用率 ~8%、升级 ~0.02/tick，RCL4@40000 断言不过——这既是 speedrun 服冲级的底线判据，也按 AGENTS.md 规则阻塞一切新功能开发。根因三条（bugs 文档已归因）：升级工能量链路过长（无控制器容器缓冲）、3 部件机体不感知地形（沼泽往返占比极高）、carrier 定编与交付优先级把升级工饿死。既有成熟能力可移植（Rush 冲级体系），本变更以修 P1-14 为主线，顺带完成该步能力建设。

## What Changes

- **控制器缓冲决策落地（P1-14 根因 1）**：实现 docs/17 预留的 cc 圈选址权——控制器旁缓冲容器放置决策（幂等、可重建），carrier 按配额补货，升级工驻容器相邻升级工位 withdraw + upgrade 原地完成（零往返）；布局模块 cc 圈让位契约保持不回退。
- **体型编译升级：预算现算 + 地形感知（P1-14 根因 2）**：移植 既有 rush 体型生成器（harvester/upgrader/worker 纯函数），叠加地形感知 MOVE 配比——按房间沼泽密度与路网覆盖率分档调整 move 比例，替代现有固定段模板；保持开局最小段与攒能定档语义。
- **升级直供链路（P1-14 根因 3）**：升级工取能锚点从 spawn 链路改为 cc 缓冲；cc 缺货纳入关键结构配额口径（账本在途承诺防超发），消除「采集→搬运→spawn→升级工沼泽折返」链路放大。
- **房间运行模式档位**：移植 roomMode 参数表（low/main/high/rush），模式解析（显式设置 > cpu 档位默认）与持久化（schema 升版），消费方统一读 profile 参数（本期接：升级定编倍率、快递总闸）。
- **自爆拉能快递**：移植 rushSupport 五闸门发车决策——spawn 盈余时孵纯 CARRY 快递爬，取满后向控制器/cc 方向自爆，墓碑能量由升级工就近拾取；绝不挤占基础孵化。
- **冲级分段判废接线**：移植分段评估与判废归因（达成/落后/判废 + 快照），接入既有冲级面板（RUSH_CONFIG 已在役）。
- 回归与勾销：rcl-sprint 3/3 断言通过（含 RCL4@40000）、boot-from-scratch 与 9 房场景不回退，docs/bugs P1-14 勾销、docs/14 进度快照刷新。

## Capabilities

### New Capabilities

- `controller-upgrade-buffer`: 控制器升级缓冲——cc 容器放置决策（控制器旁容器选址权归属）、补货配额流、升级工位就位直供行为。
- `adaptive-body-factory`: 体型编译——按能量预算现算体型、按房间地形（沼泽密度/路网覆盖）调整 MOVE 配比，取代固定段模板口径。
- `room-mode-profiles`: 房间运行模式档位——low/main/high/rush 参数表、模式解析优先级与默认值、消费方统一读取契约。
- `rush-courier`: 拉能快递——spawn 盈余能量的自爆转运机制、发车闸门与不挤占基础孵化的约束。

### Modified Capabilities

（无——openspec/specs 主规格当前为空，全部以新 capability 建立。）

## Impact

- **代码**：`src/modules/planner/`（cc 选址与落位）、`src/modules/economy/`（quota 补货、快递请求、定编口径）、`src/modules/spawning/`（bodyFactory 体型编译、spawnDirector 排产）、`src/modules/agents/`（升级工位直供、快递角色行为、suicide 意图）、`src/modules/strategy/`（roomMode resolver）、`src/modules/visuals/`（判废行与 mode 显示）、`src/utils/`（体型与分段评估纯函数）。
- **参照实现（只读移植源，保持 既有实现）**：既有实现 (`modules/shared/rush.ts`)、`roomMode.ts`、`upgradeBody.ts`、`prototype/Room/function/rushSupport.ts`、`roomWorkforce.ts`（升级工位与体型口径参考）。
- **配置**：`src/config/`（roomMode 档位表、cc/courier/terrain 参数全部入配置，零硬编码）。
- **Memory schema**：v8 → v9（`rooms[x].mode` 可选字段 + 迁移）。
- **回归**：sim rcl-sprint（验收主线：RCL4@40000 / cpuP95<20 / noErrors）、boot-from-scratch、9 房场景；docs/bugs 勾销、docs/14 与 docs/21 进度更新。
