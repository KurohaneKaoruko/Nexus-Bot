import { UPGRADER_BODY_CONFIG } from "@/config/economy";

/**
 * 引擎常量兜底表 (桩环境可能缺全局, 走静态值)。
 * 本文件被 rush 生成器复用, 故不得假定全局常量一定存在。
 */
const PART_COST: Readonly<Record<string, number>> = {
	work: 100,
	carry: 50,
	move: 50,
	tough: 10,
};
const partCost = (part: string): number => PART_COST[part] ?? 100;
const carryCapacity = (): number => (typeof CARRY_CAPACITY === "number" ? CARRY_CAPACITY : 50);
const maxCreepSize = (): number => (typeof MAX_CREEP_SIZE === "number" ? MAX_CREEP_SIZE : 50);

/**
 * rush 体型生成器: 按能量预算现算体型 (零依赖纯算法, 引擎常量为唯一触点)。
 * 契约: 任意预算下成本 ≤ 预算; 预算低于角色下限返回 null (调用方跳过, 不留死锁体型);
 * 排布统一 WORK 组在前、收尾 1 个 WORK (重载时疲劳吸收最稳的落位)。
 *
 * 口径:
 * - harvester: [W×n, C×c, M×m] 定点矿工化, WORK 封顶单矿再生上限 (5W = 10 能量/tick);
 * - upgrader: [W×n, C×c, M×m], WORK 密度优先, 自 maxWork 递减试装取容量装得下的最大 WORK,
 *   配比 CARRY=ceil(work×carryEnergyPerWork/容量)、MOVE=ceil(work/workPerMove) (见 UPGRADER_BODY_CONFIG);
 * - worker: [W,C,M] 三件套整组扩展, 整组付不起时回退 [W+M] / [M+C] 半组。
 */

/** 单矿再生上限折算的采集 WORK 上限 (SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER) */
export function maxHarvestWork(): number {
	const perTick = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME;
	return Math.max(1, Math.floor(perTick / HARVEST_POWER));
}

/** harvester 最低孵化预算: [W2,M1] = 250——双 WORK 起步, 单源收入 4/t。
 *  W1 起步把双源房经济锁死在 2/t (sprint sim 实锤 50k 仅 L2, 源能量 2500+ 堆积);
 *  能量不足 250 时攒能等待, 攒不齐由 replacement 短窗超时降档与 bootstrap
 *  (starterBudget 300) 兜底, 不设 W2 硬跳闸 (docs/bugs 涓流断采教训)。 */
export const RUSH_HARVESTER_MIN_BUDGET = BODYPART_COST[WORK] * 2 + BODYPART_COST[MOVE];
/** upgrader 最低孵化预算: [W1,C1,M1] */
export const RUSH_UPGRADER_MIN_BUDGET =
	BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
/** worker 最低孵化预算: [W1,C1,M1] */
export const RUSH_WORKER_MIN_BUDGET =
	BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];

function appendParts(body: BodyPartConstant[], part: BodyPartConstant, count: number): void {
	for (let i = 0; i < count; i += 1) {
		body.push(part);
	}
}

/**
 * harvester 体型:
 * 1 MOVE 起步 → 预算内先堆 WORK (前 5 个低耗档且 < maxWork) →
 * 按 move/work ≥ speed 补 MOVE 消除移动疲劳 (speed=0.5 即 2 WORK 1 MOVE) →
 * work ≥ 5 且 needCarry 时按吞吐折算补 CARRY 缓冲, 非 needCarry 维持 1 个 CARRY 下限 →
 * 最后受 maxWork 封顶。预算放不下首个 WORK 时返回 null。
 */
