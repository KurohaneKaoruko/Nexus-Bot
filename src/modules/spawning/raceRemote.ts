import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { unitCode } from "@/constant/UnitConstant";
import { REMOTE_CARRY_CONFIG } from "@/config/economy";
import { harvestIncomeOf } from "@/modules/economy";
import { hasRemoteSpawnBudget } from "@/modules/spawning/remoteBudget";
import { roomWorldCoord } from "@/utils/roomCoord";
import type { SpawnUnit } from "@/modules/spawning/bodyFactory";

// ==================== 外矿主链 (批次 AD, 上游 nextSpawn 外矿段整体口径) ====================

/** 远程源空缺判定 (上游 work(s) alive 口径的布尔化): 预算内最近远程源无
 *  在岗矿工 (TTL > 3×body + walk×pace) 即 true——升级编制让位的开关。
 *  只认【带 targetId 的正式任务】: 占位任务 (无 id, 矿工还在路上) 恒算
 *  空缺会把 upgrader 永久压在地板 (升级速率 8/t → 3/t 实证), 外矿链
 *  爬坡期升级面不陪葬——上游 minUp 语义是「地板 + fed 门」, 不是清零。 */
export function raceRemoteDeficitOf(ctx: TickContext, board: TaskBoard): boolean {
	const homeRoom = Object.values(ctx.world.current?.rooms ?? {})[0];
	if (!homeRoom) return false;
	const homeRoomName = homeRoom.roomName;
	const walk = (room: string) => remoteWalkLeadOf(ctx, homeRoomName, room, 2);
	for (const task of board.list({ kinds: ["harvest"], statuses: ["available", "leased", "in_progress"] })) {
		if (task.resourceType !== undefined) continue;
		const targetRoom = task.targetPos?.roomName;
		if (!targetRoom || targetRoom === task.roomName) continue;
		if (!task.targetId) continue; // 占位任务不算空缺
		const lead = walk(targetRoom);
		const holder = task.assignedTo
			? ctx.memory.units[task.assignedTo]
			: undefined;
		const creep = holder ? Game.creeps[holder.name] : undefined;
		if (
			creep &&
			!creep.spawning &&
			unitCode(holder!.unitCode) === UNIT_CODES.remoteMiner &&
			(creep.ticksToLive ?? 0) > creep.body.length * 3 + lead
		) {
			continue; // 该源在岗
		}
		return true; // 有正式源空缺
	}
	return false;
}

/** 换班提前量: 路程未实测回退线性房距估算 (上游 dist 未实测时同款退化) */
function remoteWalkLeadOf(ctx: TickContext, homeRoomName: string, targetRoomName: string, pace: number): number {
	const cached = ctx.memory.economy.remoteSourcesByHome?.[homeRoomName];
	const hit = cached?.find((e) => e.room === targetRoomName);
	if (hit) return hit.dist * pace;
	const home = roomWorldCoord(homeRoomName);
	const target = roomWorldCoord(targetRoomName);
	const linear = home && target ? Math.max(Math.abs(home.x - target.x), Math.abs(home.y - target.y)) : 1;
	return (30 + linear * 20 + 20) * pace;
}

/**
 * rush 档外矿请求产出 (批次 AD):
 * - 分支序闸 (上游 spawnIt want[0] 语义): 本矿 harvester/carrier 定编未满 →
 *   外矿请求整段不进池——AC 病理 (远程请求 priority 69 压过本矿替补) 的根治;
 * - 按源无缝换班 (上游 work(s)/alive 逐位): 矿工 TTL > 3×body + walk×pace
 *   即视为在岗, 否则发替补 (priority 同任务档, 定向绑定 taskId);
 * - hauler 按上游公式逐源定编: needCarry = ceil(dug×(2×dist+6)×slack/50),
 *   haveCarry = 该源在岗 hauler CARRY 部件和, 缺口发 carrier (remote:carry 绑定);
 * - reserver: 上游 resLead 口径 (TTL > 300 + 3×body + walk), claims=2 随预算。
 * 预算闸: 部件数走 remoteSpawnLeftoverOf (批次 L 总量门, 本矿计划编成先扣)。
 */
