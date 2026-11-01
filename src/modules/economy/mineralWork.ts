/**
 * 过道矿定编 (planning 阶段): mineMission 活语义迁移 (specs/mission-pool-retirement 映射表 mine 行)。
 *
 * 语义逐条搬运 (原实现见 mission/updaters/mineMission.ts, 域 2.3 删除):
 * - 人操开门: RoomData.outminePower/outmineDeposit 开关 + 房间能量 ≥50000 门槛,
 *   全部保留——这是人操语义 (console mine.ts 写入), 不是要删的池语义;
 * - highway 名单轮询: OutMineData[room].highway 按 LOOK_INTERVAL 分帧轮询,
 *   不可见房 observeRoom 回调侦测 PowerBank/Deposit;
 * - 侦测产出: mine 池 'power'/'deposit' 单 → 改为任务板 harvest 任务
 *   (resourceType 区分元素矿: RESOURCE_POWER=PowerBank, deposit 按矿型),
 *   定编配置 (creep/max/boostLevel/prNum/prMax/count/prCount/num) 落
 *   OutMineData[room].powerMine/depositMine 簿记 (C 波才处置 OutMineData 域);
 * - 孵化: PA/PH 成对原子性 (freeSpawns≥2 才 ×2 directSpawn, PH 失败 PA 不回收
 *   ——80t 退化窗口自动回收), PR ranged 补位, PC 收尾搬运, DH/DT 沉积矿定编。
 *   成对原子性无法用 standing 需求源表达, 按豁免口径保留 directSpawn 桥接
 *   (directSpawn 本身已是 broker 化主线入口);
 * - boost 对偶分配: assignPowerBoostTasks 逐条搬运 (AssignBoostTask 按
 *   boostOwnerId 对偶派资源)。
 *
 * 本文件只读 mine 池之外的内存域, 不触池 API (任务板是唯一任务事实源)。
 */
import type { TickContext } from "@/core";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";
import { OUTMINE_CONFIG } from "@/constant/BaseConstant";
import { UNITS } from "@/constant/CreepConstant";
import { getOutMineData, getRoomData } from "@/core/store/accessor";
import { getCreepByTargetRoom, getUnitCountByTargetRoom } from "@/utils/creepTickIndex";
import { directSpawn } from "@/modules/spawning/spawnDirector";
import { observeRoom } from "@/modules/industry";
import { isRoomTickAligned } from "@/utils/roomPhase";

/** 过道观察开门的能量门槛 (原口径逐条搬运) */
const OUTMINE_ENERGY_THRESHOLD = 50000;

const SURROUNDING_OFFSETS: Array<[number, number]> = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
];

// 这里只依赖目标房 creep 索引中的轻量字段，不要求完整 Creep 实例。
type IndexedTargetRoomCreep = {
	ticksToLive?: number | undefined;
	spawning: boolean;
};

const countActiveCreeps = (
	creeps: readonly IndexedTargetRoomCreep[] | undefined,
	minTicksToLive: number,
) => {
	return (creeps || []).filter(
		(creep) => creep.spawning || (creep.ticksToLive || 0) > minTicksToLive,
	).length;
};

const countOpenAdjacentTiles = (roomName: string, pos: RoomPosition) => {
	const terrain = new Room.Terrain(roomName);
	let count = 0;
	for (const [dx, dy] of SURROUNDING_OFFSETS) {
		const x = pos.x + dx;
		const y = pos.y + dy;
		if (x <= 1 || x >= 48 || y <= 1 || y >= 48) continue;
		if (terrain.get(x, y) !== TERRAIN_MASK_WALL) count++;
	}
	return count;
};

const getPowerBankInRoom = (room: Room) => {
	return (
		room.powerBank?.[0] ??
		(room.find(FIND_STRUCTURES, {
			filter: (structure) => structure.structureType === STRUCTURE_POWER_BANK,
		})[0] as StructurePowerBank | undefined)
	);
};

