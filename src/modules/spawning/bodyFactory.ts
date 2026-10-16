/**
 * BodyFactory (docs/nexus-design/07 §7.3 + specs/adaptive-body-factory):
 * 预算现算体型——经济角色消费 utils/rushBodies 生成器 (成本恒 ≤ 预算, WORK 封顶, 收尾 WORK),
 * 地形档 (hints.slowTerrain) 调整 move 配比: harvester 提 speed、carrier 换 [C,M] 慢地形组;
 * defender/universal 保持段模板 (开局万能体的最低成本闭环); 快递体纯 CARRY 现算。
 * 攒能定档/应急定档语义在 spawnDirector, 本模块只按给定预算编译。
 */
import {
	buildRushHarvesterBody,
	buildRushUpgraderBody,
	buildRushWorkerBody,
} from "@/utils/rushBodies";
import { RELAY_CONFIG } from "@/config/economy";

export type EconomyRole =
	| "universal"
	| "harvester"
	| "upgrader"
	| "worker"
	| "carrier"
	| "manager"
	| "transporter"
	| "miner"
	| "rush-courier"
	| "scout";
/** 战斗角色 (Phase 3: 防守型 defender, 远程为主) */
export type CombatRole = "defender" | "claimer" | "reserver";
export type SpawnUnit = EconomyRole | CombatRole;

/** 地形编译提示 (spawnDirector 按房间地形画像填充): 慢地形 = 沼泽密度高且路网未达标 */
export interface BodyHints {
	slowTerrain: boolean;
	/** 接力期 (specs/relay-hauling): RCL < RELAY_CONFIG.maxRcl 时微型接力件口径 */
	relayCarrier?: boolean;
	/** 直运期大件上限 (RCL ≥ 等级门) */
	directCarrier?: boolean;
	/**
	 * 本房暂无搬运工在场: 采集体必须自带 CARRY。
	 *
	 * 采集体默认不带 CARRY (能量全落地面成堆, 交搬运工收走), 这是有搬运工时的更优分工——
	 * 采集体少带 CARRY 跑得更快。但开局只有一只爬 (能量只够一只) 时, 无人收堆,
	 * 能量会烂在源边、控制器永远拿不到, RCL 无法起步。
	 */
	noCarrierOnSite?: boolean;
}

interface SegmentDef {
	segment: BodyPartConstant[];
	/** 最少段数 (低于此成本不生产) */
	min: number;
	/** 最多段数 (防超长身体: 生产慢、移动慢) */
	max: number;
}

/** 路面组: 1 MOVE 拖 2 CARRY / 三件套, 以路网为前提 */
export const ROAD_SEGMENTS: Record<"universal" | "carrier" | "defender", SegmentDef> = {
	universal: { segment: ["work", "carry", "move"], min: 1, max: 4 },
	carrier: { segment: ["carry", "carry", "move"], min: 1, max: 4 },
	defender: { segment: ["ranged_attack", "move"], min: 1, max: 4 },
};

/** 慢地形搬运组: 1 CARRY 配 2 MOVE, 沼泽 2.5t/格 (1:1 配 5t/格, 路面组 10t/格) */
export const TERRAIN_CARRIER_SEGMENT: SegmentDef = { segment: ["carry", "move", "move"], min: 1, max: 4 };

/** 接力微型件 (specs/relay-hauling): 200 容量基数, 相等容量才有对穿交接 */
export const RELAY_CARRIER_SEGMENTS = {
	/** 慢地形 (路网未达标): [C,M,M]×2 口径 = 每基数 4 CARRY 2 MOVE */
	offroad: { segment: ["carry", "move", "move", "carry", "move", "move"], min: 1, max: 2 } as SegmentDef,
	/** 路面配比 (路网达标, forRoad 口径): 每基数 4 CARRY 1 MOVE */
	road: { segment: ["carry", "carry", "carry", "carry", "move"], min: 1, max: 3 } as SegmentDef,
};

const ECONOMY_ROLES: ReadonlySet<string> = new Set([
	"universal",
	"harvester",
	"upgrader",
	"worker",
	"carrier",
	"manager",
	"transporter",
	"miner",
	"rush-courier",
]);

export function isEconomyRole(unit: string): unit is EconomyRole {
	return ECONOMY_ROLES.has(unit);
}

export function isSpawnUnit(unit: string): unit is SpawnUnit {
	return ECONOMY_ROLES.has(unit) || unit === "defender" || unit === "reserver";
}

