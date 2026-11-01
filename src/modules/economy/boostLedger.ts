/**
 * Boost 预订簿记 (原 boost 池的收编载体):
 * 生产面 AssignBoostTask/SubmitBoostTask (Room 原型) → 本簿记;
 * 消费面 UpdateBoostMission 的 lab 管理 (迁 industry planning) 与
 * boostFunction 的已订量查询。语义与池实现逐条对齐:
 * - 同 mineral 单条 { mineral, totalAmount, owners }
 * - owners 记录 { amount, time }, 超时 (BOOST_OWNER_TIMEOUT) 由巡检清理
 * - totalAmount 只经 SubmitBoostTask (完成量) 或无效 owner 清理扣减
 */
import { getTeamData } from '@/core/store/accessor';
import type { BoostLedgerEntry } from '@/core/store/memorySchema';

/** 预订者记录 (原 BoostTask.owners 条目) */
export interface BoostOwnerInfo {
	amount: number;
	time: number;
}

/** 簿记条目 = schema 定义 (Memory.Nexus.economy.boosts 元素类型) */
export type BoostLedgerEntryView = BoostLedgerEntry;

/** owner 超时 (原 BOOST_OWNER_TIMEOUT) */
export const BOOST_OWNER_TIMEOUT = 3000;

const boostsOf = (): BoostLedgerEntry[] => {
	const economy = Memory.Nexus?.economy;
	if (!economy) return [];
	return (economy.boosts ??= []);
};

const findEntry = (mineral: ResourceConstant): BoostLedgerEntry | undefined =>
	boostsOf().find((e) => e.mineral === mineral);

/** 预订 boost 资源 (原 AssignBoostTask): 房间存量不足返回 false */
export function assignBoost(
	room: Room,
	mineral: ResourceConstant,
	amount: number,
	ownerId?: string,
): boolean {
	const resolvedOwnerId = ownerId || '__public__';
	const stores: Array<StructureStorage | StructureTerminal | StructureLab | undefined> = [
		room.storage,
		room.terminal,
		...(room.lab ?? []),
	];
	const totalResource = stores.reduce((sum, s) => sum + ((s?.store[mineral] as number) || 0), 0);
	if (totalResource < amount) return false;

	const entries = boostsOf();
	let entry = findEntry(mineral);
	if (!entry) {
		entry = { mineral, totalAmount: 0, owners: {} };
		entries.push(entry);
	}
	entry.totalAmount += amount;
	if (!entry.owners[resolvedOwnerId]) {
		entry.owners[resolvedOwnerId] = { amount: 0, time: Game.time };
	}
	entry.owners[resolvedOwnerId].amount += amount;
	entry.owners[resolvedOwnerId].time = Game.time;
	return true;
}

/** 按体型批量预订 (原 AssignBoostTaskByBody 的下订循环部分, 存量检查由调用方完成) */
export function assignBoostAmount(
	mineral: ResourceConstant,
	amount: number,
	ownerId?: string,
): void {
	const resolvedOwnerId = ownerId || '__public__';
	const entries = boostsOf();
	let entry = findEntry(mineral);
	if (!entry) {
		entry = { mineral, totalAmount: 0, owners: {} };
		entries.push(entry);
	}
	entry.totalAmount += amount;
	if (!entry.owners[resolvedOwnerId]) {
		entry.owners[resolvedOwnerId] = { amount: 0, time: Game.time };
	}
	entry.owners[resolvedOwnerId].amount += amount;
	entry.owners[resolvedOwnerId].time = Game.time;
}

/** 提交完成量 (原 SubmitBoostTask): 扣 owner 与 totalAmount, 归零条目删除 */
export function submitBoost(
	mineral: ResourceConstant,
	amount: number,
	ownerId?: string,
): number {
	if (!amount || amount <= 0) return ERR_INVALID_ARGS;
	const entry = findEntry(mineral);
	if (!entry) return ERR_NOT_FOUND;

	if (ownerId) {
		const info = entry.owners[ownerId];
		if (info) {
			info.amount -= amount;
			if (info.amount <= 0) delete entry.owners[ownerId];
			entry.totalAmount -= amount;
		} else if (entry.owners['__public__']) {
			entry.owners['__public__'].amount -= amount;
			if (entry.owners['__public__'].amount <= 0) {
				delete entry.owners['__public__'];
			}
			entry.totalAmount -= amount;
		} else if (Object.keys(entry.owners).length === 0) {
			entry.totalAmount -= amount;
		} else {
			// 未注册消耗不影响任务总数 (Team 抢占保护)
			return ERR_INVALID_TARGET;
		}
	} else {
		return ERR_INVALID_ARGS;
	}

	if (entry.totalAmount < 0) entry.totalAmount = 0;
	if (entry.totalAmount <= 0) {
		const idx = boostsOf().indexOf(entry);
		if (idx >= 0) boostsOf().splice(idx, 1);
	}
	return OK;
}

/** owner 有效性 (原 isBoostOwnerValid: Team 存活 / creep 存活 / 公共档不过期) */
const isOwnerValid = (ownerId: string, info: BoostOwnerInfo): boolean => {
	if (ownerId === '__public__') return true;
	if (Game.time - info.time > BOOST_OWNER_TIMEOUT) return false;
	if (ownerId.startsWith('Team-')) {
		const teamId = ownerId.slice(5);
		const teamData = getTeamData(teamId);
		return Boolean(teamData);
	}
	return Boolean(Game.creeps[ownerId]);
};

/** 巡检 (原 cleanInvalidBoostTasks): 无 owner 条目转公共档; 超时/失效 owner 清理 */
export function pruneBoostEntries(): void {
	const entries = boostsOf();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		if (entry.totalAmount <= 0) {
			entries.splice(i, 1);
			continue;
		}
		if (!entry.owners || Object.keys(entry.owners).length === 0) {
			entry.owners = { ['__public__']: { amount: entry.totalAmount, time: Game.time } };
		}
		for (const ownerId in entry.owners) {
			const info = entry.owners[ownerId]!;
			if (!isOwnerValid(ownerId, info)) {
				entry.totalAmount -= info.amount;
				delete entry.owners[ownerId];
			}
		}
		if (entry.totalAmount <= 0) {
			entries.splice(i, 1);
		}
	}
}

/** 指定 owner 的已订量 (原 boostFunction 236 读池面): 簿记替代池查询 */
export function reservedAmountOf(mineral: ResourceConstant, ownerId: string): number {
	const info = findEntry(mineral)?.owners[ownerId];
	return typeof info?.amount === 'number' && info.amount > 0 ? info.amount : 0;
}

/** 活跃预订条目 (原 UpdateBoostMission 读 activeTasks 面) */
export function activeBoostEntries(): BoostLedgerEntry[] {
	return boostsOf().filter((e) => e.totalAmount > 0);
}

/** 删除条目 (原 RemoveBoostTask): 条目不存在返回 false */
export function removeBoostEntry(mineral: ResourceConstant): boolean {
	const entries = boostsOf();
	const idx = entries.findIndex((e) => e.mineral === mineral);
	if (idx < 0) return false;
	entries.splice(idx, 1);
	return true;
}
