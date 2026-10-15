/**
 * rush 体型生成器: 按能量预算现算体型 (零依赖纯算法, 引擎常量为唯一触点)。
 * 契约: 任意预算下成本 ≤ 预算; 预算低于角色下限返回 null (调用方跳过, 不留死锁体型);
 * 排布统一 WORK 组在前、收尾 1 个 WORK (重载时疲劳吸收最稳的落位)。
 *
 * 口径:
 * - harvester: [W×n, C×c, M×m] 定点矿工化, WORK 封顶单矿再生上限 (5W = 10 能量/tick);
 * - upgrader: [W×n, C×c, M×m], WORK 优先, move 增长门 work/move ≥ 4 (4 WORK 拖 1 MOVE);
 * - worker: [W,C,M] 三件套整组扩展, 整组付不起时回退 [W+M] / [M+C] 半组。
 */

/** 单矿再生上限折算的采集 WORK 上限 (SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER) */
export function maxHarvestWork(): number {
	const perTick = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME;
	return Math.max(1, Math.floor(perTick / HARVEST_POWER));
}

/** harvester 最低孵化预算: [W1,M1] = 150 (W2 硬底线实验负收益已撤销——涓流期换代
 *  等待断收入; 采集体型的正解是收入感知定档, 见 docs/bugs 校准实录) */
export const RUSH_HARVESTER_MIN_BUDGET = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
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
 * upgrader 体型:
 * 1W1C1M 起步 → CARRY 增长门为容量比 (CARRY_CAPACITY×carry)/work < carryRatio
 * (carryRatio=1 即长期维持 1 个 CARRY 缓冲) → MOVE 增长门 work/move ≥ 4 →
 * 其余预算全部转 WORK, WORK 达 maxWork (定编缺口) 即停。
 */
export function buildRushUpgraderBody(
	budget: number,
	options: { maxWork?: number; carryRatio?: number } = {},
): BodyPartConstant[] | null {
	const { maxWork, carryRatio = 1 } = options;
	if (budget < RUSH_UPGRADER_MIN_BUDGET) {
		return null;
	}

	const maxParts = MAX_CREEP_SIZE;
	let cost = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
	let work = 1;
	let move = 1;
	let carry = 1;

	while (budget > cost) {
		if ((CARRY_CAPACITY * carry) / work < carryRatio && budget >= cost + BODYPART_COST[CARRY]) {
			if (work + move + carry + 1 > maxParts) {
				break;
			}
			carry += 1;
			cost += BODYPART_COST[CARRY];
			continue;
		}

		if ((move === 0 || work / move >= 4) && budget >= cost + BODYPART_COST[MOVE]) {
			if (work + move + carry + 1 > maxParts) {
				break;
			}
			move += 1;
			cost += BODYPART_COST[MOVE];
			continue;
		}

		if (maxWork && work >= maxWork) {
			break;
		}

		if (budget >= cost + BODYPART_COST[WORK]) {
			if (work + move + carry + 1 > maxParts) {
				break;
			}
			work += 1;
			cost += BODYPART_COST[WORK];
			continue;
		}

		break;
	}

	const body: BodyPartConstant[] = [];
	appendParts(body, WORK, work - 1);
	appendParts(body, CARRY, carry);
	appendParts(body, MOVE, move);
	body.push(WORK);
	return body;
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
