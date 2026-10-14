# 10. 侦察、房间评估与扩张策略

## 10.1 扩张是投资，不是自动占地

每增加一个房间，Bot 获得更多资源与战略位置，也增加 Spawn、单位生产、运输、防御、Memory 和 CPU 成本。扩张模块应比较预期净收益和长期风险，而不是单纯看到中立 Controller 就派 Claim Creep。

## 10.2 侦察状态机

建议使用：

`Unknown → Candidate → Scouting → Evaluated → Reserved/ClaimPlanned → Settling → Operational`

也允许退回：

- `Evaluated → Rejected`：收益不足或风险太高；
- `Scouting → Stale`：情报过时，需要重访；
- `ClaimPlanned → Paused`：GCL、能源或防御能力不足；
- `Operational → UnderThreat`：当前殖民地需要局部或全局调整。

每次转移记录原因，避免每个 Tick 因为轻微变化反复改状态。

## 10.3 房间价值评分

评分可由以下分项组成：

`RoomValue = sourcePotential + mineralValue + strategicPosition + infrastructureValue - travelCost - defenseRisk - settlementCost - CPUOverhead`

其中：

- Source 数量和可达性影响基础能源潜力；
- Mineral 类型与产业规划/市场需求关联；
- 路程影响矿工到岗、运力需求、替补时间与风险；
- 邻接地理位置影响 RoomGraph 和后续扩张；
- 敌对势力、NPC 区域事件、狭窄入口与情报过期增加风险；
- 目标房间需要的 Spawn/道路/Extension 等建设是一次性与长期投入；
- 已达到 GCL 房间上限时，可以考虑预定或等待而不是盲目占领。

所有权/预定状态和房间等级应以实时可见对象为准；不可见区域只能依据带置信度的 Intel 估算。

## 10.4 远程采集的单位经济

远程 Source 的名义产能不是实际收益。应估算：

- 采集者产能与固定工作位；
- 从 Source 到缓存点的距离；
- 从缓存点到本地消费/储存的搬运周转时间；
- 需要多少运输容量；
- 路线上的风险与替补延迟；
- 是否能用 Link/Container 优化；
- 失去一个单位对总产出会造成多大影响。

如果路程增加导致运输成本超过产量增益，应拒绝该目标、只保留侦察，或将其变成独立前哨并调整资源转移策略。

## 10.5 Reserve 与 Claim

Reserve 和 Claim 具有不同战略目的。Reserve 可以维护/延长对 Controller 的预定，并可影响 Source 状态（以当前规则/API 为准）；Claim 则把房间纳入自己的控制体系、消耗 GCL 名额并要求后续维持。

扩张计划应显式判断：

- 当前是否还有可用 GCL 房间名额；
- 目标更适合远程开采、预定还是建立正式殖民地；
- 是否有可靠的 Controller 占领者与建造/补给队列；
- 房间失守后是否会形成不可接受的连锁影响。

## 10.6 Settling 流程

对正式殖民地建议分段实施：

1. 先完成侦察并确认房间价值；
2. 计算 Claim Creep、首批经济 Creep、运输与防御单位的生产/路途时间；
3. 预留资源并确认本地基地不因此出现生产缺口；
4. 派遣占领单位；
5. 占领后优先建造必要 Spawn 及经济基础设施；
6. 将基础经济与主房间隔离核算，避免新房间长期净消耗却被隐藏在全局总数中；
7. 达成产出、RCL、补给或安全阈值后将状态标记为 `Operational`。

## 10.7 失去房间与撤退

Bot 必须能承认失败：如果房间长期遭受威胁、物流亏损、关键设施反复被摧毁或维护成本显著超过收益，应评估暂停远程采集、撤回机体、缩减投资。已经投入的资源属于沉没成本，不能成为继续投入的唯一理由。

## 10.8 Scout 的路径与信息任务

Scout 不只是“走到那里”。它可以获得：出口连接、房间归属、Source/Mineral、敌方结构、道路和危险情报。任务应该根据目标信息的缺口和信息时效分配：高价值邻接房间比无关远区更值得频繁侦察。

使用 Observer 或跨 Shard 机制前，先评估是否真能降低总成本；不要把每一种 API 都变成常态运行模块。

