// remote-clear: 外矿清理编队验证 (remote-defense 三期)
// 链路: active 外矿进 invader → 状态机 paused → threat(nature=npc) →
//       planRemoteClearSquads 提 kind=remote 编队 → 槽位 defend 任务 →
//       defender 编制扩容孵化 → 跨房进军 → 击杀 → 威胁衰减 → 编队解散 → 恢复。
// 场景骨架沿用 remote-threat (单目标房 W5N9, 敌方低强度 npc 单位)。
import { defineSim } from 'screeps-sim'

const presetMemory = JSON.stringify({
	Nexus: {
		schemaVersion: 17,
		economy: {
			accumulators: {
				spawnIdleTicks: 0,
				starvationTicks: 0,
				carryBusyTicks: 0,
				carryIdleTicks: 0,
				energyStockDelta: 0,
			},
			lastStockTotal: 0,
			lastStockTick: 0,
			diagnosis: {
				bottleneck: 'none',
				carrierMultiplier: 1,
				upgraderBonus: 0,
				quotaFloorBias: 0,
				updatedAt: 0,
			},
			travel: {},
			remoteTargets: ['W5N9'],
		},
	},
})

const ext = []
for (let i = 0; i < 10; i += 1) {
	const x = 20 + (i % 5), y = 22 + Math.floor(i / 5)
	ext.push({ type: 'extension', pos: [x, y], energy: 50 })
}

export default defineSim({
	name: 'remote-clear',
	description: '外矿清理编队: invader 定时波次 → npc 威胁暂停 → remote 编队清杀 → 恢复',
	seed: 7,
	ticks: 20000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	npc: {
		invaders: {
			/** tick 6000 首波 (此时 W5N9 已 active) */
			first: 6000,
			every: 100000,
			squad: 1,
			lifetime: 4000,
		},
	},
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 5, progress: 0, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				...ext,
				{ type: 'storage', pos: [23, 26], store: { energy: 50000 } },
			],
		},
		{
			name: 'W5N9',
			terrain: { kind: 'generated', seed: 8 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 5], mine: false },
		},
	],
	asserts: [
		{ kind: 'noErrors' },
		{ kind: 'cpuP95Below', value: 20 },
	],
})
