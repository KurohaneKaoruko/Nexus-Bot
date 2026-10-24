/**
 * Boost lab 管理 (原 UpdateBoostMission 的 lab 分配/填充/清理语义,
 * 自 mission/updaters/boostMission 迁移):
 * 预订需求读 economy/boostLedger (原读 boost 池), lab 单表预留
 * (ensureBoostLabs) 与搬运发单 (transport 池) 口径不变。
 * 搬运发单将随 transport 池退役切片统一收口为任务板 carry。
 */
import { getLabAB, ensureBoostLabs } from '@/modules/industry';
import { getStructData } from '@/core/store/accessor';
import { activeBoostEntries, pruneBoostEntries } from '@/modules/economy/boostLedger';

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

/** 搬运发单 (transport 池, 口径原样): 去重后下 lab↔storage 点对点单 */
const addBoostTransport = (
	room: Room,
	task: { source: string; target: string; resourceType: ResourceConstant; amount: number },
	match: { source?: string; target?: string; resourceType: ResourceConstant },
): void => {
	room.addTransportMission(room.TransportLevel('boost'), {
		pos: 0,
		source: task.source as Id<Structure>,
		target: task.target as Id<Structure>,
		resourceType: task.resourceType,
		amount: task.amount,
	} as never);
	void match;
};

/** lab 回收 (原 cleanupBoostLab): 非目标矿清回 storage */
const cleanupBoostLab = (room: Room, lab: StructureLab): void => {
	const mineral = lab.mineralType;
	if (!mineral || lab.store[mineral] <= 0 || !room.storage) return;
	addBoostTransport(
		room,
		{ source: lab.id, target: room.storage.id, resourceType: mineral, amount: lab.store[mineral] },
		{ source: lab.id, resourceType: mineral },
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
const manageBoostLab = (room: Room, lab: StructureLab | null, mineral: ResourceConstant, amount: number): void => {
	if (!lab) return;

	if (lab.mineralType && lab.mineralType !== mineral) {
		cleanupBoostLab(room, lab);
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
					{ source: source.id, target: lab.id, resourceType: mineral, amount: needed },
					{ target: lab.id, resourceType: mineral },
				);
			}
		}
	}

	if (!room.storage || room.storage.store[RESOURCE_ENERGY] <= 0) return;
	if (lab.store[RESOURCE_ENERGY] >= BOOST_LAB_ENERGY_TARGET) return;

	addBoostTransport(
		room,
		{
			source: room.storage.id,
			target: lab.id,
			resourceType: RESOURCE_ENERGY,
			amount: BOOST_LAB_ENERGY_TARGET - lab.store[RESOURCE_ENERGY],
		},
		{ target: lab.id, resourceType: RESOURCE_ENERGY },
	);
};

/** 清空 task 征用 (原 clearAllBoostData): 无预订时只留 fixed 配置 */
const clearAllBoostData = (room: Room): void => {
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
		if (lab) cleanupBoostLab(room, lab);
	}
	for (const labId in boostLabs) {
		if (boostLabs[labId]?.mode === 'task') delete boostLabs[labId];
	}
};

/** 每拍入口 (原 UpdateBoostMission 主体): 巡检簿记 → lab 分配 → 填充 */
export function planBoostLabWork(room: Room): void {
	pruneBoostEntries();

	const labs = room.lab;
	if (!labs || labs.length === 0) return;

	const boostLabs = ensureBoostLabs(room.name);
	const forbidden = forbiddenBoostLabIds(room);
	const entries = activeBoostEntries();

	if (entries.length === 0) {
		clearAllBoostData(room);
		for (const labId in boostLabs) {
			const entry = boostLabs[labId];
			if (!entry || entry.mode !== 'fixed' || forbidden.has(labId)) continue;
			manageBoostLab(room, Game.getObjectById(labId as Id<StructureLab>), entry.mineral, BOOST_LAB_CAPACITY);
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
			manageBoostLab(room, Game.getObjectById(labId as Id<StructureLab>), mineral, BOOST_LAB_CAPACITY);
			continue;
		}

		if (neededMinerals.has(mineral)) {
			assignedLabs.add(labId);
			manageBoostLab(room, Game.getObjectById(labId as Id<StructureLab>), mineral, neededMineralsMap[mineral] || 0);
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
		manageBoostLab(room, targetLab, mineral, neededMineralsMap[mineral] || 0);
	}
}
