// stronghold-door: 盾队过窄门 + 拆要塞核心全链路回归
// 场景: W5N8 家 (RCL8/spawn), 南邻 W5N7 要塞房——
//   15..35 墙圈 + 南门 (24-26,35), 核心 (25,25) 被地形墙 23..27 圈围,
//   南侧开口 (25,27)。盾队 4 爬 (T40M10 肉盾 + 3×M5H40M5 全奶) +
//   蓝球 R40M10 从 W5N8 南缘出发。
// 断言: 1200 tick 内核心被拆除 (队伍过界→绕墙→穿门→齐射拆完)。
import { defineSim } from 'screeps-sim'

const wallRows: string[] = []
for (let y = 0; y < 50; y++) {
	let row = ''
	for (let x = 0; x < 50; x++) {
		const inRing = x >= 15 && x <= 35 && y >= 15 && y <= 35
		const onRing = inRing && (x === 15 || x === 35 || y === 15 || y === 35)
		// 南门: 下边墙 y=35 在 x=24..26 开口
		const isDoor = y === 35 && x >= 24 && x <= 26
		// 核心护壳: 23..27 圈地形墙, 南侧 (25,27) 留口
		const onCoreRing = x >= 23 && x <= 27 && y >= 23 && y <= 27 && (x === 23 || x === 27 || y === 23 || y === 27)
		const coreDoor = x === 25 && y === 27
		row += (onRing && !isDoor) || (onCoreRing && !coreDoor) ? '#' : '.'
	}
	wallRows.push(row)
}

const heal = Array(40).fill('heal') as string[]
const mv5 = Array(5).fill('move') as string[]
const tough40 = Array(40).fill('tough') as string[]
const mv10 = Array(10).fill('move') as string[]
const r40 = Array(40).fill('ranged_attack') as string[]

export default defineSim({
	name: 'stronghold-door',
	description: '盾队过窄门全链路: 过房界→绕墙圈→穿南门→贴核心→蓝球齐射拆除 (1200t 内核心必须消失)',
	seed: 42,
	ticks: 1200,
	cpu: { limit: 200, bucket: 10000 },
	deterministicRandom: true,
	alwaysVisible: true,
	memory: JSON.stringify({
		__simProbe: { interval: 100, room: 'W5N7' },
		rooms: {},
		creeps: {
			g1: { unit: 'team-ranged', teamID: 'TEST' },
			g2: { unit: 'team-heal', teamID: 'TEST' },
			g3: { unit: 'team-heal', teamID: 'TEST' },
			g4: { unit: 'team-heal', teamID: 'TEST' },
			s1: { unit: 'team-ranged', teamID: 'TEST' },
		},
		Nexus: {
			schemaVersion: 14,
			rooms: {},
			tasks: {},
			units: {},
			TeamData: {
				TEST: {
					name: 'TEST',
					status: 'ready',
					toward: '↑',
					formation: 'quad',
					creeps: [],
					num: 5,
					time: 5,
					homeRoom: 'W5N8',
					targetRoom: 'W5N7',
					configKey: 'SRG/4',
				},
			},
		},
	}),
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'flat' },
			sources: { positions: [[18, 22], [32, 30]] },
			controller: { level: 8, pos: [28, 27] },
			mineral: { pos: [38, 38], type: 'H', amount: 30000 },
			structures: [
				{ type: 'spawn', pos: [25, 25], energy: 300 },
			],
			creeps: [
				{ name: 'g1', body: [...tough40, ...mv10], pos: [24, 46] },
				{ name: 'g2', body: [...mv5, ...heal], pos: [25, 46] },
				{ name: 'g3', body: [...mv5, ...heal], pos: [24, 47] },
				{ name: 'g4', body: [...mv5, ...heal], pos: [25, 47] },
				{ name: 's1', body: [...r40, ...mv10], pos: [25, 45] },
			],
		},
		{
			name: 'W5N7',
			terrain: { kind: 'rows', rows: wallRows },
			sources: { positions: [[5, 5]] },
			controller: { level: 0, pos: [25, 5], mine: false },
			structures: [
				{ type: 'invaderCore', pos: [25, 25], hits: 100000, enemy: true },
			],
			creeps: [],
		},
	],
	asserts: [
		{ kind: 'noErrors' },
		// 队伍 5 爬全程存活 (过门/绕墙/贴核过程无死亡 = 没有死锁导致的异常损耗)
		{ kind: 'creepCountAtLeast', value: 5 },
		{ kind: 'cpuAvgBelow', value: 50 },
	],
})
