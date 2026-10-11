/**
 * Allocator (docs/nexus-design/05 §5.4–5.7 / api/05 §5.6):
 * 两段式分配 —— 先硬性资格过滤 (不可执行靠过滤, 不靠扣分), 再贪心评分;
 * 切换必须付出代价 (hysteresis), 紧急任务可抢占。
 */
import type { CreepSummary } from "@/core/world";
import type { NexusTask } from "@/store/taskSchema";
import { leaseTicksFor } from "@/store/taskSchema";

export interface CapabilityProfile {
	creepName: string;
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

export function profileOf(summary: CreepSummary): CapabilityProfile {
	return {
		creepName: summary.name,
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

export function scoreCandidate(
	profile: CapabilityProfile,
	task: NexusTask,
	travelCost: number,
	switchCost: number,
	now: number,
): number {
	const criticality = task.priority / 100;
	const urgency =
		task.deadline !== undefined
			? Math.max(0, Math.min(1, 1 - (task.deadline - now) / 300))
			: 0.3;
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
	const w = SCORE_WEIGHTS;
	return (
		w.criticality * criticality +
		w.urgency * urgency +
		w.utility * utility +
		w.capabilityFit * capabilityFit -
		w.travel * travelCost -
		w.risk * 0 -
		w.switch * switchCost
	);
}

function travelCostOf(
	profile: CapabilityProfile,
	task: NexusTask,
	world: WorldViewLike,
): number {
	if (profile.roomName !== task.roomName) {
		return Number.POSITIVE_INFINITY;
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
	rooms: Record<string, {
		sources: { id: string; x: number; y: number }[];
		energyStructures: { id: string; x: number; y: number }[];
		sites: { id: string; x: number; y: number }[];
		piles: { id: string; x: number; y: number }[];
		stores: { id: string; x: number; y: number }[];
	}>;
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
}

/**
 * 贪心分配: 任务按优先级降序, 每个任务取合格候选中的最高分;
 * 持有任务的 creep 参与分配时需过滞回阈值, 紧急任务可抢占。
 */
export function assignBatch(input: AssignInput): readonly Assignment[] {
	const assignments: Assignment[] = [];
	const taken = new Set<string>();
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
