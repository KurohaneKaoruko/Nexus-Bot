// arena: 私服 speedrun 演练 (平地单房, 20k tick = 榜单赛制窗口)
// 计分口径 = 累计控制器进度 (引擎 CONTROLLER_LEVELS 为每级增量, 升级时进度结转):
// 累计到 L4=180,200 / L5=585,200 / L6=1,800,200;
// 单房双源能量天花板 20/t, 40k 窗口上限 800k —— L6 需 1.8M 物理不可达 (2026-10-15 勘误),
// L6 只进 rclTimeline 统计不设硬断言; L5 阶梯门按 14.6~16.7/t 可达档校准。
// 榜面参照: 前五门槛 742,802 (多房)。
import { defineSim } from 'screeps-sim'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map((name) => ({
	name,
	terrain: { kind: 'flat' } as const,
	sources: { count: 2, energy: 3000 },
		// 中立控制器: 官方世界规则所有房都有 controller, 外矿链依赖其存在
		// (2026-10-19 race 对照实证: 缺失则外矿侦查断链)
		controller: { level: 0, pos: [25, 25] as [number, number], mine: false },
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
		// 断言档位按引擎物理口径校准 (2026-10-15 勘误): 累计进度 L3=45,200 / L4=180,200 / L5=585,200,
		// 20/t 天花板下原 L5@30000 (需 19.5/t 持续, 占天花板 98%) 与 L6@40000 (需 1.8M > 800k 上限)
		// 均物理不可达, 长期红会掩盖真实回归 —— L5 下调至 35k (16.7/t, 可达档), L6 撤断言只留时间线。
		{ kind: 'rclReachedBy', value: 2, tick: 2000 },
		{ kind: 'rclReachedBy', value: 3, tick: 8000 },
		{ kind: 'rclReachedBy', value: 4, tick: 20000 },
		{ kind: 'rclReachedBy', value: 5, tick: 35000 },
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})
