
/**
 * 原型运行时驱动层: 挂载引擎原型方法 (Room/Creep/Flag/RoomVisual/RoomPosition),
 * 逐己方房驱动原型特性链 (任务池消费/能量状态) + 旗标链。
 * Nexus 任务板处理核心经济 (harvester/carrier/upgrader/worker);
 * 原型方法族 (goTransfer/moveToRoom/doubleMove 等) 是角色行为库的现行 API。
 */
import mountCreep from '@/proto/Creep'
import mountFlag from '@/proto/Flag'
import mountRoom from '@/proto/Room'
import mountRoomPosition from '@/proto/RoomPosition'
import mountRoomVisual from '@/modules/visuals/proto'
import { ConsoleExtension } from '@/console'
import { qos } from '@/core/qos'
import '@/core/structureCache'
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
	mounted = true;
}

function runRoomFeatures(room: Room): void {
	const tier = qos.getQoS()?.level ?? 'normal'

	// ── 基础结构状态 (每 tick, 不可延迟) ──
	// 孵化池 spawn 链已退役 (directSpawn 主线化): 生产端 UpdateSpawnMission 连带
	// spawnRules/spawnMission Getter 已删 (5.6 批次二, 挂单零消费者实证);
	// (该拍任务调度位已退役, 语义在 planning 阶段任务板)
	// (economy planners/mineralWork + industry boostLabWork/terminalWork 读簿记),
	// spawn 池仅剩 warSpawn/external 去重计数消费 (spawnLoad), 不经调度入口维护;
	// 工业结构链由 Industry 域驱动; 塔控/主动防御由主线 Defense (broker) 独家驱动,
	// legacy TowerWork/activeDefense 退役——装配回收期 qos.getRoomQosLevel 从不存在,
	// 特性链实际静默死亡期间主线单轨已验证
	// 孵化消费端 (SpawnWork → spawnControl.SpawnCreep) 已退役: 与主线 spawnDirector
	// 双孵化器分治——攒能/让位政策只约束主线, legacy 按平行定编静默孵化 (sim 实证
	// 全场 179 只中 139 只无日志孵化, 让位期仍孵 upgrader/worker 把攒能窗口抽干)。
	room.updateEnergyState?.(false)

	// 外矿双体系勘误 (2026-10-15, C 波已收口 2026-10-29): 外矿由任务板系
	// planRemoteHarvest 独家驱动 (economy/remoteMining, scout→远程采集任务)。
	// 原型系外矿采集链 (mine/* + outMine/externalMine/externalScheduler) 已随
	// legacy-consolidation-b C 波退役删除; 人操簿记面存续 (console mine.ts +
	// Memory.OutMineData, mineralWork 消费)。

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
