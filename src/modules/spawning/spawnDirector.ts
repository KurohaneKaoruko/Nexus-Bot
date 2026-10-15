/**
 * SpawnDirector (docs/nexus-design/07 / api/07 §7.5):
 * 从「无法分配的任务」聚合能力缺口 → 生产请求 → BodyFactory 出身体 → 排程提交。
 * 无状态: 每 Tick 由存活/在途/任务重新计算缺口;
 * 替补窗口实装 (§7.5): lead = 生产时间 + 实测路程 P95 + 余量, 关键岗位允许短暂重叠;
 * Creep 死亡后回收 UnitRecord, 租约由任务对账释放。
 */
import type { TickContext } from "@/core";
import { directiveFor } from "@/modules/strategy";
import { downgradeEmergency } from "@/core/world";
import { STRATEGY_CONFIG } from "@/config/strategy";
import { STAFFING_CONFIG } from "@/config/defense";
import { UNIT_CODES, unitCode } from "@/constant/UnitConstant";
import { UnitData } from "@/constant/CreepConstant";
import { generateCreepName } from "@/utils/naming";
import { createTaskBoard } from "@/modules/tasks";
import { activeRemoteHarvestCount, activeScoutCount } from "@/modules/economy/remoteMining";
import {
	bodyCost,
	buildBody,
	isSpawnUnit,
	typicalSpawnTime,
	type SpawnUnit,
} from "@/modules/spawning/bodyFactory";
import { travelP95, commitReservation, releaseReservation, reserve } from "@/modules/economy";
import { takeCourierRequests } from "@/core/store/runtime";
import { maxThreatScore, threatTierOf } from "@/modules/defense";
import {
	CARRY_STAFFING_CONFIG,
	CONTROLLER_BUFFER_CONFIG,
	PRODUCTION_GATE_CONFIG,
	REPLACEMENT_CONFIG,
	RELAY_CONFIG,
	SPAWN_CONFIG,
} from "@/config/economy";
import {
	carrierCountTargetOf,
	upgraderCountTargetOf,
	isProductionSecured,
} from "@/modules/economy";
import { rushBodyWork } from "@/utils/rushBodies";
import { isSlowTerrain, terrainProfileFor } from "@/modules/spawning/terrainProfile";
import type { TaskBoard } from "@/modules/tasks";

/** 代号 → 角色名 (名称解析出的 unitCode 是代号, 需还原为角色名) */
function roleFromCode(code: string): SpawnUnit | undefined {
	const entry = Object.entries(UNIT_CODES).find(([, candidate]) => candidate === code);
	if (!entry) {
		return undefined;
	}
	const unitName = entry[0];
	return isSpawnUnit(unitName) ? unitName : undefined;
}