function segmentCost(segment: BodyPartConstant[]): number {
	return segment.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

export function bodyCost(body: BodyPartConstant[]): number {
	return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

/** 生产时间: 经典规则每部件 3 tick (docs/nexus-design/07 §7.5, 以当前服务器为准) */
export function spawnTimeOf(body: BodyPartConstant[]): number {
	return body.length * 3;
}

/** 段模板按预算重复 min..max 次 (低于 min 段成本返回 null) */
export function buildSegmented(def: SegmentDef, budget: number): BodyPartConstant[] | null {
	const cost = segmentCost(def.segment);
	if (budget < cost * def.min) {
		return null;
	}
	const segments = Math.min(def.max, Math.floor(budget / cost));
	const body: BodyPartConstant[] = [];
	for (let i = 0; i < segments; i += 1) {
		body.push(...def.segment);
	}
	return body;
}

/** 快递体型: 纯 CARRY 按预算堆叠 (specs/rush-courier 预算只抽盈余, 预算口径在发车闸门) */
export function buildCourierBody(budget: number): BodyPartConstant[] | null {
	const body: BodyPartConstant[] = [];
	let cost = 0;
	while (cost + BODYPART_COST[CARRY] <= budget && body.length < MAX_CREEP_SIZE) {
		body.push(CARRY);
		cost += BODYPART_COST[CARRY];
	}
	return body.length > 0 ? body : null;
}

/**
 * 预算现算体型: rush 生成器口径 (harvester 5W 封顶驻点矿工化 / upgrader WORK 密度优先
 * 递减试装 / worker 三件套整组); 慢地形 harvester speed=1 (1:1 move/work, 到位前的沼泽路段不积疲劳)。
 */
export function buildBody(
	unit: SpawnUnit,
	budget: number,
	hints?: BodyHints,
): BodyPartConstant[] | null {
	switch (unit) {
		case "harvester":
			return buildRushHarvesterBody(budget, {
				speed: hints?.slowTerrain ? 1 : 0.5,
				needCarry: hints?.noCarrierOnSite === true,
			});
		case "upgrader":
			return buildRushUpgraderBody(budget);
		case "worker":
			return buildRushWorkerBody(budget, { slowTerrain: hints?.slowTerrain === true });
		case "carrier":
			if (hints?.relayCarrier) {
				return buildSegmented(
					hints.slowTerrain
						? RELAY_CARRIER_SEGMENTS.offroad
						: RELAY_CARRIER_SEGMENTS.road,
					budget,
				);
			}
			if (hints?.directCarrier) {
				// 直运期 (达等级门): 大件摊薄往返, 段数上限放大
				return buildSegmented(
					{ ...ROAD_SEGMENTS.carrier, max: RELAY_CONFIG.directMaxSegments },
					budget,
				);
			}
			return buildSegmented(
				hints?.slowTerrain ? TERRAIN_CARRIER_SEGMENT : ROAD_SEGMENTS.carrier,
				budget,
			);
		case "rush-courier":
			return buildCourierBody(budget);
		case "scout":
			// 侦查件: 单 MOVE 最低成本, 到达即获视野
			return buildSegmented({ segment: ["move"], min: 1, max: 1 }, budget) ?? ["move"];
		case "manager":
		case "transporter":
			// 中央搬运/建筑内搬运: [C,M] 整组
			return buildSegmented({ segment: ["carry", "move"], min: 1, max: 8 }, budget);
		case "miner":
			// 元素矿工: [W,W,C,M] 整组
			return buildSegmented({ segment: ["work", "work", "carry", "move"], min: 1, max: 2 }, budget);
		case "universal":
			return buildSegmented(ROAD_SEGMENTS.universal, budget);
		case "defender":
			return buildSegmented(ROAD_SEGMENTS.defender, budget);
		case "reserver":
			// 外矿预订件 (对齐 Rosmarin race): [CLAIM,MOVE]×n, 预订功率随预算放大
			return buildSegmented({ segment: ["claim", "move"], min: 1, max: 3 }, budget);
		case "claimer":
			// 扩张占领件: 单组 [CLAIM, MOVE], 600 成本最低门槛
			return buildSegmented({ segment: ["claim", "move"], min: 1, max: 1 }, budget) ?? ["claim", "move"];
		default:
			return null;
	}
}

/** 角色的典型生产时间上界 (替补窗口估算用: 满配体型) */
export function typicalSpawnTime(unit: SpawnUnit): number {
	return spawnTimeOf(buildBody(unit, Number.MAX_SAFE_INTEGER) ?? []);
}
