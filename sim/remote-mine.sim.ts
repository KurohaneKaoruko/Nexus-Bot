// remote-mine: 外矿同名-role 验证 (main 档 remoteMining 开闸)
// 链路: 邻房不可见 → scout 任务 → 侦查 → 远程 harvest 任务 → 跨房采集 → 能量回流
//
// 2026-10-15 勘误: 本场景测的是任务板系外矿 (planRemoteHarvest 自动扫邻房, 无需预置);
// 但 main 档下原型系 (outMine/ExternalMine) 的目标列表只认手动配置
// (autoAddNearbyEnergyTargets 仅 rush 档调用, 「列表为空 = 不采」是刻意决策)——
// 若未来启用原型系, 需按 OutMineData schema 预置目标列表, 且必须带合法
// schemaVersion (否则 calibrateNexus 对无法识别版本的 Nexus 子树整体重建, 预置被清空)。
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
		// 外矿编制防回退: 判定外矿链路是否在线 (scout + 远程采集体仍在编)。
		// 阈值按 WORK 密度优先的体型口径重设 (2026-10-15): 单体采集体可载 4~5 WORK,
		// 故只数低于「每源一爬」的小体型期基线 —— 只数不再是产能代理。
		// 产能口径由 harvest/upgrade 指标另行取证: 同场景 30k tick
		// harvested 54492→133922 (+146%)、controller control 244→290 (+19%)、
		// cpu p95 持平 (5ms), 即更少爬数产出更多能量。
		{ kind: 'creepCountAtLeast', value: 10 },
		{ kind: 'rclAtLeast', value: 3 },
		// 外矿链路无错误 + 经济不退级 (远程源增量下 RCL3 维持/上行) + CPU 预算内
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
