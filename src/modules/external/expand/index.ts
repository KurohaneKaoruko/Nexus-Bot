
import { ExpandController } from '@/modules/external/expand/ExpandController';
import { CreepMemoryTransfer } from '@/modules/external/expand/CreepMemoryTransfer';

export { ExpandController };
export { CreepMemoryTransfer };

// ── 正式域模块 (原 ExpandModule App 壳承接) ──────────────────────

import type { TickContext, TickModule } from '@/core';
import { ExpandModule } from '@/modules/external/expand/ExpandModule';

/** 跨 shard 扩张: 内存迁移 + 扩张控制器主流程 (commit 主段) */
export const Expansion: TickModule = {
	name: 'expansion',
	phase: 'commit',
	band: 'P2',
	run(_ctx: TickContext): void {
		ExpandModule.start?.();
	},
};
