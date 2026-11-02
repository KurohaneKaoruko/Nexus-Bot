// remote-keeper: SK 房采集链验证 (remote-keeper 四期)
// 链路: W5N4 (keeper 房) pin → RCL 门槛过 → scouting/评估 (keeper 口径净收益) →
//       active → keeperHold 常驻编队 (slots=lair 数) → 覆盖成立才派采集 →
//       lair 观测落 Intel (lairs 数组) → 元素矿 remote:mineral 登记。
// 对照: W5N2 (normal) 常规外矿不受 SK 门影响。
// 断言: noErrors / cpuP95; dump-memory 核对编队/任务/lairs/矿任务。
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
			remoteTargets: ['W5N4', 'W5N2'],
		},
	},
})

// RCL6: 20 ext (RCL6 满配) + spawn 300 + storage
const ext = []
for (let i = 0; i < 20; i += 1) {
	const x = 18 + (i % 7), y = 20 + Math.floor(i / 7)
	ext.push({ type: 'extension', pos: [x, y], energy: 50 })
}

export default defineSim({
	name: 'remote-keeper',
	description: 'SK 房采集链: keeper 房 pin → 覆盖编队 → 采集节律 → 元素矿登记',
	seed: 7,
	ticks: 8000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N3',
			// seed 7 = remote-mine 已验证地形 (travel 正常); 场景首轮 seed 11 实测
			// harvester 到岗 p95 1014t, 往返超寿命 → 换代循环烧光孵化产能
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 6, progress: 0, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				...ext,
				{ type: 'storage', pos: [23, 26], store: { energy: 80000 } },
				{ type: 'terminal', pos: [21, 28], store: { energy: 20000 } },
			],
		},
		{
			name: 'W5N4',
			terrain: { kind: 'generated', seed: 12 },
			// SK 房定式: 3 源 4000 容量
			sources: { count: 3, energy: 4000 },
			controller: { level: 0, pos: [25, 5], mine: false },
			mineral: { pos: [40, 40], type: 'X', amount: 50000 },
			structures: [
				// keeperLair ×3 (守卫最近源; 引擎自动定刷 keeper)
				{ type: 'keeperLair', pos: [8, 8] },
				{ type: 'keeperLair', pos: [8, 42] },
				{ type: 'keeperLair', pos: [42, 25] },
			],
		},
		{
			name: 'W5N2',
			terrain: { kind: 'generated', seed: 13 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 5], mine: false },
		},
	],
	asserts: [
		{ kind: 'noErrors' },
		{ kind: 'cpuP95Below', value: 20 },
	],
})
