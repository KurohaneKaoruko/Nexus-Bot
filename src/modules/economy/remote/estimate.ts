/**
 * 外矿净收益估算纯函数 (docs/nexus-design/13 §24.7.2 推导口径, phase4 4.2)。
 *
 * 全部取运行环境常量; 输入 pathLength (格) 与母房 energyCapacityAvailable,
 * 输出 net (能量/tick) 与 spawn 占用 s (部件·tick 折算)。
 * 纯函数: 不触游戏 API 运行时对象 (常量经兜底表读取, node 直跑可测)。
 */
import { REMOTE_CONFIG } from "@/config/remote";

/** 部件成本表 (引擎常量兜底, 官方值) */
const PART_COST = { work: 100, carry: 50, move: 50, claim: 600 } as const;
/** 引擎常量兜底 (桩环境可能缺全局声明) */
const HARVEST_POWER_V = typeof HARVEST_POWER === "number" ? HARVEST_POWER : 2;
const CARRY_CAPACITY_V = typeof CARRY_CAPACITY === "number" ? CARRY_CAPACITY : 50;
const CREEP_LIFE_TIME_V = typeof CREEP_LIFE_TIME === "number" ? CREEP_LIFE_TIME : 1500;
const CREEP_CLAIM_LIFE_TIME_V =
	typeof CREEP_CLAIM_LIFE_TIME === "number" ? CREEP_CLAIM_LIFE_TIME : 600;
const CREEP_SPAWN_TIME_V = typeof CREEP_SPAWN_TIME === "number" ? CREEP_SPAWN_TIME : 3;
const MAX_CREEP_SIZE_V = typeof MAX_CREEP_SIZE === "number" ? MAX_CREEP_SIZE : 50;
/** 源产能: 预定 3000/300=10/t, 未预定 1500/300=5/t (官方常量折算) */
const SOURCE_RATE_RESERVED = 10;
const SOURCE_RATE_NEUTRAL = 5;
/** 容器维护成本/tick: CONTAINER_DECAY/CONTAINER_DECAY_TIME × REPAIR_COST (官方值 0.5) */
const CONTAINER_UPKEEP_PER_TICK = 0.5;
/** 预定体部件: 2×[CLAIM, MOVE] (预定净增长需 2 CLAIM) */
const RESERVER_PARTS = 4;

export interface RemoteEstimateInput {
	/** 母房交付点 → 源工位路径长 (格) */
	pathLength: number;
	/** 母房 energyCapacityAvailable */
	energyCapacity: number;
	/** 是否满足预定条件 (源产能按 10/t 计) */
	reserved: boolean;
	/** 源数 (默认 1; 净收益按源数线性放大) */
	sourceCount?: number;
}

/** 净收益估算输出 */
export interface RemoteEstimateOutput {
	/** 净收入 (能量/tick, 已扣单位成本/容器维护/路途损耗) */
	net: number;
	/** spawn 占用 (部件数 × CREEP_SPAWN_TIME / 寿命, 折算/tick) */
	s: number;
}

/**
 * 单源净收益估算 (§24.7.2 表格逐行):
 * - 采集体 w = ceil(r / HARVEST_POWER) WORK + 1 CARRY + 1:1 MOVE, 按 E 裁剪
 * - 搬运容量 C = ceil(r_eff × (2d + 装卸余量) / CARRY_CAPACITY)
 * - 搬运体按无路 1:1 在 E 内取最大只数
 * - 预定体: E ≥ 2×(claim+move) 时一房一只 (2 CLAIM 才能让预定净增长)
 * - net = r_eff − 单位成本/tick − 容器维护 − 路途损耗
 * - s = Σ 部件数 × CREEP_SPAWN_TIME / 寿命
 */
export function estimateRemoteNet(input: RemoteEstimateInput): RemoteEstimateOutput {
	const d = Math.max(1, input.pathLength);
	const E = input.energyCapacity;
	const sources = Math.max(1, input.sourceCount ?? 1);
	// 有效预定 = 预定意愿 ∧ E 可负担 2×[CLAIM,MOVE]: 装不下时房间实际不会
	// 被预定, 源产能按未预定 5/t 折算 (而非按 10/t 空想)
	const reserverCost = 2 * (PART_COST.claim + PART_COST.move);
	const effectiveReserved = input.reserved && E >= reserverCost;
	const r = effectiveReserved ? SOURCE_RATE_RESERVED : SOURCE_RATE_NEUTRAL;

	// 采集体: WORK 封顶单源速率, 1 CARRY 收尾, MOVE 1:1 (无路口径)
	const workNeed = Math.ceil(r / HARVEST_POWER_V);
	// 按 E 裁剪: 预算不足时 WORK 递减 (至少 1)
	let harvesterWork = workNeed;
	while (harvesterWork > 1 && harvesterWork * PART_COST.work + PART_COST.carry + harvesterWork * PART_COST.move > E) {
		harvesterWork -= 1;
	}
	const harvesterActualCost =
		harvesterWork * PART_COST.work + PART_COST.carry + harvesterWork * PART_COST.move;
	if (harvesterActualCost > E) {
		// E 连最小采集体都装不下: 净收益无效
		return { net: 0, s: 0 };
	}
	const rEff = Math.min(r, harvesterWork * HARVEST_POWER_V);

	// 搬运: 总容量需求 = r_eff × (2d + 装卸余量); 每只 [C,M]×n 1:1 在 E 内取最大,
	// 部件数受 MAX_CREEP_SIZE 封顶 (25 对 = 50 部件)
	const carryNeed = Math.ceil((rEff * (2 * d + REMOTE_CONFIG.loadMargin)) / CARRY_CAPACITY_V);
	const perHaulerPairs = Math.min(
		Math.floor((MAX_CREEP_SIZE_V / 2) as number),
		Math.max(1, Math.floor(E / (PART_COST.carry + PART_COST.move))),
	);
	const haulerBodyCarry = Math.min(perHaulerPairs, carryNeed);
	const haulerCount = Math.max(1, Math.ceil(carryNeed / Math.max(1, haulerBodyCarry)));
	const haulerCostEach = haulerBodyCarry * (PART_COST.carry + PART_COST.move);
	const haulerPartsEach = haulerBodyCarry * 2;

	// 预定体: 2×[CLAIM,MOVE] (2 CLAIM 预定才净增长); 有效预定判定已含 E 门槛
	const reserverCount = effectiveReserved ? 1 : 0;

	// 单位成本/tick (预定体寿命 600, 其余 1500)
	const unitCostPerTick =
		(harvesterActualCost + haulerCostEach * haulerCount) / CREEP_LIFE_TIME_V +
		reserverCount * (reserverCost / CREEP_CLAIM_LIFE_TIME_V);
	// 路途损耗: 采集+搬运体在路上的时间折算 (r_eff × d / 寿命)
	const transitLoss = (rEff * d) / CREEP_LIFE_TIME_V;
	// 容器维护
	const containerUpkeep = CONTAINER_UPKEEP_PER_TICK;

	const perSourceNet = rEff - unitCostPerTick - containerUpkeep - transitLoss;
	const net = perSourceNet * sources;
	// spawn 占用: Σ 部件数 × 孵化时长 / 寿命 (预定体走 600 寿命)
	const harvesterParts = harvesterWork * 2 + 1;
	const s =
		((harvesterParts + haulerPartsEach * haulerCount) * CREEP_SPAWN_TIME_V) / CREEP_LIFE_TIME_V +
		(reserverCount * RESERVER_PARTS * CREEP_SPAWN_TIME_V) / CREEP_CLAIM_LIFE_TIME_V;

	return { net, s };
}
