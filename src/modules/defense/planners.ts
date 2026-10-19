/**
 * 防御规划器 (docs/nexus-design/19 §19.3/§19.4, emergency 阶段):
 * 读威胁摘要 + 快照 → defend/retreat/repair 任务幂等 upsert, 威胁衰减 cancel;
 * 高强度威胁改为**向编队机制提需求** (docs/nexus-design/20: 防御=需求方, 集群=执行形态), 由 cluster-squads 建队;
 * 撤退进入/退出阈值分离 (迟滞); SafeMode 多条件政策经 broker 统一提交;
 * 维修按价值 tier × 损坏程度 × 威胁区域排序, 有界并发, 墙/城门不无条件修满。
 * 纯函数模块: broker 以参数注入 (装配见 defense/index.ts), 规划器不触碰游戏 API。
 */
import {
	REPAIR_CONFIG,
	RETREAT_CONFIG,
	SAFEMODE_CONFIG,
	STAFFING_CONFIG,
	THREAT_CONFIG,
} from "@/config/defense";
import { RUSH_BUILD_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import { directiveFor } from "@/modules/strategy";
import type { CreepSummary, DamageableSummary, RoomObservation } from "@/core/world";
import type { RoomThreatRecord } from "@/core/store/memorySchema";
import { priorityFor } from "@/core/store/taskSchema";
import { requestSquad } from "@/core/store/runtime";
import type { TaskBoard } from "@/modules/tasks";
import { rankHostiles, threatTierOf } from "@/modules/defense/threatModel";
import type { ActionBroker } from "@/modules/agents";

/** 威胁期间保持存活的任务族 (cancel 判定用) */
const DEFENSE_KINDS = ["defend", "retreat"] as const;

function isActive(task: { status: string }): boolean {
	return task.status !== "completed" && task.status !== "cancelled" && task.status !== "failed";
}

/** 战斗单位判定: 按实际部件而非角色字符串 (总表验收项) */
export function isCombatant(creep: CreepSummary): boolean {
	return creep.bodyAttack > 0 || creep.bodyRanged > 0 || creep.bodyHeal > 0;
}

/** 撤退锚点: Spawn 优先, 缺省 Controller (docs/nexus-design/09 §9.3 非战斗单位撤退) */
export function retreatAnchor(room: RoomObservation): { x: number; y: number; roomName: string } {
	if (RETREAT_CONFIG.anchor === "spawn") {
		const spawn = room.energyStructures.find((structure) => structure.structureType === "spawn");
		if (spawn) {
			return { x: spawn.x, y: spawn.y, roomName: room.roomName };
		}
	}
	const controller = room.controller;
	return controller
		? { x: controller.x, y: controller.y, roomName: room.roomName }
		: { x: 25, y: 25, roomName: room.roomName };
}

/** 维修目标线: 墙/城门用绝对维护线, 其余 hitsMax × 比例 */
export function maintainTargetOf(structure: DamageableSummary): number {
	if (structure.structureType === "rampart") {
		return REPAIR_CONFIG.rampartMaintainHits;
	}
	if (structure.structureType === "constructedWall") {
		return REPAIR_CONFIG.wallMaintainHits;
	}
	return structure.hitsMax * REPAIR_CONFIG.maintainRatio;
}

/**
 * 是否低于维修触发线。比例线对 decay 结构 (容器/道路) 太迟钝:
 * 90% 线意味着容器掉 25000 血 (5000t decay) 后才触发——一旦 worker 编制
 * 空缺就追不上 decay, 容器必死 (250k 血 25k tick 寿命), 死后重建 5000e +
 * 数千 tick 断供 (sim 实证 cc 容器 decay 死, 升级链断 8.9k tick)。
 * decay 结构改用绝对余量线: 掉到「预警窗口内 decay 量」即触发, 持续小补。
 */
const DECAY_STRUCTURE_TYPES: ReadonlySet<string> = new Set(["container", "road"]);

/** decay 结构的每 tick 衰减速率 (自有房口径: 容器 5000/500t, 道路 100/1000t) */
function decayRateOf(structure: DamageableSummary): number {
	return structure.structureType === "road" ? 0.1 : 10;
}

function belowMaintainLine(structure: DamageableSummary): boolean {
	if (DECAY_STRUCTURE_TYPES.has(structure.structureType)) {
		return structure.hitsMax - structure.hits >= REPAIR_CONFIG.decayLeadTicks * decayRateOf(structure);
	}
	return structure.hits < maintainTargetOf(structure);
}

function isWallLike(structure: DamageableSummary): boolean {
	return structure.structureType === "rampart" || structure.structureType === "constructedWall";
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 威胁区域: 结构距任一敌方 threatZoneRange 内 (排序加成用) */
function inThreatZone(room: RoomObservation, structure: DamageableSummary): boolean {
	for (const hostile of room.hostiles) {
		if (
			chebyshev(structure.x, structure.y, hostile.x, hostile.y) <= REPAIR_CONFIG.threatZoneRange
		) {
			return true;
		}
	}
	return false;
}

/** 维修排序: 价值 tier × 损坏程度 × 威胁区域加成 (docs/nexus-design/09 §9.3 不无条件修满) */
function repairRank(
	room: RoomObservation,
	structure: DamageableSummary,
	threatZone: boolean,
): number {
	const tier = REPAIR_CONFIG.valueTier[structure.structureType] ?? 1;
	const target = maintainTargetOf(structure);
	const severity = Math.max(0, Math.min(1, 1 - structure.hits / Math.max(1, target)));
	return tier * 100 + severity * 50 + (threatZone ? REPAIR_CONFIG.threatZoneBonus : 0);
}

/** 维修规划 (structure-repair spec): 幂等任务 + 有界并发 + 衰减终结 */
export function planRepairRoom(
	ctx: TickContext,
	board: TaskBoard,
	room: RoomObservation,
	threat: RoomThreatRecord | undefined,
): void {
	const threatActive = (threat?.score ?? 0) >= THREAT_CONFIG.tierThresholds.low;
	const bias = directiveFor(ctx).kindBias.repair ?? 0;
	const expected = new Set<string>();

	const targets = room.damageables
		.filter(belowMaintainLine)
		.map((structure) => ({ structure, zone: inThreatZone(room, structure) }))
		.sort((a, b) => repairRank(room, b.structure, b.zone) - repairRank(room, a.structure, a.zone))
		.slice(0, REPAIR_CONFIG.maxConcurrentTasks);

	for (const { structure, zone } of targets) {
		const dedupeKey = `repair:${room.roomName}:${structure.id}`;
		expected.add(dedupeKey);
		let priority = priorityFor("repair") + bias;
		// decay 结构维修提级 (RUSH_BUILD_CONFIG.criticalInfraPriority 档): 容器
		// 25k tick 寿命, 死后重建 5000e + 8.9k tick 断供; 与关键基建建造同档,
		// 让 harvester (亲和 build, repair 无 carry 门槛) 经 criticality 通道承接。
		// road 不提级 (c22 实证: 提级后 10 条路的恒 decay 把 6/9 人力吸进维修,
		// RCL3 段升级速率 0.55/t)——道路维修维持常规档殿后
		if (structure.structureType === "container") {
			priority = Math.min(priority, RUSH_BUILD_CONFIG.criticalInfraPriority);
		}
		if (threatActive && isWallLike(structure)) {
			priority -= REPAIR_CONFIG.defenseLineThreatBonus;
		}
		if (zone) {
			priority -= REPAIR_CONFIG.threatZoneBonus;
		}
		board.upsert(
			{
				dedupeKey,
				kind: "repair",
				roomName: room.roomName,
				targetId: structure.id,
				targetPos: { x: structure.x, y: structure.y, roomName: room.roomName },
				priority,
				requiredCapabilities: ["work", "move"],
			},
			ctx.tick,
		);
	}

	for (const task of board.list({ roomName: room.roomName, kinds: ["repair"] })) {
		if (!expected.has(task.dedupeKey) && isActive(task)) {
			board.cancel(task.id, ctx.tick, "subject-gone");
		}
	}
}

/**
 * SafeMode 多条件政策 (docs/nexus-design/09 §9.3 / docs/api/08 §8.3):
 * 威胁超线 (常规防御不足近似) + 关键结构濒毁 + 可用次数/冷却允许 + 重试冷却;
 * 禁止单一敌人数量阈值; 经 broker defense 管线统一提交。
 */
export function evaluateSafeMode(
	ctx: TickContext,
	room: RoomObservation,
	threat: RoomThreatRecord | undefined,
	broker: Pick<ActionBroker, "submit">,
): void {
	if (!threat || threat.score < SAFEMODE_CONFIG.threatDeficitScore) {
		return;
	}
	const controller = room.controller;
	if (!controller) {
		return;
	}
	const criticalHit = room.damageables.some(
		(structure) =>
			SAFEMODE_CONFIG.criticalTypes.includes(structure.structureType) &&
			structure.hitsMax > 0 &&
			structure.hits < structure.hitsMax * SAFEMODE_CONFIG.criticalHitsRatio,
	);
	if (!criticalHit) {
		return;
	}
	if ((controller.safeModeAvailable ?? 0) <= 0) {
		return;
	}
	if (controller.safeMode !== undefined || controller.safeModeCooldown !== undefined) {
		return;
	}
	const bookkeeping = ctx.memory.defense.safeMode;
	// lastAttemptTick 0 = 从未尝试 (真实服务器 tick 量级远大于冷却, 不构成误判)
	if (
		bookkeeping.lastAttemptTick > 0 &&
		ctx.tick - bookkeeping.lastAttemptTick < SAFEMODE_CONFIG.retryCooldown
	) {
		return;
	}
	bookkeeping.lastAttemptTick = ctx.tick;
	broker.submit({
		id: `safemode-${room.roomName}-${ctx.tick}`,
		tick: ctx.tick,
		actorName: controller.id,
		kind: "activateSafeMode",
		targetId: controller.id,
		priority: 99,
		pipeline: "defense",
		dedupeKey: `safemode:${room.roomName}`,
	});
	ctx.logger.info(`SafeMode 提案 ${room.roomName}: ${threat.reason}`);
}

/** 防御应急规划入口 (docs/nexus-design/19 §19.3 按房间): 威胁驱动任务族 + SafeMode + 维修 */
export function planDefenseRoom(
	ctx: TickContext,
	board: TaskBoard,
	room: RoomObservation,
	broker: Pick<ActionBroker, "submit">,
): void {
	const threat = ctx.memory.rooms[room.roomName]?.threat;
	const score = threat?.score ?? 0;
	const tier = threatTierOf(score);
	const bias = directiveFor(ctx).kindBias;
	const expected = new Set<string>();

	// defend: 可见敌方且威胁达 low 线 (弱敌仅塔处理, 分级响应)
	if (room.hostiles.length > 0 && tier !== "peace") {
		const priority = priorityFor("defend") + (bias.defend ?? 0);
		if (tier === "high") {
			// 高强度威胁: 单任务不足以应对 → 提编队需求 (docs/nexus-design/19 §19.4 集群, 成员数 = 分级编制)
			requestSquad({
				kind: "defense",
				roomName: room.roomName,
				slots: STAFFING_CONFIG.tierDefenders.high,
				taskKind: "defend",
				capabilities: ["ranged", "move"],
				priority,
				reason: `tier:high threat:${Math.round(score)}`,
			});
		} else {
			// 低强度: 单条 defend 任务由塔 + 单个 defender 处理
			const top = rankHostiles(room)[0];
			if (top) {
				const dedupeKey = `defend:${room.roomName}:${tier}`;
				expected.add(dedupeKey);
				board.upsert(
					{
						dedupeKey,
						kind: "defend",
						roomName: room.roomName,
						targetId: top.id,
						targetPos: { x: top.x, y: top.y, roomName: room.roomName },
						priority,
						requiredCapabilities: ["ranged", "move"],
					},
					ctx.tick,
				);
			}
		}
	}

	// retreat: 进入线 = low; 退出线 = exitScore (阈值分离防抖, 期间持续保持)
	const hasRetreat = board.list({ roomName: room.roomName, kinds: ["retreat"] }).some(isActive);
	if (
		score >= RETREAT_CONFIG.exitScore &&
		(score >= THREAT_CONFIG.tierThresholds.low || hasRetreat)
	) {
		const anchor = retreatAnchor(room);
		for (const creep of room.creeps) {
			if (creep.spawning || isCombatant(creep)) {
				continue;
			}
			const dedupeKey = `retreat:${room.roomName}:${creep.name}`;
			expected.add(dedupeKey);
			board.upsert(
				{
					dedupeKey,
					kind: "retreat",
					roomName: room.roomName,
					targetPos: anchor,
					priority: priorityFor("retreat"),
					requiredCapabilities: ["move"],
				},
				ctx.tick,
			);
		}
	}

	// 衰减/降级终结: 非预期存活任务取消 (威胁衰减或 defend tier 变化换防)
	// 只清理本规划器命名空间的任务 (kind:room 前缀); 编队槽位任务 (squad:*) 归编队机制管辖
	for (const kind of DEFENSE_KINDS) {
		const prefix = `${kind}:${room.roomName}`;
		for (const task of board.list({ roomName: room.roomName, kinds: [kind] })) {
			if (!task.dedupeKey.startsWith(prefix)) {
				continue;
			}
			if (!expected.has(task.dedupeKey) && isActive(task)) {
				board.cancel(
					task.id,
					ctx.tick,
					score < RETREAT_CONFIG.exitScore ? "threat-decayed" : "tier-changed",
				);
			}
		}
	}

	planRepairRoom(ctx, board, room, threat);
	evaluateSafeMode(ctx, room, threat, broker);
}
