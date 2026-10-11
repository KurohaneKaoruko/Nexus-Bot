/**
 * Tick 上下文 (docs/nexus-design/03 §3.4 / docs/api/03 §3.1):
 * 当前 Tick 的临时对象, 不得存入 Memory; 模块通过 runIsolated 获得预算门控 + 错误隔离。
 * world 为感知产出的快照持有者 (感知阶段前为 null); memory 为经 bootstrap 的类型化视图;
 * directive 为战略指令的惰性派生槽 (派生实现由 boot 装配注入, 内核不依赖战略模块)。
 */
import type { NexusMemory } from "@/store/memorySchema";
import { classifyError, errorMessage, type ErrorBoundary } from "@/core/errorBoundary";
import type { CpuBudget, PriorityBand } from "@/core/cpuBudget";
import type { Logger } from "@/core/logger";
import type { WorldHolder, WorldView } from "@/core/world";
import type { StrategyDirective } from "@/modules/strategy/directive";

/** 指令派生的输入视图 (派生只读 Memory 摘要与快照计数) */
export interface DirectiveSource {
	readonly memory: NexusMemory;
	readonly world: WorldView | null;
	readonly tick: number;
}

export interface TickContext {
	readonly tick: number;
	readonly shardName: string;
	readonly cpu: CpuBudget;
	readonly logger: Logger;
	readonly errors: ErrorBoundary;
	/** 感知产出 (纯数据快照), 感知阶段前 current 为 null */
	readonly world: WorldHolder;
	/** 经 bootstrap 的类型化 Memory.nexus 视图 */
	readonly memory: NexusMemory;
	/**
	 * 当 Tick 战略指令: 首次调用时派生并缓存 (本 Tick 内同引用);
	 * 首调用发生在 strategy 阶段之后 → 重估结果当 Tick 即对 Cluster/Spawn 生效。
	 */
	directive(): StrategyDirective;
	/**
	 * 在错误边界内执行一段命名工作:
	 * 熔断中 → 跳过; 预算不足 → 跳过; 否则计量执行, 异常被分类限频上报, 不向外传播。
	 */
	runIsolated(name: string, band: PriorityBand, fn: () => void): void;
}

export interface TickContextDeps {
	tick: number;
	shardName: string;
	cpu: CpuBudget;
	logger: Logger;
	errors: ErrorBoundary;
	world: WorldHolder;
	memory: NexusMemory;
	/** 战略指令派生实现 (boot 装配, 见 modules/strategy/directive) */
	deriveDirective: (source: DirectiveSource) => StrategyDirective;
}

export function createTickContext(deps: TickContextDeps): TickContext {
	const { tick, shardName, cpu, logger, errors, world, memory, deriveDirective } = deps;
	let directiveCache: StrategyDirective | undefined;

	function directive(): StrategyDirective {
		if (directiveCache === undefined) {
			directiveCache = deriveDirective({ memory, world: world.current, tick });
		}
		return directiveCache;
	}

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

	return { tick, shardName, cpu, logger, errors, world, memory, directive, runIsolated };
}
