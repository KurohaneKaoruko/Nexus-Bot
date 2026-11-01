/**
 * Boost lab 管理 (原 UpdateBoostMission 的 lab 分配/填充/清理语义,
 * 自 mission/updaters/boostMission 迁移):
 * 预订需求读 economy/boostLedger (原读 boost 池), lab 单表预留
 * (ensureBoostLabs) 口径不变; 搬运发单改任务板 carry (原 transport 池,
 * 域 3.4 收口)——能量方向可执行, 矿物方向待矿物执行分支 (摸底档 N 节登记)。
 */
import { getLabAB, ensureBoostLabs } from '@/modules/industry';
import { getStructData } from '@/core/store/accessor';
import { activeBoostEntries, pruneBoostEntries } from '@/modules/economy/boostLedger';
import { priorityFor } from '@/core/store/taskSchema';
import type { TaskBoard } from '@/modules/tasks';

const BOOST_LAB_CAPACITY = 3000;
const BOOST_LAB_ENERGY_TARGET = 2000;

type BoostDemandMap = Partial<Record<ResourceConstant, number>>;

/** reaction 活跃时底物 Lab A/B 不得征用 (原 getForbiddenBoostLabIds) */
const forbiddenBoostLabIds = (room: Room): Set<string> => {
	const botmem = getStructData(room.name);
	const { labAId, labBId } = getLabAB(room.name, room);
	const reactionActive =
		!!botmem?.lab && !!labAId && !!labBId && !!botmem?.labAtype && !!botmem?.labBtype;
	const forbidden = new Set<string>();
	if (reactionActive) {
		forbidden.add(labAId as string);
		forbidden.add(labBId as string);
	}
	return forbidden;
};

/** 搬运发单 (任务板 carry, 原 transport 池口径): lab↔storage 点对点单 */
const addBoostTransport = (
	room: Room,
	board: TaskBoard | undefined,
	task: { source: string; target: string; resourceType: ResourceConstant; amount: number },
): void => {
	if (!board) return;
	const source = Game.getObjectById(task.source as Id<AnyStoreStructure>);
	const target = Game.getObjectById(task.target as Id<AnyStoreStructure>);
	if (!source || !target) return;
	board.upsert(
		{
			dedupeKey: `carry:boost:${room.name}:${task.target}:${task.resourceType}`,
			kind: 'carry',
			roomName: room.name,
			targetId: task.source,
			targetPos: { x: source.pos.x, y: source.pos.y, roomName: room.name },
			destId: task.target,
			destPos: { x: target.pos.x, y: target.pos.y, roomName: room.name },
			resourceType: task.resourceType,
			amount: task.amount,
			priority: priorityFor('carry'),
			requiredCapabilities: ['carry', 'move'],
			deadline: Game.time + 300,
		},
		Game.time,
	);
};

/** lab 回收 (原 cleanupBoostLab): 非目标矿清回 storage */
const cleanupBoostLab = (room: Room, board: TaskBoard | undefined, lab: StructureLab): void => {
	const mineral = lab.mineralType;
	if (!mineral || lab.store[mineral] <= 0 || !room.storage) return;
	addBoostTransport(
		room,
		board,
		{ source: lab.id, target: room.storage.id, resourceType: mineral, amount: lab.store[mineral] },
	);
};

/** 最佳 Lab 选择 (原 findBestLabForBoost): 已存目标矿 > 空闲 > 征用 */
const findBestLab = (
	availableLabs: StructureLab[],
	assignedLabs: Set<string>,
	mineral: ResourceConstant,
): StructureLab | null => {
	const candidates = availableLabs.filter((l) => !assignedLabs.has(l.id));
	if (candidates.length === 0) return null;
	const ready = candidates.find((l) => l.mineralType === mineral);
	if (ready) return ready;
	const idle = candidates.find((l) => !l.mineralType);
	if (idle) return idle;
	return candidates[0]!;
};

