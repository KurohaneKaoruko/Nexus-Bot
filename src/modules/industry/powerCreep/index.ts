
import type { TickContext, TickModule } from '@/core'
import { log } from '@/utils/log'
import { extend } from '@/modules/agents/prototype/registry'
import BaseFunction from "@/modules/industry/powerCreep/function/baseFunction"
import PowerCreepDoubleAction from "@/modules/industry/powerCreep/function/doubleAction"
import PowerCreepUsePower from "@/modules/industry/powerCreep/function/usePower"
import PowerCreepExecute from "@/modules/industry/powerCreep/execute"

let mounted = false

function ensureMounted(): void {
	if (mounted) return
	extend(PowerCreep, BaseFunction)
	extend(PowerCreep, PowerCreepDoubleAction)
	extend(PowerCreep, PowerCreepUsePower)
	extend(PowerCreep, PowerCreepExecute)
	mounted = true
}

/**
 * 未孵化 pc 的自动孵化: idle 旗所在房有 powerSpawn 即尝试 (10t 节流 + 冷却检查)。
 */
function trySpawnDormant(pc: PowerCreep): void {
	if (Game.time % 10 !== 0) return
	if ((pc.spawnCooldownTime ?? 0) > Date.now()) return
	const flag = Game.flags[`${pc.name}-idle`] || Game.flags[`${pc.name}-IDLE`]
	const room = flag?.room
	const powerSpawn = room?.powerSpawn
	if (powerSpawn) {
		const result = pc.spawn(powerSpawn)
		if (result === OK) {
			log('PowerCreep', `PowerCreep ${pc.name} 在 ${room!.name} 孵化`)
		} else {
			log('PowerCreep', `PowerCreep ${pc.name} 在 ${room!.name} 孵化失败: ${result}`)
		}
	}
}

/**
 * PowerCreep 域模块: 原型挂载 + 全量 pc 驱动 (休眠自动孵化 / 在场执行)。
 * PowerCreep 聚合执行入口: 模式分发 + 辅助/自动操作编排。
 */
export const PowerCreeps: TickModule = {
	name: 'power-creeps',
	phase: 'commit',
	band: 'P2',
	run(_ctx: TickContext): void {
		ensureMounted()
		for (const pc of Object.values(Game.powerCreeps)) {
			if (!pc.ticksToLive) {
				trySpawnDormant(pc)
				continue
			}
			pc.exec()
		}
	},
}
