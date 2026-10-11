/**
 * 运输目标配额 (docs/nexus-design/06 §6.4):
 * 搬运目的地由配额决定而非「每 Tick 选最近」——关键消费结构按类型与缺口优先,
 * 最低库存保障未满足时低优先级目标不抢占; 在途承诺 (账本预留) 计入已承诺,
 * 防止对同一目的地超发搬运; 富余能量兜底转入 Storage。
 */
import { HAUL_CONFIG } from "@/config/economy";
import { TOWER_CONFIG } from "@/config/defense";
import type { TickContext } from "@/core/tickContext";
import type { RoomObservation } from "@/core/world";
import { createLedger } from "@/modules/economy/ledger";

export interface QuotaDestination {
	id: string;
	structureType: string;
	x: number;
	y: number;
	/** 目的地优先级: 数值大者优先获得运力 */
	priority: number;
	/** 保障水位 - 当前库存 - 在途承诺 */
	headroom: number;
}

/** 目的地优先级表: 塔补给最高 (docs/nexus-design/09 §9.3 塔需能源), Spawn/Extension 保障, Storage 兜底 */
const DEST_PRIORITY: Record<string, number> = {
	tower: 4,
	spawn: 3,
	extension: 2,
	storage: 1,
};

/**
 * 目的地配额表: 低于补给触发线的塔 (高优先级) + 低于最低库存线的供能结构 + 未达水位的 Storage。
 * floorBias 来自经济模型诊断 (quotaFloorBias, 比例偏移), 上下限钳制防抖。
 */
export function destinationQuotas(ctx: TickContext, room: RoomObservation, floorBias: number): QuotaDestination[] {
	const ledger = createLedger(ctx);
	const ratio = HAUL_CONFIG.structureFloorRatio + Math.max(-0.3, Math.min(0.3, floorBias));
	const destinations: QuotaDestination[] = [];

	for (const tower of room.towers) {
		if (tower.energy >= TOWER_CONFIG.resupplyTrigger) {
			continue;
		}
		const headroom = TOWER_CONFIG.resupplyTarget - tower.energy - ledger.committedTo(room.roomName, tower.id);
		if (headroom <= 0) {
			continue;
		}
		destinations.push({
			id: tower.id,
			structureType: "tower",
			x: tower.x,
			y: tower.y,
			priority: DEST_PRIORITY.tower ?? 1,
			headroom,
		});
	}
	for (const structure of room.energyStructures) {
		const floor = structure.energyCapacity * ratio;
		const headroom = floor - structure.energy - ledger.committedTo(room.roomName, structure.id);
		if (headroom <= 0) {
			continue;
		}
		destinations.push({
			id: structure.id,
			structureType: structure.structureType,
			x: structure.x,
			y: structure.y,
			priority: DEST_PRIORITY[structure.structureType] ?? 1,
			headroom,
		});
	}
	for (const store of room.stores) {
		if (store.structureType !== "storage") {
			continue;
		}
		const headroom = HAUL_CONFIG.storageFloorAmount - store.energy - ledger.committedTo(room.roomName, store.id);
		if (headroom <= 0) {
			continue;
		}
		destinations.push({
			id: store.id,
			structureType: store.structureType,
			x: store.x,
			y: store.y,
			priority: DEST_PRIORITY.storage ?? 1,
			headroom,
		});
	}
	return destinations;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 目的地最少承接量: 低于该值不值得为一趟运输建任务 */
const HAUL_MIN_DEST_AMOUNT = HAUL_CONFIG.minHaulAmount;

/**
 * 为货源选目的地: 只考虑余量足够承接一批的目的地;
 * 同优先级按距离近者优先, 关键结构在运力紧张时天然压过兜底 Storage。
 */
export function pickDestination(
	destinations: QuotaDestination[],
	fromX: number,
	fromY: number,
): QuotaDestination | undefined {
	let best: QuotaDestination | undefined;
	let bestScore = -Infinity;
	for (const destination of destinations) {
		if (destination.headroom < HAUL_MIN_DEST_AMOUNT) {
			continue;
		}
		const score = destination.priority * 1000 - chebyshev(fromX, fromY, destination.x, destination.y);
		if (score > bestScore) {
			best = destination;
			bestScore = score;
		}
	}
	return best;
}

/** 预计往返耗时: 批次数 × (往返距离 + 装卸余量), 单格移动按 1.5 tick 估算 */
export function roundTripEstimate(amount: number, distance: number): number {
	const trips = Math.max(1, Math.ceil(amount / HAUL_CONFIG.batchSize));
	return Math.ceil(trips * (distance * 2 * 1.5 + 20));
}
