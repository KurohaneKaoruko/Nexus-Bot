/**
 * 外矿孵化容量准入闸 (race 口径, docs/bugs/race-strategy-port 批次 L 移植):
 * 单位 = 身体部件数——B 件爬孵化耗 3B tick, 每 spawn 每 1500t 窗口产 500×N 部件,
 * 维持一只 B 件爬恰耗 B 单位/窗口。
 *
 * leftover = capacity − localDemand − remoteUsed:
 * - localDemand = 非采集本地类型在编部件 + 本地源计划编成;
 *   本地 harvester 在编不计入 (编成由定编目标代表, race 同款);
 * - remoteUsed = 本矿注册、目标在跨房的单位部件 (在编 + 孵化中);
 * - leftover 为负 = 本地缺口, 外矿全停; 主房成长后余量自动放大外矿规模。
 *
 * 接入点 (请求侧): spawnDirector 外矿定向替补环 (harvest/carry)——预算不足
 * 时远程请求不进池, 本地请求不被远程占坑, 也不被远程挤爆 (批次 K fix11 病理:
 * 8 源定向请求挤爆孵化线, 升级面 0.48×)。
 */
import type { TickContext } from "@/core";
import { UNIT_CODES } from "@/constant/UnitConstant";

/** 引擎常量 (官方值, sim 与实服一致) */
const LIFE = 1500;
const SPAWN_TIME = 3;

/** 本地源计划编成 (race 公式): 每源维持编成的部件当量。
 *  路程未实测时回退 20t 保守计——不按猜测路程夸大本地需求。 */
function localSourceDemandOf(ctx: TickContext, roomName: string): number {
	const intel = ctx.memory.rooms[roomName];
	const sources = intel?.sourceTiming;
	if (!sources) return 0;
	let demand = 0;
	for (const raw of Object.values(sources)) {
		const pathTime = Math.min(60, Math.max(10, Number(raw) || 20));
		demand += (7 * LIFE) / Math.max(200, LIFE - pathTime) + pathTime * 0.4;
	}
	return demand;
}

/** 剩余外矿孵化容量 (已扣本地计划编成与在编外务; 负数 = 本地缺口, 外矿全停) */
export function remoteSpawnLeftoverOf(ctx: TickContext, roomName: string): number {
	const world = ctx.world.current;
	const room = world?.rooms[roomName];
	const spawnCount = Object.values(Game.spawns).filter((s) => s.room.name === roomName).length;
	const capacity = Math.max(1, spawnCount) * Math.floor(LIFE / SPAWN_TIME);

	let localDemand = 0;
	let remoteUsed = 0;
	for (const [name, record] of Object.entries(ctx.memory.units)) {
		if (record.homeRoom !== roomName) continue;
		const creep = Game.creeps[name];
		if (!creep) continue; // 孵化未落体/死亡回收窗口: 下拍对账
		const parts = creep.body.length;
		if (parts <= 0) continue;
		// 外务判定: creep.memory 任务指针指向跨房任务 = 本矿派出的远程腿 (harvest/
		// carry/reserve/scout 统一口径, 采/运/订全部占外矿预算)。
		// 指针以 creep.memory 为准 (claim 的唯一写入口), units 注册表 taskId 不同步
		const liveMemory = (creep as unknown as { memory?: { taskId?: string } }).memory;
		const taskRoom = liveMemory?.taskId !== undefined
			? ctx.memory.tasks[liveMemory.taskId]?.targetPos?.roomName
			: undefined;
		if (taskRoom !== undefined && taskRoom !== roomName) {
			remoteUsed += parts;
			continue;
		}
		// 采集在编不计入 (编成由定编目标代表); 其余本地类型全计
		if (record.unitCode === UNIT_CODES.harvester) continue;
		localDemand += parts;
	}
	localDemand += localSourceDemandOf(ctx, roomName) ||
		(room ? room.sources.length * ((7 * LIFE) / (LIFE - 20) + 8) : 0);

	return capacity - localDemand - remoteUsed;
}

/** 外矿准入判定: 剩余孵化容量 ≥ 新单部件数 */
export function hasRemoteSpawnBudget(ctx: TickContext, roomName: string, parts: number): boolean {
	return remoteSpawnLeftoverOf(ctx, roomName) >= parts;
}

/** 远程采集件部件数预算 (rush 生成器口径): ~5W + 1C + move 配比 0.5 */
export function remoteHarvestPartsOf(ctx: TickContext, roomName: string): number {
	const world = ctx.world.current;
	const capacity = world?.rooms[roomName]?.energyCapacity ?? 300;
	const work = Math.min(5, Math.max(1, Math.floor(capacity / 100)));
	const carry = 1;
	const move = Math.max(1, Math.ceil((work + carry) / 2));
	return work + carry + move;
}

/** 远程搬运件部件数预算 (批次 Y-v2): 对齐上游 hauler maxCarry 16 大件直运——
 *  微型接力件 200 容量/趟, 同路程下趟数是大件的 8 倍, 路上时间税吞光外矿
 *  净收益 (32k 中点对照: move +2.4k, 采集/升级双降)。road 段 [C,C,M] ×16
 *  = 32 CARRY 16 MOVE, 容量 1600, 预算按 RCL4 档 ~1300-1800 分段适配。 */
export function remoteHaulPartsOf(): number {
	return 48;
}
