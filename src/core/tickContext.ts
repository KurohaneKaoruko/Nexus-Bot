/**
 * Tick 上下文 (docs/nexus-design/03 §3.4 / docs/api/03 §3.1):
 * 当前 Tick 的临时对象, 不得存入 Memory; 模块通过 runIsolated 获得预算门控 + 错误隔离。
 * world 为感知产出的快照持有者 (感知阶段前为 null); memory 为经校准的类型化视图。
 * 内核不依赖任何业务模块: 跨域读取只经 memory / world / 领域公共出口。
 */
import type { NexusMemory } from "@/core/store/memorySchema";
import { classifyError, errorMessage, type ErrorBoundary } from "@/core/errorBoundary";
import type { CpuBudget, PriorityBand } from "@/core/cpuBudget";
import type { Logger } from "@/core/logger";
import type { Telemetry } from "@/core/metrics";
import type { WorldHolder } from "@/core/world";
import type { VariantProfile } from "@/config/profile";

export interface TickContext {
	readonly tick: number;
	readonly shardName: string;
	/** 当前变体装配 (模块开关 / 变体级设置), 供模块读取变体差异 */
	readonly profile: VariantProfile;
	readonly cpu: CpuBudget;
	readonly logger: Logger;
	readonly errors: ErrorBoundary;
	readonly telemetry: Telemetry;
	/** 感知产出 (纯数据快照), 感知阶段前 current 为 null */
	readonly world: WorldHolder;
	/** 经校准的类型化 Memory.Nexus 视图 */
	readonly memory: NexusMemory;
	/**
	 * 在错误边界内执行一段命名工作:
	 * 熔断中 → 跳过; 预算不足 → 跳过; 否则计量执行, 异常被分类限频上报, 不向外传播。
	 */
	runIsolated(name: string, band: PriorityBand, fn: () => void): void;
}

export interface TickContextDeps {
	tick: number;
	shardName: string;
	profile: VariantProfile;
	cpu: CpuBudget;
	logger: Logger;
	errors: ErrorBoundary;
	telemetry: Telemetry;
	world: WorldHolder;
	memory: NexusMemory;
}

export function createTickContext(deps: TickContextDeps): TickContext {
	const { tick, shardName, profile, cpu, logger, errors, telemetry, world, memory } = deps;

	function runIsolated(name: string, band: PriorityBand, fn: () => void): void {
		if (errors.isCircuitOpen(name, tick)) {
			cpu.recordSkip(name, "circuit");
			return;
		}
		if (!cpu.canRun(name, band)) {
			cpu.recordSkip(name, "budget");
			return;
		}
		try {
			cpu.measure(name, fn);
			errors.recordSuccess(name, tick);
		} catch (err) {
			errors.report({
				module: name,
				tick,
				code: classifyError(err),
				message: errorMessage(err),
			});
		}
	}

	return { tick, shardName, profile, cpu, logger, errors, telemetry, world, memory, runIsolated };
}
