// speedrun-upstream: 上游 speedrun-bot 官方场景复刻 (sim.mjs 逐参数对齐)。
//
// 用途: 移植到 src/branch/race/speedrun 的冲级 bot 必须在本场跑出与上游 bundle
// 一致的分 (SPEEDRUN_MODE=1 构建), 证明搬运零失真; 之后才具备上线资格。
//
// 场景: 3x3 世界 (W1N1..W3N3), 全部同布局 (terrain.txt 原始地形, 双源 (21,13)/(30,29),
// controller (17,25)), home=W2N2 带 spawn (17,31) energy 300。CPU limit 100 确定性。
// 上游 20k 基线: score 971,773 (L4@6,364 / L5@13,322); 40k 目标 2,255,965。
// bundle 指向 race 变体产物 (dist-race/main.js): 上游基线是 SPEEDRUN_MODE 构建
// 跑出来的, 用 main 变体 dist/main.js 对照无意义 (2026-10-29 勘误)。
import { defineSim } from 'screeps-sim'
import {
	UPSTREAM_TERRAIN,
	UPSTREAM_SOURCES,
	UPSTREAM_CONTROLLER,
	UPSTREAM_MINERAL,
} from './_upstream-world.ts'

const neighbor = (name: string) => ({
	name,
	terrain: UPSTREAM_TERRAIN,
	sources: UPSTREAM_SOURCES,
	controller: UPSTREAM_CONTROLLER,
	mineral: UPSTREAM_MINERAL,
})

export default defineSim({
	name: 'speedrun-upstream',
	description: '上游 bot 对等场: 移植版须复现 sim.mjs 基线 (20k≈971,773)',
	seed: 42,
	ticks: 40000,
	cpu: { limit: 100, bucket: 10000, deterministicRandom: true },
	bundle: '../dist-race/main.js',
	rooms: [
		neighbor('W1N1'),
		neighbor('W1N2'),
		neighbor('W1N3'),
		neighbor('W2N1'),
		{
			name: 'W2N2',
			terrain: UPSTREAM_TERRAIN,
			sources: UPSTREAM_SOURCES,
			controller: { level: 1, pos: [17, 25] as [number, number], mine: true },
			mineral: UPSTREAM_MINERAL,
			structures: [{ type: 'spawn', pos: [17, 31], energy: 300 }],
		},
		neighbor('W2N3'),
		neighbor('W3N1'),
		neighbor('W3N2'),
		neighbor('W3N3'),
	],
	asserts: [
		{ kind: 'rclReachedBy', value: 4, tick: 10000 },
		{ kind: 'rclReachedBy', value: 5, tick: 20000 },
		{ kind: 'rclReachedBy', value: 6, tick: 40000 },
		{ kind: 'noErrors' },
	],
})
