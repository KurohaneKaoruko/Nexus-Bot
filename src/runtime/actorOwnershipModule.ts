/**
 * Actor 所有权维护模块 (api/16 actor-ownership / 任务 2.4):
 * perception 阶段 P0 重建注册表 + 对账租约 (记录档默认, 行为零变化);
 * commit 阶段落持久索引。
 *
 * owner 候选注册在模块加载时完成一次 (静态名册):
 * - nexus-agent: 任务驱动路径 (agentSystem);
 * - legacy-exec: 原型类型 exec() 自驱路径;
 * - teams-direct: Teams 直操路径。
 * 优先级: nexus 最高 (拦截档下任务驱动路径不被 legacy 夺走)。
 */
import type { TickContext, TickModule } from "@/core";
import { rebuildActorRegistry } from "@/runtime/actorRegistry";
import { persistOwnership, registerOwnerCandidate, sweepOwnership } from "@/runtime/actorOwnership";

const CANDIDATES: ReadonlyArray<{ name: string; priority: number }> = [
	{ name: "nexus-agent", priority: 100 },
	{ name: "legacy-exec", priority: 50 },
	{ name: "teams-direct", priority: 60 },
];

let candidatesRegistered = false;

export const ActorOwnershipSweep: TickModule = {
	name: "actor-ownership-sweep",
	phase: "perception",
	band: "P0",
	run(ctx: TickContext): void {
		if (!candidatesRegistered) {
			for (const c of CANDIDATES) {
				registerOwnerCandidate(c.name, c.priority);
			}
			candidatesRegistered = true;
		}
		rebuildActorRegistry(ctx.tick);
		sweepOwnership(ctx.tick);
	},
};

export const ActorOwnershipPersist: TickModule = {
	name: "actor-ownership-persist",
	phase: "commit",
	band: "P3",
	run(ctx: TickContext): void {
		persistOwnership(ctx.tick);
	},
};
