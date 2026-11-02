// remote-roads: 外矿路网二期验证 (docs/nexus-design/13 §24.2)
// 链路: active 房 → 干线规划落盘 layout.roads → createSite 放量 → 路段建成 coverage↑
//       → 损毁路段 repair 任务 → pavedThreshold 后搬运体路面配比
// 场景骨架沿用 remote-mine (manual 档预置双目标, RCL4+storage 开闸)
import { defineSim } from 'screeps-sim'

const presetMemory = JSON.stringify({
	Nexus: {
		schemaVersion: 11,
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

export default defineSim({
	name: 'remote-roads',
	description: '外矿路网: 干线规划落盘/放量/coverage 爬升/维修链 (二期 1.2-3.1)',
	seed: 7,
	ticks: 30000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 4, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				{ type: 'extension', pos: [24, 24], energy: 50 },
				{ type: 'extension', pos: [26, 24], energy: 50 },
				{ type: 'extension', pos: [24, 26], energy: 50 },
				{ type: 'extension', pos: [26, 26], energy: 50 },
				{ type: 'extension', pos: [23, 25], energy: 50 },
				{ type: 'storage', pos: [26, 25], store: { energy: 20000 } },
			],
			creeps: [],
		},
		{
			name: 'W5N9',
			terrain: { kind: 'generated', seed: 8 },
			sources: { count: 2, energy: 3000 },
			controller: { pos: [28, 27] },
			creeps: [],
		},
	],
	asserts: [
		{ kind: 'creepCountAtLeast', value: 8 },
		{ kind: 'rclAtLeast', value: 3 },
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
