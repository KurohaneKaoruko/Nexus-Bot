
/**
 * 跨 shard 域模块: InterShardMemory 缓存维护与扩张指令接收 (原 InterShardModule App 壳承接)。
 * start 在 commit 主段 (P2), end 在 commit 终末 (P0, 由 EndPhase 统一驱动)。
 */
import type { TickContext, TickModule } from "@/core";
import { InterShardModule } from "@/modules/intershard/InterShardModule";

export { InterShardModule };

export const InterShard: TickModule = {
	name: "inter-shard",
	phase: "commit",
	band: "P2",
	run(_ctx: TickContext): void {
		InterShardModule.start?.();
	},
};
