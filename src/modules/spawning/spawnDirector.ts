/**
 * SpawnDirector (docs/nexus-design/07 / api/07 §7.5):
 * 从「无法分配的任务」聚合能力缺口 → 生产请求 → BodyFactory 出身体 → 排程提交。
 * 无状态: 每 Tick 由存活/在途/任务重新计算缺口;
 * 替补窗口实装 (§7.5): lead = 生产时间 + 实测路程 P95 + 余量, 关键岗位允许短暂重叠;
 * Creep 死亡后回收 UnitRecord, 租约由任务对账释放。
 */
import type { TickContext } from "@/core/tickContext";
import { STRATEGY_CONFIG } from "@/config/strategy";
import { STAFFING_CONFIG } from "@/config/defense";
import { ROLE_CODES, roleCode } from "@/constant/RoleConstant";
import { generateCreepName } from "@/utils/naming";
import {
	bodyCost,
	buildBody,
	isSpawnRole,
	typicalSpawnTime,
	type SpawnRole,
} from "@/modules/spawning/bodyFactory";
import { travelP95 } from "@/modules/economy/model";
import { commit as commitReservation, release as releaseReservation, reserve } from "@/modules/economy/ledger";
import { maxThreatScore, threatTierOf } from "@/modules/defense/threatModel";
import { ECONOMY_MODEL_CONFIG, REPLACEMENT_CONFIG, SPAWN_CONFIG } from "@/config/economy";
import type { TaskBoard } from "@/modules/tasks/board";

/** 代号 → 角色名 (名称解析出的 roleCode 是代号, 需还原为角色名) */
function roleFromCode(code: string): SpawnRole | undefined {
	const entry = Object.entries(ROLE_CODES).find(([, candidate]) => candidate === code);
	if (!entry) {
		return undefined;
	}
	const roleName = entry[0];
	return isSpawnRole(roleName) ? roleName : undefined;
}

/** 任务类型 → 生产角色 */
function roleForTaskKind(kind: string): SpawnRole | undefined {
	switch (kind) {
		case "harvest":
			return "harvester";
		case "upgrade":
			return "upgrader";
		case "build":
		case "repair":
			return "worker";
		case "fill_spawn":
		case "haul":
			return "carrier";
		case "defend":
			return "defender";
		default:
			return undefined;
	}
}

interface SpawnRequest {
	role: SpawnRole;
	priority: number;
	purpose: string;
}

/** 各角色的目标编制基线 (Phase 3 单房间; 运力乘数/升级加成由经济模型诊断给出;
 *  defender 编制 = 威胁分级映射, 和平为 0 不养常备军) */
function roleTargets(ctx: TickContext): Record<SpawnRole, number> {
	const world = ctx.world.current;
	const sources = world
		? Object.values(world.rooms).reduce((sum, room) => sum + room.sources.length, 0)
		: 0;
	return {
		harvester: Math.max(1, sources),
		universal: 1,
		upgrader: 1,
		worker: 1,
		carrier: 1,
		defender: STAFFING_CONFIG.tierDefenders[threatTierOf(maxThreatScore(ctx.memory))],
	};
}

/** 诊断调整后的有效编制: carrier 乘运力乘数, upgrader 加产能过剩转移 */
function effectiveTarget(ctx: TickContext, role: SpawnRole): number {
	const base = roleTargets(ctx)[role];
	const diagnosis = ctx.memory.economy.diagnosis;
	if (role === "carrier") {
		return Math.max(
			1,
			Math.min(ECONOMY_MODEL_CONFIG.carrierMultiplierMax, Math.round(base * diagnosis.carrierMultiplier)),
		);
	}
	if (role === "upgrader") {
		return base + diagnosis.upgraderBonus;
	}
	return base;
}

/**
 * 替补提前量 (docs/nexus-design/07 §7.5): 生产时间 + 实测路程 P95 + 安全余量, 按单位名确定性抖动 ±jitterRatio
 * (bugs/P2-8: 同龄单位同拍进入替补窗口会成对孵化, 抖动使其错峰)。
 */
function replacementLead(ctx: TickContext, role: SpawnRole, roomName: string, creepName: string): number {
	const base = typicalSpawnTime(role) + travelP95(ctx, role, roomName) + REPLACEMENT_CONFIG.setupMargin;
	return Math.round(base * (1 + nameJitter(creepName)));
}

/** 名称哈希 → [-jitterRatio, +jitterRatio] 的确定性偏移 (同名恒定, 不引入随机源) */
function nameJitter(creepName: string): number {
	let hash = 0;
	for (let i = 0; i < creepName.length; i += 1) {
		hash = (hash * 31 + creepName.charCodeAt(i)) | 0;
	}
	const unit = (Math.abs(hash) % 1000) / 1000; // 0..1
	return (unit * 2 - 1) * REPLACEMENT_CONFIG.jitterRatio;
}

