// speedrun: 私服冲级阶梯门 (分段目标验收) — race 变体专用场
//
// 与既有场景的分工:
// - sprint/arena 为内核 rush 模式诊断场 (main 变体, dist/main.js);
// - 本场是 race 变体 speedrun 引擎的**验收门**。地形用上游真实地形
//   (terrain.txt): 极简地形 (全平原+角墙) 实测系统性慢 5600t (无导流,
//   爬坡期拥堵与寻路开销放大, 且车道并轨失效 — 等价路径平手抖动),
//   2026-10-30 否决。地标与私服实测对账: 源 (21,13)/(30,29),
//   ctrl(18,24)/spawn(17,31), 邻房 ctrl(17,25)/mineral(34,6)。
//   断言即分段目标本身。
//
// bundle 指向 race 变体产物 (dist-race/main.js, `npm run build:race:speedrun`
// 生成, 不进部署链): 引擎 roomOk 守卫要求源在 (21,13)/(30,29), 旧配置
// (flat + sources.count=2 自动放位 → (7,7)/(7,37)) 下 race 引擎整场待机,
// 本场历史上跑出的时间线其实是 main 变体的数字 (2026-10-29 勘误)。
import { defineSim } from 'screeps-sim'
import { UPSTREAM_TERRAIN } from './_upstream-world.ts'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map(
	(name) => ({
		name,
		terrain: UPSTREAM_TERRAIN,
		// 外矿是冲级核心收入: 邻房与家房同地形同源位 (上游 sim.mjs 口径)
		sources: { positions: [[21, 13], [30, 29]] as [number, number][] },
		controller: { level: 0, pos: [17, 25] as [number, number], mine: false },
		mineral: { pos: [34, 6] as [number, number], type: 'O' as const, amount: 35000 },
		alwaysVisible: false,
		objects: [] as unknown[],
	}),
)

export default defineSim({
	name: 'speedrun',
	description: '私服冲级分段门 (race 引擎): RCL4≤10k / RCL5≤20k / RCL6≤40k',
	seed: 42,
	// 40k = 私服赛制窗口 (speedrun mod bracket [20000, 40000], 4wt 自动重开);
	// RCL6 门即截止时刻达标, 无 5k 余量
	ticks: 40000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	// race 变体 bundle (SPEEDRUN_PROFILE=1 构建), 不与 main 变体共用 dist/main.js
	bundle: '../dist-race/main.js',
	rooms: [
		{
			name: 'W5N8',
			terrain: UPSTREAM_TERRAIN,
			sources: { positions: [[21, 13], [30, 29]] as [number, number][] },
			// 私服实测地标 (2026-10-30 ws 对账): ctrl(18,24)/spawn(17,31) —
			// spawn 是引擎标准锚点, ctrl 偏移模板 (17,25) 触发 reanchor 探测
			controller: { level: 1, pos: [18, 24] },
			// 私服开局: 只有 spawn, 无任何预置结构
			structures: [{ type: 'spawn', pos: [17, 31], energy: 300 }],
			creeps: [] as unknown[],
		},
		...neighbors,
	],
	asserts: [
		// ── 三档目标 (对齐私服 speedrun 榜口径 1wt/2wt/4wt, 从落地 tick 0 起算) ──
		// 中间档 (L2/L3) 已废止: 榜口径只看 4/5/6; 未达标时红是冲刺状态的诚实呈现 (D1)
		{ kind: 'rclReachedBy', value: 4, tick: 10000 },
		{ kind: 'rclReachedBy', value: 5, tick: 20000 },
		{ kind: 'rclReachedBy', value: 6, tick: 40000 },
		// ── 回归护栏 ──
		{ kind: 'cpuP95Below', value: 40 },
		{ kind: 'noErrors' },
	],
})
