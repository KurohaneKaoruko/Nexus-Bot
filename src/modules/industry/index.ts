
/**
 * 工业域模块: 结构控制链 (link/终端/lab/工厂/PowerSpawn, 每 tick) +
 * 自动化链 (autoLab/autoFactory/autoMarket/autoPowerSpawn, QoS normal 档)。
 * 原 roomFeatures 特性链的工业部分承接, 时序语义保真 (结构控制先于可延迟自动化)。
 */
import { qos } from '@/core/qos'
import { linkWork } from '@/modules/industry/controls/linkControl'
import { terminalWork } from '@/modules/industry/controls/terminalControl'
import { planBoostLabWork as boostLabWork } from '@/modules/industry/boostLabWork'
import { labWork } from '@/modules/industry/controls/labControl'
import { factoryWork } from '@/modules/industry/controls/factoryControl'
import { powerSpawnWork } from '@/modules/industry/controls/powerSpawnControl'
import { runObserveWork, runObserveCallbackTick } from '@/modules/industry/controls/observeControl'
import { runAutoLab } from '@/modules/industry/autoLab'
import { runAutoFactory } from '@/modules/industry/autoFactory'
import { runAutoMarket } from '@/modules/industry/autoMarket'
import { runAutoPower } from '@/modules/industry/autoPowerSpawn'
import { NukeModule } from '@/modules/industry/nukeSync'
import type { TickContext, TickModule } from '@/core'

function runIndustry(room: Room): void {
	const tier = qos.getQoS()?.level ?? 'normal'

	// ── 结构控制 (每 tick, 不可延迟) ──
	runObserveCallbackTick()
	linkWork(room)
	terminalWork(room)
	boostLabWork(room)
	labWork(room)
	factoryWork(room)
	powerSpawnWork(room)
	runObserveWork(room)

	if (tier !== 'normal') return

	// ── 可延迟自动化 ──
	runAutoLab(room)
	runAutoFactory(room)
	runAutoMarket(room)
	runAutoPower(room)
}

// 核弹请求→旗标同步 (QoS 门控独立于房间循环)
export const Nukes: TickModule = {
	name: 'nukes',
	phase: 'planning',
	band: 'P2',
	run(_ctx: TickContext): void {
		NukeModule.tick?.()
	},
}

export const Industry: TickModule = {
	name: 'industry',
	phase: 'planning',
	band: 'P2',
	run(_ctx: TickContext): void {
		for (const room of Object.values(Game.rooms)) {
			if (!room.controller?.my) continue
			runIndustry(room)
		}
	},
}

// ── 公共面: 控制台命令族 (console 宿主装配) ──
export { default as factory } from '@/modules/industry/console/factory'
export { default as lab } from '@/modules/industry/console/lab'
export { default as nuker } from '@/modules/industry/console/nuker'
export { default as powerSpawn } from '@/modules/industry/console/powerspawn'
export { default as spawn } from '@/modules/industry/console/spawn'
export { default as terminal } from '@/modules/industry/console/terminal'

// ── 公共面: 实验室预定 / 观测队列 ──
export {
	ensureBoostLabs,
	getLabAB,
	resolveLabFromMem,
	type BoostLabsMemory,
} from '@/modules/industry/labReservations'
export { observeRoom } from '@/modules/industry/controls/observeControl'
