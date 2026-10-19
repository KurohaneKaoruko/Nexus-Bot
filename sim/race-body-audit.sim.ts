// 冲级体型取证: 短场跑 6000t, 记录每次孵化的体型与能量环境
import { defineSim } from 'screeps-sim'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map(
	(name) => ({
		name,
		terrain: { kind: 'flat' } as const,
		sources: { count: 2, energy: 3000 },
		// 中立控制器: 外矿链依赖 (2026-10-19 勘误)
		controller: { level: 0, pos: [25, 25] as [number, number], mine: false },
		alwaysVisible: false,
		objects: [] as unknown[],
	}),
)

export default defineSim({
	name: 'race-body-audit',
	description: '冲级体型审计: 6000t 记录孵化体型构成',
	seed: 7,
	ticks: 6000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'flat' },
			sources: { count: 2, energy: 3000 },
			controller: { level: 1, pos: [28, 27] },
			structures: [{ type: 'spawn', pos: [25, 25], energy: 300 }],
			creeps: [] as unknown[],
		},
		...neighbors,
	],
	asserts: [
		{ kind: 'noErrors' as const },
	],
})
