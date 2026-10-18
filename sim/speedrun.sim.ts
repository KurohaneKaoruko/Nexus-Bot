// speedrun: 私服冲级阶梯门 (分段目标验收)
//
// 与既有场景的分工:
// - sprint/arena 为 P1-14 诊断场 (RCL1 起步 + 多种子地形, 目标宽松, 用于定位瓶颈);
// - 本场是**验收门**, 配置与私服开局一致, 断言即分段目标本身。
//
// 场景口径对齐私服开局: RCL1、单 spawn、零预置结构 (无 extension / 无容器 / 无 cc)、
// 双源、地形平坦。邻房为平地空房, 仅供寻路与视距。
//
// 引擎口径备忘 (决定了本场的时间预算, 勿凭直觉改):
// - 孵化耗时 = CREEP_SPAWN_TIME × 部件数 (1W1M 仅 6t), **不是**固定 300t;
// - spawn 低于 300 能量时每 tick 自回 1 点 → RCL1 的节拍器是能量回填, 不是孵化;
// - 单源再生上限 = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME = 10 能量/tick,
//   双源即单房产能天花板 20/tick; RCL2→RCL3 需累计 45000 进度, 故 RCL3 目标
//   必然依赖外矿 (目标均速 15/tick 已占单房天花板 75%)。
import { defineSim } from 'screeps-sim'

const neighbors = ['W4N7', 'W4N8', 'W4N9', 'W5N7', 'W5N9', 'W6N7', 'W6N8', 'W6N9'].map(
	(name) => ({
		name,
		terrain: { kind: 'flat' } as const,
		// 外矿是冲级核心收入 (rush 档 remoteMining: "auto" 自动扫邻房):
		// L3 门需 15/t (占单房天花板 75%), L4+ 必须外矿补收入 (2026-10-15 勘误:
		// 原配置为无源空房, L3~L6 门全部物理不可达)
		sources: { count: 2, energy: 3000 },
		alwaysVisible: false,
		objects: [] as unknown[],
	}),
)

export default defineSim({
	name: 'speedrun',
	description: '私服冲级分段门: RCL4≤10k / RCL5≤20k / RCL6≤40k',
	seed: 7,
	ticks: 45000,
	cpu: { limit: 100, bucket: 10000 },
	deterministicRandom: true,
	rooms: [
		{
			name: 'W5N8',
			terrain: { kind: 'flat' },
			sources: { count: 2, energy: 3000 },
			controller: { level: 1, pos: [28, 27] },
			// 私服开局: 只有 spawn, 无任何预置结构
			structures: [{ type: 'spawn', pos: [25, 25], energy: 300 }],
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
		{ kind: 'cpuP95Below', value: 20 },
		{ kind: 'noErrors' },
	],
})