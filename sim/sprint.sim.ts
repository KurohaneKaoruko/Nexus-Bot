// rcl-sprint: 种子地形冲级场景 (P1-14 验收: RCL4 ≤40000, 2026-10-12 基线未过)
import { defineSim } from 'screeps-sim'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map((name) => ({
	name,
	terrain: { kind: 'flat' } as const,
	sources: { count: 2, energy: 3000 },
		// 中立控制器: 官方世界规则所有房都有 controller, 外矿链依赖其存在
		// (2026-10-19 race 对照实证: 缺失则外矿侦查断链)
		controller: { level: 0, pos: [25, 25] as [number, number], mine: false },
}))

export default defineSim({
	name: 'rcl-sprint',
	description: '种子地形冲级场景: 沼泽墙阻 + 双 source, 长跑验证经济与 CPU 曲线',
	seed: 7,
	ticks: 50000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 1, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [{ type: 'spawn', pos: [25, 25], energy: 300 }],
			creeps: [],
		},
		...neighbors,
	],
	asserts: [
		{ kind: 'rclReachedBy', value: 4, tick: 40000 },
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
