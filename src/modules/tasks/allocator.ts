/**
 * Allocator (docs/nexus-design/05 §5.4–5.7 / api/05 §5.6):
 * 两段式分配 —— 先硬性资格过滤 (不可执行靠过滤, 不靠扣分), 再贪心评分;
 * 切换必须付出代价 (hysteresis), 紧急任务可抢占。
 */
import type { CreepSummary } from "@/core/world";
import type { NexusTask } from "@/core/store/taskSchema";
import { leaseTicksFor } from "@/core/store/taskSchema";
import { UNIT_CODES } from "@/constant/UnitConstant";

export interface CapabilityProfile {
	creepName: string;
	/** 角色代号 (感知侧从名称解析): 亲和评分用 */
	unitCode: string;
	roomName: string;
	x: number;
	y: number;
	work: number;
	carry: number;
	move: number;
	claim: number;
	/** 战斗部件计数 (Phase 3: defend/retreat 资格判定) */
	attack: number;
	ranged: number;
	heal: number;
	carryEnergy: number;
	freeCapacity: number;
	ttlRemaining: number;
	spawning: boolean;
}

export interface AllocationCandidate {
	creepName: string;
	taskId: string;
	score: number;
}

export interface Assignment {
	creepName: string;
	taskId: string;
	score: number;
}

/** 评分权重 (api/05 §5.6 示例, 待实测校准; 集中配置) */
export const SCORE_WEIGHTS = {
	criticality: 100,
	urgency: 30,
	utility: 20,
	/**
	 * 亲和加分 (bugs/P1-14 派发段): 阈值算式 W > 90 —— 最坏情形 fill_spawn(95,
	 * 无亲和得分 137+滞回 15) vs upgrade(30, 亲和得分 62+W), W=95 时专职升级体
	 * 能从 fill_spawn 逃回同族任务且反向不可夺; 生存类 (defend/retreat ≥ 抢占线)
	 * 豁免滞回, 不受本权重压制。
	 */
	affinity: 95,
	capabilityFit: 15,
	travel: 2,
	risk: 10,
	switch: 8,
} as const;

/** 切换阈值: 新任务须比当前任务高出的分数 (除非紧急抢占) */
export const SWITCH_MARGIN = 15;
/** 紧急抢占线: 任务优先级达到该值可无视滞回直接抢占 */
export const CRITICAL_PRIORITY = 90;
/** 最低剩余寿命: 低于此值不接新任务 */
const MIN_TTL = 150;

export function profileOf(summary: CreepSummary): CapabilityProfile {
	return {
		creepName: summary.name,
		unitCode: summary.unitCode,
		roomName: summary.roomName,
		x: summary.x,
		y: summary.y,
		work: summary.bodyWork,
		carry: summary.bodyCarry,
		move: summary.bodyMove,
		claim: summary.bodyClaim,
		attack: summary.bodyAttack,
		ranged: summary.bodyRanged,
		heal: summary.bodyHeal,
		carryEnergy: summary.carryEnergy,
		freeCapacity: summary.freeCapacity,
		ttlRemaining: summary.ticksToLive,
		spawning: summary.spawning,
	};
}

/** 硬性资格过滤: 不可执行的候选直接出局 */
export function canExecute(profile: CapabilityProfile, task: NexusTask): boolean {
	if (profile.spawning) {
		return false;
	}
	if (profile.ttlRemaining < MIN_TTL) {
		return false;
	}
	if (profile.roomName !== task.roomName) {
		// 跨房任务 (claim: 本矿孵化 → 远程目标) 放行, 由评分的 travel 成本约束
		if (task.kind !== "claim") {
			return false;
		}
	}
	// 侦查是纯移动差事: 生产件 (work/carry) 不得抢占, 留给专职 scout
	if (task.kind === "scout" && profile.work + profile.carry > 0) {
		return false;
	}
	// 反向: 侦查件只接侦查 (单 MOVE 身体不参与生产/搬运竞争)
	if (task.kind !== "scout" && profile.work + profile.carry === 0 && profile.claim === 0 && profile.attack + profile.ranged + profile.heal === 0) {
		return false;
	}
	for (const capability of task.requiredCapabilities) {
		if (capability === "work" && profile.work === 0) {
			return false;
		}
		if (capability === "carry" && profile.carry === 0) {
			return false;
		}
		if (capability === "move" && profile.move === 0) {
			return false;
		}
		if (capability === "claim" && profile.claim === 0) {
			return false;
		}
		if (capability === "attack" && profile.attack === 0) {
			return false;
		}
		if (capability === "ranged" && profile.ranged === 0) {
			return false;
		}
		if (capability === "heal" && profile.heal === 0) {
			return false;
		}
	}
	return true;
}

