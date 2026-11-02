// remote-threat: 外矿安全链路验证 (phase4-remote-intel 8.3)
// 三个邻房对照: W5N9 放敌方单位 (威胁暂停路径), W4N8 放敌方结构 (安全否决
// rejected 路径), W5N7 干净 (active 对照样)。
// 断言: noErrors / cpuP95; dump-memory 核对 W5N9 有 remote-scope 威胁记录、
// 全局姿态未切 war、W4N8 rejected (unsafe)、W5N7 进入 active。
import { defineSim } from 'screeps-sim'

const presetMemory = JSON.stringify({
	Nexus: {
		schemaVersion: 17,
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
			remoteTargets: ['W5N9', 'W4N8', 'W5N7'],
		},
	},
})

// RCL5: 容量 800 (10 ext × 50 + 300 spawn + 200 storage 初始无关, ext 满配)
const ext = []
for (let i = 0; i < 10; i += 1) {
	const x = 20 + (i % 5), y = 22 + Math.floor(i / 5)
	ext.push({ type: 'extension', pos: [x, y], energy: 50 })
}

export default defineSim({
	name: 'remote-threat',
	description: '外矿安全: 敌方单位暂停路径 + 敌方结构剔除路径 + 干净对照 active',
	seed: 7,
	ticks: 12000,
	memory: presetMemory,
	cpu: { limit: 20, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'generated', seed: 7 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 5, progress: 0, pos: [28, 27] },
			mineral: { pos: [10, 40], type: 'O', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
				...ext,
				{ type: 'storage', pos: [23, 26], store: { energy: 50000 } },
			],
		},
		{
			name: 'W5N9',
			terrain: { kind: 'generated', seed: 8 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 5], mine: false },
			creeps: [
				// 敌方战斗体: 威胁评分远超 pause 线; 长 ttl 保证威胁窗口覆盖 active 后
				{ name: 'raider', body: ['attack', 'attack', 'attack', 'move'], pos: [20, 20], enemy: true, ttl: 100000 },
			],
		},
		{
			name: 'W4N8',
			terrain: { kind: 'generated', seed: 9 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 5], mine: false },
			structures: [
				// invader core: 安全否决路径 (敌对结构, 无 RCL 限制)
				{ type: 'invaderCore', pos: [25, 25], hits: 100000, enemy: true },
			],
		},
		{
			name: 'W5N7',
			terrain: { kind: 'generated', seed: 10 },
			sources: { count: 2, energy: 3000 },
			controller: { level: 0, pos: [25, 5], mine: false },
		},
	],
	asserts: [
		{ kind: 'noErrors' },
		{ kind: 'cpuP95Below', value: 20 },
		// 四链 memoryPath 断言 (三期 4.1, 引擎 ttl 修复后敌人寿命不再被抹):
		// 分类 = W5N9 威胁在册 (raider, scope=remote) / 编队 = 清理编队请求
		// / 止损 = W4N8 安全否决 (invader core 是结构, 走 rejected 不走 threat)
		// / 恢复 = W5N7 干净对照 active。W5N7 无威胁是对照断言。
		{ kind: 'memoryPath', path: ['Nexus', 'rooms', 'W5N9', 'threat', 'scope'], exists: true },
		{ kind: 'memoryPath', path: ['Nexus', 'squads', 'squad:remote:W5N9'], exists: true },
		{ kind: 'memoryPath', path: ['Nexus', 'rooms', 'W4N8', 'invaderCore'], exists: true },
		{ kind: 'memoryPath', path: ['Nexus', 'rooms', 'W5N7', 'threat'], exists: false },
		{ kind: 'memoryPath', path: ['Nexus', 'remotes', 'W5N8', 'rooms', 'W5N7', 'state'], exists: true },
		{ kind: 'memoryPath', path: ['Nexus', 'remotes', 'W5N8', 'rooms', 'W4N8', 'state'], exists: true },
	],
})
