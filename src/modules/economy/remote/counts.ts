/**
 * 外矿定编计数 (phase4 5.9, 自 economy/remoteMining.ts 迁入):
 * 任务板口径的活跃外矿任务统计——harvester 定编 / carrier 加编 / scout 并行
 * 编制的输入。口径不变, 仅搬迁 (旧文件删除, 消费方 demandSources 改引此处)。
 */
import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import { SCOUT_CONFIG } from "@/config/economy";
import { isProductionSecured } from "@/modules/economy/productionGate";

/** 活跃远程采集任务数 (定编口径: 本矿 harvester 编制 = 本矿源数 + 远程任务数)。
 *  带 resourceType 的 harvest 是过道矿合约 (economy/mineralWork, directSpawn
 *  桥接自孵战斗件), 不计入 harvester 定编。 */
export function activeRemoteHarvestCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["harvest"] })) {
		if (task.resourceType !== undefined) continue;
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/** 活跃外矿回运任务数 (定编口径): 每个容器/掉落堆回运点都需要专属运力 */
export function activeRemoteCarryCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["carry"] })) {
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/** 外矿待回运存量 (能量): 容器/掉落堆任务登记量之和, 作为运力加编信号 */
export function activeRemoteCarryBacklog(ctx: TickContext, board: TaskBoard): number {
	let total = 0;
	for (const task of board.list({ kinds: ["carry"] })) {
		if (!task.targetPos?.roomName || task.targetPos.roomName === task.roomName) continue;
		total += task.amount ?? 0;
	}
	return total;
}

/** 活跃侦查任务数 (定编口径): 生产安全门内并行侦察 (≤ parallelCap),
 *  未就绪期恒 1——采集面未铺满时 scout 是能量税, 先保本地产出再摊侦察 */
export function activeScoutCount(ctx: TickContext, board: TaskBoard): number {
	const rooms = Object.values(ctx.world.current?.rooms ?? {});
	const secured = rooms.length > 0 && rooms.every((room) => isProductionSecured(ctx, room));
	if (!secured) {
		return 1;
	}
	return Math.min(board.list({ kinds: ["scout"] }).length, SCOUT_CONFIG.parallelCap);
}
