// 冲级体型取证: 短场跑 6000t, 记录每次孵化的体型与能量环境 (race 引擎专用场)
//
// 世界复刻私服新世界 (同 speedrun 场景口径): 上游地形 + 源 (21,13)/(30,29) +
// ctrl(18,24)/spawn(26,24)。旧 flat+自动源位配置下 race 引擎 roomOk=false
// 整场待机, 审计的其实是 main 变体 (2026-10-29 勘误)。
import { defineSim } from 'screeps-sim'
import { UPSTREAM_TERRAIN } from './_upstream-world.ts'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map(
	(name) => ({
		name,
		terrain: UPSTREAM_TERRAIN,
		sources: { positions: [[21, 13], [30, 29]] as [number, number][] },
		controller: { level: 0, pos: [17, 25] as [number, number], mine: false },
		mineral: { pos: [34, 6] as [number, number], type: 'O' as const, amount: 35000 },
		alwaysVisible: false,
		objects: [] as unknown[],
	}),
)

export default defineSim({
	name: 'race-body-audit',
	description: '冲级体型审计 (race 引擎): 6000t 记录孵化体型构成',
	seed: 42,
	ticks: 6000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	bundle: '../dist-race/main.js',
	rooms: [
		{
			name: 'W5N8',
			terrain: UPSTREAM_TERRAIN,
			sources: { positions: [[21, 13], [30, 29]] as [number, number][] },
			controller: { level: 1, pos: [18, 24] },
			structures: [{ type: 'spawn', pos: [26, 24], energy: 300 }],
			creeps: [] as unknown[],
		},
		...neighbors,
	],
	asserts: [
		{ kind: 'rclReachedBy' as const, value: 2, tick: 2000 },
		{ kind: 'noErrors' as const },
	],
})
