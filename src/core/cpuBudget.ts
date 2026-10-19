/**
 * CPU 预算分级调度 (docs/api/03 §3.2 / docs/nexus-design/12)。
 * P0 安全关键 → P3 昂贵分析; 预算不足按优先级带降级;
 * 某段被连续跳过超限时强制按 P1 门槛放行一次 (饥饿保护), 实际运行即清零计数。
 */
export type PriorityBand = "P0" | "P1" | "P2" | "P3";

export type SkipReason = "budget" | "circuit" | "bootstrap-loop" | "critical-worker-wait";

export interface CpuAccess {
	getUsed(): number;
	getLimit(): number;
	getBucket(): number;
}

export interface CpuSnapshot {
	used: number;
	limit: number;
	bucket: number;
	remaining: number;
}

export interface CpuHooks {
	/** measure 结束后回调, 供遥测记录单段实际成本 */
	onMeasure?(name: string, cost: number): void;
	/** 每次跳过回调, 供遥测计数 */
	onSkip?(name: string, reason: SkipReason): void;
}

export interface CpuBudget {
	snapshot(): CpuSnapshot;
	/** 判定 name 这段工作当前是否允许运行 */
	canRun(name: string, band: PriorityBand, estimatedCost?: number): boolean;
	/** 计量执行一段工作, 并清除该段的连续跳过计数 */
	measure<T>(name: string, fn: () => T): T;
	recordSkip(name: string, reason: SkipReason): void;
}

/** 预留安全余量比例: 不等耗尽才停, 给后续阶段留成本 */
const RESERVE_RATIO = 0.15;
/** bucket 低于此值时暂停 P3 昂贵分析 */
const LOW_BUCKET = 2000;
/** 连续跳过达到该次数后强制放行一次, 防止某段长期饥饿 */
const MAX_CONSECUTIVE_SKIPS = 30;

export function createCpuBudget(cpu: CpuAccess, hooks: CpuHooks = {}): CpuBudget {
	const consecutiveSkips = new Map<string, number>();

	function snapshot(): CpuSnapshot {
		const used = cpu.getUsed();
		const limit = cpu.getLimit();
		const bucket = cpu.getBucket();
		return { used, limit, bucket, remaining: limit - used };
	}

	function reserveOf(limit: number): number {
		return limit * RESERVE_RATIO;
	}

	function canRun(name: string, band: PriorityBand, estimatedCost: number = 0): boolean {
		const { remaining, limit, bucket } = snapshot();
		if (remaining <= 0) {
			return false;
		}
		const reserve = reserveOf(limit);
		// 饥饿保护: 连续跳过太多次的段, 只要有 P1 级余量就放行一次
		if ((consecutiveSkips.get(name) ?? 0) >= MAX_CONSECUTIVE_SKIPS) {
			return remaining > reserve / 2;
		}
		switch (band) {
			case "P0":
				return true;
			case "P1":
				return remaining > reserve / 2;
			case "P2":
				return remaining > reserve;
			case "P3":
				return bucket >= LOW_BUCKET && remaining > reserve + estimatedCost;
		}
	}

	function measure<T>(name: string, fn: () => T): T {
		consecutiveSkips.delete(name);
		const start = cpu.getUsed();
		try {
			return fn();
		} finally {
			hooks.onMeasure?.(name, Math.max(0, cpu.getUsed() - start));
		}
	}

	function recordSkip(name: string, reason: SkipReason): void {
		consecutiveSkips.set(name, (consecutiveSkips.get(name) ?? 0) + 1);
		hooks.onSkip?.(name, reason);
	}

	return { snapshot, canRun, measure, recordSkip };
}
