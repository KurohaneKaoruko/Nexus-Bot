/**
 * 冲级分段节奏评估 (纯算法; 分段目标表来自 config/race 纯数据)。
 * 以 lv1 基线对照分段目标, 输出各段达成/落后/判废状态;
 * 段超时判废该轮 attempt 并生成归因快照, 供面板与落盘消费。
 */
import { RUSH_CONFIG } from "@/config/race";

/** 单个分段的评估状态 */
export interface SegmentStatus {
	/** 目标等级 */
	level: number;
	/** 达成线 (tick, 相对 lv1 基线) */
	target: number;
	/** 合格线; 无独立合格线的段与达成线同值 */
	pass: number;
	/** 达成耗时; 未达成为 undefined */
	achievedAt?: number;
	/** 已流逝耗时; 未达成为当前值 */
	elapsed?: number;
	/** 预计达成耗时; 速率 > 0 且进度点已知才有值 */
	eta?: number;
	/** 落后标识: 预计/实际耗时超过达成线 (但未超合格线 → 合格档) */
	behind: boolean;
	/** 判废: 耗时超过合格线 (无合格线段即达成线) */
	failed: boolean;
}

/** 分段评估输入 (调用方从世界快照/面板记忆组装) */
export interface RaceProgressInput {
	/** lv1 基线绝对 tick */
	baseline: number;
	/** 当前绝对 tick */
	now: number;
	/** 当前控制器等级 */
	level: number;
	/** 当前级已积累进度点 */
	progress: number;
	/** 实测升级速率 (点/tick) */
	rate: number;
	/** 各级达成绝对 tick */
	levels: Record<number, number>;
	/** 未达成目标等级 → 从当前位置到该级的剩余进度点 */
	pointsToReach: Record<number, number>;
}

interface SegmentTarget {
	level: number;
	target: number;
	pass: number;
}

/** 分段目标表 (等级升序; pass 缺省取 achieve, 即无独立合格线) */
const SEGMENTS: readonly SegmentTarget[] = Object.entries(RUSH_CONFIG.segmentTargets)
	.map(([level, spec]) => ({
		level: Number(level),
		target: spec.achieve,
		pass: spec.pass ?? spec.achieve,
	}))
	.sort((a, b) => a.level - b.level);

export const RUSH_SEGMENT_LEVELS: readonly number[] = SEGMENTS.map((s) => s.level);

/**
 * 评估全部分段状态; 未达成段「已流逝超合格线」同样判废 (即使立刻达成也已超时)。
 */
export function evaluateRaceSegments(input: RaceProgressInput): SegmentStatus[] {
	const { baseline, now, rate, levels, pointsToReach } = input;
	const elapsed = now - baseline;
	return SEGMENTS.map(({ level, target, pass }) => {
		const achievedTick = levels[level];
		if (achievedTick !== undefined) {
			const achievedAt = Math.max(0, achievedTick - baseline);
			return {
				level,
				target,
				pass,
				achievedAt,
				behind: achievedAt > target,
				failed: achievedAt > pass,
			};
		}
		const remaining = pointsToReach[level];
		const eta = rate > 0 && remaining !== undefined ? elapsed + Math.ceil(remaining / rate) : undefined;
		const failed = elapsed > pass;
		const behind = failed || (eta !== undefined && eta > target);
		const status: SegmentStatus = { level, target, pass, elapsed, behind, failed };
		if (eta !== undefined) {
			status.eta = eta;
		}
		return status;
	});
}

/** 判废落账载体 (消费方持久化; 仅最新一条, 有界) */
export interface SegmentVerdictState {
	failed?: boolean;
	failedSegment?: number;
	failSnapshot?: Record<string, unknown>;
}

/**
 * 判废落账: 仅在「首次判废或判废段变化」时写入快照, 返回是否新判废。
 * (防止每 Tick 重复落账, 保证记忆占用不随判废次数增长)
 */
export function applySegmentVerdicts(
	state: SegmentVerdictState,
	statuses: readonly SegmentStatus[],
	buildSnapshot: (segment: SegmentStatus) => Record<string, unknown>,
): boolean {
	const firstFail = statuses.find((s) => s.failed);
	if (!firstFail) {
		return false;
	}
	if (state.failed && state.failedSegment === firstFail.level) {
		return false;
	}
	state.failed = true;
	state.failedSegment = firstFail.level;
	state.failSnapshot = buildSnapshot(firstFail);
	return true;
}
