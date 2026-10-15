/**
 * 经济系统任务源模块 (planning 阶段): 观测 → 任务意向。
 * 任务产出经 units/ 注册表路由到各单位自驱 (高内聚单文件)。
 */
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { runEconomyPlanners } from "@/modules/economy/planners";
import { planRemoteHarvest } from "@/modules/economy/remoteMining";
import { runEconomyModel } from "@/modules/economy/model";
import { planCourierRequests } from "@/modules/economy/courier";

export const Economy: TickModule = {
	name: "economy",
	phase: "planning",
	band: "P1",
	run(ctx: TickContext): void {
		const board = createTaskBoard(ctx.memory.tasks);
		runEconomyPlanners(ctx, board);
		// 外矿同名-unit 采集任务 (邻房可见 source)
		const w = ctx.world.current;
		if (w) {
			for (const room of Object.values(w.rooms)) {
				planRemoteHarvest(ctx, room, board);
			}
		}
		planCourierRequests(ctx);
		runEconomyModel(ctx);
	},
};

export {
	economyIndicators,
	type EconomyIndicators,
	travelP95,
	recordTravelSample,
	recordActionRates,
} from "@/modules/economy/model";
export { maintainLedger, commit as commitReservation, release as releaseReservation, reserve } from "@/modules/economy/ledger";
export {
	harvestIncomeOf,
	harvestTimeSplitOf,
	upgradeWorkTargetOf,
	upgraderCountTargetOf,
	carrierCountTargetOf,
	upgradersStarvedOf,
	registerUpgraderStarve,
	energyLevelOf,
} from "@/modules/economy/workforce";
export {
	isProductionSecured,
	onDutySources,
	harvestStaffingOf,
	harvesterTargetTotal,
	carrierGatePassed,
} from "@/modules/economy/productionGate";
export { Pixel } from "@/modules/economy/pixel";
export { hasHungryUpgrader } from "@/modules/economy/courier";
export { ccUpgradeReserveOf } from "@/modules/economy/workforce";
