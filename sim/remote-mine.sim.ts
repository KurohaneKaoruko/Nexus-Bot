// remote-mine: 外矿同名-role 验证 (main 档 remoteMining 开闸)
// 链路: 邻房不可见 → scout 任务 → 侦查 → 远程 harvest 任务 → 跨房采集 → 能量回流
import { defineSim } from 'screeps-sim'

export default defineSim({
	name: 'remote-mine',
	description: '外矿同名-role: main 档侦查邻房 + 远程采集, 邻房 flat 双源保通关性',
	seed: 7,
	ticks: 30000,
	cpu: { limit: 20, bucket: 10000 }, // <100 → main 档 → remoteMining 开
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 3, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				{ type: 'extension', pos: [24, 24], energy: 50 },
				{ type: 'extension', pos: [26, 24], energy: 50 },
				{ type: 'extension', pos: [24, 26], energy: 50 },
				{ type: 'extension', pos: [26, 26], energy: 50 },
				{ type: 'extension', pos: [23, 25], energy: 50 },
			],
			creeps: [],
		},
		// 邻房: 平地双源 (侦查可达 + 远程采集收益)
		{
			name: 'W5N9',
			terrain: { kind: 'flat' },
			sources: { count: 2, energy: 3000 },
		},
		{
			name: 'W4N8',
			terrain: { kind: 'flat' },
			sources: { count: 1, energy: 3000 },
		},
	],
	asserts: [
		// 外矿编制防回退: 开闸比关闸 (12) 多 scout+远程 harvester ≥1
		{ kind: 'creepCountAtLeast', value: 13 },
		{ kind: 'rclAtLeast', value: 3 },
		// 外矿链路无错误 + 经济不退级 (远程源增量下 RCL3 维持/上行) + CPU 预算内
		
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