export function buildRushHarvesterBody(
	budget: number,
	options: { maxWork?: number; needCarry?: boolean; speed?: number } = {},
): BodyPartConstant[] | null {
	const { maxWork, needCarry = false, speed = 0.5 } = options;
	if (budget < RUSH_HARVESTER_MIN_BUDGET) {
		return null;
	}
	const cap = maxWork ?? maxHarvestWork();

	let cost = 0;
	let work = 0;
	let move = 0;
	let carry = 0;

	move += 1;
	cost += BODYPART_COST[MOVE];
	if (needCarry) {
		carry += 1;
		cost += BODYPART_COST[CARRY];
	}

	while (cost < budget && work + move + carry < MAX_CREEP_SIZE) {
		if (work < 5 && work < cap && budget >= cost + BODYPART_COST[WORK]) {
			work += 1;
			cost += BODYPART_COST[WORK];
			continue;
		}

		if ((move === 0 || move / work < speed) && budget >= cost + BODYPART_COST[MOVE]) {
			move += 1;
			cost += BODYPART_COST[MOVE];
			continue;
		}

		const desiredCarry = needCarry
			? Math.ceil((4 * work * HARVEST_POWER) / CARRY_CAPACITY)
			: 1;

		if (work >= 5 && carry < desiredCarry && budget >= cost + BODYPART_COST[CARRY]) {
			carry += 1;
			cost += BODYPART_COST[CARRY];
			continue;
		}

		if (cap && work >= cap) {
			break;
		}

		if (budget >= cost + BODYPART_COST[WORK]) {
			work += 1;
			cost += BODYPART_COST[WORK];
			continue;
		}

		break;
	}

	// 预算放不下任何 WORK (needCarry 前置占用) 时不产出: 保证成本恒 ≤ 预算
	if (work < 1) {
		return null;
	}

	const body: BodyPartConstant[] = [];
	appendParts(body, WORK, work - 1);
	appendParts(body, CARRY, carry);
	appendParts(body, MOVE, move);
	body.push(WORK);
	return body;
}

/**
 * 驻点远程矿工体型 (批次 AD, 上游 remoteMiner 口径): W 拉满 (单矿再生上限封顶),
 * M = ceil(W/2) 平地 (沼泽 ceil(W/3)), 收尾 1 CARRY 承接换源/自喂。
 * 上游 body: W×w + C×1 + M×ceil(w/2); w = floor((cap-150)/100), 预算不足时 w 递减。
 * 返回 null 表示预算 < W2M1C1 (250), 调用方跳过本轮。
 */
export function buildStationaryRemoteMinerBody(
	budget: number,
	options: { slowTerrain?: boolean } = {},
): BodyPartConstant[] | null {
	if (budget < BODYPART_COST[WORK] * 2 + BODYPART_COST[MOVE] + BODYPART_COST[CARRY]) {
		return null;
	}
	let work = Math.min(
		maxHarvestWork(),
		Math.floor((budget - BODYPART_COST[CARRY] - BODYPART_COST[MOVE]) / BODYPART_COST[WORK]),
	);
	while (
		work >= 2 &&
		work * BODYPART_COST[WORK] + BODYPART_COST[MOVE] + BODYPART_COST[CARRY] > budget
	) {
		work -= 1;
	}
	const perMove = options.slowTerrain ? 3 : 2;
	const move = Math.max(1, Math.ceil(work / perMove));
	const body: BodyPartConstant[] = [];
	appendParts(body, WORK, work);
	appendParts(body, MOVE, move);
	body.push(CARRY);
	return body;
}

/**
 * upgrader 体型 (WORK 密度优先):
 * 以 maxWork (定编缺口) 为上限, 自高向低试装 WORK, 取能量容量装得下的最大 WORK 数。
 *
 * 配比按「升级体就近取能、移动占比低」设定: CARRY = ceil(work × carryEnergyPerWork /
 * CARRY_CAPACITY) 保证随身缓冲够摊在几个 WORK 上, MOVE = ceil(work / workPerMove)
 * 每 10 个 WORK 才配 1 个 MOVE —— 预算因此几乎全转成 WORK, 同能量下火力密度最大化。
 * 试装失败即 work 减一重算 (CARRY/MOVE 随 work 收敛), 返回首个可行体型。
 *
 * 与旧「逐件加预算」路径的差异: 旧路径 MOVE 增长门为 work/move ≥ 4 (即 4 WORK 配 1 MOVE),
 * 同预算下 WORK 密度显著更低, 火力被 MOVE 分走。
 */
