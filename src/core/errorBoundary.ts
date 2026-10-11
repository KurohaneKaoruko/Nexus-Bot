/**
 * 模块错误边界 (docs/api/03 §3.3 / docs/nexus-design/03 §3.7):
 * 错误分类 → 限频上报 → 连续失败熔断 (进入/解除), 不吞错、不无限刷屏。
 */
import type { Logger } from "@/core/logger";

export type ErrorCode = "DATA" | "API" | "POLICY" | "INVARIANT" | "UNEXPECTED";

export interface ModuleError {
	readonly module: string;
	readonly tick: number;
	readonly code: ErrorCode;
	readonly message: string;
}

export interface ErrorBoundaryOptions {
	/** 连续失败多少次后熔断, 缺省 5 */
	failureThreshold?: number;
	/** 熔断持续多少 tick, 缺省 100 */
	openTicks?: number;
	/** 每条错误记录后的回调, 供遥测计数 */
	onRecord?(err: ModuleError): void;
}

export interface ErrorBoundary {
	/** 上报一次模块失败: 限频记录 + 熔断计数 */
	report(err: ModuleError): void;
	/** 模块成功运行一次: 清零连续失败计数, 解除熔断 */
	recordSuccess(module: string, tick: number): void;
	isCircuitOpen(module: string, tick: number): boolean;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_TICKS = 100;

/** 错误分类: Phase 0 尚无业务层错误, 统一 UNEXPECTED; 后续阶段在此补充启发式 */
export function classifyError(err: unknown): ErrorCode {
	void err;
	return "UNEXPECTED";
}

export function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

interface CircuitState {
	consecutiveFailures: number;
	totalFailures: number;
	openUntilTick: number;
}

export function createErrorBoundary(logger: Logger, options: ErrorBoundaryOptions = {}): ErrorBoundary {
	const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
	const openTicks = options.openTicks ?? DEFAULT_OPEN_TICKS;
	const circuits = new Map<string, CircuitState>();

	function stateOf(module: string): CircuitState {
		let state = circuits.get(module);
		if (!state) {
			state = { consecutiveFailures: 0, totalFailures: 0, openUntilTick: 0 };
			circuits.set(module, state);
		}
		return state;
	}

	function report(err: ModuleError): void {
		const state = stateOf(err.module);
		state.consecutiveFailures += 1;
		state.totalFailures += 1;

		const alreadyOpen = state.openUntilTick > err.tick;
		if (!alreadyOpen && state.consecutiveFailures >= failureThreshold) {
			// 进入熔断: 每个熔断窗口只告警一次 (靠 logger 限频去重)
			state.openUntilTick = err.tick + openTicks;
			logger.error(
				`circuit.${err.module}`,
				`模块 ${err.module} 连续失败 ${state.consecutiveFailures} 次, 熔断至 tick ${state.openUntilTick}`,
			);
		} else {
			logger.error(`error.${err.module}.${err.code}`, `[${err.code}] tick ${err.tick}: ${err.message}`);
		}
		options.onRecord?.(err);
	}

	function recordSuccess(module: string, _tick: number): void {
		const state = circuits.get(module);
		if (state) {
			state.consecutiveFailures = 0;
			state.openUntilTick = 0;
		}
	}

	function isCircuitOpen(module: string, tick: number): boolean {
		const state = circuits.get(module);
		return state !== undefined && tick < state.openUntilTick;
	}

	return { report, recordSuccess, isCircuitOpen };
}
