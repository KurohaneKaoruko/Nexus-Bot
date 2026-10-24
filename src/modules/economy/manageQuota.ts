/**
 * storage↔terminal 资源平衡供给 (specs/mission-pool-retirement manage 行):
 * UpdateManageMission 的 terminal 缓冲语义迁任务板——
 * - 发送簿记 (sendLedger) 在途请求优先: terminal 补至请求量 (上限 energySendCap/resourceSendCap);
 * - 无请求时按目标水位补 terminal 低于阈值的资源, 溢出线以上转回 storage;
 * - `{room}_terminal_clear` 旗标 = terminal 清空语义 (转出阈值归零、停止补入)。
 * 阈值同源 MANAGE_BALANCE; 分类键 lab/bar/goods 对应 LabMap/BarList/Goods 词表。
 * 纯函数核心 + 原生房读取包装; terminal_transfer 不在 planner 主题清扫口径内,
 * 由本模块对自有键前缀自取消。
 */
import { TERMINAL_BALANCE_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { reserve } from "@/modules/economy/ledger";
import { sendTotalByResource } from "@/modules/economy/sendLedger";
import { LabMap, BarList, Goods } from "@/constant/ResourceConstant";

/** terminal 平衡规划输入 (纯数据) */
export interface TerminalBalanceView {
	roomName: string;
	storageId: string;
	terminalId: string;
	/** storage/terminal 各资源存量 (键为资源类型) */
	storageStore: Record<string, number>;
	terminalStore: Record<string, number>;
	/** storage 通用剩余容量 */
	storageFree: number;
	/** 发送簿记在途请求汇总 (键为资源类型) */
	sendTotals: Record<string, number>;
	/** `{room}_terminal_clear` 旗标 */
	clearFlag: boolean;
}

/** 平衡计划: 每资源至多一条 (fill: storage→terminal / drain: terminal→storage) */
export interface TerminalTransferPlan {
	dedupeKey: string;
	resourceType: ResourceConstant;
	direction: "fill" | "drain";
	amount: number;
	sourceId: string;
	destId: string;
}

/** 资源分类阈值档 (原 createTerminalThresholds 口径) */
const thresholdTierOf = (
	resourceType: string,
): "energy" | "power" | "lab" | "bar" | "goods" | "default" => {
	if (resourceType === RESOURCE_ENERGY) return "energy";
	if (resourceType === RESOURCE_POWER) return "power";
	if (resourceType in LabMap) return "lab";
	if ((BarList as readonly string[]).includes(resourceType)) return "bar";
	if ((Goods as readonly string[]).includes(resourceType)) return "goods";
	return "default";
};

const targetOf = (resourceType: string): number =>
	TERMINAL_BALANCE_CONFIG.target[thresholdTierOf(resourceType)];

const sourceCeilingOf = (resourceType: string): number =>
	TERMINAL_BALANCE_CONFIG.source[thresholdTierOf(resourceType)];

/** terminal 平衡规划 (纯函数): 返回当 tick 应存续的平衡计划集 */
export function planTerminalTransfers(view: TerminalBalanceView): TerminalTransferPlan[] {
	const plans: TerminalTransferPlan[] = [];
	const totalRequested = Object.values(view.sendTotals).reduce((sum, n) => sum + n, 0);

	// terminal 自动转入: 发送请求优先, 其余按目标水位
	for (const resourceType of Object.keys(view.storageStore)) {
		let amount = 0;
		if (resourceType === RESOURCE_ENERGY && totalRequested > 0) {
			amount = Math.min(
				view.storageStore[resourceType] ?? 0,
				totalRequested - (view.terminalStore[resourceType] ?? 0),
				TERMINAL_BALANCE_CONFIG.energySendCap - (view.terminalStore[resourceType] ?? 0),
			);
		} else if (view.sendTotals[resourceType]) {
			amount = Math.min(
				view.storageStore[resourceType] ?? 0,
				view.sendTotals[resourceType]! - (view.terminalStore[resourceType] ?? 0),
				TERMINAL_BALANCE_CONFIG.resourceSendCap - (view.terminalStore[resourceType] ?? 0),
			);
		} else {
			if (view.clearFlag) break;
			const threshold = targetOf(resourceType);
			if ((view.terminalStore[resourceType] ?? 0) >= threshold) continue;
			amount = Math.min(
				view.storageStore[resourceType] ?? 0,
				threshold - (view.terminalStore[resourceType] ?? 0),
			);
		}
		if (amount <= 0) continue;
		plans.push({
			dedupeKey: `terminal_transfer:${view.roomName}:${resourceType}`,
			resourceType: resourceType as ResourceConstant,
			direction: "fill",
			amount,
			sourceId: view.storageId,
			destId: view.terminalId,
		});
	}

	// terminal 自动转出: 溢出线以上回 storage (clearFlag 时阈值归零 = 全清)
	for (const resourceType of Object.keys(view.terminalStore)) {
		if (view.sendTotals[resourceType]) continue;
		const threshold = view.clearFlag ? 0 : sourceCeilingOf(resourceType);
		const held = view.terminalStore[resourceType] ?? 0;
		if (held <= threshold) continue;
		const amount = Math.min(held - threshold, view.storageFree);
		if (amount <= 0) continue;
		plans.push({
			dedupeKey: `terminal_transfer:${view.roomName}:${resourceType}`,
			resourceType: resourceType as ResourceConstant,
			direction: "drain",
			amount,
			sourceId: view.terminalId,
			destId: view.storageId,
		});
	}

	return plans;
}

/**
 * 原生房读取 + 任务板 upsert 包装 (planners 接入):
 * terminal/多资源存量不在感知快照内, 提交阶段读原生房;
 * 自有键前缀 (`terminal_transfer:{room}:`) 条件消失即取消 (不在 PLANNED_KINDS 清扫口径内)。
 */
export function upsertTerminalTransferTasks(
	ctx: TickContext,
	board: TaskBoard,
	room: RoomObservation,
	priority: number,
): void {
	const nativeRoom = Game.rooms[room.roomName];
	const terminal = nativeRoom?.terminal;
	const storage = nativeRoom?.storage;
	if (!nativeRoom || !terminal || !storage) return;
	// 布局门 (原 checkTerminalResourceBalance): storage/terminal 相邻才产平衡单
	if (!storage.pos.inRangeTo(terminal.pos, 2)) return;

	const nativeStore = (store: StoreDefinition | undefined): Record<string, number> => {
		const flat: Record<string, number> = {};
		if (!store) return flat;
		for (const resourceType of Object.keys(store)) {
			const amount = store[resourceType as ResourceConstant];
			if (typeof amount === "number" && amount > 0) flat[resourceType] = amount;
		}
		return flat;
	};

	const plans = planTerminalTransfers({
		roomName: room.roomName,
		storageId: storage.id,
		terminalId: terminal.id,
		storageStore: nativeStore(storage.store),
		terminalStore: nativeStore(terminal.store),
		storageFree: storage.store.getFreeCapacity(),
		sendTotals: sendTotalByResource(nativeRoom, Memory),
		clearFlag: Boolean(Game.flags[`${room.roomName}_terminal_clear`]),
	});

	const expected = new Set(plans.map((plan) => plan.dedupeKey));
	for (const task of board.list({ roomName: room.roomName, kinds: ["terminal_transfer"] })) {
		if (
			!expected.has(task.dedupeKey) &&
			task.status !== "completed" &&
			task.status !== "cancelled"
		) {
			board.cancel(task.id, ctx.tick, "subject-gone");
		}
	}
	for (const plan of plans) {
		const source = plan.direction === "fill" ? storage : terminal;
		const dest = plan.direction === "fill" ? terminal : storage;
		const task = board.upsert(
			{
				dedupeKey: plan.dedupeKey,
				kind: "terminal_transfer",
				roomName: room.roomName,
				targetId: plan.sourceId,
				targetPos: { x: source.pos.x, y: source.pos.y, roomName: room.roomName },
				destId: plan.destId,
				destPos: { x: dest.pos.x, y: dest.pos.y, roomName: room.roomName },
				resourceType: plan.resourceType,
				amount: plan.amount,
				priority,
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + 200,
			},
			ctx.tick,
		);
		if (task.createdAt === ctx.tick && plan.resourceType === RESOURCE_ENERGY) {
			reserve(ctx, {
				owner: task.id,
				roomName: room.roomName,
				amount: plan.amount,
				destId: plan.destId,
				...(task.deadline !== undefined ? { expiresAt: task.deadline } : {}),
			});
		}
	}
}
