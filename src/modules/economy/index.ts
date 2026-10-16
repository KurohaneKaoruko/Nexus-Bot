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

// ── 公共面: 角色单位 (原型角色注册表消费) ──
export { default as carrier } from "@/modules/economy/units/carrier";
export { default as harvester } from "@/modules/economy/units/harvester";
export { default as manager } from "@/modules/economy/units/manager";
export { default as miner } from "@/modules/economy/units/miner";
export { default as transporter } from "@/modules/economy/units/transporter";
export { default as universal } from "@/modules/economy/units/universal";
export { default as upgrader } from "@/modules/economy/units/upgrader";
export { default as worker } from "@/modules/economy/units/worker";

// ── 公共面: 生产门控 / 劳动力 / 物流配额 / 调度基准 / 终末钩子 ──
export {
	getBuiltRoomLevel,
	getHarvesterTargetBySource,
	getHarvestStaffingTotal,
	isRoomProductionSecured,
	isRoomRemoteUnlocked,
} from "@/modules/economy/productionGateAccess";
export {
	UPGRADE_NEEDED_TTD,
	UPGRADE_URGENT_SPAWN_LEVEL,
	estimateRoomEnergyIncome,
	getDroppedPileEnergy,
	getDroppedPileWorkerBoost,
	getDowngradeUniversalSpawnMissing,
	getDowngradeUniversalTarget,
	getMyConstructionSites,
	getRoomEnergyState,
	getRushCarrierTarget,
	getStoredEnergy,
	getUpgradeWorkTarget,
	getUpgraderSuccessionNeeds,
	getUpgraderTarget,
	getWorkerBuildTarget,
	getWorkerPopulationCap,
	getWorkerUpgradeTarget,
	getWorkerWallTarget,
	hasControllerEnergyBuffer,
	isUpgraderSpawnUrgent,
	registerFillRequestProvider,
	registerRemoteIncomeProvider,
	shouldDelayUpgraderForPrimaryBuild,
} from "@/modules/economy/roomWorkforce";
export { buildFillRequests, getControllerCarryQuota } from "@/modules/economy/energyLogistics";
export { destinationQuotas } from "@/modules/economy/quota";
export { activeRemoteHarvestCount, activeScoutCount } from "@/modules/economy/remoteMining";
export { getCoreDepotContainer, isCoreDepotContainer, isCoreDepotContainerDraining } from "@/modules/economy/coreDepot";
export { FunnelModule } from "@/modules/economy/FunnelModule";
