/**
 * 资源账本 (docs/nexus-design/06 §6.1/§6.6):
 * 库存直接聚合自感知快照; 可用库存 = 库存 - Σ有效预留;
 * 预留是对未来计划的会计记录 (reserve/commit/release + 过期清理);
 * 生产/交付速率为滚动估计: 每 Tick O(1) 累加, 每窗口折叠 EMA, 恒定 O(房间×资源种)。
 */
import { LEDGER_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core/tickContext";
import type { ReservationRecord, RoomRates, RateState } from "@/store/memorySchema";

/** 账本聚合的能源种类 (Phase 2 仅能源; 预留接口保留 resourceType) */
export type LedgerResource = "energy";

export interface ReserveInput {
	owner: string;
	roomName: string;
	resourceType?: LedgerResource;
	amount: number;
	/** 目的地结构 ID (配额在途承诺用) */
	destId?: string;
	/** 过期 tick, 缺省按配置 TTL */
	expiresAt?: number;
}

export interface LedgerView {
	/** 可见库存 (结构存量 + Creep 携带) */
	stock(roomName: string): number;
	/** 可用库存 = 库存 - Σ有效预留, 不足时为 0 */
	available(roomName: string): number;
	/** 目的地在途承诺量 (按预留的 destId 汇总) */
	committedTo(roomName: string, destId: string): number;
	/** 所有者当前的有效预留 ID (无则 undefined) */
	reservationIdOf(owner: string): string | undefined;
	/** 房间速率 */
	rates(roomName: string): RoomRates;
}

function emptyRate(): RateState {
	return { accumulated: 0, ema: 0, lastFoldTick: 0 };
}

function ratesOf(ctx: TickContext, roomName: string): RoomRates {
	const rates = ctx.memory.ledger.rates;
	if (!rates[roomName]) {
		rates[roomName] = { produced: emptyRate(), delivered: emptyRate() };
	}
	return rates[roomName];
}

/** 可见库存: 供能结构 + 各类储存结构 + 落地能量 + Creep 携带 (来自快照, 不额外 find) */
export function stockOf(ctx: TickContext, roomName: string): number {
	const room = ctx.world.current?.rooms[roomName];
	if (!room) {
		return 0;
	}
	let total = 0;
	for (const structure of room.energyStructures) {
		total += structure.energy;
	}
	for (const store of room.stores) {
		total += store.energy;
	}
	for (const pile of room.piles) {
		total += pile.amount;
	}
	for (const creep of room.creeps) {
		total += creep.carryEnergy;
	}
	return total;
}

function activeReservations(ctx: TickContext, now: number): ReservationRecord[] {
	const active: ReservationRecord[] = [];
	for (const reservation of Object.values(ctx.memory.ledger.reservations)) {
		if (reservation.expiresAt > now) {
			active.push(reservation);
		}
	}
	return active;
}

export function createLedger(ctx: TickContext): LedgerView {
	return {
		stock: (roomName) => stockOf(ctx, roomName),

		available(roomName: string): number {
			const stock = stockOf(ctx, roomName);
			let committed = 0;
			for (const reservation of activeReservations(ctx, ctx.tick)) {
				if (reservation.roomName === roomName) {
					committed += reservation.amount;
				}
			}
			return Math.max(0, stock - committed);
		},

		committedTo(roomName: string, destId: string): number {
			let committed = 0;
			for (const reservation of activeReservations(ctx, ctx.tick)) {
				if (reservation.roomName === roomName && reservation.destId === destId) {
					committed += reservation.amount;
				}
			}
			return committed;
		},

		reservationIdOf(owner: string): string | undefined {
			for (const [id, reservation] of Object.entries(ctx.memory.ledger.reservations)) {
				if (reservation.owner === owner && reservation.expiresAt > ctx.tick) {
					return id;
				}
			}
			return undefined;
		},

		rates: (roomName) => ratesOf(ctx, roomName),
	};
}

/**
 * 创建预留: 可用库存不足时拒绝 (不超发), 成功返回预留 ID, 失败返回 null。
 */
export function reserve(ctx: TickContext, input: ReserveInput): string | null {
	const ledger = createLedger(ctx);
	const resource = input.resourceType ?? "energy";
	if (resource !== "energy") {
		return null;
	}
	if (input.amount <= 0 || ledger.available(input.roomName) < input.amount) {
		return null;
	}
	const id = `r${ctx.tick.toString(36)}${Math.floor(Math.random() * 0xffff)
		.toString(16)
		.padStart(4, "0")}`;
	ctx.memory.ledger.reservations[id] = {
		id,
		owner: input.owner,
		roomName: input.roomName,
		resourceType: resource,
		amount: input.amount,
		expiresAt: input.expiresAt ?? ctx.tick + LEDGER_CONFIG.reservationTtl,
		...(input.destId !== undefined ? { destId: input.destId } : {}),
	};
	return id;
}

/** 按实际用量提交预留; 少用部分随记录删除自动回到可用库存 */
export function commit(ctx: TickContext, reservationId: string, _actualUse: number): boolean {
	const reservation = ctx.memory.ledger.reservations[reservationId];
	if (!reservation) {
		return false;
	}
	delete ctx.memory.ledger.reservations[reservationId];
	return true;
}

/** 按原因释放预留 (计划取消/主体消失), 数量回到可用库存 */
export function release(ctx: TickContext, reservationId: string, _reason: string): boolean {
	const reservation = ctx.memory.ledger.reservations[reservationId];
	if (!reservation) {
		return false;
	}
	delete ctx.memory.ledger.reservations[reservationId];
	return true;
}

/**
 * 对账维护: 过期预留清理 + 主体 (任务) 消失的预留释放。
 * 在 reconcile 阶段调用一次; 返回清理数量。
 */
export function maintainLedger(ctx: TickContext, ownerExists: (owner: string) => boolean): number {
	const now = ctx.tick;
	let cleaned = 0;
	for (const [id, reservation] of Object.entries(ctx.memory.ledger.reservations)) {
		if (reservation.expiresAt <= now || !ownerExists(reservation.owner)) {
			delete ctx.memory.ledger.reservations[id];
			cleaned += 1;
		}
	}
	ctx.memory.ledger.expiredCount += cleaned;
	return cleaned;
}

/** 采集产出入账 (每 Tick 由模型累加器按快照差分调用) */
export function recordProduction(ctx: TickContext, roomName: string, amount: number): void {
	if (amount > 0) {
		ratesOf(ctx, roomName).produced.accumulated += amount;
	}
}

/** 物流交付入账 (同上) */
export function recordDelivery(ctx: TickContext, roomName: string, amount: number): void {
	if (amount > 0) {
		ratesOf(ctx, roomName).delivered.accumulated += amount;
	}
}

/**
 * 窗口折叠: 每 rateWindowTicks 把累加量按平滑系数折入 EMA。
 * 由经济模型在诊断窗口调用; 返回本房间是否有折叠发生。
 */
export function foldRates(ctx: TickContext, roomName: string): boolean {
	const rates = ratesOf(ctx, roomName);
	const period = LEDGER_CONFIG.rateWindowTicks;
	if (ctx.tick - rates.produced.lastFoldTick < period) {
		return false;
	}
	const smooth = LEDGER_CONFIG.rateSmoothing;
	fold(rates.produced, smooth, ctx.tick);
	fold(rates.delivered, smooth, ctx.tick);
	return true;
}

function fold(state: RateState, smooth: number, now: number): void {
	const windowAvg = state.accumulated / LEDGER_CONFIG.rateWindowTicks;
	state.ema = state.ema * (1 - smooth) + windowAvg * smooth;
	state.accumulated = 0;
	state.lastFoldTick = now;
}