/** lab 填充管理 (原 manageBoostLab): 补矿 + 补能量 */
const manageBoostLab = (room: Room, board: TaskBoard | undefined, lab: StructureLab | null, mineral: ResourceConstant, amount: number): void => {
	if (!lab) return;

	if (lab.mineralType && lab.mineralType !== mineral) {
		cleanupBoostLab(room, board, lab);
		return;
	}

	const currentAmount = lab.store[mineral] || 0;
	const freeSpace = lab.store.getFreeCapacity(mineral);
	const fillTarget = Math.min(BOOST_LAB_CAPACITY, amount);

	if (currentAmount < fillTarget && (freeSpace ?? 0) > 0) {
		const source = [room.storage, room.terminal].find((store) => store && store.store[mineral] > 0);
		if (source) {
			const needed = Math.min(fillTarget - currentAmount, freeSpace ?? 0, source.store[mineral]);
			if (needed > 0) {
				addBoostTransport(
					room,
					board,
					{ source: source.id, target: lab.id, resourceType: mineral, amount: needed },
				);
			}
		}
	}

	if (!room.storage || room.storage.store[RESOURCE_ENERGY] <= 0) return;
	if (lab.store[RESOURCE_ENERGY] >= BOOST_LAB_ENERGY_TARGET) return;

	addBoostTransport(
		room,
		board,
		{
			source: room.storage.id,
			target: lab.id,
			resourceType: RESOURCE_ENERGY,
			amount: BOOST_LAB_ENERGY_TARGET - lab.store[RESOURCE_ENERGY],
		},
	);
};

/** 清空 task 征用 (原 clearAllBoostData): 无预订时只留 fixed 配置 */
const clearAllBoostData = (room: Room, board: TaskBoard | undefined): void => {
	const botmem = getStructData(room.name);
	const { labAId, labBId } = getLabAB(room.name, room);
	const reactionActive =
		!!botmem?.lab && !!labAId && !!labBId && !!botmem?.labAtype && !!botmem?.labBtype;
	const boostLabs = botmem?.boostLabs;
	if (!boostLabs) return;
	for (const labId of Object.keys(boostLabs) as Id<StructureLab>[]) {
		const entry = boostLabs[labId];
		if (!entry || entry.mode !== 'task') continue;
		if (!reactionActive && ((labAId && labId === labAId) || (labBId && labId === labBId))) continue;
		const lab = Game.getObjectById(labId);
		if (lab) cleanupBoostLab(room, board, lab);
	}
	for (const labId in boostLabs) {
		if (boostLabs[labId]?.mode === 'task') delete boostLabs[labId];
	}
};

/** 每拍入口 (原 UpdateBoostMission 主体): 巡检簿记 → lab 分配 → 填充 */
export function planBoostLabWork(room: Room, board?: TaskBoard): void {
	pruneBoostEntries();

	const labs = room.lab;
	if (!labs || labs.length === 0) return;

	const boostLabs = ensureBoostLabs(room.name);
	const forbidden = forbiddenBoostLabIds(room);
	const entries = activeBoostEntries();

	if (entries.length === 0) {
		clearAllBoostData(room, board);
		for (const labId in boostLabs) {
			const entry = boostLabs[labId];
			if (!entry || entry.mode !== 'fixed' || forbidden.has(labId)) continue;
			manageBoostLab(room, board, Game.getObjectById(labId as Id<StructureLab>), entry.mineral, BOOST_LAB_CAPACITY);
		}
		return;
	}

	const neededMineralsMap: BoostDemandMap = {};
	for (const entry of entries) {
		if (entry.totalAmount <= 0) continue;
		neededMineralsMap[entry.mineral] =
			(neededMineralsMap[entry.mineral] || 0) + entry.totalAmount;
	}

	const neededMinerals = new Set(Object.keys(neededMineralsMap) as ResourceConstant[]);
	const assignedLabs = new Set<string>();

	for (const labId in boostLabs) {
		const entry = boostLabs[labId];
		if (!entry) continue;

		if (forbidden.has(labId)) {
			if (entry.mode === 'task') delete boostLabs[labId];
			continue;
		}

		const mineral = entry.mineral;
		if (!mineral) {
			delete boostLabs[labId];
			continue;
		}

		if (entry.mode === 'fixed') {
			assignedLabs.add(labId);
			manageBoostLab(room, board, Game.getObjectById(labId as Id<StructureLab>), mineral, BOOST_LAB_CAPACITY);
			continue;
		}

		if (neededMinerals.has(mineral)) {
			assignedLabs.add(labId);
			manageBoostLab(room, board, Game.getObjectById(labId as Id<StructureLab>), mineral, neededMineralsMap[mineral] || 0);
			neededMinerals.delete(mineral);
			continue;
		}

		delete boostLabs[labId];
	}

	const availableLabs = labs.filter((lab) => !forbidden.has(lab.id));
	for (const mineral of neededMinerals) {
		const targetLab = findBestLab(availableLabs, assignedLabs, mineral);
		if (!targetLab) continue;
		boostLabs[targetLab.id] = { mineral, mode: 'task' };
		assignedLabs.add(targetLab.id);
		manageBoostLab(room, board, targetLab, mineral, neededMineralsMap[mineral] || 0);
	}
}
