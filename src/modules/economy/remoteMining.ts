/**
 * 外矿同名-unit 实现: 侦查邻房 → 记录远程 source → 产出跨房采集任务。
 * 远程 harvester 与本矿同名 (memory.targetRoom 区分), 任务 kind 仍为 harvest。
 * 侦查无状态化: 邻房不可见时产出 scout 任务 (到达即获视野), 可见时产出采集任务。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";
import { RESERVE_CONFIG } from "@/config/economy";
import { roomModeProfileFor } from "@/modules/strategy";

/** 己方用户名 (任一自有 spawn 的 owner; 无 spawn 的角落场景由调用侧兜底为不抢订) */
function myUsername(): string | undefined {
	for (const spawn of Object.values(Game.spawns)) {
		return spawn.owner?.username;
	}
	return undefined;
}

/** 邻房名计算: 已抽公共 utils/roomCoord (bugs/P1-17), 此处仅再导出兼容本文件内引用 */
import { neighborRooms } from "@/utils/roomCoord";
import { REMOTE_HAUL_CONFIG } from "@/config/economy";
import { remoteSourceWeightOf } from "@/modules/economy/income";
import { isProductionSecured } from "@/modules/economy/productionGate";

/** 远程源旁容器 (可见房直查): 距源 ≤ containerRange 的第一个容器 */
function remoteSourceContainer(
	room: Room,
	source: Source,
): StructureContainer | undefined {
	return room
		.find(FIND_STRUCTURES, {
			filter: (s): s is StructureContainer =>
				s.structureType === STRUCTURE_CONTAINER &&
				s.pos.inRangeTo(source.pos, REMOTE_HAUL_CONFIG.containerRange),
		})
		.find((c) => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 || c.store.energy > 0);
}

/**
 * 远程容器回运任务 (bugs/race-strategy-port W1-2): 源旁容器存量过阈值即产
 * haul (容器→本矿), 远程矿工驻源卸容器、本矿 carrier 跨房拉回——
 * 5W 矿工自回运的长途往返是采集面塌陷主因 (2×路程 tick 全程 0 采集)。
 */
function upsertRemoteHaul(
	ctx: TickContext,
	board: TaskBoard,
	homeRoomName: string,
	remoteRoom: Room,
	source: Source,
): void {
	const container = remoteSourceContainer(remoteRoom, source);
	if (
		!container ||
		container.store.energy < container.store.getCapacity(RESOURCE_ENERGY) * REMOTE_HAUL_CONFIG.haulTriggerRatio
	) {
		return;
	}
	board.upsert(
		{
			dedupeKey: `haul:${homeRoomName}:remote:${container.id}`,
			kind: "haul",
			roomName: homeRoomName,
			targetId: container.id,
			targetPos: {
				x: container.pos.x,
				y: container.pos.y,
				roomName: remoteRoom.name,
			},
			priority: REMOTE_HAUL_CONFIG.haulPriority,
			requiredCapabilities: ["carry", "move"],
		},
		ctx.tick,
	);
}

/**
 * 外矿任务产出 (remoteMining 政策, 用户口径 2026-10-15):
 * - "auto" (仅 rush): 自动扫描发展——邻房不可见派 scout, 可见无主即登记采集;
 * - "manual" (main 系): 只挖 Memory.Nexus.economy.remoteTargets 显式登记的源,
 *   未登记的邻房一概不碰 (侦查也不派);
 * - "off": 不挖。
 */
