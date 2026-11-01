// roster-probe: 跨房单位名册取证 (phase4-remote-intel 0.1)
// 链路: 母房 W5N8 + 邻房 W5N9 (中立 ctrl); 预置 scout 单位 + 一条租给它的
// scout 任务 (targetRoom=W5N9)。观察单位跨房后:
//   ① world.dead 是否误报 (感知口径缺陷 §24.3 A)
//   ② Memory.creeps[name] / Memory.Nexus.units[name] 是否被死亡回收删除
//   ③ 单位是否在边界出口格来回 (驱动失联的自救抖动)
// Memory 预置口径 (calibration 约束): schemaVersion + 完整 economy 子结构,
// 否则 calibrateNexus 整体重建 (docs/25 B9)。
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
		},
		// 预置 scout 租约: 目标邻房, 租期宽裕 (deadline/leaseUntil 大值)
		tasks: {
			'tprobe1': {
				id: 'tprobe1',
				dedupeKey: 'scout:W5N9',
				kind: 'scout',
				status: 'leased',
				roomName: 'W5N9',
				targetPos: { x: 25, y: 25, roomName: 'W5N9' },
				priority: 9,
				createdAt: 1,
				updatedAt: 1,
				leaseUntil: 3000,
				deadline: 3000,
				requiredCapabilities: ['move'],
				assignedTo: 'probe-scout',
				attempts: 0,
				maxAttempts: 3,
			},
		},
		units: {
			'probe-scout': {
				name: 'probe-scout',
				unitCode: 'scout',
				homeRoom: 'W5N8',
				bornAt: 1,
				lastTaskChange: 1,
				taskId: 'tprobe1',
			},
		},
	},
	creeps: {
		'probe-scout': { unit: 'scout', homeRoom: 'W5N8', taskId: 'tprobe1' },
	},
})

export default defineSim({
	name: 'roster-probe',
	description: '名册回归: 跨房 scout 任务存活→到达→完成 (三缺陷修复后)',
	seed: 7,
	ticks: 300,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'flat' },
			sources: { positions: [[18, 22], [32, 30]] },
			controller: { level: 3, pos: [28, 27] },
			mineral: { pos: [38, 38], type: 'H', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				{ type: 'storage', pos: [26, 26], store: { energy: 5000 } },
			],
			creeps: [
				{ name: 'probe-scout', body: ['move', 'move'], pos: [48, 25] },
			],
		},
		{
			name: 'W5N9',
			terrain: { kind: 'flat' },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 25], mine: false },
			creeps: [],
		},
	],
	asserts: [
		{ kind: 'noErrors' },
		{ kind: 'cpuP95Below', value: 20 },
		// 修复后回归断言 (docs/bugs/cross-room-agent-deadlock 第 1 节):
		// ① 外房挂靠 scout 任务不再 t1 cancel (缺陷一) ② scout 跨房到达 (缺陷二,
		//   sim 角格穿越保真度修复后) ③ 任务 complete 不永挂 (缺陷三)。
		// 断言机制: defineSim 只有 rcl/creepCount/cpu 族, 任务级断言由
		// scripts/sim-matrix 外的专用复核 (npx screeps-sim + dump-memory)
		// 承接——本场景断言只守住运行时红线。
	],
})
