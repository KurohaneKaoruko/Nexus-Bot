/**
 * 最小遥测 (docs/api/03 §3.5 / docs/nexus-design/13 §13.4):
 * 模块 CPU 用量、错误数、预算跳过数的运行时计数; 摘要可由控制台查询;
 * 状态只存进程内存, 不落 Memory, 无日志历史增长。
 */
import type { SkipReason } from "@/core/cpuBudget";

export interface ModuleStats {
	cpuLast: number;
	cpuTotal: number;
	runs: number;
	errors: number;
	skipsBudget: number;
	skipsCircuit: number;
}

export interface Telemetry {
	onMeasure(name: string, cost: number): void;
	onSkip(name: string, reason: SkipReason): void;
	onError(module: string): void;
	recordTick(tick: number, cpuUsed: number): void;
	/** 结构化摘要供 HUD 渲染 */
	summary(): TelemetrySummary;
}

export interface TelemetrySummary {
	tick: number;
	cpuUsed: number;
	modules: Array<{
		name: string;
		cpuLast: number;
		runs: number;
		errors: number;
		skips: number;
	}>;
}

export function createTelemetry(): Telemetry {
	const modules = new Map<string, ModuleStats>();
	let lastTick = 0;
	let lastCpuUsed = 0;

	function statsOf(name: string): ModuleStats {
		let stats = modules.get(name);
		if (!stats) {
			stats = { cpuLast: 0, cpuTotal: 0, runs: 0, errors: 0, skipsBudget: 0, skipsCircuit: 0 };
			modules.set(name, stats);
		}
		return stats;
	}

	function summary(): TelemetrySummary {
		const moduleList: TelemetrySummary["modules"] = [];
		for (const [name, stats] of modules) {
			if (
				stats.runs === 0 &&
				stats.errors === 0 &&
				stats.skipsBudget === 0 &&
				stats.skipsCircuit === 0
			) {
				continue;
			}
			moduleList.push({
				name,
				cpuLast: stats.cpuLast,
				runs: stats.runs,
				errors: stats.errors,
				skips: stats.skipsBudget + stats.skipsCircuit,
			});
		}
		return { tick: lastTick, cpuUsed: lastCpuUsed, modules: moduleList };
	}

	return {
		onMeasure(name: string, cost: number): void {
			const stats = statsOf(name);
			stats.cpuLast = cost;
			stats.cpuTotal += cost;
			stats.runs += 1;
		},
		onSkip(name: string, reason: SkipReason): void {
			const stats = statsOf(name);
			if (reason === "circuit") {
				stats.skipsCircuit += 1;
			} else {
				stats.skipsBudget += 1;
			}
		},
		onError(module: string): void {
			statsOf(module).errors += 1;
		},
		recordTick(tick: number, cpuUsed: number): void {
			lastTick = tick;
			lastCpuUsed = cpuUsed;
		},
		summary,
	};
}
