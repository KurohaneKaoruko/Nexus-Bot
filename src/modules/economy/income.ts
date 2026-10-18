/**
 * 收入折算统一口径 (specs/resource-ledger「收入估计口径统一」):
 * 采集/外矿/预订加成的折算只在此处定义——定编、孵化门、外矿评分一律引用本模块,
 * 杜绝同房不同数。口径: 己方预订源满容量 3000, 未预订源容量减半 (1500),
 * 与 remoteMining 预订线 (specs/race-remote) 一致。
 */
import type { TickContext } from "@/core";

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
 * 统一外矿折算: 遍历本矿登记在板的远程采集任务, 按预订状态加权求和。
 * 直读 memory.tasks 原始记录 (逐 tick 逐房调用, 不重复建板)。
 */
export function remoteSourceWeightOf(ctx: TickContext, roomName: string): number {
	let me: string | undefined;
	for (const spawn of Object.values(Game.spawns)) {
		me = spawn.owner?.username;
		break;
	}
	let weight = 0;
	for (const task of Object.values(ctx.memory.tasks)) {
		if (task.kind !== "harvest" || task.roomName !== roomName) continue;
		const target = task.targetPos?.roomName;
		if (!target || target === roomName) continue;
		const reservation = Game.rooms[target]?.controller?.reservation;
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
