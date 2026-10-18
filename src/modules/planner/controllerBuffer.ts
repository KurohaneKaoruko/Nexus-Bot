/**
 * 控制器缓冲 cc 选址与落位 (specs/controller-upgrade-buffer / bugs P1-14 根因①):
 * 选址权归本决策——控制器配置范围内已有容器/容器工地时采纳之 (不另建);
 * 否则按「相邻可站位最多、离 spawn 更近 (补给腿短)」评分选定唯一点位落站点,
 * 失败按 worksite 同口径冷却。布局放量对控制器旁容器点位的让位契约在 layoutPlanner。
 */
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import { submitIntent } from "@/runtime/intentQueue";

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 站点创建失败冷却 (进程级, 有界每房一条; global 重置后的一次重试由站点存在性检查兜底) */
const ccRetryAt = new Map<string, number>();

/**
 * 评分选点: 候选 = 距控制器 [placeRangeMin, placeRangeMax] 的非墙且无结构/工地格;
 * 评分 = 相邻可站位数 × 10 − 距 spawn 距离 (可站位多 → 升级工位足, 近 spawn → 补给腿短)。
 * 返回 null 表示无可用候选 (本 Tick 放弃, 下次重扫)。
 */
export function pickControllerBufferSpot(
	roomObj: Room,
	controller: { x: number; y: number },
	spawn?: { x: number; y: number },
): { x: number; y: number } | null {
	const terrain = roomObj.getTerrain();
	const { placeRangeMin, placeRangeMax } = CONTROLLER_BUFFER_CONFIG;
	let best: { x: number; y: number } | null = null;
	let bestScore = -Infinity;
	for (let dy = -placeRangeMax; dy <= placeRangeMax; dy += 1) {
		for (let dx = -placeRangeMax; dx <= placeRangeMax; dx += 1) {
			const range = Math.max(Math.abs(dx), Math.abs(dy));
			if (range < placeRangeMin || range > placeRangeMax) {
				continue;
			}
			const x = controller.x + dx;
			const y = controller.y + dy;
			if (x < 0 || x > 49 || y < 0 || y > 49) {
				continue;
			}
			if ((terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) {
				continue;
			}
			if (roomObj.lookForAt(LOOK_STRUCTURES, x, y).length > 0) {
				continue;
			}
			if (roomObj.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) {
				continue;
			}
			let standable = 0;
			for (let ny = -1; ny <= 1; ny += 1) {
				for (let nx = -1; nx <= 1; nx += 1) {
					if (nx === 0 && ny === 0) {
						continue;
					}
					const sx = x + nx;
					const sy = y + ny;
					if (sx < 0 || sx > 49 || sy < 0 || sy > 49) {
						continue;
					}
					if ((terrain.get(sx, sy) & TERRAIN_MASK_WALL) === 0) {
						standable += 1;
					}
				}
			}
			const score =
				standable * 10 - (spawn ? chebyshev(x, y, spawn.x, spawn.y) : 0);
			if (score > bestScore) {
				bestScore = score;
				best = { x, y };
			}
		}
	}
	return best;
}

/**
 * cc 落位决策 (Planner commit 阶段逐 owned room 调用):
 * RCL 门控 → 采纳检查 (范围内容器/工地) → 冷却检查 → 评分选点 → createConstructionSite。
 */
export function runControllerBufferPlacement(
	ctx: TickContext,
	room: RoomObservation,
	roomObj: Room,
): void {
	const controller = room.controller;
	if (!controller || room.rcl < CONTROLLER_BUFFER_CONFIG.minRcl) {
		return;
	}
	// 采纳: 范围内已有容器 (感知已认定) 或容器工地
	if (room.controllerBuffer) {
		return;
	}
	const hasSite = room.sites.some(
		(site) =>
			site.structureType === "container" &&
			chebyshev(site.x, site.y, controller.x, controller.y) <=
				CONTROLLER_BUFFER_CONFIG.adoptRange,
	);
	if (hasSite) {
		return;
	}
	const retryAt = ccRetryAt.get(room.roomName);
	if (retryAt !== undefined && ctx.tick < retryAt) {
		return;
	}
	const pending = ccPending.get(room.roomName);
	if (pending !== undefined && ctx.tick - pending < CONTROLLER_BUFFER_CONFIG.siteRetryInterval) {
		// 在途意图未超时: 等待 broker 执行落地, 不重复提交
		return;
	}
	const spawn = roomObj.find(FIND_MY_SPAWNS)[0];
	const spot = pickControllerBufferSpot(
		roomObj,
		{ x: controller.x, y: controller.y },
		spawn ? { x: spawn.pos.x, y: spawn.pos.y } : undefined,
	);
	if (!spot) {
		return;
	}
	// 经命令边界提交工地创建 (api/17); 原生调用权收编进 broker
	submitIntent(ctx.tick, {
		actorName: room.roomName,
		kind: "createSite",
		pipeline: "construction",
		priority: 40,
		targetPos: { x: spot.x, y: spot.y, roomName: room.roomName },
		payload: { structureType: STRUCTURE_CONTAINER },
		dedupeKey: `cc-site:${room.roomName}`,
	});
	ccPending.set(room.roomName, ctx.tick);
	ctx.logger.info(
		`cc-site:${room.roomName}:${ctx.tick} 控制器缓冲站点意图提交 (${spot.x},${spot.y})`,
	);
}

/** cc 工地在途意图 tick (房间 → 提交 tick; 超时未成站视为失败) */
const ccPending = new Map<string, number>();