export function runSpawnDirector(ctx: TickContext, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}

	// 死亡回收: 清理单位记录 (租约由 reconcile 释放, 替补由缺口重算生效)
	for (const dead of ctx.world.dead) {
		delete ctx.memory.units[dead];
		// Memory.creeps 是引擎侧独立表, 不随 units 清理会随 4wt 重开无界累积 (bugs/P1-6)
		const engineCreeps = (typeof Memory !== "undefined" ? Memory : undefined) as
			| { creeps?: Record<string, unknown> }
			| undefined;
		if (engineCreeps?.creeps) {
			delete engineCreeps.creeps[dead];
		}
	}

	const spawns = Object.values(Game.spawns);
	if (spawns.length === 0) {
		return;
	}

	// 存活/在途角色计数
	const aliveRoles = new Map<string, number>();
	let aliveTotal = 0;
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			aliveRoles.set(creep.roleCode, (aliveRoles.get(creep.roleCode) ?? 0) + 1);
			aliveTotal += 1;
		}
	}
	const inflightRoles = new Map<string, number>();
	for (const spawn of spawns) {
		const name = spawn.spawning?.name;
		const role = name ? ctx.memory.units[name]?.roleCode : undefined;
		if (role) {
			inflightRoles.set(role, (inflightRoles.get(role) ?? 0) + 1);
		}
	}
	const staffed = (role: string): number =>
		(aliveRoles.get(roleCode(role)) ?? 0) + (inflightRoles.get(role) ?? 0);

	// 战略指令 (设计 D5): survive 姿态暂停非关键岗位的新排 (缺口与替补均停),
	// carrier/harvester 与从零起步的 bootstrap 不受影响; 不做身体缩水 (避免与替补窗口耦合)
	const pauseRoles = ctx.directive().posture === "survive" ? STRATEGY_CONFIG.surviveSpawnPauseRoles : [];

	// 缺口聚合: 未分配任务 → 角色请求
	const requests = new Map<SpawnRole, SpawnRequest>();
	const addRequest = (role: SpawnRole, priority: number, purpose: string): void => {
		if (pauseRoles.includes(role)) {
			return;
		}
		const existing = requests.get(role);
		if (!existing || priority > existing.priority) {
			requests.set(role, { role, priority, purpose });
		}
	};

	if (aliveTotal === 0) {
		// 从零起步: 先造万能单位跑通闭环
		addRequest("universal", 100, "bootstrap");
	} else {
		// 常驻编制缺口 (bugs/P1-5): harvester/upgrader 的岗位与任务 available 状态解耦——
		// 任务被租住或处于失败冷却期时缺口仍可见, 否则岗位长期空转
		for (const roleName of SPAWN_CONFIG.standingRoles) {
			if (!isSpawnRole(roleName)) {
				continue;
			}
			if (staffed(roleName) < effectiveTarget(ctx, roleName)) {
				addRequest(roleName, SPAWN_CONFIG.standingPriority, `staffing:${roleName}`);
			}
		}
		for (const task of board.list({ statuses: ["available"] })) {
			const role = roleForTaskKind(task.kind);
			if (role && staffed(role) < effectiveTarget(ctx, role)) {
				addRequest(role, task.priority, role);
			}
		}
		// 替补窗口 (docs/nexus-design/07 §7.5): TTL 低于 lead = 生产 + 实测路程 P95 + 余量 时提前补位;
		// 关键岗位允许短暂在编重叠 (staffed ≤ target), 廉价岗位严格不超编 (staffed < target)
		for (const room of Object.values(world.rooms)) {
			for (const creep of room.creeps) {
				const role = roleFromCode(creep.roleCode);
				if (!role) {
					continue;
				}
				if (creep.ticksToLive >= replacementLead(ctx, role, room.roomName, creep.name)) {
					continue;
				}
				const target = effectiveTarget(ctx, role);
				const overlapping = REPLACEMENT_CONFIG.keyRoles.includes(role)
					? staffed(role) <= target
					: staffed(role) < target;
				if (overlapping) {
					addRequest(role, 60, `replacement:${role}`);
				}
			}
		}
	}

	if (requests.size === 0) {
		return;
	}

	const ordered = [...requests.values()].sort((a, b) => b.priority - a.priority);
	for (const spawn of spawns) {
		if (spawn.spawning) {
			continue;
		}
		const budget = spawn.room.energyAvailable;
		const request = ordered.find((r) => buildBody(r.role, budget) !== null);
		if (!request) {
			// 能量不足以生产任何请求: 等待积累, 计入跳过指标
			ctx.cpu.recordSkip("spawn-director", "budget");
			continue;
		}
		const body = buildBody(request.role, budget);
		if (!body) {
			continue;
		}
		// defender 生产能源经共享账本预留 (specs/combat-spawning): 失败等待, 不与搬运承诺重复花销
		let reservationId: string | null = null;
		if (request.role === "defender") {
			reservationId = reserve(ctx, {
				owner: `spawn-request:${request.role}:${ctx.tick}`,
				roomName: spawn.room.name,
				amount: bodyCost(body),
			});
			if (!reservationId) {
				ctx.cpu.recordSkip("spawn-director", "budget");
				continue;
			}
		}
		const name = generateCreepName(request.role, {
			random: Math.random,
			exists: (candidate) => candidate in Game.creeps,
		});
		const code = spawn.spawnCreep(body, name, {
			memory: { role: request.role, homeRoom: spawn.room.name },
		});
		if (code === OK) {
			ctx.memory.units[name] = {
				name,
				roleCode: request.role,
				homeRoom: spawn.room.name,
				bornAt: ctx.tick,
				lastTaskChange: ctx.tick,
			};
			if (reservationId) {
				commitReservation(ctx, reservationId, bodyCost(body));
			}
			ctx.logger.info(`生产 ${name} (${request.purpose}, ${body.length} 部件)`);
		} else {
			if (reservationId) {
				releaseReservation(ctx, reservationId, "spawn-failed");
			}
			ctx.logger.warn(`spawn.${code}`, `生产 ${request.role} 失败: ${code}`);
		}
	}
}
