// @ts-nocheck

/**
 * commit 相位 P0 段统一驱动各域 end 钩子
 * (漏斗转账/跨 shard 写回/内存清理/统计落账/事件总线收尾)。
 
 */
import { ClearModule } from '@/core/store/clear'
import { Statistics } from '@/core/statistics'
import { FunnelModule } from '@/modules/economy'
import { InterShardModule } from '@/modules/intershard'
import { runEventPhase } from '@/core/event'
import type { TickContext, TickModule } from '@/core'

// Event → Funnel → InterShard → Clear → Statistics
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