export function raceRemoteRequests(
	ctx: TickContext,
	board: TaskBoard,
	staffed: (unit: string) => number,
	targets: Record<SpawnUnit, number>,
	addRequest: (unit: SpawnUnit, priority: number, purpose: string, taskId?: string, rkey?: string, budget?: number) => void,
): void {
	// 分支序闸 ①: 本矿采集面未满编 → 外矿整段让位 (上游 want[0] 恒本矿)。
	// 定编口径: effectiveTarget 的 dying 剔除口径与 staffed 对齐 (存活+在途),
	// 直接用 targets 面值——replacement 环已按同口径发缺口请求。
	if (staffed("harvester") < Math.max(1, targets.harvester)) return;
	// 分支序闸 ②: 搬运未满编 → 拦 hauler 请求 (上游 hauler 段在两个本矿源
	// work 之后)。**只拦 hauler**——miner/reserver 与搬运编制解耦: 闸②若整段
	// return, 矿工死绝→堆空→carry 取消→hauler 闲编→闸关→矿工不补, 自锁死循环
	// (28k 实证 8 远程任务全 available, remoteMiner 0 只)。上游无此耦合:
	// miner 请求在 work(s) 内部先于 hauler 判定。

	const homeRoom = Object.values(ctx.world.current?.rooms ?? {})[0];
	if (!homeRoom) return;
	const homeRoomName = homeRoom.roomName;
	const rcl = homeRoom.rcl;
	const capacity = homeRoom.energyCapacity;
	const slack = rcl < 3 ? 0.998 : 0.81;

	// 活体索引: 按目标源/房间聚合 (units 注册表 + 引擎侧 body 读数)
	type Duty = { ttl: number; bodyLen: number; work: number; carry: number; taskId?: string | undefined };
	const byTask = new Map<string, Duty[]>();
	// 搬运力按目标房聚合 (上游 haveCarry 口径: 该源在岗 hauler 的 CARRY 和;
	// 绑定到目标房任一 carry 任务的都算——按源细分反而漏计堆→多源共运)
	const carryByRoom = new Map<string, number>();
	let idleCarry = 0;
	for (const record of Object.values(ctx.memory.units)) {
		if (record.homeRoom !== homeRoomName) continue;
		const creep = Game.creeps[record.name];
		if (!creep || creep.spawning) continue;
		const code = unitCode(record.unitCode);
		if (code !== UNIT_CODES.remoteMiner && code !== UNIT_CODES.carrier && code !== UNIT_CODES.reserver) continue;
		// 任务指针以 creep.memory 为准 (claim 的唯一写入口); units 注册表的
		// taskId 无人同步, 读它 = vacancy 恒空 → 同任务无限重发孵化请求
		// (6k 实证单位爆到 51 只, RM 全场 idle)
		const taskId = creep.memory.taskId;
		const duty: Duty = {
			ttl: creep.ticksToLive ?? 0,
			bodyLen: creep.body.length,
			work: creep.getActiveBodyparts(WORK),
			carry: creep.getActiveBodyparts(CARRY),
			taskId,
		};
		if (code === UNIT_CODES.remoteMiner || code === UNIT_CODES.reserver) {
			if (!taskId) continue;
			const list = byTask.get(taskId);
			if (list) list.push(duty);
			else byTask.set(taskId, [duty]);
		} else {
			// carrier: 绑定任务 → 目标房计入搬运力; 未绑定 → idle 池
			const boundTask = taskId ? board.get(taskId) : undefined;
			const destRoom = boundTask?.targetPos?.roomName;
			if (destRoom && destRoom !== homeRoomName) {
				carryByRoom.set(destRoom, (carryByRoom.get(destRoom) ?? 0) + duty.carry);
			} else {
				idleCarry += duty.carry;
			}
		}
	}

	// 远程任务面: budget 裁剪在 planRemoteHarvest 已做 (容量驱动),
	// 此处逐任务产出 miner/hauler/reserver 请求 (上游 work(s) 顺序: miner → hauler → reserver)
	const remoteTasks = board
		.list({ kinds: ["harvest"], statuses: ["available", "leased", "in_progress"] })
		.filter(
			(t) =>
				t.resourceType === undefined &&
				t.targetPos?.roomName !== undefined &&
				t.targetPos.roomName !== t.roomName,
		)
		.sort((a, b) => (a.targetPos!.roomName < b.targetPos!.roomName ? -1 : 1));
	for (const task of remoteTasks) {
		const targetRoom = task.targetPos!.roomName;
		const walk = remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 2); // 矿工 pace ≈ 2 (W:M = 5:3)
		const miners = byTask.get(task.id) ?? [];
		// ① 矿工 (上游 alive 口径: spawning 视为满 TTL)
		const aliveMiner = miners.filter((m) => m.ttl > m.bodyLen * 3 + walk);
		const minerParts = Math.max(6, Math.floor((capacity - 100) / 100) + 2);
		if (aliveMiner.length === 0 && hasRemoteSpawnBudget(ctx, homeRoomName, minerParts)) {
			// 预算分档 (上游 minerEnergyCapacity 口径: income>0 用满容量攒大件,
			// 收入未起按 energyAvailable 降档)——收入信号取本矿实测采集流
			// (上游 getRoomStats().income 同源口径)。编制比较在 fleetWork 波动时
			// 开窗震荡, 且本地满编后 incomeUp 恒真 → 满容量档在涓流期恒攒不满,
			// RM 饿死 (15k 实证 RM 仅 1 只, t2300 后零孵化)。
			const incomeUp = harvestIncomeOf(ctx, homeRoom) > 0;
			const avail = Object.values(Game.spawns)[0]?.room.energyAvailable ?? 300;
			addRequest(
				"remoteMiner",
				task.priority,
				`remote:miner:${task.id}`,
				task.id,
				`rm:${task.id}`,
				incomeUp ? undefined : avail,
			);
		}
		// ② hauler (上游 needCarry 公式): dug = min(10, 2×ΣW)
		const dug = Math.min(10, 2 * aliveMiner.reduce((s, m) => s + m.work, 0));
		const needCarry = Math.ceil((dug * (2 * remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 1) + 6) * slack) / 50);
		const haveCarry = idleCarry + (carryByRoom.get(targetRoom) ?? 0);
		if (dug > 0 && haveCarry < needCarry && hasRemoteSpawnBudget(ctx, homeRoomName, 48)) {
			// 分支序闸 ② (仅 hauler): 本矿搬运缺编时外矿 hauler 让位
			if (staffed("carrier") < Math.max(1, targets.carrier)) continue;
			// 绑定该源的回运任务 (available carry 即本源产出堆), 无则裸请求由分配器指派
			const carryTask = board
				.list({ kinds: ["carry"], statuses: ["available"] })
				.find((t) => t.targetPos?.roomName === targetRoom);
			addRequest("carrier", REMOTE_CARRY_CONFIG.carryPriority, `remote:carry:${carryTask?.id ?? task.id}`, carryTask?.id, `rc:${task.id}`);
		}
	}
	// ③ reserver (上游 resLead 口径): 每房一单, TTL > 300 + 3×body + walk
	const reserveTasks = board
		.list({ kinds: ["reserve"], statuses: ["available", "leased", "in_progress"] })
		.filter((t) => t.targetPos?.roomName !== undefined && t.targetPos.roomName !== t.roomName);
	const seenRooms = new Set<string>();
	for (const task of reserveTasks) {
		const targetRoom = task.targetPos!.roomName;
		if (seenRooms.has(targetRoom)) continue;
		seenRooms.add(targetRoom);
		const walk = remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 1);
		// holder 判定与 RM 同源修正: creep.memory 是任务指针的唯一事实源
		const holders = Object.values(ctx.memory.units).filter((r) => {
			if (r.homeRoom !== homeRoomName || unitCode(r.unitCode) !== UNIT_CODES.reserver) return false;
			const creep = Game.creeps[r.name];
			return creep !== undefined && creep.memory.taskId !== undefined;
		});
		// 全局预订件上限 (上游 claims=2): reserver 部件小 (650 能量) 且 priority
		// 与 RM 同档, 无上限时 pool.find 恒先孵它, RM (270+) 攒能期被挤到恒饿
		// (40k 实证 reserver 6 只 / RM 0 只)。含孵化中——请求池逐拍重建,
		// 只算已落体会在同一窗口并发发出 N 个请求
		const aliveReservers = Object.values(ctx.memory.units).filter((r) => {
			if (r.homeRoom !== homeRoomName || unitCode(r.unitCode) !== UNIT_CODES.reserver) return false;
			const creep = Game.creeps[r.name];
			return creep !== undefined && (creep.spawning || (creep.ticksToLive ?? 0) > 100);
		}).length;
		const aliveHolder = holders.some((r) => {
			const creep = Game.creeps[r.name];
			return creep && !creep.spawning && (creep.ticksToLive ?? 0) > 300 + creep.body.length * 3 + walk;
		});
		if (!aliveHolder && aliveReservers < 2 && hasRemoteSpawnBudget(ctx, homeRoomName, 4)) {
			addRequest("reserver", task.priority + 1, `remote:reserve:${targetRoom}`, task.id, `rr:${targetRoom}`);
		}
	}
}
