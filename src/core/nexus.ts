/**
 * 应用组装核心 (nexus.ts): profile → 调度器 → 每 Tick 循环。
 * 内核零业务模块依赖: 模块经 createNexus(profile).use(...).loop() 挂载,
 * 跨域读取只经 ctx (memory/world/logger/errors/cpu/telemetry);
 * 面板渲染与领域查询入口由 Visuals 模块挂载 (内核只保留遥测查询)。
 */
import type { VariantProfile } from "@/config/profile";
import { createCpuBudget, type CpuAccess } from "@/core/cpuBudget";
import { createErrorBoundary } from "@/core/errorBoundary";
import { formatError } from "@/core/errorMapper";
import { createLogger, type LogSink } from "@/core/logger";
import { TICK_PHASES } from "@/core/phases";
import { createScheduler, type TickModule, type TickScheduler } from "@/core/scheduler";
import { createWorldHolder } from "@/core/world";
import { calibrateNexus } from "@/core/store/calibration";
import { createTelemetry } from "@/core/metrics";
import { createTickContext } from "@/core/tickContext";

/** 单次 flush 的输出目的地, 游戏内为 console.log */
const sink: LogSink = (message) => console.log(message);

/** 运行时共享状态: global 重置时随沙盒一起重建, 不需要持久化 */
let shared: {
	logger: ReturnType<typeof createLogger>;
	telemetry: ReturnType<typeof createTelemetry>;
} | null = null;

function getShared() {
	if (!shared) {
		shared = { logger: createLogger({ sink }), telemetry: createTelemetry() };
	}
	return shared;
}

export interface NexusRuntime {
	/** 挂载模块 (注册序 = 同阶段执行序, 变体开关在此过滤); loop() 之后拒绝再挂载 */
	use(...modules: readonly TickModule[]): this;
	/** 冻结装配, 返回主循环 (Screeps 入口 exports.loop) */
	loop(): () => void;
}

/**
 * 应用组装: createNexus(profile).use(模块...).loop()。
 * 模块清单直接写在入口文件里 (main.ts / 各 branch 变体), 装配一目了然。
 */
export function createNexus(profile: VariantProfile): NexusRuntime {
	const scheduler = createScheduler();
	let started = false;

	return {
		use(...modules) {
			if (started) {
				throw new Error("loop() 已启动, 不能再挂载模块");
			}
			for (const module of modules) {
				scheduler.register(module);
			}
			return this;
		},
		loop() {
			started = true;
			return buildLoop(scheduler, profile);
		},
	};
}

function buildLoop(scheduler: TickScheduler, profile: VariantProfile): () => void {
	const { logger, telemetry } = getShared();
	const memoryRoot = () => Memory as unknown as Record<string, unknown>;
	const cpuAccess: CpuAccess = {
		getUsed: () => Game.cpu.getUsed(),
		getLimit: () => Game.cpu.tickLimit ?? Game.cpu.limit,
		getBucket: () => Game.cpu.bucket,
	};
	const tickSource = () => Game.time;
	const shardName = () => Game.shard?.name ?? "shard0";

	const errors = createErrorBoundary(logger, {
		onRecord: (err) => telemetry.onError(err.module),
	});
	const cpu = createCpuBudget(cpuAccess, {
		onMeasure: telemetry.onMeasure,
		onSkip: telemetry.onSkip,
	});
	const world = createWorldHolder();

	// 控制台查询入口 (内核部分): 遥测与模块清单; 领域查询由各域经 Object.assign 注册
	const query = (globalThis as unknown as { Nexus?: Record<string, unknown> }).Nexus ?? {};
	query.metrics = () => telemetry.summary();
	query.modules = () => scheduler.enabledModuleNames();
	(globalThis as unknown as Record<string, unknown>).Nexus = query;

	return function loop(): void {
		try {
			const tick = tickSource();
			logger.beginTick(tick);

			const nexus = calibrateNexus({ memory: memoryRoot(), tick, logger });
			const ctx = createTickContext({
				tick,
				shardName: shardName(),
				profile,
				cpu,
				logger,
				errors,
				telemetry,
				world,
				memory: nexus,
			});

			for (const phase of TICK_PHASES) {
				scheduler.runPhase(phase, ctx);
			}

			telemetry.recordTick(tick, cpuAccess.getUsed());
		} catch (err) {
			// 顶层兜底: 经 sourcemap 还原后输出, 不让未捕获异常污染 Screeps 自身的报错通道
			console.error(formatError(err));
		}
	};
}