export function planRemoteHarvest(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
): void {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (profile.remoteMining === "off") return;
	// 外矿开门条件 (对齐 Rosmarin race productionGate 语义, 2026-10-18 race 复盘):
	// ① 采集面铺满 (isProductionSecured) —— 本矿收入稳住才放外矿, 掏空本地采集面
	//    的老顾虑由该闸承接, 不再用 RCL3 一刀切 (sim 实证 L3@19049 → 外矿永不启动,
	//    收入上限锁死 20/t, 升级速率 2.65/t);
	// ② rush auto 档才低门放行; manual 档维持 RCL3 (显式登记房由用户自己把关)。
	// 外矿采集件无 CARRY 的 drop 风险由外矿 haul 任务闭环承接 (upsertRemoteHaul),
	// 不再依赖 harvester 体型档。
	if (room.rcl < 3 && !(profile.remoteMining === "auto" && isProductionSecured(ctx, room))) {
		return;
	}

	if (profile.remoteMining === "manual") {
		const targets = ctx.memory.economy.remoteTargets ?? [];
		for (const targetRoomName of targets) {
			const remoteRoom = Game.rooms[targetRoomName];
			// 无视野: 对手动指定的房间定向侦查 (不扫列表外邻房)
			if (!remoteRoom) {
				board.upsert({
					dedupeKey: `scout:${room.roomName}:${targetRoomName}`,
					kind: "scout",
					roomName: room.roomName,
					targetPos: { x: 25, y: 25, roomName: targetRoomName },
					priority: priorityFor("scout"),
					requiredCapabilities: ["move"],
				}, ctx.tick);
				continue;
			}
			if (remoteRoom.controller?.my) continue;
			if (remoteRoom.controller?.owner) continue;
			// 预订线 (对齐 Rosmarin race): 未预订源容量减半 (1500 vs 3000),
			// 收入翻倍的前置。衰减到续订线以下即重发 (防裸奔减半期);
			// 他人预订不抢 (reserveController 对他订无效, 派件纯浪费)。
			const reservation = remoteRoom.controller?.reservation;
			const mine = myUsername() !== undefined && reservation?.username === myUsername();
			if (
				remoteRoom.controller &&
				(!reservation || (mine && reservation.ticksToEnd < RESERVE_CONFIG.refreshTicks))
			) {
				board.upsert({
					dedupeKey: `reserve:${room.roomName}:${targetRoomName}`,
					kind: "reserve",
					roomName: room.roomName,
					targetId: remoteRoom.controller.id,
					targetPos: {
						x: remoteRoom.controller.pos.x,
						y: remoteRoom.controller.pos.y,
						roomName: targetRoomName,
					},
					priority: priorityFor("reserve"), // 预订是外矿收入翻倍的前置, 与侦查同档
					requiredCapabilities: ["claim", "move"],
				}, ctx.tick);
			}
			for (const source of remoteRoom.find(FIND_SOURCES)) {
				board.upsert({
					dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
					kind: "harvest",
					roomName: room.roomName,
					targetId: source.id,
					targetPos: {
						x: source.pos.x,
						y: source.pos.y,
						roomName: targetRoomName,
					},
					priority: priorityFor("harvest"), // 与本矿对齐: urgent 门 (70) 之下远程工恒无替补 (bugs (十二))
					requiredCapabilities: ["work", "move"],
				}, ctx.tick);
				upsertRemoteHaul(ctx, board, room.roomName, remoteRoom, source);
			}
		}
		return;
	}

	// auto 档发展房上限: 按 neighborRooms 固定顺序确定性选取, 防止 8 邻房全开
	// 抬高定编淹没孵化队列 (历史 rush 控制冻结机理)。产出任务 (scout/harvest)
	// 的房才消耗配额; 有主/无源的房跳过不占坑。
	let budget = profile.remoteAutoMaxRooms ?? Number.POSITIVE_INFINITY;
	for (const neighborName of neighborRooms(room.roomName)) {
		if (budget <= 0) break;
		const neighbor = Game.rooms[neighborName];
		// 无视野邻房: 派侦查 (到达获视野后由采集任务自然接替)
		if (!neighbor) {
			board.upsert({
				dedupeKey: `scout:${room.roomName}:${neighborName}`,
				kind: "scout",
				roomName: room.roomName,
				targetPos: { x: 25, y: 25, roomName: neighborName },
				priority: priorityFor("scout"),
				requiredCapabilities: ["move"],
			}, ctx.tick);
			budget -= 1;
			continue;
		}
		if (neighbor.controller?.my) continue; // 己方房跳过
		if (neighbor.controller?.owner) continue; // 有主之地不开矿
		const sources = neighbor.find(FIND_SOURCES);
		if (sources.length === 0) continue; // 无源房不占发展配额
		budget -= 1;
		// 预订线 (对齐 Rosmarin race): 未预订外矿先订后采, 容量 1500→3000。
		// 衰减到续订线以下即重发; 他人预订不抢 (reserveController 对他订无效)。
		const reservation = neighbor.controller?.reservation;
		const mine = myUsername() !== undefined && reservation?.username === myUsername();
		if (
			neighbor.controller &&
			(!reservation || (mine && reservation.ticksToEnd < RESERVE_CONFIG.refreshTicks))
		) {
			board.upsert({
				dedupeKey: `reserve:${room.roomName}:${neighborName}`,
				kind: "reserve",
				roomName: room.roomName,
				targetId: neighbor.controller.id,
				targetPos: {
					x: neighbor.controller.pos.x,
					y: neighbor.controller.pos.y,
					roomName: neighborName,
				},
				priority: priorityFor("reserve"), // 预订是外矿收入翻倍的前置, 与侦查同档
				requiredCapabilities: ["claim", "move"],
			}, ctx.tick);
		}
		for (const source of sources) {
			board.upsert({
				dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
				kind: "harvest",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: {
					x: source.pos.x,
					y: source.pos.y,
					roomName: neighborName,
				},
				priority: priorityFor("harvest"), // 与本矿对齐: urgent 门 (70) 之下远程工恒无替补 (bugs (十二))
				requiredCapabilities: ["work", "move"],
			}, ctx.tick);
			upsertRemoteHaul(ctx, board, room.roomName, neighbor, source);
		}
	}
}

/** 活跃远程采集任务数 (定编口径: 本矿 harvester 编制 = 本矿源数 + 远程任务数) */
export function activeRemoteHarvestCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["harvest"] })) {
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/** 活跃侦查任务数 (定编口径: scout 编制 = min(1, 活跃 scout 任务)) */
export function activeScoutCount(ctx: TickContext, board: TaskBoard): number {
	const tasks = board.list({ kinds: ["scout"] });
	return tasks.length > 0 ? 1 : 0;
}

/**
 * 本矿登记在板的远程源加权数 (升级定编口径, bugs (十二)): kind=harvest 且目标房 ≠ 本矿。
 * 直读 memory.tasks 原始记录 (升级定编每 tick 逐房调用, 不重复建板)。
 * 预订口径 (对齐 Rosmarin race): 己方预订源满容量 3000 记 1; 未预订源容量减半记 0.5
 * (防升级体按虚高收入超编, 外矿断供期反噬本地采集面)。
 * @deprecated 收入口径统一 (specs/resource-ledger): 折算逻辑迁 income.ts 的
 * remoteSourceWeightOf, 本包装仅供旧引用过渡, 随 legacy 清理移除。
 */
export function activeRemoteSourceCount(ctx: TickContext, roomName: string): number {
	return remoteSourceWeightOf(ctx, roomName);
}
