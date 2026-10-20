// boot-from-scratch: 空房间从零启动 (回归基线: RCL2 ≤500 / 断言 3/3)
import { defineSim } from 'screeps-sim'

/** 主房周围的 8 个邻房 (跨房视野/远征行为的舞台) */
const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map((name) => ({
	name,
	terrain: { kind: 'flat' } as const,
	sources: { count: 2, energy: 3000 },
}))

export default defineSim({
	name: 'boot-from-scratch',
	description: '空房间从零启动 (平地 9 房世界, 基线 RCL2@~550)',
	seed: 42,
	ticks: 20000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	alwaysVisible: false,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'flat' },
			sources: { positions: [[18, 22], [32, 30]] },
			controller: { level: 1, pos: [28, 27] },
			mineral: { pos: [38, 38], type: 'H', amount: 30000 },
			structures: [{ type: 'spawn', pos: [25, 25], energy: 300 }],
			creeps: [],
		},
		...neighbors,
	],
	asserts: [
		// RCL2 达标线 (用户口径 2026-10-20): ≤500 达标, >1000 视为不合格。
		// 旧值 5000 形同虚设 (实测 L2@330, 探针图 L2@458)。
		{ kind: 'rclReachedBy', value: 2, tick: 500 },
		{ kind: 'creepCountAtLeast', value: 2 },
		{ kind: 'noErrors' },
	],
})
