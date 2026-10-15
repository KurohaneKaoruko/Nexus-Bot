// arena: 私服 speedrun 演练 (平地单房, 20k tick = 榜单赛制窗口)
// 计分口径 = 累计控制器进度 (L4 基线 180,200 / L5 基线 585,200);
// 单房满采满升理论上限 ~20/t, 20k 满分 ~400k。榜面参照: 前五门槛 742,802 (多房)。
import { defineSim } from 'screeps-sim'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map((name) => ({
	name,
	terrain: { kind: 'flat' } as const,
	sources: { count: 2, energy: 3000 },
}))

export default defineSim({
	name: 'arena',
	description: '私服 speedrun 演练: 平地双源 40k (=服务器次档窗口), 升级吞吐是唯一指标',
	seed: 7,
	ticks: 40000,
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
		// 等级阶梯统计到 RCL6: 单行摘要的 RCL 时间线 + 断言详情行报告各等级耗时 (减 L1 即落地后)
		{ kind: 'rclReachedBy', value: 2, tick: 2000 },
		{ kind: 'rclReachedBy', value: 3, tick: 8000 },
		{ kind: 'rclReachedBy', value: 4, tick: 15000 },
		{ kind: 'rclReachedBy', value: 5, tick: 30000 },
		{ kind: 'rclReachedBy', value: 6, tick: 40000 },
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
