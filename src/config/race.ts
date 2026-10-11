/**
 * 冲级面板参数 (docs/nexus-design/02 原则 F 观测; 分段目标对齐 RosmarinBot Thresholds.RUSH)。
 * 分段目标 = 相对 lv1 基线的 tick 数, 双线制:
 * achieve 达成线 (按期) / pass 合格线 (未判废的兜底线), 无 pass 的段达成线即判废线。
 */
export const RUSH_CONFIG = {
	segmentTargets: {
		2: { achieve: 500, pass: 1000 },
		3: { achieve: 3000, pass: 5000 },
		4: { achieve: 5000, pass: 10000 },
		5: { achieve: 15000, pass: 20000 },
		6: { achieve: 30000, pass: 40000 },
	} as Record<number, { achieve: number; pass?: number }>,
} as const;