/** 孵化记忆业务字段 (sourceRoom/targetRoom/boost 对偶): 直写 CreepMemory 业务键 */
const createMineCreepMemory = (
	sourceRoom: string,
	targetRoom: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => {
	return { sourceRoom, targetRoom, ...extra };
};

/** boost 对偶分配 (原 assignPowerBoostTasks 逐条搬运): PA/PH 对按 boostOwnerId 预订 boost 资源 */
const assignPowerBoostTasks = (room: Room, boostLevel: number, boostOwnerId: string) => {
	if (boostLevel === 1) {
		room.AssignBoostTask("GO", 150, boostOwnerId);
		room.AssignBoostTask("UH", 600, boostOwnerId);
		room.AssignBoostTask("LO", 750, boostOwnerId);
	} else if (boostLevel === 2) {
		room.AssignBoostTask("GHO2", 150, boostOwnerId);
		room.AssignBoostTask("UH2O", 600, boostOwnerId);
		room.AssignBoostTask("LO", 750, boostOwnerId);
	}
};

const getPowerCarryThreshold = (
	room: Room,
	targetRoom: string,
	maxPc: number,
	mineData: PowerMineTask,
) => {
	const tick = Game.map.getRoomLinearDistance(room.name, targetRoom) * 50 + (maxPc / 2) * 150 + 50;
	let threshold = tick * Math.max(1800, mineData.creep * 600 * (mineData.boostLevel + 1));
	if (threshold < 600e3) threshold = 600e3;
	if (threshold > 1.5e6) threshold = 1.5e6;
	return threshold;
};

/** 母房可采 PowerBank 定编数 (原 getPowerBankHarvestCount 逐条搬运) */
const getPowerBankHarvestCount = (room: Room) => {
	const powerBank = getPowerBankInRoom(room);

	if (!powerBank || powerBank.power < OUTMINE_CONFIG.POWER_MIN_AMOUNT) return 0;
	if (powerBank.hits < powerBank.hitsMax) return 0;

	let num = countOpenAdjacentTiles(room.name, powerBank.pos);
	if (!num) return 0;

	num = Math.min(num, 3);

	return powerBank.ticksToDecay > 2e6 / (600 * num) + 500 ? num : 0;
};

/** 母房可采 Deposit 定编数 (原 getDepositHarvestCount 逐条搬运) */
const getDepositHarvestCount = (room: Room) => {
	const deposits = room.find(FIND_DEPOSITS);

	if (!deposits || deposits.length === 0) return 0;

	let depositWorkerNum = 0;

	for (const deposit of deposits) {
		if (deposit.lastCooldown >= OUTMINE_CONFIG.DEPOSIT_MAX_COOLDOWN) {
			continue;
		}

		let num = countOpenAdjacentTiles(room.name, deposit.pos);
		if (num === 0) continue;

		depositWorkerNum += Math.min(num, 3);
	}

	return depositWorkerNum;
};

/** 母房能量门槛判定: room[RESOURCE_*] getter 聚合 mass_stores (structureCache 挂载) */
const roomEnergyOf = (room: Room): number =>
	(room as unknown as Record<string, number>)[RESOURCE_ENERGY] ?? 0;

// ── PowerBank 侦测定编配置 (原 getPowerMineMissionData 逐条搬运) ──

type PowerMineMissionConfig = Omit<PowerMineTask, "targetRoom">;

const getPowerMineMissionData = (
	room: Room,
	powerTeamNum: number,
	power: number,
): PowerMineMissionConfig => {
	const stores = [room.storage, room.terminal, ...(room.lab ?? [])];
	let loAmount = 0;
	let goAmount = 0;
	let uhAmount = 0;
	let gho2Amount = 0;
	let uh2oAmount = 0;

	for (const store of stores) {
		if (!store) continue;
		loAmount += store.store["LO"] || 0;
		goAmount += store.store["GO"] || 0;
		uhAmount += store.store["UH"] || 0;
		gho2Amount += store.store["GHO2"] || 0;
		uh2oAmount += store.store["UH2O"] || 0;
	}

	if (power >= 7000 && loAmount >= 3000 && gho2Amount >= 3000 && uh2oAmount >= 3000) {
		return {
			creep: 1,
			max: 2,
			boostLevel: 2,
			prNum: 0,
			prMax: 0,
		};
	}

	if (power >= 7000 && loAmount >= 3000 && goAmount >= 3000 && uhAmount >= 3000) {
		return {
			creep: 1,
			max: 2,
			boostLevel: 1,
			prNum: 5,
			prMax: 8,
		};
	}

	if (power > 3000 && loAmount >= 3000 && goAmount >= 3000 && uhAmount >= 3000) {
		return {
			creep: Math.min(powerTeamNum, 2),
			max: 3,
			boostLevel: 1,
			prNum: powerTeamNum === 1 ? 4 : 0,
			prMax: 6,
		};
	}

	return {
		creep: powerTeamNum,
		max: 6,
		boostLevel: 0,
		prNum: powerTeamNum <= 2 ? 4 : 0,
		prMax: 10,
	};
};

// ── 定编簿记域: OutMineData[room].powerMine/depositMine (读写兼容 C 波前不动) ──

/** PowerBank 定编簿记键 (room.memory.powerMine 已废弃, 收编进 OutMineData 域) */
const powerMineBookOf = (roomName: string) => (getOutMineData(roomName).powerMine ??= {});
const depositMineBookOf = (roomName: string) => (getOutMineData(roomName).depositMine ??= {});

const upsertMineralHarvestTask = (
	ctx: TickContext,
	board: TaskBoard,
	sourceRoom: string,
	targetRoom: string,
	resourceType: ResourceConstant,
	targetId: string,
	pos: { x: number; y: number },
) => {
	const key = `harvest:${sourceRoom}:mineral:${targetRoom}`;
	board.upsert(
		{
			dedupeKey: key,
			kind: "harvest",
			roomName: sourceRoom,
			targetId,
			targetPos: { x: pos.x, y: pos.y, roomName: targetRoom },
			resourceType,
			priority: priorityFor("harvest"),
			requiredCapabilities: ["work"],
		},
		ctx.tick,
	);
};

const cancelMineralHarvestTask = (
	ctx: TickContext,
	board: TaskBoard,
	sourceRoom: string,
	targetRoom: string,
) => {
	for (const task of board.list({ kinds: ["harvest"], roomName: sourceRoom })) {
		if (task.dedupeKey === `harvest:${sourceRoom}:mineral:${targetRoom}`) {
			board.cancel(task.id, ctx.tick, "mineral-exhausted");
		}
	}
};

// ── 定编执行 (原 handlePowerMine / handleDepositMine 逐条搬运) ──

const handlePowerMine = (
	ctx: TickContext,
	board: TaskBoard,
	room: Room,
	targetRoom: string,
	mineData: PowerMineTask,
) => {
	const targetRoomObj = Game.rooms[targetRoom];
	const powerBank = targetRoomObj ? getPowerBankInRoom(targetRoomObj) : undefined;

	if (targetRoomObj && !powerBank) {
		delete powerMineBookOf(room.name)[targetRoom];
		cancelMineralHarvestTask(ctx, board, room.name, targetRoom);
		console.log(`${targetRoom} 的 PowerBank 已耗尽, 已移出开采队列。`);
		return;
	}

	const creepByTargetRoom = getCreepByTargetRoom(targetRoom);
	let pa = 0,
		ph = 0;
	let powerTeamNum = mineData.creep;

	if (!powerBank || powerBank.hits > 500000) {
		pa = countActiveCreeps(creepByTargetRoom[UNITS["power-attack"]] ?? [], 100);
		ph = countActiveCreeps(creepByTargetRoom[UNITS["power-heal"]] ?? [], 100);
	} else {
		pa = (creepByTargetRoom[UNITS["power-attack"]] || []).length;
		ph = (creepByTargetRoom[UNITS["power-heal"]] || []).length;
		powerTeamNum = 1;
	}

	// 第一阶段：维持攻坚队（PA / PH）与可选 ranged 队列。
	if (!mineData.count) mineData.count = 0;
	if (mineData.count < mineData.max) {
		const panum = pa + getUnitCountByTargetRoom(targetRoom, UNITS["power-attack"]);
		const phnum = ph + getUnitCountByTargetRoom(targetRoom, UNITS["power-heal"]);

		for (let i = Math.min(panum, phnum); i < powerTeamNum; i++) {
			const boostOwnerId = `Mine-${room.name}-${targetRoom}-${Game.time}-${mineData.count}`;
			const memory = createMineCreepMemory(room.name, targetRoom, {
				boostLevel: mineData.boostLevel,
				boostOwnerId,
			});

			// PA/PH 成对下蛋保原子性: directSpawn 同步孵化, 单空闲 spawn 时只下
			// 一只会让 boost 悬空 (AssignBoostTask 按对偶派资源)——两个空闲才成对
			const freeSpawns = room.find(FIND_MY_SPAWNS).filter((s) => !s.spawning).length;
			if (freeSpawns < 2) break;

			const paRet = directSpawn(room, {
				mode: "direct",
				unit: UNITS["power-attack"],
				memory: { ...memory },
			});
			if (paRet !== OK) break;
			const phRet = directSpawn(room, {
				mode: "direct",
				unit: UNITS["power-heal"],
				memory: { ...memory },
			});
			if (phRet !== OK) {
				// PA 已下蛋而 PH 失败: 补救——PA 单体无法攻坚, 不再补 PH,
				// boost 资源会在 80t 退化窗口自动回收 (ensureBoosted 口径)
				break;
			}

			assignPowerBoostTasks(room, mineData.boostLevel, boostOwnerId);

			mineData.count = mineData.count + 1;

			if (mineData.count >= mineData.max) break;
		}

		powerMineBookOf(room.name)[targetRoom] = mineData;
	}

	if (!mineData.prCount) mineData.prCount = 0;
	if (mineData.prCount < mineData.prMax && mineData.prNum > 0) {
		const prnum =
			(creepByTargetRoom[UNITS["power-ranged"]] || []).length +
			getUnitCountByTargetRoom(targetRoom, UNITS["power-ranged"]);

		for (let i = prnum; i < mineData.prNum; i++) {
			const memory = createMineCreepMemory(room.name, targetRoom);
			directSpawn(room, { mode: "direct", unit: UNITS["power-ranged"], memory: { ...memory } });
			mineData.prCount = mineData.prCount + 1;
		}

		powerMineBookOf(room.name)[targetRoom] = mineData;
	}

	if (!targetRoomObj) return;
	if (!powerBank) return;

	// 第二阶段：PowerBank 进入收尾阈值后，开始补充搬运队（PC）。
	const maxPc = powerBank.power / 1250;
	const threshold = getPowerCarryThreshold(room, targetRoom, maxPc, mineData);

	if (powerBank.hits <= threshold) {
		const pc = countActiveCreeps(creepByTargetRoom[UNITS["power-carry"]] ?? [], 150);

		if (pa < 1 || ph < 1) return;

		const pcnum = pc + getUnitCountByTargetRoom(targetRoom, UNITS["power-carry"]);
		for (let i = pcnum; i < maxPc; i++) {
			const memory = createMineCreepMemory(room.name, targetRoom);
			directSpawn(room, { mode: "direct", unit: UNITS["power-carry"], memory: { ...memory } });
		}
	}
};

const handleDepositMine = (
	ctx: TickContext,
	board: TaskBoard,
	room: Room,
	targetRoom: string,
	mineData: DepositMineTask,
) => {
	const lookInterval = OUTMINE_CONFIG.LOOK_INTERVAL;

	let depositWorkerNum = mineData.num;
	if (!depositWorkerNum || depositWorkerNum <= 0) {
		delete depositMineBookOf(room.name)[targetRoom];
		cancelMineralHarvestTask(ctx, board, room.name, targetRoom);
		console.log(`${targetRoom} 的任务数量异常, 已移出开采队列。`);
		return;
	}

	const targetRoomObj = Game.rooms[targetRoom];
	if (targetRoomObj && isRoomTickAligned(targetRoom, lookInterval * 5, lookInterval * 5 - 1)) {
		depositWorkerNum = getDepositHarvestCount(targetRoomObj);
		if (depositWorkerNum > 0) {
			mineData.num = depositWorkerNum;
			depositMineBookOf(room.name)[targetRoom] = mineData;
		} else {
			delete depositMineBookOf(room.name)[targetRoom];
			cancelMineralHarvestTask(ctx, board, room.name, targetRoom);
			console.log(`${targetRoom} 的 Deposit 已耗尽, 已移出开采队列。`);
			return;
		}
	}

	if (!mineData.active) return;

	const creepByTargetRoom = getCreepByTargetRoom(targetRoom);

	const dh = countActiveCreeps(creepByTargetRoom[UNITS["deposit-harvest"]] ?? [], 200);
	const dhnum = dh + getUnitCountByTargetRoom(targetRoom, UNITS["deposit-harvest"]);
	if (dhnum < depositWorkerNum) {
		const memory = createMineCreepMemory(room.name, targetRoom);
		directSpawn(room, { mode: "direct", unit: UNITS["deposit-harvest"], memory: { ...memory } });
	}

	const dt = countActiveCreeps(creepByTargetRoom[UNITS["deposit-transfer"]] ?? [], 150);
	const dtnum = dt + getUnitCountByTargetRoom(targetRoom, UNITS["deposit-transfer"]);
	if (dtnum < depositWorkerNum / 2) {
		const memory = createMineCreepMemory(room.name, targetRoom);
		directSpawn(room, { mode: "direct", unit: UNITS["deposit-transfer"], memory: { ...memory } });
	}
};

// ── highway 轮询: 名单逐房侦测 + 定编续排 ──

/** 侦测回调: 视野已到位的过道房侦测 PowerBank/Deposit → 产出 harvest 任务 + 定编簿记 */
const handleHighwayRoom = (
	ctx: TickContext,
	board: TaskBoard,
	room: Room,
	roomName: string,
	outminePower: boolean,
	outmineDeposit: boolean,
) => {
	const targetRoom = Game.rooms[roomName];
	if (!targetRoom) return;

	if (outminePower) {
		const powerBook = powerMineBookOf(room.name);
		if (!powerBook[roomName]) {
			const powerTeamNum = getPowerBankHarvestCount(targetRoom);
			if (powerTeamNum > 0) {
				const powerBank = getPowerBankInRoom(targetRoom);
				if (!powerBank) return;
				const data: PowerMineTask = {
					...getPowerMineMissionData(room, powerTeamNum, powerBank.power),
					targetRoom: roomName,
				};

				powerBook[roomName] = data;
				upsertMineralHarvestTask(
					ctx,
					board,
					room.name,
					roomName,
					RESOURCE_POWER,
					powerBank.id,
					powerBank.pos,
				);
				console.log(`在 ${roomName} 发现 PowerBank (${powerBank.power} power), 已加入开采队列。`);
				console.log(
					`将从 ${room.name} 派出 ${data.creep} 数量的T${data.boostLevel}采集队。Ranged数量:${data.prNum}。`,
				);
			}
		}
	}

	if (outmineDeposit) {
		const depositBook = depositMineBookOf(room.name);
		if (!depositBook[roomName]) {
			const depositWorkerNum = getDepositHarvestCount(targetRoom);
			if (depositWorkerNum > 0) {
				const firstDeposit = targetRoom.find(FIND_DEPOSITS)[0]!;
				const data: DepositMineTask = {
					targetRoom: roomName,
					num: depositWorkerNum,
					active: true,
				};
				depositBook[roomName] = data;
				upsertMineralHarvestTask(
					ctx,
					board,
					room.name,
					roomName,
					firstDeposit.depositType,
					firstDeposit.id,
					firstDeposit.pos,
				);
				console.log(`在 ${roomName} 发现 Deposit, 已加入开采队列。`);
				console.log(`将从 ${room.name} 派出总共 ${depositWorkerNum} 数量的采集队。`);
			}
		}
	}
};

/**
 * 过道矿计划入口: 人操开关/能量门槛/highway 名单轮询 + 既有定编簿记续排。
 * 每 tick 对每个己方房调用; 名单轮询与定编续排同拍。
 */
export function planMineralWork(ctx: TickContext, board: TaskBoard, room: Room): void {
	const lookInterval = OUTMINE_CONFIG.LOOK_INTERVAL;

	// 定编续排: 侦测过的簿记条目逐条续排
	const powerBook = powerMineBookOf(room.name);
	for (const [targetRoom, data] of Object.entries(powerBook)) {
		handlePowerMine(ctx, board, room, targetRoom, data as PowerMineTask);
	}
	const depositBook = depositMineBookOf(room.name);
	for (const [targetRoom, data] of Object.entries(depositBook)) {
		if (typeof data === "number") continue; // deposit 级位置数据 (旧格式残值), C 波处置
		handleDepositMine(ctx, board, room, targetRoom, data as DepositMineTask);
	}

	// highway 名单轮询
	if (!isRoomTickAligned(room.name, lookInterval)) return;

	if (roomEnergyOf(room) < OUTMINE_ENERGY_THRESHOLD) return;
	const outminePower = getRoomData(room.name)?.["outminePower"] ?? false;
	const outmineDeposit = getRoomData(room.name)?.["outmineDeposit"] ?? false;
	if (!outminePower && !outmineDeposit) return;

	const lookList = getOutMineData(room.name)?.["highway"] || [];
	if (lookList.length === 0) return;

	// 轮询观察房间 (原口径: 仅不可见房发起观察, 可见房本拍不侦测——
	// 侦测只发生在 observe 成功的下一 tick 回调, 保真不扩语义)
	const lookIndex = Math.floor(Game.time / lookInterval) % lookList.length;
	const roomName = lookList[lookIndex];
	if (!Game.rooms[roomName!]) {
		// 使用新的 observeRoom API 并注册回调
		// 回调会在 observe 成功的下一 tick 自动执行
		observeRoom(room, roomName!, () => {
			handleHighwayRoom(ctx, board, room, roomName!, outminePower, outmineDeposit);
		});
	}
}
