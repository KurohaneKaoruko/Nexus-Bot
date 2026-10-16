
/**
 * 原型运行时驱动层: 挂载引擎原型方法 (Room/Creep/Flag/RoomVisual/RoomPosition),
 * 逐己方房驱动原型特性链 (任务池消费/能量状态) + 旗标链。
 * Nexus 任务板处理核心经济 (harvester/carrier/upgrader/worker);
 * 原型方法族 (goTransfer/moveToRoom/doubleMove 等) 是角色行为库的现行 API。
 */
import mountCreep from '@/modules/agents/prototype/Creep'
import mountFlag from '@/modules/agents/prototype/Flag'
import mountRoom from '@/modules/agents/prototype/Room'
import mountRoomPosition from '@/modules/agents/prototype/RoomPosition'
import mountRoomVisual from '@/modules/agents/prototype/RoomVisual'
import { ConsoleExtension } from '@/console'
import { qos } from '@/core/qos'
import '@/core/structureCache'
import { registerFillRequestProvider } from '@/modules/economy/roomWorkforce'
import { buildFillRequests } from '@/modules/economy/energyLogistics'
import { registerOutMineIncomeProvider } from '@/modules/external/outMine'
import { updateBucketGovernor } from '@/core/bucketGovernor'
import type { TickContext, TickModule } from '@/core'

let mounted = false;

function ensureMounted(): void {
	if (mounted) return;
	mountCreep();
	mountFlag();
	mountRoom();
	mountRoomPosition();
	mountRoomVisual();
	ConsoleExtension();
	registerFillRequestProvider(buildFillRequests);
	registerOutMineIncomeProvider();
	mounted = true;
}

function runRoomFeatures(room: Room): void {
	const tier = qos.getQoS()?.level ?? 'normal'

	// ── 基础结构状态 (每 tick, 不可延迟) ──
	// 孵化池 spawn 链已退役 (directSpawn 主线化), MissionUpdate 仅维护任务池产出
	// 工业结构链由 Industry 域驱动; 塔控/主动防御由主线 Defense (broker) 独家驱动,
	// legacy TowerWork/activeDefense 退役——装配回收期 qos.getRoomQosLevel 从不存在,
	// 特性链实际静默死亡期间主线单轨已验证
	// 孵化消费端 (SpawnWork → spawnControl.SpawnCreep) 已退役: 与主线 spawnDirector
	// 双孵化器分治——攒能/让位政策只约束主线, legacy 按平行定编静默孵化 (sim 实证
	// 全场 179 只中 139 只无日志孵化, 让位期仍孵 upgrader/worker 把攒能窗口抽干)。
	// 生产端 (UpdateSpawnMission) 保留: 池内挂单计入 pending 有自然上界; 消费走主线。
	room.MissionUpdate?.()
	room.updateEnergyState?.(false)

	// 外矿双体系勘误 (2026-10-15): 外矿由任务板系 planRemoteHarvest 独家驱动
	// (economy/remoteMining, scout→远程采集任务)。原型系 outMine()/ExternalMine
	// 全链 (cc 保活/外矿编制/跨房搬运) 保持休眠——两套并行会双份 scout/编制,
	// 实测 CPU p95 14→51ms、arena 40k 不进 L3 (docs/bugs sim-audit-10-12 (七))。
	// 若未来启用原型系, 必须同时关闭任务板侧的 remoteMining 开关。

	if (tier !== 'normal') return
}

function runFlagFeatures(): void {
	for (const flag of Object.values(Game.flags)) {
		if (flag.handleSetPositionFlag()) continue;
		if (flag.handleNukeFlag()) continue;
		if (flag.handleWarSpawnFlag()) continue;
		if (flag.handleLayoutVisualFlag()) continue;
	}
}

export const RoomFeatures: TickModule = {
	name: 'room-features',
	phase: 'planning',
	band: 'P2',
	run(_ctx: TickContext): void {
		ensureMounted()
		updateBucketGovernor()
		runFlagFeatures()
		for (const room of Object.values(Game.rooms)) {
			if (!room.controller?.my) continue
			runRoomFeatures(room)
		}
	},
}