/** 任务类型的固有收益 (0..1, 校准用初值) */
const KIND_UTILITY: Record<string, number> = {
	fill_spawn: 0.9,
	defend: 0.9,
	retreat: 0.8,
	harvest: 0.8,
	haul: 0.6,
	build: 0.6,
	repair: 0.5,
	upgrade: 0.4,
};

/**
 * 角色 ↔ 任务类型亲和表 (bugs/P1-14 派发段): 专职编制的体对同族任务加分,
 * 防高优任务 (fill_spawn 95 vs upgrade 85) 把专职升级体吸走——否则升级任务
 * 成「烫手山芋」循环易主 (30k tick 前程进度零增长的根因)。
 * 代号键从 UNIT_CODES 单源派生 (禁止手抄代号字符串);
 * 无亲和角色 (universal 等) 全表可接, 兜底行为不受影响。
 */
const UNIT_TASK_AFFINITY: Record<string, readonly string[]> = {
	[UNIT_CODES.upgrader]: ["upgrade"],
	[UNIT_CODES.worker]: ["build", "repair"],
	[UNIT_CODES.harvester]: ["harvest"],
	[UNIT_CODES.carrier]: ["fill_spawn", "haul"],
	[UNIT_CODES.defender]: ["defend"],
};

/** 角色对任务是否亲和 (无表项角色恒不加分) */
function isAffine(unitCode: string, kind: string): boolean {
	return (UNIT_TASK_AFFINITY[unitCode] ?? []).includes(kind);
}

export function scoreCandidate(
	profile: CapabilityProfile,
	task: NexusTask,
	travelCost: number,
	switchCost: number,
	now: number,
): number {
	const criticality = task.priority / 100;
	const urgency =
		task.deadline !== undefined ? Math.max(0, Math.min(1, 1 - (task.deadline - now) / 300)) : 0.3;
	const utility = KIND_UTILITY[task.kind] ?? 0.4;
	const required = Math.max(1, task.requiredCapabilities.length);
	const matched = task.requiredCapabilities.filter((capability) => {
		if (capability === "work") return profile.work > 0;
		if (capability === "carry") return profile.carry > 0;
		if (capability === "move") return profile.move > 0;
		if (capability === "claim") return profile.claim > 0;
		if (capability === "attack") return profile.attack > 0;
		if (capability === "ranged") return profile.ranged > 0;
		if (capability === "heal") return profile.heal > 0;
		return false;
	}).length;
	const capabilityFit = matched / required;
	const affinity = isAffine(profile.unitCode, task.kind) ? 1 : 0;
	const w = SCORE_WEIGHTS;
	return (
		w.criticality * criticality +
		w.urgency * urgency +
		w.utility * utility +
		w.affinity * affinity +
		w.capabilityFit * capabilityFit -
		w.travel * travelCost -
		w.switch * switchCost
	);
}

function travelCostOf(profile: CapabilityProfile, task: NexusTask, world: WorldViewLike): number {
	if (profile.roomName !== task.roomName) {
		// 跨房任务 (claim) 用房名线性距离折算, 不做无穷大排除
		if (task.kind !== "claim") {
			return Number.POSITIVE_INFINITY;
		}
		const m1 = profile.roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
		const m2 = task.roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
		if (!m1 || !m2) return Number.POSITIVE_INFINITY;
		const dist =
			Math.abs((parseInt(m2[2] ?? "0", 10) || 0) - (parseInt(m1[2] ?? "0", 10) || 0)) +
			Math.abs((parseInt(m2[4] ?? "0", 10) || 0) - (parseInt(m1[4] ?? "0", 10) || 0));
		return dist * 50;
	}
	let tx = profile.x;
	let ty = profile.y;
	if (task.targetPos) {
		tx = task.targetPos.x;
		ty = task.targetPos.y;
	} else if (task.targetId) {
		const room = world.rooms[task.roomName];
		const known = room
			? [
					...room.sources,
					...room.energyStructures,
					...room.sites,
					...room.piles,
					...room.stores,
				].find((o) => o.id === task.targetId)
			: undefined;
		if (!known) {
			return 0;
		}
		tx = known.x;
		ty = known.y;
	}
	return Math.max(Math.abs(tx - profile.x), Math.abs(ty - profile.y));
}

