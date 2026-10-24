/**
 * 终端发送簿记 (原 terminal 池 send 型任务的收编载体):
 * 人操 console `send` 命令 → 本簿记 upsert; terminalControl 每 30t 消费一批;
 * manageMission 的终端转入阈值读 totalAmount。语义与池实现逐条对齐。
 */
import { THRESHOLDS } from '@/constant/Thresholds';
import { Goods, RESOURCE_ABBREVIATIONS } from '@/constant/ResourceConstant';
import type { TickContext } from '@/core/tickContext';
import type { SendLedgerEntry as SendLedgerEntrySchema } from '@/core/store/memorySchema';

/** 簿记条目 = schema 定义 (Memory.Nexus.economy.sends 元素类型) */
export type SendLedgerEntry = SendLedgerEntrySchema;

const normalizeResourceType = (resourceType: string | ResourceConstant): ResourceConstant =>
	(RESOURCE_ABBREVIATIONS[resourceType as string] || resourceType) as ResourceConstant;

const sendsOf = (memory: Memory): SendLedgerEntry[] => {
	const economy = memory.Nexus?.economy;
	if (!economy) return [];
	return (economy.sends ??= []);
};

/** 发送最小批量 (原 getSendMinBatch): 攒够再发, terminal 冷却期不做碎片发送 */
const sendMinBatch = (resourceType: ResourceConstant): number => {
	if (resourceType === RESOURCE_ENERGY) return THRESHOLDS.ENERGY.SEND_BATCH_ENERGY;
	return (Goods as readonly string[]).includes(resourceType) ? 10 : THRESHOLDS.ENERGY.SEND_BATCH_MINERAL;
};

/** 房间可发送量 (原 getRoomSendAmount): storage + terminal 合计 */
const roomSendAmount = (room: Room, resourceType: ResourceConstant): number =>
	(room.storage?.store[resourceType] || 0) + (room.terminal?.store[resourceType] || 0);

/** 簿记可用性巡检 (原 getSendMissionTotalAmount 内联清理): 房间资源不足即删条目 */
const pruneByRoomStock = (room: Room, entries: SendLedgerEntry[]): SendLedgerEntry[] => {
	const keep: SendLedgerEntry[] = [];
	for (const entry of entries) {
		const required = Math.min(entry.amount, THRESHOLDS.ENERGY.SEND_REQUEST_MIN);
		if (roomSendAmount(room, entry.resourceType) >= required) {
			keep.push(entry);
		}
	}
	return keep;
};

/** console `send` 人操面: upsert 簿记 (原 SendMissionAdd, 同键覆盖 amount) */
export function upsertSendEntry(
	memory: Memory,
	targetRoom: string,
	resourceType: string | ResourceConstant,
	amount: number,
): void {
	const normalized = normalizeResourceType(resourceType);
	const entries = sendsOf(memory);
	const existing = entries.find((e) => e.targetRoom === targetRoom && e.resourceType === normalized);
	if (existing) {
		existing.amount = amount;
		return;
	}
	entries.push({ targetRoom, resourceType: normalized, amount });
}

/** 只增不减 upsert (原 SendMissionUpsertMax 语义, 自动链防反复调度不收敛) */
export function upsertSendEntryMax(
	memory: Memory,
	targetRoom: string,
	resourceType: string | ResourceConstant,
	amount: number,
	maxAmount?: number,
): boolean {
	if (!amount || typeof amount !== 'number' || amount <= 0) return false;
	const normalized = normalizeResourceType(resourceType);
	const entries = sendsOf(memory);
	const existing = entries.find((e) => e.targetRoom === targetRoom && e.resourceType === normalized);
	if (existing) {
		existing.amount = Math.max(existing.amount, Math.min(amount, maxAmount ?? amount));
		return true;
	}
	entries.push({ targetRoom, resourceType: normalized, amount: Math.min(amount, maxAmount ?? amount) });
	return true;
}

/** 可派发判定 (原 canDispatchSendTask): terminal 实存 ≥ min(amount, 最小批量) */
export function dispatchableSendEntry(room: Room, entry: SendLedgerEntry): boolean {
	if (!room.terminal) return false;
	const minBatch = Math.min(entry.amount, sendMinBatch(entry.resourceType));
	return (room.terminal.store[entry.resourceType] || 0) >= minBatch;
}

/** 取第一条可派发条目 (原 getSendMission 语义) */
export function firstDispatchableSend(room: Room, memory: Memory): SendLedgerEntry | null {
	for (const entry of pruneByRoomStock(room, sendsOf(memory))) {
		if (dispatchableSendEntry(room, entry)) return entry;
	}
	return null;
}

/** 条目消减/完成清理 (原 terminalControl 更新/删除池单) */
export function settleSendEntry(memory: Memory, entry: SendLedgerEntry, sentAmount: number): void {
	const entries = sendsOf(memory);
	const idx = entries.indexOf(entry);
	if (idx < 0) return;
	const remaining = entry.amount - sentAmount;
	if (remaining > 0) {
		entries[idx] = { ...entry, amount: remaining };
	} else {
		entries.splice(idx, 1);
	}
}

/** 删除条目 (原 ERR_INVALID_ARGS 失败清理) */
export function removeSendEntry(memory: Memory, entry: SendLedgerEntry): void {
	const entries = sendsOf(memory);
	const idx = entries.indexOf(entry);
	if (idx >= 0) entries.splice(idx, 1);
}

/** 按资源类型汇总待发总量 (原 getSendMissionTotalAmount, manageMission 终端转入阈值输入) */
export function sendTotalByResource(room: Room, memory: Memory): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const entry of pruneByRoomStock(room, sendsOf(memory))) {
		totals[entry.resourceType] = entry.amount + (totals[entry.resourceType] || 0);
	}
	return totals;
}

/** 供 planning 阶段直取 (ctx.memory 即 Memory.Nexus) */
export function sendLedgerOf(ctx: TickContext): SendLedgerEntry[] {
	return sendsOf(ctx.memory as unknown as Memory);
}
