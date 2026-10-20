/**
 * 收入折算统一口径 (specs/resource-ledger「收入估计口径统一」):
 * 采集/外矿/预订加成的折算只在此处定义——定编、孵化门、外矿评分一律引用本模块,
 * 杜绝同房不同数。口径: 己方预订源满容量 3000, 未预订源容量减半 (1500),
 * 与 remoteMining 预订线 (specs/race-remote) 一致。
 */
import type { TickContext } from "@/core";
import type { NexusTask } from "@/core/store/taskSchema";
import { REMOTE_CARRY_CONFIG } from "@/config/economy";

/** 能源再生周期 (ENERGY_REGEN_TIME) */
const ENERGY_REGEN_TIME = 300;
/** 己方预订源的单源每 tick 收入上限 (3000 / 300) */
const RESERVED_CAP_PER_TICK = 3000 / ENERGY_REGEN_TIME;

/** 预订折算系数: 己方预订记 1, 未预订记 0.5 (容量减半) */
export function reservationFactor(
	username: string | undefined,
	reservation: ReservationLike,
): number {
	return reservation.username === username ? 1 : 0.5;
}

/** 引擎 controller.reservation 的最小结构 (避免依赖游戏 API 类型) */
export interface ReservationLike {
	username?: string;
}

/**
 * 外矿源是否具备回运通道 (收入记账前置):
 * - 可见且源旁已有容器: 稳态回运点, 能量有稳定去处;
 * - 不可见/容器未建: 以源附近的在板回运任务为准 (矿工 drop 期的掉落堆回运)。
 * 无回运通道的远程源, 挖出的能量只会在原地衰减, 不计入收入——否则升级定编
 * 按虚高收入超编, 外矿能量却没回本矿。
 */
function hasReturnPath(
	target: string,
	x: number,
	y: number,
	carryTasks: readonly NexusTask[],
): boolean {
	const room = Game.rooms[target];
	if (room) {
		const containers = room.find(FIND_STRUCTURES, {
			filter: (s): s is StructureContainer =>
				s.structureType === STRUCTURE_CONTAINER &&
				Math.max(Math.abs(s.pos.x - x), Math.abs(s.pos.y - y)) <= REMOTE_CARRY_CONFIG.containerRange,
		});
		if (containers.length > 0) return true;
	}
	return carryTasks.some(
		(t) =>
			t.targetPos !== undefined &&
			t.targetPos.roomName === target &&
			Math.max(Math.abs(t.targetPos.x - x), Math.abs(t.targetPos.y - y)) <=
				REMOTE_CARRY_CONFIG.containerRange + 1,
	);
}

/**
 * 统一外矿折算: 遍历本矿登记在板的远程采集任务, 按预订状态加权求和。
 * 仅计入具备回运通道的远程源 (容器或源旁在板回运任务)。
 * 直读 memory.tasks 原始记录 (逐 tick 逐房调用, 不重复建板)。
 */
export function remoteSourceWeightOf(ctx: TickContext, roomName: string): number {
	let me: string | undefined;
	for (const spawn of Object.values(Game.spawns)) {
		me = spawn.owner?.username;
		break;
	}
	const tasks = Object.values(ctx.memory.tasks);
	const carryTasks = tasks.filter(
		(task) =>
			task.kind === "carry" &&
			task.roomName === roomName &&
			task.status !== "completed" &&
			task.status !== "cancelled" &&
			task.status !== "failed",
	);
	let weight = 0;
	for (const task of tasks) {
		if (task.kind !== "harvest" || task.roomName !== roomName) continue;
		const pos = task.targetPos;
		if (!pos || pos.roomName === roomName) continue;
		if (!hasReturnPath(pos.roomName, pos.x, pos.y, carryTasks)) continue;
		const reservation = Game.rooms[pos.roomName]?.controller?.reservation;
		weight += reservationFactor(me, reservation ?? {});
	}
	return weight;
}

/** 外矿折算收入的每 tick 上限 (预留给外矿评分与定编共用) */
export function remoteCapPerTick(): number {
	return RESERVED_CAP_PER_TICK;
}

/** 本矿 + 外矿折算的采集收入 (能量/tick): 本矿实测 + 远程加权数 × 单源上限 */
export function incomeWithRemoteOf(
	ctx: TickContext,
	roomName: string,
	localIncome: number,
): number {
	const remoteWeight = remoteSourceWeightOf(ctx, roomName);
	return localIncome + remoteWeight * RESERVED_CAP_PER_TICK;
}