/** 任务类型 → 生产角色 */
function unitForTaskKind(kind: string): SpawnUnit | undefined {
	switch (kind) {
		case "harvest":
			return "harvester";
		case "upgrade":
			return "upgrader";
		case "build":
		case "repair":
			return "worker";
		case "claim":
			return "universal"; // 全能体带 CLAIM 部件执行占领
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
	unit: SpawnUnit;
	priority: number;
	purpose: string;
	/** 快递等按请求给定预算编译的角色 (缺省走容量/存量定档) */
	budget?: number;
}

/**
 * 各角色的目标编制基线 (specs/workforce-staffing 吞吐定编):
 * - upgrader: WORK 口径目标 (采集收入×档位倍率, 水位收缩/盈余/pile 取 max, 受饥饿
 *   负反馈与人口硬上限钳制) 按当前孵化体型折只——取代固定只数/produced EMA 口径;
 * - carrier: 运力下界 Σ(2×实测路程×速率)×冗余÷单件运力 (实测缺失回退每源 1 只);
 * - harvester/worker 等维持 count 基线 (采集饱和由攒能升体型承接, 建造定编留步 3 后评估)。
 * defender 编制 = 威胁分级映射, 和平为 0 不养常备军。
 */
function unitTargets(ctx: TickContext): Record<SpawnUnit, number> {
	const world = ctx.world.current;
	const rooms = world ? Object.values(world.rooms) : [];
	const sources = rooms.reduce((sum, room) => sum + room.sources.length, 0);
	const sites = rooms.reduce((sum, room) => sum + room.sites.length, 0);
	// 外矿同名-unit 定编: 远程 harvest 任务每源 +1 harvester; scout 按活跃侦查任务
	const board = createTaskBoard(ctx.memory.tasks);
	const remoteHarvest = activeRemoteHarvestCount(ctx, board);
	const scoutNeed = activeScoutCount(ctx, board);
	let upgraderNeed = 0;
	let carrierNeed = 0;
	for (const room of rooms) {
		upgraderNeed += upgraderCountTargetOf(ctx, room);
		// 路程未实测 (开局) 回退每源 1 只保守基线, 不按猜测路程编队
		carrierNeed += carrierCountTargetOf(ctx, room) ?? room.sources.length;
	}
	return {
		harvester: Math.max(1, sources + remoteHarvest),
		scout: scoutNeed,
		universal: 1,
		upgrader: Math.max(1, upgraderNeed),
		worker: Math.max(
			1,
			Math.min(
				SPAWN_CONFIG.workers.max,
				1 + Math.floor(sites / SPAWN_CONFIG.workers.sitesPerWorker),
			),
		),
		carrier: Math.max(1, carrierNeed),
		"rush-courier": 0,
		// 特化单位: 结构到位才激活 (RCL 门控短路, 避免低 RCL 每帧遍历)
		manager: rooms.some((r) => r.rcl >= 4 && r.stores.some((s) => s.structureType === "storage")) ? 1 : 0,
		transporter: rooms.some((r) => r.rcl >= 3 && r.sites.length > 0) ? 1 : 0,
		miner: rooms.some((r) => r.rcl >= 6 && r.stores.some((s) => s.structureType === "container")) ? 1 : 0,
		defender: STAFFING_CONFIG.tierDefenders[threatTierOf(maxThreatScore(ctx.memory))],
		// 扩张占领件: 活跃 claim 任务时 1 只 (任务消失编制即收)
		claimer: board.list({ kinds: ["claim"] }).some((t) => t.status !== "completed") ? 1 : 0,
	};
}

/** 诊断调整后的有效编制: carrier 乘运力乘数 (吞吐目标已由 workforce 现算, 不再有第二公式) */
function effectiveTarget(ctx: TickContext, unit: SpawnUnit): number {
	const base = unitTargets(ctx)[unit];
	const diagnosis = ctx.memory.economy.diagnosis;
	if (unit === "carrier") {
		const multiplierTarget = Math.round(base * diagnosis.carrierMultiplier);
		const rclCap = Math.min(
			CARRY_STAFFING_CONFIG.maxCarriers,
			CARRY_STAFFING_CONFIG.carriersPerRcl * Math.max(1, topRcl(ctx)),
		);
		return Math.max(CARRY_STAFFING_CONFIG.minCarriers, Math.min(rclCap, multiplierTarget));
	}
	if (unit === "upgrader") {
		return base + diagnosis.upgraderBonus;
	}
	return base;
}

/** 己方房最高 RCL */
function topRcl(ctx: TickContext): number {
	let rcl = 0;
	for (const room of Object.values(ctx.world.current?.rooms ?? {})) {
		rcl = Math.max(rcl, room.rcl);
	}
	return rcl;
}

/**
 * cc 水位门: 存量 < 在座升级 WORK×2×缓冲 tick 时为 true。
 * 多房语义: 任一有 cc 的房低于水位即暂停升级体孵化 (保守口径, 修复旧实现
 * 首个有 cc 房即 return 的单房短路)。
 */
function ccBelowSpawnGate(ctx: TickContext): boolean {
	const world = ctx.world.current;
	if (!world) {
		return false;
	}
	const capacity = Math.max(300, ...Object.values(Game.spawns).map(
		(spawn) => spawn.room.energyCapacityAvailable,
	));
	const upgradeWork = rushBodyWork(buildBody("upgrader", capacity) ?? []);
	let anyBelow = false;
	for (const room of Object.values(world.rooms)) {
		const buffer = room.controllerBuffer;
		if (!buffer) {
			continue;
		}
		const store = room.stores.find((s) => s.id === buffer.id);
		if (store && store.energy < upgradeWork * 2 * CONTROLLER_BUFFER_CONFIG.spawnGateBufferTicks) {
			anyBelow = true;
		}
	}
	return anyBelow;
}

/**
 * 替补提前量 (docs/nexus-design/07 §7.5): 生产时间 + 实测路程 P95 + 安全余量, 按单位名确定性抖动 ±jitterRatio
 * (bugs/P2-8: 同龄单位同拍进入替补窗口会成对孵化, 抖动使其错峰)。
 */
function replacementLead(
	ctx: TickContext,
	unit: SpawnUnit,
	roomName: string,
	creepName: string,
): number {
	const base =
		typicalSpawnTime(unit) + travelP95(ctx, unit, roomName) + REPLACEMENT_CONFIG.setupMargin;
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
	/** spawn 空闲起算 tick (攒能等待超时兜底): 跨 Tick 持久化, 修复每 Tick 重建
	 *  使 capacityWaitTicks 超时永不触发的死代码 (specs/workforce-staffing 顺手修) */
	const spawnIdleSince = ctx.memory.spawn.idleSince ?? {};
	for (const id of Object.keys(spawnIdleSince)) {
		if (!(id in Game.spawns)) {
			delete spawnIdleSince[id];
		}
	}
	ctx.memory.spawn.idleSince = spawnIdleSince;

	// 存活/在途角色计数
	const aliveRoles = new Map<string, number>();
	let aliveTotal = 0;
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			aliveRoles.set(creep.unitCode, (aliveRoles.get(creep.unitCode) ?? 0) + 1);
			aliveTotal += 1;
		}
	}
	const inflightRoles = new Map<string, number>();
	for (const spawn of spawns) {
		const name = spawn.spawning?.name;
		const unit = name ? ctx.memory.units[name]?.unitCode : undefined;
		if (unit) {
			inflightRoles.set(unit, (inflightRoles.get(unit) ?? 0) + 1);
		}
	}
	const staffed = (unit: string): number =>
		(aliveRoles.get(unitCode(unit)) ?? 0) + (inflightRoles.get(unit) ?? 0);

	// 战略指令 (设计 D5): survive 姿态暂停非关键岗位的新排 (缺口与替补均停),
	// carrier/harvester 与从零起步的 bootstrap 不受影响; 不做身体缩水 (避免与替补窗口耦合);
	// 降级紧急时 upgrader 豁免暂停名单 (bugs/P1-10: 保升级岗位不断供, 宁可挤占也要保级)
	const downgradeActive = Object.values(world.rooms).some((room) =>
		downgradeEmergency(room.controller),
	);
	const pauseRoles =
		directiveFor(ctx).posture === "survive"
			? STRATEGY_CONFIG.surviveSpawnPauseRoles.filter(
					(unit) => unit !== "upgrader" || !downgradeActive,
				)
			: [];

	// 缺口聚合: 未分配任务 → 角色请求
	const requests = new Map<SpawnUnit, SpawnRequest>();
	const addRequest = (unit: SpawnUnit, priority: number, purpose: string): void => {
		if (pauseRoles.includes(unit)) {
			return;
		}
		const existing = requests.get(unit);
		if (!existing || priority > existing.priority) {
			requests.set(unit, { unit, priority, purpose });
		}
	};

	// bootstrap 簿记复位 (bugs/P1-10): 任一己方房可见即清零, 恢复即时生效
	const spawnState = ctx.memory.spawn;
	if (
		Object.keys(world.rooms).length > 0 &&
		(spawnState.bootstrapCount !== 0 || spawnState.lastBootstrapTick !== 0)
	) {
		spawnState.bootstrapCount = 0;
		spawnState.lastBootstrapTick = 0;
	}

	if (aliveTotal === 0) {
		// 从零起步: 先造万能单位跑通闭环;
		// 失明态连续空转超限后降频告警 (bugs/P1-10: 防 universal churn 耗尽能量)
		const throttled =
			spawnState.bootstrapCount > SPAWN_CONFIG.bootstrap.maxConsecutive &&
			ctx.tick - spawnState.lastBootstrapTick < SPAWN_CONFIG.bootstrap.throttleInterval;
		if (throttled) {
			ctx.cpu.recordSkip("spawn-director", "bootstrap-loop");
			ctx.logger.warn(
				"spawn-bootstrap-loop",
				`无可见房连续 bootstrap ${spawnState.bootstrapCount} 次, 降频等待恢复`,
			);
		} else {
			spawnState.bootstrapCount += 1;
			spawnState.lastBootstrapTick = ctx.tick;
			addRequest("universal", 100, "bootstrap");
		}
	} else {
		// 常驻编制缺口 (bugs/P1-5): harvester/upgrader/carrier 的岗位与任务 available 状态解耦——
		// 任务被租住或处于失败冷却期时缺口仍可见, 否则岗位长期空转;
		// carrier 可按角色覆盖优先级 (物流骨干不被任务驱动请求永久压队)
		for (const unitName of SPAWN_CONFIG.standingRoles) {
			if (!isSpawnUnit(unitName)) {
				continue;
			}
			// 水位门: cc 存量低于升级抽水缓冲时暂停升级体孵化, 孵化槽让位物流
			if (unitName === "upgrader" && !downgradeActive && ccBelowSpawnGate(ctx)) {
				continue;
			}
			if (staffed(unitName) < effectiveTarget(ctx, unitName)) {
				const priority =
					SPAWN_CONFIG.standingPriorityByRole[unitName] ?? SPAWN_CONFIG.standingPriority;
				addRequest(unitName, priority, `staffing:${unitName}`);
			}
		}
		for (const task of board.list({ statuses: ["available"] })) {
			const unit = unitForTaskKind(task.kind);
			if (unit && staffed(unit) < effectiveTarget(ctx, unit)) {
				addRequest(unit, task.priority, unit);
			}
		}
		// 替补窗口 (docs/nexus-design/07 §7.5): TTL 低于 lead = 生产 + 实测路程 P95 + 余量 时提前补位;
		// 关键岗位允许短暂在编重叠 (staffed ≤ target), 廉价岗位严格不超编 (staffed < target)
		for (const room of Object.values(world.rooms)) {
			for (const creep of room.creeps) {
				const unit = roleFromCode(creep.unitCode);
				if (!unit) {
					continue;
				}
				if (creep.ticksToLive >= replacementLead(ctx, unit, room.roomName, creep.name)) {
					continue;
				}
				const target = effectiveTarget(ctx, unit);
				const overlapping = REPLACEMENT_CONFIG.keyRoles.includes(unit)
					? staffed(unit) <= target
					: staffed(unit) < target;
				if (overlapping) {
					addRequest(unit, 60, `replacement:${unit}`);
				}
			}
		}
	}

	// 拉能快递 (specs/rush-courier): 消费 planning 阶段过五闸门的需求,
	// 优先级最低 (40) —— 任何基础编制/任务/替补请求都排在前面
	for (const courier of takeCourierRequests()) {
		if (courier.roomName in world.rooms) {
			requests.set("rush-courier", {
				unit: "rush-courier",
				priority: courier.priority,
				purpose: courier.reason,
				budget: courier.budget,
			});
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
		// 产出就绪闸 (specs/production-readiness-gate): 本房采集面未铺满时,
		// ① 起步序列闸——只受理采集面/生存角色; ② 搬运开局闸——在岗搬运体
		// 不得超过采集面规模 (防「3 搬运 : 1 矿工」倒挂吃光孵化槽)
		const spawnRoom = world.rooms[spawn.room.name];
		const secured = spawnRoom ? isProductionSecured(ctx, spawnRoom) : true;
		const gateAllows = (unit: SpawnUnit): boolean => {
			if (secured) {
				return true;
			}
			if (unit === "carrier") {
				return staffed("carrier") < Math.max(1, staffed("harvester"));
			}
			return PRODUCTION_GATE_CONFIG.unsecuredAllowedRoles.includes(unit);
		};
		const gated = ordered.filter((r) => gateAllows(r.unit));
		// 体型按容量定档 (energyCapacityAvailable), 攒能等待: 涓流经济下按瞬时存量定档
		// 会永远困在最小体型 (sim 实证: 5 万 tick 仍 3 部件);
		// 高优先请求 (bootstrap/应急) 例外——按现有能量立即生产, 保开局速度;
		// 等待超时兜底: 存量长期攒不满期望体型时退回按存量降档, 防编制空转。
		// 地形档 (specs/adaptive-body-factory): 本房沼泽密度高且路网未达标 → move 配比上调。
		// 注: 冲级窗口不强制 harvester 带 CARRY——sim 实证 RCL2 档 (550 容量) 强制 carry
		// 会 -1 WORK 且把源能量导向 ext/spawn 而非 cc 升级链, 升级总量 17658→4614 恶化;
		// 直供泵的 carry 前提由生成器的 1-CARRY 下限自然满足 (预算 ≥650 即 RCL3 起)
		const hints = {
			slowTerrain: isSlowTerrain(terrainProfileFor(spawn.room.name, ctx.tick)),
			// 接力期档 (specs/relay-hauling): RCL < 等级门用微型接力件, 达门大件直运
			relayCarrier: (spawn.room.controller?.level ?? 0) < RELAY_CONFIG.maxRcl,
			directCarrier: (spawn.room.controller?.level ?? 0) >= RELAY_CONFIG.maxRcl,
		};
		const capacity = spawn.room.energyCapacityAvailable;
		const available = spawn.room.energyAvailable;
		const idleSince = spawnIdleSince[spawn.id] ?? ctx.tick;
		const urgent = gated.find(
			(r) =>
				r.priority >= SPAWN_CONFIG.immediatePriority &&
				(!SPAWN_CONFIG.capacityWaitRoles.includes(r.unit) ||
					// 采集面归零时立即小体复产 (自举通道): 攒能等待的前提是有收入,
					// 矿工全灭后等待只会让能量归零死锁 (50k 普查: 0 harvester 存活实锤)
					(r.unit === "harvester" && staffed("harvester") === 0)) &&
				buildBody(r.unit, r.budget ?? available, hints) !== null,
		);
		let body: BodyPartConstant[] | null = null;
		let request: SpawnRequest | undefined;
		if (urgent) {
			request = urgent;
			body = buildBody(urgent.unit, urgent.budget ?? available, hints);
		} else {
			request = gated.find((r) => buildBody(r.unit, r.budget ?? capacity, hints) !== null);
			if (request) {
				const desired = buildBody(request.unit, request.budget ?? capacity, hints);
				if (desired && bodyCost(desired) > available) {
					// 期望体型未攒够: 等待 (超时后退回按存量降档); 攒能角色用短窗——
					// replacement 提前量 (~200t) 撑不住长等待, 换代断采是净损失 (50k 实测);
					// 替补用途的等待另受换代窗口钳制 (提前量量级), 老单位死前必出新人
					const waitLimit = request.purpose.startsWith("replacement:")
						? Math.min(SPAWN_CONFIG.capacityWaitTicks, SPAWN_CONFIG.replacementWaitTicks)
						: SPAWN_CONFIG.capacityWaitRoles.includes(request.unit)
							? Math.min(SPAWN_CONFIG.capacityWaitTicks, SPAWN_CONFIG.capacityWaitTicksShort)
							: SPAWN_CONFIG.capacityWaitTicks;
					if (ctx.tick - idleSince < waitLimit) {
						spawnIdleSince[spawn.id] = idleSince;
						ctx.cpu.recordSkip("spawn-director", "budget");
						continue;
					}
					body = buildBody(request.unit, request.budget ?? available, hints);
				} else {
					body = desired;
				}
			}
		}
		if (!request || !body) {
			// 能量不足以生产任何请求: 等待积累, 计入跳过指标
			spawnIdleSince[spawn.id] = idleSince;
			ctx.cpu.recordSkip("spawn-director", "budget");
			continue;
		}
		delete spawnIdleSince[spawn.id];
		// defender 生产能源经共享账本预留 (specs/combat-spawning): 失败等待, 不与搬运承诺重复花销
		let reservationId: string | null = null;
		if (request.unit === "defender") {
			reservationId = reserve(ctx, {
				owner: `spawn-request:${request.unit}:${ctx.tick}`,
				roomName: spawn.room.name,
				amount: bodyCost(body),
			});
			if (!reservationId) {
				ctx.cpu.recordSkip("spawn-director", "budget");
				continue;
			}
		}
		const name = generateCreepName(request.unit, {
			random: Math.random,
			exists: (candidate) => candidate in Game.creeps,
		});
		const code = spawn.spawnCreep(body, name, {
			memory: { unit: request.unit, homeRoom: spawn.room.name },
		});
		if (code === OK) {
			ctx.memory.units[name] = {
				name,
				unitCode: request.unit,
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
			ctx.logger.warn(`spawn.${code}`, `生产 ${request.unit} 失败: ${code}`);
		}
	}
}

// ==================== 直接孵化 (编队/扩张/援助/控制台) ====================

/**
 * 直接孵化接口: 绕过任务板/池, 按角色默认体型或显式体型立即下蛋。
 * 用于编队 (TeamSpawner)/扩张 (ExpandController)/pc 陪护/控制台——
 * 一次性/指令式孵化语义, 不参与定编与预算竞争。
 * @returns spawnCreep 返回码 (OK=0 为成功)
 */
export function directSpawn(
	room: Room,
	unit: string,
	memory: Record<string, unknown>,
	body?: BodyPartConstant[],
	namePrefix?: string,
): number {
	const spawns = room.find(FIND_MY_SPAWNS);
	const spawn = spawns.find((s) => !s.spawning);
	if (!spawn) return ERR_BUSY;
	const config = (UnitData as unknown as Record<string, { level: number; code?: string }>)[unit];
	if (!config) {
		return ERR_INVALID_ARGS;
	}
	const bodyFinal = body ?? (room as any).GenerateBodys?.((room as any).GetUnitBodys?.(unit, undefined, undefined), unit);
	if (!bodyFinal?.length) return ERR_NOT_ENOUGH_RESOURCES;
	const mem = { ...memory, unit, cache: {} } as CreepMemory;
	return spawn.spawnCreep(bodyFinal, generateCreepName(String(namePrefix ?? config.code ?? unit), { random: Math.random, exists: (n) => n in Game.creeps }), { memory: mem });
}
