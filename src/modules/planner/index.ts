/**
 * 布局规划模块 (docs/nexus-design/17 / docs/nexus-design/21):
 * - 无布局的己方房: 满足 CPU 桶门控时自动生成动态布局 (失败按 retryAt 退避);
 * - 有布局的己方房: 升档 (buildLevel 变化) 或在建工地低水位时按布局逐级放量;
 * - 布局生成前的开局窗口: 沿用驻点规划放 Source 容器, 保住早期经济 (bugs/P0-3 口径)。
 */
import { PLANNER_CONFIG } from "@/config/planner";
import { WORKSITE_CONFIG } from "@/config/economy";
import type { TickContext, TickModule } from "@/core";
import type { RoomIntelRecord, LayoutRoomRecord } from "@/core/store/memorySchema";
import type { RoomObservation, SourceSummary } from "@/core/world";
import { LayoutPlanner } from "./layoutPlanner";
import { getLayoutRecord, ensureLayoutRecord } from "./memory";
import { runControllerBufferPlacement } from "./controllerBuffer";
import { runSourceExtensionPlacement } from "./sourceExtensions";
import { roomModeFor } from "@/modules/strategy";

export { LayoutPlanner } from "./layoutPlanner";
export { pickControllerBufferSpot } from "./controllerBuffer";
export { pickSourceExtensionSpots } from "./sourceExtensions";

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function hasContainerNearSource(room: RoomObservation, source: SourceSummary): boolean {
	return room.stores.some(
		(store) =>
			store.structureType === "container" && chebyshev(store.x, store.y, source.x, source.y) <= 1,
	);
}

function hasSiteAt(
	room: RoomObservation,
	spot: { x: number; y: number },
	structureType: string,
): boolean {
	return room.sites.some(
		(site) => site.x === spot.x && site.y === spot.y && site.structureType === structureType,
	);
}

/** 开局兜底: 布局生成前按驻点放 Source 容器 (容器位=驻点, bugs/P0-3 定案) */
function runBootstrapContainers(
	ctx: TickContext,
	room: RoomObservation,
	roomObj: Room,
	intel: RoomIntelRecord,
): void {
	for (const source of room.sources) {
		const worksite = intel.worksites?.[source.id];
		const spot = worksite?.containerSpot;
		if (!worksite || !spot) {
			continue;
		}
		if (worksite.siteRetryAt !== undefined && ctx.tick < worksite.siteRetryAt) {
			continue;
		}
		if (hasContainerNearSource(room, source) || hasSiteAt(room, spot, "container")) {
			continue;
		}
		const code = roomObj.createConstructionSite(spot.x, spot.y, STRUCTURE_CONTAINER);
		if (code === OK) {
			ctx.logger.info(
				`bootstrap-container:${room.roomName}:${ctx.tick} Source 容器站点落位 (${spot.x},${spot.y})`,
			);
		} else {
			worksite.siteRetryAt = ctx.tick + WORKSITE_CONFIG.siteRetryInterval;
			ctx.logger.warn(
				`bootstrap-container:${code}`,
				`容器站点创建失败 code=${code}, 冷却 ${WORKSITE_CONFIG.siteRetryInterval}t`,
			);
		}
	}
}

/** 自动布局生成: 无记录的己方房尝试动态布局, 失败退避 */
function runAutoLayout(ctx: TickContext, roomName: string): boolean {
	const record = ensureLayoutRecord(roomName);
	if (ctx.tick < (record.retryAt ?? 0)) {
		return false;
	}
	record.retryAt = ctx.tick + PLANNER_CONFIG.layoutRetryBackoffTicks;
	const code = LayoutPlanner.buildDynamic(roomName);
	if (code === OK) {
		delete record.retryAt;
		return true;
	}
	ctx.logger.warn(
		`layout-build:${roomName}`,
		`动态布局生成失败 code=${code}, ${PLANNER_CONFIG.layoutRetryBackoffTicks}t 后重试`,
	);
	return false;
}

/** 布局放量: 升档或工地低水位时按布局放站 */
function runSitePlacement(ctx: TickContext, roomObj: Room, record: LayoutRoomRecord): void {
	const level = roomObj.controller?.level ?? 0;
	if (level < 2) {
		return;
	}
	const mySites = roomObj.find(FIND_CONSTRUCTION_SITES);
	const levelChanged = record.buildLevel !== level;
	const lowWater = mySites.length < PLANNER_CONFIG.buildSitesLowWater;
	if (!levelChanged && !lowWater) {
		return;
	}
	const created = LayoutPlanner.plannerCreateSite(roomObj, record.data, {
		maxSites: PLANNER_CONFIG.maxSitesPerPass,
	});
	if (created > 0) {
		ctx.logger.info(
			`layout-sites:${record.type}:${roomObj.name}:${ctx.tick} 放量 ${created} 个工地 (RCL${level}${levelChanged ? " 升档" : " 补足"})`,
		);
	}
	record.buildLevel = level;
}

export const Planner: TickModule = {
	name: "layout-planner",
	phase: "commit",
	band: "P2",
	run(ctx: TickContext): void {
		const world = ctx.world.current;
		if (!world) {
			return;
		}
		for (const room of Object.values(world.rooms)) {
			const roomObj = Game.rooms[room.roomName];
			if (!roomObj || roomObj.controller?.my !== true) {
				continue;
			}
			// 控制器缓冲: 布局生成前后都需要 (选址权独立于布局记录)
			runControllerBufferPlacement(ctx, room, roomObj);
			// 源旁 ext 直供链: 冲级档生效 (RCL 门控在决策内), 配额与布局放量共享
			if (roomModeFor(ctx, room.roomName) === "rush") {
				const intel = ctx.memory.rooms[room.roomName];
				if (intel) {
					runSourceExtensionPlacement(ctx, room, roomObj, intel);
				}
			}
			const record = getLayoutRecord(room.roomName);
			if (!record || Object.keys(record.data).length === 0) {
				// 布局未生成: 开局容器兜底 + 自动布局尝试
				if (room.rcl >= WORKSITE_CONFIG.containerMinRcl && PLANNER_CONFIG.bootstrapContainerEnabled) {
					const intel = ctx.memory.rooms[room.roomName];
					if (intel?.worksites) {
						runBootstrapContainers(ctx, room, roomObj, intel);
					}
				}
				if (PLANNER_CONFIG.autoLayoutEnabled && roomObj.controller) {
					runAutoLayout(ctx, room.roomName);
				}
				continue;
			}
			if (record.autobuild) {
				runSitePlacement(ctx, roomObj, record);
			}
		}
	},
};
