/**
 * 威胁模型 (docs/nexus-design/09 §9.2 / docs/nexus-design/19 §19.4):
 * 评分 = 能力估值 (部件×权重, boost 放大) × 关键资产接近度 × 类别乘数;
 * 结果为 rooms[x].threat 单条有界记录 (lastSeen/confidence 新鲜度语义, docs/nexus-design/04 §4.3);
 * 失视按 tick 衰减, 衰减至无害或超时清除——过期威胁不维持防御状态。
 * 战损统计 (docs/nexus-design/14 Phase 3): 威胁窗口内单位损失/击杀近似/塔能耗, 全部有界计数。
 */
import { THREAT_CONFIG, WAR_STATS_CONFIG } from "@/config/defense";
import type { TickContext } from "@/core";
import type { HostileCreepSummary, RoomObservation } from "@/core/world";
import type { NexusMemory, ThreatCategory } from "@/core/store/memorySchema";
import { markUrgentReeval } from "@/core/store/runtime";
import type { ActionResult } from "@/modules/agents";

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 威胁能力估值: 存活部件计数 × 权重, boost 部件按占比放大 */
export function hostilePower(hostile: HostileCreepSummary): number {
	const w = THREAT_CONFIG.partWeights;
	let power =
		hostile.bodyAttack * (w.attack ?? 0) +
		hostile.bodyRanged * (w.ranged ?? 0) +
		hostile.bodyHeal * (w.heal ?? 0) +
		hostile.bodyTough * (w.tough ?? 0) +
		hostile.bodyMove * (w.move ?? 0);
	const parts =
		hostile.bodyAttack +
		hostile.bodyRanged +
		hostile.bodyHeal +
		hostile.bodyTough +
		hostile.bodyMove;
	if (parts > 0 && hostile.boostedParts > 0) {
		const boostRatio = Math.min(1, hostile.boostedParts / parts);
		power *= 1 + (THREAT_CONFIG.boostMultiplier - 1) * boostRatio;
	}
	return power;
}

/** 关键资产 (Spawn/Controller/塔/Storage) 接近度: 距离越近乘数越高, 远离范围恒 1 */
export function proximityFactor(room: RoomObservation, x: number, y: number): number {
	const assets: Array<{ x: number; y: number }> = [];
	for (const structure of room.energyStructures) {
		if (structure.structureType === "spawn") {
			assets.push(structure);
		}
	}
	if (room.controller) {
		assets.push(room.controller);
	}
	for (const tower of room.towers) {
		assets.push(tower);
	}
	for (const store of room.stores) {
		if (store.structureType === "storage") {
			assets.push(store);
		}
	}
	if (assets.length === 0) {
		return 1;
	}
	let nearest = Number.POSITIVE_INFINITY;
	for (const asset of assets) {
		nearest = Math.min(nearest, chebyshev(x, y, asset.x, asset.y));
	}
	if (nearest >= THREAT_CONFIG.proximityRange) {
		return 1;
	}
	return 1 + (1 - nearest / THREAT_CONFIG.proximityRange) * THREAT_CONFIG.proximityWeight;
}

/** 单个敌方的威胁贡献 (排序/评分共用) */
export function hostileThreat(room: RoomObservation, hostile: HostileCreepSummary): number {
	return (
		hostilePower(hostile) *
		proximityFactor(room, hostile.x, hostile.y) *
		THREAT_CONFIG.categoryMultiplier[hostile.isNpc ? "npc" : "player"]
	);
}

/** 敌方按威胁贡献降序 (defend 目标选择用) */
export function rankHostiles(room: RoomObservation): HostileCreepSummary[] {
	return [...room.hostiles].sort((a, b) => hostileThreat(room, b) - hostileThreat(room, a));
}

export interface ThreatSnapshot {
	score: number;
	/** 主导类别: 存在玩家敌人即为 player */
	category: ThreatCategory;
	hostileCount: number;
	/** 引用量化输入的原因摘要 (可归因) */
	reason: string;
}

/** 可见威胁评分 (纯函数, 只读快照) */
export function scoreHostiles(room: RoomObservation): ThreatSnapshot {
	let score = 0;
	let hasPlayer = false;
	for (const hostile of room.hostiles) {
		score += hostileThreat(room, hostile);
		if (!hostile.isNpc) {
			hasPlayer = true;
		}
	}
	const category: ThreatCategory = hasPlayer ? "player" : "npc";
	return {
		score,
		category,
		hostileCount: room.hostiles.length,
		reason: `hostiles:${room.hostiles.length} score:${Math.round(score)} cat:${category}`,
	};
}

/**
 * 更新房间威胁记录 (emergency 阶段每 Tick 调用):
 * 可见 → 快照评分覆盖 + 击杀近似归因; 失视 → 按 tick 衰减, 无害/超时清除;
 * 新威胁窗口 → 计数 + 紧急重估标志; 威胁活跃期死亡的房间单位计入战损。
 */
