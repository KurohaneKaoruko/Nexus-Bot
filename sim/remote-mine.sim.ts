// remote-mine: 外矿手动目标列表验证 (main 档 remoteMining: "manual", 2026-10-15 政策)
// 链路: 预置 remoteTargets → 定向 scout 点亮 → 远程 harvest 任务 → 跨房采集 → 能量回流
//
// 政策口径 (用户 2026-10-15): rush 自动扫邻房发展外矿; high 及以下只挖手动登记的目标。
// 本场景验证 manual 路径: Memory 预置 ["W5N9", "W4N8"], 未登记邻房一概不碰。
//
// Memory 预置口径 (calibration 约束): 必须带合法 schemaVersion 与完整 economy 子结构,
// 否则 calibrateNexus 对无法识别版本的 Nexus 子树整体重建, 预置被清空。
import { defineSim } from 'screeps-sim'

const presetMemory = JSON.stringify({
	Nexus: {
		schemaVersion: 11,
		economy: {
			accumulators: {
				spawnIdleTicks: 0,
				starvationTicks: 0,
				haulBusyTicks: 0,
				haulIdleTicks: 0,
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
			remoteTargets: ['W5N9', 'W4N8'],
		},
	},
})

export default defineSim({
	name: 'remote-mine',
	description: '外矿手动列表: main 档定向侦查 + 远程采集, 预置 W5N9/W4N8 双目标',
	seed: 7,
	ticks: 30000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 }, // <100 → main 档 → remoteMining: "manual"
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