/** 分配输入: 最小化对 TickContext 的依赖, 便于单测 */
export interface WorldViewLike {
	rooms: Record<
		string,
		{
			sources: { id: string; x: number; y: number }[];
			energyStructures: { id: string; x: number; y: number }[];
			sites: { id: string; x: number; y: number }[];
			piles: { id: string; x: number; y: number }[];
			stores: { id: string; x: number; y: number }[];
		}
	>;
}

export interface AssignInput {
	now: number;
	tasks: readonly NexusTask[];
	profiles: readonly CapabilityProfile[];
	world: WorldViewLike;
	/** 当前任务指针 (creep.memory.taskId) */
	currentTaskOf: (creepName: string) => string | undefined;
	getTask: (taskId: string) => NexusTask | undefined;
	claim: (taskId: string, creepName: string, now: number, leaseTicks?: number) => boolean;
	/**
	 * 亲和排他开关 (bugs (十三)): 开 = 有专属角色在岗的 kind 禁止跨界认领。
	 * main 系 (无 courier 投喂) 开——升级体钉死工位; rush/mini 关——churn 经济
	 * 里升级体兼差 fill_spawn 是承重的 (全员顶孵化线), arena 实证排他即回退
	 * (L3 18140→21684)。
	 */
	affinityExclusive?: boolean;
}

/**
 * 贪心分配: 任务按优先级降序, 每个任务取合格候选中的最高分;
 * 持有任务的 creep 参与分配时需过滞回阈值, 紧急任务可抢占。
 *
 * 亲和排他 (bugs (十三)): fill_spawn 等高优先物流任务按序先处理, 专属角色
 * (carrier) 耗尽后会溢出捕获带 carry 的其他专属编制 (升级体被 fill_spawn
 * 掏空 → upgrade 任务全 available 无人可领)。规则: kind 有专属角色在场
 * (非孵化) 时, 非专属角色不得认领; 专属角色全灭/孵化中则放行跨界兜底
 * (保 bootstrap: 无 harvester 时 universal 可采)。
 */
export function assignBatch(input: AssignInput): readonly Assignment[] {
	const assignments: Assignment[] = [];
	const taken = new Set<string>();

	// 本 tick 有在岗专属角色的 kind 集合
	const affinityOwnedKinds = new Set<string>();
	for (const profile of input.profiles) {
		if (profile.spawning) continue;
		for (const kind of UNIT_TASK_AFFINITY[profile.unitCode] ?? []) {
			affinityOwnedKinds.add(kind);
		}
	}

	const byPriority = [...input.tasks]
		.filter((task) => task.status === "available")
		.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

	for (const task of byPriority) {
		let best: { profile: CapabilityProfile; score: number } | null = null;
		for (const profile of input.profiles) {
			if (taken.has(profile.creepName)) {
				continue;
			}
			if (!canExecute(profile, task)) {
				continue;
			}
			if (
				input.affinityExclusive &&
				affinityOwnedKinds.has(task.kind) &&
				!isAffine(profile.unitCode, task.kind)
			) {
				continue;
			}
			const travel = travelCostOf(profile, task, input.world);
			if (!Number.isFinite(travel)) {
				continue;
			}
			const currentTaskId = input.currentTaskOf(profile.creepName);
			const isSwitch = currentTaskId !== undefined && currentTaskId !== task.id;
			const switchCost = isSwitch ? 1 : 0;
			const candidateScore = scoreCandidate(profile, task, travel, switchCost, input.now);
			if (isSwitch && task.priority < CRITICAL_PRIORITY) {
				const current = input.getTask(currentTaskId);
				if (current) {
					const currentScore = scoreCandidate(profile, current, 0, 0, input.now);
					if (candidateScore < currentScore + SWITCH_MARGIN) {
						continue;
					}
				}
			}
			if (!best || candidateScore > best.score) {
				best = { profile, score: candidateScore };
			}
		}
		if (best && input.claim(task.id, best.profile.creepName, input.now, leaseTicksFor(task.kind))) {
			taken.add(best.profile.creepName);
			assignments.push({ creepName: best.profile.creepName, taskId: task.id, score: best.score });
		}
	}
	return assignments;
}
