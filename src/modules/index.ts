/**
 * 默认模块装配: 按 TICK_PHASES 阶段归属注册 (docs/nexus-design/03 §3.3 顺序)。
 * 变体可通过 profile.modules 开关禁用任一模块 (注册期过滤, 零 CPU)。
 * 同阶段执行序 = 注册序: emergency 中 defense-planners;
 * strategy 中 nexus-core; planning 中 economy-planners → economy-model → cluster-squads;
 * commit 中 broker → construction → visuals。
 */
import type { TickModule } from "@/core/scheduler";
import { perceptionModule } from "@/modules/world/perception";
import { defenseModule } from "@/modules/defense/index";
import { strategyCoreModule } from "@/modules/strategy/core";
import { economyModule } from "@/modules/economy/index";
import { economyModelModule } from "@/modules/economy/model";
import { clusterModule } from "@/modules/cluster/index";
import { tasksModule } from "@/modules/tasks/index";
import { spawnModule } from "@/modules/spawning/index";
import { agentsModule, brokerModule } from "@/modules/agents/index";
import { constructionModule } from "@/modules/economy/construction";
import { visualsModule } from "@/modules/visuals/index";

export function createDefaultModules(): TickModule[] {
	return [
		perceptionModule,
		defenseModule,
		strategyCoreModule,
		economyModule,
		economyModelModule,
		clusterModule,
		tasksModule,
		spawnModule,
		agentsModule,
		brokerModule,
		constructionModule,
		visualsModule,
	];
}
