/**
 * 经济系统任务源模块 (planning 阶段): 观测 → 任务意向。
 * 任务产出经 units/ 注册表路由到各单位自驱 (高内聚单文件)。
 */
import type { TickContext, TickModule } from "@/core";

import { createTaskBoard } from "@/modules/tasks";
import { runEconomyPlanners } from "@/modules/economy/planners";
import { planRemoteHarvest } from "@/modules/economy/remoteMining";
import { planMineralWork } from "@/modules/economy/mineralWork";
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
		// 过道矿定编 (specs/mission-pool-retirement mine 行): 人操链语义,
		// 需要原型扩展面 (directSpawn/observeRoom/AssignBoostTask) → 遍历 Game.rooms
		for (const room of Object.values(Game.rooms)) {
			if (!room.controller?.my) continue;
			planMineralWork(ctx, board, room);
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
export { droppedPileEnergy } from "@/modules/economy/workforce";
export { maintainLedger, updateHungerVitals, commit as commitReservation, release as releaseReservation, reserve, createLedger } from "@/modules/economy/ledger";
export {
	reservationFactor,
	remoteSourceWeightOf,
	remoteCapPerTick,
	incomeWithRemoteOf,
} from "@/modules/economy/income";
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

// ── 公共面: 原型角色单位 (任务驱动角色 handler 已裁撤, 见 bugs/role-registry-executor-gap) ──
export { default as miner } from "@/modules/economy/units/miner";

// ── 公共面: 生产门控 / 劳动力 / 物流配额 / 调度基准 / 终末钩子 ──
export {
	getBuiltRoomLevel,
	getHarvesterTargetBySource,
	getHarvestStaffingTotal,
	isRoomProductionSecured,
	isRoomRemoteUnlocked,
} from "@/modules/economy/productionGateAccess";
export { destinationQuotas } from "@/modules/economy/quota";
export { activeRemoteHarvestCount, activeRemoteCarryBacklog, activeRemoteCarryCount, activeScoutCount } from "@/modules/economy/remoteMining";
export { getCoreDepotContainer, isCoreDepotContainer, isCoreDepotContainerDraining } from "@/modules/economy/coreDepot";
export { FunnelModule } from "@/modules/economy/FunnelModule";
