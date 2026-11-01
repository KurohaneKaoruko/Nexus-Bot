// run-residue: 实服 4wt 重开残留死锁复现 (bugs/scout-run-residue-overrun)
// 场景: Memory 预置上一 run 残留任务 (旧房 scout + 旧世界远程 harvest 任务),
// 房间只有本矿 W5N8 —— 复现 run#20: carrier-only 连孵 / 采集面空转 / RCL1 锁死。
// 验证 C 层清理 (roomName + targetPos.roomName 双口径) 能解锁: 孵化面恢复 harvester。
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
			remoteTargets: [],
		},
		// 上一 run 残留: 旧主房 scout 任务 (roomName 已非我房) + 旧邻房远程 harvest
		// (roomName 仍是本房名, 但 targetPos 指向已不存在的旧世界房间)
		tasks: {
			tresidue01: {
				id: 'tresidue01',
				dedupeKey: 'scout:W2N4:W3N3',
				kind: 'scout',
				status: 'available',
				roomName: 'W2N4',
				priority: 55,
				createdAt: 1,
				updatedAt: 1,
				requiredCapabilities: ['move'],
				attempts: 0,
				maxAttempts: 5,
				targetPos: { x: 25, y: 25, roomName: 'W3N3' },
			},
			tresidue02: {
				id: 'tresidue02',
				dedupeKey: 'harvest:W5N8:legacy-remote-a',
				kind: 'harvest',
				status: 'available',
				roomName: 'W5N8',
				priority: 55,
				createdAt: 1,
				updatedAt: 1,
				requiredCapabilities: ['work', 'move'],
				attempts: 0,
				maxAttempts: 5,
				targetId: 'legacy-source-a',
				targetPos: { x: 25, y: 25, roomName: 'W9N5' },
			},
			tresidue03: {
				id: 'tresidue03',
				dedupeKey: 'harvest:W5N8:legacy-remote-b',
				kind: 'harvest',
				status: 'available',
				roomName: 'W5N8',
				priority: 55,
				createdAt: 1,
				updatedAt: 1,
				requiredCapabilities: ['work', 'move'],
				attempts: 0,
				maxAttempts: 5,
				targetId: 'legacy-source-b',
				targetPos: { x: 26, y: 26, roomName: 'W9N5' },
			},
		},
	},
})

export default defineSim({
	name: 'run-residue',
	description: '4wt 重开残留任务死锁复现: 旧房 scout + 旧世界远程 harvest 残留',
	seed: 11,
	ticks: 6000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 11 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 1, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [{ type: 'spawn', pos: [25, 25], energy: 300 }],
			creeps: [],
		},
	],
	asserts: [
		// 残留死锁解除: 采集面恢复 + 进度推进 (L2 5000t 内, 对齐 boot 场景口径)
		{ kind: 'rclReachedBy', value: 2, tick: 5000 },
		{ kind: 'creepCountAtLeast', value: 2 },
		{ kind: 'noErrors' },
	],
})
