/**
 * Tick 调度器 (docs/api/03 §3.4):
 * 注册期按变体模块开关过滤 (禁用 = 不注册 = 零 CPU); 拒绝重名; 同阶段按注册序稳定执行。
 */
import type { VariantProfile } from "@/config/profile";
import type { TickPhase } from "@/core/phases";
import type { PriorityBand } from "@/core/cpuBudget";
import type { TickContext } from "@/core/tickContext";

export interface TickModule {
	readonly name: string;
	readonly phase: TickPhase;
	readonly band: PriorityBand;
	run(ctx: TickContext): void;
}

export interface TickScheduler {
	register(module: TickModule): void;
	/** 已启用模块名 (注册序) */
	enabledModuleNames(): string[];
	/** 被开关禁用的模块名, 供遥测/排障 */
	disabledModuleNames(): string[];
	runPhase(phase: TickPhase, ctx: TickContext): void;
}

export function createScheduler(profile: VariantProfile): TickScheduler {
	const byPhase = new Map<TickPhase, TickModule[]>();
	const enabled: string[] = [];
	const disabled: string[] = [];
	const seen = new Set<string>();

	function register(module: TickModule): void {
		if (profile.modules[module.name] === false) {
			disabled.push(module.name);
			return;
		}
		if (seen.has(module.name)) {
			throw new Error(`重复注册模块: ${module.name}`);
		}
		seen.add(module.name);
		enabled.push(module.name);
		let list = byPhase.get(module.phase);
		if (!list) {
			list = [];
			byPhase.set(module.phase, list);
		}
		list.push(module);
	}

	function runPhase(phase: TickPhase, ctx: TickContext): void {
		const list = byPhase.get(phase);
		if (!list) {
			return;
		}
		for (const module of list) {
			ctx.runIsolated(module.name, module.band, () => module.run(ctx));
		}
	}

	return {
		register,
		enabledModuleNames: () => [...enabled],
		disabledModuleNames: () => [...disabled],
		runPhase,
	};
}