export function buildRushUpgraderBody(
	budget: number,
	options: { maxWork?: number; carryRatio?: number } = {},
): BodyPartConstant[] | null {
	const { maxWork, carryRatio = 1 } = options;
	if (budget < RUSH_UPGRADER_MIN_BUDGET) {
		return null;
	}

	// 预算隐含的 WORK 上界 (先按最少配比粗估, 再由试装收敛)
	const capacity = carryCapacity();
	const partsCap = maxCreepSize();
	const upperWork = maxWork ?? Math.min(partsCap, Math.floor(budget / partCost("work")));
	for (let work = upperWork; work >= 1; work -= 1) {
		// carryRatio ≥ 1 时维持至少 1 CARRY; carryEnergyPerWork 决定超过 1 时的增长
		const carry = Math.max(
			1,
			Math.max(
				Math.ceil((carryRatio * work) / capacity),
				Math.ceil((UPGRADER_BODY_CONFIG.carryEnergyPerWork * work) / capacity),
			),
		);
		const move = Math.max(UPGRADER_BODY_CONFIG.minMove, Math.ceil(work / UPGRADER_BODY_CONFIG.workPerMove));
		if (work + carry + move > partsCap) {
			continue;
		}
		const cost = work * partCost("work") + carry * partCost("carry") + move * partCost("move");
		if (cost > budget) {
			continue;
		}
		const body: BodyPartConstant[] = [];
		appendParts(body, WORK, work - 1);
		appendParts(body, CARRY, carry);
		appendParts(body, MOVE, move);
		body.push(WORK);
		return body;
	}
	return null;
}

/**
 * worker 体型:
 * 1W1C1M 起步 → 预算充足按整组扩展 (常规 [W,C,M] 200/组; 慢地形 [W,C,M,M] 250/组,
 * 沼泽房 1 MOVE 拖不动 2 载重, 双 MOVE 消化疲劳) →
 * 整组付不起时回退 [WORK+MOVE] 或 [MOVE+CARRY] 半组 →
 * 受 maxWork 与 MAX_CREEP_SIZE 约束。排布收尾 WORK+MOVE。
 */
export function buildRushWorkerBody(
	budget: number,
	options: { maxWork?: number; slowTerrain?: boolean } = {},
): BodyPartConstant[] | null {
	const { maxWork, slowTerrain = false } = options;

	const moveCost = BODYPART_COST[MOVE];
	const workCost = BODYPART_COST[WORK];
	const carryCost = BODYPART_COST[CARRY];
	const movesPerGroup = slowTerrain ? 2 : 1;
	const groupCost = workCost + carryCost + moveCost * movesPerGroup;
	const maxParts = MAX_CREEP_SIZE;
	// 慢地形组 [W,C,M,M]=250 起步: 预算不足整组时不产 (保证成本恒 ≤ 预算)
	if (budget < groupCost) {
		return null;
	}

	let work = 1;
	let move = movesPerGroup;
	let carry = 1;
	let energy = budget - groupCost;

	while (energy >= moveCost && work + move + carry + 2 <= maxParts) {
		if (maxWork && work >= maxWork) {
			break;
		}

		if (energy >= groupCost && work + move + carry + 2 + movesPerGroup <= maxParts) {
			work += 1;
			move += movesPerGroup;
			carry += 1;
			energy -= groupCost;
			continue;
		}

		if (energy >= workCost + moveCost) {
			work += 1;
			move += 1;
			energy -= workCost + moveCost;
			continue;
		}

		if (energy >= moveCost + carryCost) {
			move += 1;
			carry += 1;
			energy -= moveCost + carryCost;
			continue;
		}

		break;
	}

	const body: BodyPartConstant[] = [];
	appendParts(body, WORK, work - 1);
	appendParts(body, CARRY, carry);
	appendParts(body, MOVE, move - 1);
	body.push(WORK);
	body.push(MOVE);
	return body;
}

/** 体型总成本 */
export function rushBodyCost(body: BodyPartConstant[]): number {
	return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

/** 体型 WORK 部件数 */
export function rushBodyWork(body: BodyPartConstant[]): number {
	return body.reduce((sum, part) => sum + (part === WORK ? 1 : 0), 0);
}