export function updateRoomThreat(ctx: TickContext, room: RoomObservation): void {
	const intel = ctx.memory.rooms[room.roomName];
	if (!intel) {
		return;
	}
	const stats = ctx.memory.defense.stats;
	const previous = intel.threat;
	const snapshot = scoreHostiles(room);

	if (snapshot.hostileCount > 0) {
		// 击杀近似: 上一 Tick 也可见且数量下降 (排除失视回填造成的误计)
		if (
			previous &&
			previous.lastSeenAt === ctx.tick - 1 &&
			snapshot.hostileCount < previous.hostileCount
		) {
			stats.hostilesKilled += previous.hostileCount - snapshot.hostileCount;
		}
		const continuing = previous !== undefined && previous.score >= THREAT_CONFIG.harmlessScore;
		if (!continuing) {
			stats.threatWindows += 1;
			markUrgentReeval(ctx.tick);
		}
		intel.threat = {
			score: snapshot.score,
			peakScore: Math.max(snapshot.score, previous?.peakScore ?? 0),
			category: snapshot.category,
			firstSeenAt: continuing ? previous.firstSeenAt : ctx.tick,
			lastSeenAt: ctx.tick,
			confidence: 1,
			hostileCount: snapshot.hostileCount,
			reason: snapshot.reason,
		};
	} else if (previous) {
		const unseen = ctx.tick - previous.lastSeenAt;
		const decayed = previous.score * Math.pow(THREAT_CONFIG.decayFactor, unseen);
		if (unseen > THREAT_CONFIG.staleTicks || decayed < THREAT_CONFIG.harmlessScore) {
			// 衰减至无害或长期失视: 清除, 不再当作实时事实
			delete intel.threat;
		} else {
			intel.threat = {
				...previous,
				score: decayed,
				confidence: Math.pow(0.5, unseen / THREAT_CONFIG.confidenceHalfLife),
			};
		}
	}

	// 己方损失归因: 威胁活跃期死亡的、家在本房间的单位 (emergency 先于 spawn 回收, 记录尚在)
	if (intel.threat !== undefined && ctx.world.dead.length > 0) {
		for (const name of ctx.world.dead) {
			const unit = ctx.memory.units[name];
			if (unit && unit.homeRoom === room.roomName) {
				stats.unitsLost += 1;
			}
		}
	}
}

/** 全局最高威胁分 (战略 war 输入, 纯 Memory 读) */
export function maxThreatScore(memory: NexusMemory): number {
	let max = 0;
	for (const intel of Object.values(memory.rooms)) {
		const score = intel.threat?.score ?? 0;
		if (score > max) {
			max = score;
		}
	}
	return max;
}

export type ThreatTier = "peace" | "low" | "high";

/** 威胁分级 (defend/retreat 生成与编制映射的基准) */
export function threatTierOf(score: number): ThreatTier {
	if (score >= THREAT_CONFIG.tierThresholds.high) {
		return "high";
	}
	if (score >= THREAT_CONFIG.tierThresholds.low) {
		return "low";
	}
	return "peace";
}

/* ── 塔能耗统计 (broker 结果回填, docs/nexus-design/14 战损预算) ── */

/** accepted 塔行动能耗入账 (每行动 10 能源, commit 段调用) */
export function recordTowerSpend(ctx: TickContext, results: readonly ActionResult[]): void {
	let added = 0;
	for (const result of results) {
		if (result.pipeline === "tower" && result.accepted) {
			added += WAR_STATS_CONFIG.towerEnergyPerAction;
		}
	}
	if (added > 0) {
		const spend = ctx.memory.defense.stats.towerEnergy;
		spend.accumulated += added;
		spend.total += added;
	}
}

/** 窗口折叠 EMA (emergency 段调用, O(1)) */
export function foldTowerSpend(ctx: TickContext): void {
	const spend = ctx.memory.defense.stats.towerEnergy;
	if (ctx.tick - spend.lastFoldTick < WAR_STATS_CONFIG.foldWindowTicks) {
		return;
	}
	const average = spend.accumulated / WAR_STATS_CONFIG.foldWindowTicks;
	spend.ema =
		spend.ema * (1 - WAR_STATS_CONFIG.foldSmoothing) + average * WAR_STATS_CONFIG.foldSmoothing;
	spend.accumulated = 0;
	spend.lastFoldTick = ctx.tick;
}

/* ── 观测快照 (HUD/控制台, docs/nexus-design/02 原则 F) ── */

export interface DefenseSnapshot {
	maxScore: number;
	tier: ThreatTier;
	/** 主导威胁类别 (有可见威胁时) */
	category?: ThreatCategory;
	unitsLost: number;
	hostilesKilled: number;
	threatWindows: number;
	/** 塔能耗窗口均值 (能源/窗口) */
	towerEnergyEma: number;
	safeModeActivations: number;
}

export function defenseSnapshot(ctx: TickContext): DefenseSnapshot {
	const maxScore = maxThreatScore(ctx.memory);
	let category: ThreatCategory | undefined;
	for (const intel of Object.values(ctx.memory.rooms)) {
		if (intel.threat && intel.threat.score >= maxScore && maxScore > 0) {
			category = intel.threat.category;
		}
	}
	const stats = ctx.memory.defense.stats;
	return {
		maxScore,
		tier: threatTierOf(maxScore),
		...(category !== undefined ? { category } : {}),
		unitsLost: stats.unitsLost,
		hostilesKilled: stats.hostilesKilled,
		threatWindows: stats.threatWindows,
		towerEnergyEma: stats.towerEnergy.ema,
		safeModeActivations: ctx.memory.defense.safeMode.activationCount,
	};
}
