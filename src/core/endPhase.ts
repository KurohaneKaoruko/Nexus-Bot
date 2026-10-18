// @ts-nocheck

/**
 * commit 相位终末段的统一挂载点 (api 内核纯化 / 任务 3.10)。
 *
 * 内核零业务依赖: 各域的 end 钩子由所属模块自己定义 TickModule 并向
 * commit 相位注册 (EventBusEnd 已在 event.ts, 其余在各自模块内);
 * 本文件只保留兼容再导出, 供各变体入口按原序挂载:
 * Event → Funnel → InterShard → Clear → Statistics。
 */
import { ClearModule } from '@/core/store/clear'
import { Statistics } from '@/core/statistics'
import { FunnelModule } from '@/modules/economy'
import { InterShardModule } from '@/modules/intershard'
import { runEventPhase } from '@/core/event'
import type { TickContext, TickModule } from '@/core'

export const FunnelEnd: TickModule = {
	name: 'funnel-end',
	phase: 'commit',
	band: 'P0',
	run(_ctx: TickContext): void {
		FunnelModule.end?.();
	},
};

export const InterShardEnd: TickModule = {
	name: 'intershard-end',
	phase: 'commit',
	band: 'P0',
	run(_ctx: TickContext): void {
		InterShardModule.end?.();
	},
};

export const ClearEnd: TickModule = {
	name: 'clear-end',
	phase: 'commit',
	band: 'P0',
	run(_ctx: TickContext): void {
		ClearModule.end?.();
	},
};

export const StatisticsEnd: TickModule = {
	name: 'statistics-end',
	phase: 'commit',
	band: 'P0',
	run(_ctx: TickContext): void {
		Statistics.end?.();
	},
};

/** 兼容再导出: 旧名单一 EndPhase 已拆为逐域模块 (见上) */
export const EndPhase: TickModule = {
	name: 'end-phase',
	phase: 'commit',
	band: 'P0',
	run(_ctx: TickContext): void {
		runEventPhase('end');
		FunnelModule.end?.();
		InterShardModule.end?.();
		ClearModule.end?.();
		Statistics.end?.();
	},
};
