/**
 * 经济系统规划器 (docs/nexus-design/06 §6.2–6.4 / docs/nexus-design/02 原则 B 局部层): 把房间观测转成任务。
 * 行为兼容保证: dedupe key / 取消语义 / 账本预留语义不变;
 * 指令生效 (设计 D5): 任务基础优先级叠加姿态偏置;
 * survive 且库存低于储备下限时 upgrade/build 暂停新建, 既有任务降权保持存活。
 * 规划器是纯函数: upsert 意图 (dedupeKey 幂等) + cancel 消失的主体;
 * 优先级政策: fill_spawn > harvest > haul > build > upgrade (docs/nexus-design/06 §6.2)。
 * haul 走配额 (§6.4): 货源+目的地+批量明确, 在途承诺入账本, 空缺即终结改派。
 */
import {
	BUILD_PRIORITY_BONUS,
	CONTROLLER_BUFFER_CONFIG,
	DOWNGRADE_CONFIG,
	HAUL_CONFIG,
	SPAWN_CONFIG,
} from "@/config/economy";
import { STRATEGY_CONFIG } from "@/config/strategy";
import { directiveFor, roomModeProfileFor } from "@/modules/strategy";
import type { TickContext } from "@/core";
import { downgradeEmergency, type RoomObservation } from "@/core/world";
import { priorityFor, type NewTaskInput, type TaskKind } from "@/core/store/taskSchema";
import type { TaskBoard } from "@/modules/tasks";
import { destinationQuotas, pickDestination, roundTripEstimate } from "@/modules/economy/quota";
import { createLedger, reserve } from "@/modules/economy/ledger";
import { worksiteFor } from "@/modules/world";
import { controllerCarryQuotaOf } from "@/modules/economy/workforce";
import { UNIT_CODES } from "@/constant/UnitConstant";

const PLANNED_KINDS: TaskKind[] = ["harvest", "haul", "fill_spawn", "upgrade", "build"];

/**
 * 无 cc 期升级工位枚举 (bugs/P1-14 派发段): 控制器射程 (3) 内、距控制器 ≥2 的
 * 环带可站位格 (非墙/无结构阻挡, 感知层 structureBlocked 口径的近似——用 sites+stores 判占)。
 * 与 cc slots 同构: 固定顺序枚举取前 wanted 格, 工位任务 i ↔ 枚举序 i。
 * 地形墙不可站——planner 运行在 commit 阶段, 可直接读 Game.rooms 原生地形。
 */
function controllerWorkSlots(
	room: RoomObservation,
	wanted: number,
): Array<{ x: number; y: number }> {
	const controller = room.controller;
	if (!controller) {
		return [];
	}
	const roomObj = Game.rooms[room.roomName];
	const terrain = roomObj?.getTerrain();
	const blocked = new Set<string>();
	for (const site of room.sites) {
		blocked.add(`${site.x},${site.y}`);
	}
	for (const store of room.stores) {
		blocked.add(`${store.x},${store.y}`);
	}
	for (const structure of room.energyStructures) {
		blocked.add(`${structure.x},${structure.y}`);
	}
	const slots: Array<{ x: number; y: number }> = [];
	for (let dy = -3; dy <= 3; dy += 1) {
		for (let dx = -3; dx <= 3; dx += 1) {
			const cheb = Math.max(Math.abs(dx), Math.abs(dy));
			// 内环 (cheb ≤ 1) 保留给控制器本体与 cc 落位; 外环射程边沿留给交通
			if (cheb < 2 || cheb > 3) {
				continue;
			}
			const x = controller.x + dx;
			const y = controller.y + dy;
			if (x < 0 || x > 49 || y < 0 || y > 49) {
				continue;
			}
			if (blocked.has(`${x},${y}`)) {
				continue;
			}
			if (terrain !== undefined && (terrain.get(x, y) & TERRAIN_MASK_WALL) !== 0) {
				continue;
			}
			slots.push({ x, y });
			if (slots.length >= wanted) {
				return slots;
			}
		}
	}
	return slots;
}

/** 节流期保持既有任务存活: 不新建, 仅以压制优先级合并更新 (防「暂停即取消」抖动) */
function sustainSuppressed(
	board: TaskBoard,
	roomName: string,
	kind: "upgrade" | "build",
	dedupeKey: string,
	input: NewTaskInput,
	expected: Set<string>,
	now: number,
): void {
	const alive = board
		.list({ roomName, kinds: [kind] })
		.some(
			(task) =>
				task.dedupeKey === dedupeKey &&
				task.status !== "completed" &&
				task.status !== "cancelled" &&
				task.status !== "failed",
		);
	if (!alive) {
		return;
	}
	board.upsert(input, now);
	expected.add(dedupeKey);
}

/** 规划单房间: 读快照与当 Tick 战略指令 → 任务 upsert + 账本预留 */
export function planEconomyRoom(ctx: TickContext, board: TaskBoard, room: RoomObservation): void {
	const directive = directiveFor(ctx);
	const bias = (kind: TaskKind): number => directive.kindBias[kind] ?? 0;
	const expected = new Set<string>();
	const intel = ctx.memory.rooms[room.roomName];

	// harvest: 每 Source 一个稳定任务, 工作位可用才生成 (容量语义 = 相邻可行走格数, 持有数由租约约束)
	for (const source of room.sources) {
		const worksite = intel ? worksiteFor(intel, room, source) : undefined;
		if (!worksite) {
			continue;
		}
		const dedupeKey = `harvest:${room.roomName}:${source.id}`;
		expected.add(dedupeKey);
		board.upsert(
			{
				dedupeKey,
				kind: "harvest",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: { x: source.x, y: source.y, roomName: room.roomName },
				priority: priorityFor("harvest") + bias("harvest"),
				requiredCapabilities: ["work", "move"],
			},
			ctx.tick,
		);
	}

	// upgrade: 控制器缓冲存在 → 每个就位工位一条任务 (工位任务 i ↔ slots[i], specs/controller-upgrade-buffer),
	// 持有者驻工位 withdraw cc + upgrade 原地完成; 无 cc → 每房间一条常驻任务 (既有链路);
	// 要求 carry (无 carry 的 harvester 取料必然 ERR_FULL, bugs/P0-2);
	// 节流期不新建、既有降权存活; 降级紧急时提权至抢占线之上且豁免节流与偏置 (bugs/P1-10: survive 不得压制保级)
	const modeProfile = roomModeProfileFor(ctx, room.roomName);
	if (room.controller) {
		const controller = room.controller;
		const emergency = downgradeEmergency(controller);
		const modeBias =
			modeProfile.upgradeBias && room.rcl <= modeProfile.upgradeBias.belowRcl
				? modeProfile.upgradeBias.amount
				: 0;
		const emitUpgrade = (dedupeKey: string, pos: { x: number; y: number }): void => {
			const input: NewTaskInput = {
				dedupeKey,
				kind: "upgrade",
				roomName: room.roomName,
				targetId: controller.id,
				targetPos: { x: pos.x, y: pos.y, roomName: room.roomName },
				priority: emergency
					? DOWNGRADE_CONFIG.upgradePriority
					: priorityFor("upgrade") + bias("upgrade") + modeBias,
				requiredCapabilities: ["work", "carry", "move"],
			};
			if (emergency) {
				expected.add(dedupeKey);
				board.upsert(input, ctx.tick);
			} else if (directive.suppressUpgradeBuild) {
				input.priority -= STRATEGY_CONFIG.suppressPenalty;
				sustainSuppressed(board, room.roomName, "upgrade", dedupeKey, input, expected, ctx.tick);
			} else {
				expected.add(dedupeKey);
				board.upsert(input, ctx.tick);
			}
		};
		const buffer = room.controllerBuffer;
		if (buffer && buffer.slots.length > 0) {
			const slots = buffer.slots.slice(0, SPAWN_CONFIG.maxUpgradersPerRoom);
			for (const slot of slots) {
				emitUpgrade(`upgrade:${room.roomName}:cc:${slot.x},${slot.y}`, slot);
			}
		} else {
			// 无 cc 多工位 (bugs/P1-14 派发段): cc 缺席时升级容量不再是全房 1 条任务——
			// 按定编只数在控制器射程内环带取可站位格发射工位任务 (与 cc slots 同构,
			// 租约即分配); 工位数取满额 (与经济态解耦), 否则 CRITICAL 收缩时任务
			// 随 wanted 波动 subject-gone 取消重建, 持有者反复易主; cc 建成后自动
			// 切换 cc slots 版本
			const wanted = SPAWN_CONFIG.maxUpgradersPerRoom;
			if (wanted > 1) {
				for (const slot of controllerWorkSlots(room, wanted)) {
					emitUpgrade(`upgrade:${room.roomName}:slot:${slot.x},${slot.y}`, slot);
				}
			} else {
				emitUpgrade(`upgrade:${room.roomName}`, { x: room.controller.x, y: room.controller.y });
			}
		}
	}

	// build: 工地存在才生成; 节流期同 upgrade;
	// cc 工地 (控制器旁容器) 提权——升级直供链路的地基; 按结构加成: 扩容 > 铺装 > 普通
	for (const site of room.sites) {
		const dedupeKey = `build:${room.roomName}:${site.id}`;
		const nearController =
			site.structureType === "container" &&
			room.controller !== undefined &&
			Math.max(Math.abs(site.x - room.controller.x), Math.abs(site.y - room.controller.y)) <=
				CONTROLLER_BUFFER_CONFIG.adoptRange;
		const input: NewTaskInput = {
			dedupeKey,
			kind: "build",
			roomName: room.roomName,
			targetId: site.id,
			targetPos: { x: site.x, y: site.y, roomName: room.roomName },
			priority:
				priorityFor("build") +
				bias("build") +
				(nearController ? CONTROLLER_BUFFER_CONFIG.buildPriorityBonus : 0) +
				(BUILD_PRIORITY_BONUS[site.structureType] ?? 0),
			requiredCapabilities: ["work", "carry", "move"],
		};
		// cc 工地豁免节流 (bugs/P1-14 派发段): 升级直供链路的地基, survive 压制会让
		// cc 建造 (75−20=55) 恒排 ext (70) 之后无限期搁置——地基不成, 供能链永缺前提物
		if (directive.suppressUpgradeBuild && !nearController) {
			input.priority -= STRATEGY_CONFIG.suppressPenalty;
			sustainSuppressed(board, room.roomName, "build", dedupeKey, input, expected, ctx.tick);
		} else {
			expected.add(dedupeKey);
			board.upsert(input, ctx.tick);
		}
	}

	// fill_spawn: 供能结构缺量才生成 (满仓即无任务)——满仓补给是出生引擎的供能
	// (spawnCreep 联合扣能, 池满=出生吞吐), 不按水位截断; 升级工被劫持问题
	// 由分配器的角色匹配加分解决 (不违反能力优先)
	for (const structure of room.energyStructures) {
		if (structure.energy >= structure.energyCapacity) {
			continue;
		}
		const dedupeKey = `fill_spawn:${room.roomName}:${structure.id}`;
		expected.add(dedupeKey);
		board.upsert(
			{
				dedupeKey,
				kind: "fill_spawn",
				roomName: room.roomName,
				targetId: structure.id,
				targetPos: { x: structure.x, y: structure.y, roomName: room.roomName },
				amount: structure.energyCapacity - structure.energy,
				priority: priorityFor("fill_spawn") + bias("fill_spawn"),
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + 200,
			},
			ctx.tick,
		);
	}

	// haul: 配额驱动的资源流 (货源 → 配额目的地), 低于阈值不值得搬运;
	// cc 是升级专用汇 (specs/controller-upgrade-buffer), 不作为搬运货源被抽走;
	// 落地堆货源按「坐标」去重——堆叠 id 随合并/衰减 churn, 按 id 去重会让任务
	// 每 Tick 取消重建, 搬运链路断裂 (bugs/P1-14 根因③)
	const bufferId = room.controllerBuffer?.id;
	const destinations = destinationQuotas(ctx, room, ctx.memory.economy.diagnosis.quotaFloorBias);
	// 控制器专线保留 (specs/controller-supply-line): 空闲搬运力 ≤ 专线只数时,
	// 收紧非 cc 目的地的新 haul 放量——近距孵化/塔请求不得吸干升级供能份额
	const dedicatedCarry = controllerCarryQuotaOf(ctx, room);
	let idleCarriers = room.creeps.filter(
		(creep) => !creep.spawning && creep.unitCode === UNIT_CODES.carrier,
	).length;
	for (const task of Object.values(ctx.memory.tasks)) {
		if (
			(task.kind === "haul" || task.kind === "fill_spawn") &&
			task.roomName === room.roomName &&
			(task.status === "leased" || task.status === "in_progress")
		) {
			idleCarriers -= 1;
		}
	}
	const supplyLineTight =
		CONTROLLER_BUFFER_CONFIG.supplyLineGateEnabled && idleCarriers <= dedicatedCarry;
	/** 在途 haul 任务键集: 专线收紧只抑制「新建」放量, 在途任务放行跑完 (取消风暴教训) */
	const inflightHaulKeys = new Set(
		board.list({ roomName: room.roomName, kinds: ["haul"] }).map((task) => task.dedupeKey),
	);
	const haulSources: Array<{ key: string; id: string; x: number; y: number; amount: number }> = [];
	for (const pile of room.piles) {
		if (pile.amount >= HAUL_CONFIG.minHaulAmount) {
			haulSources.push({ key: `${pile.x},${pile.y}`, id: pile.id, x: pile.x, y: pile.y, amount: pile.amount });
		}
	}
	for (const store of room.stores) {
		if (store.id === bufferId) {
			continue;
		}
		if (store.energy >= HAUL_CONFIG.minStoreAmount) {
			haulSources.push({ key: store.id, id: store.id, x: store.x, y: store.y, amount: store.energy });
		}
	}
	const ledger = createLedger(ctx);
	for (const source of haulSources) {
		const destination = pickDestination(destinations, source.x, source.y);
		if (!destination) {
			continue;
		}
		// 专线收紧 (specs/controller-supply-line): 运力吃紧时只放行 cc 目的地;
		// 已在途的任务保持预期集合 (跳过刷新), 不因闸门翻转被取消——载货半程被杀就是断流
		const dedupeKey = `haul:${room.roomName}:${source.key}:${destination.id}`;
		if (supplyLineTight && destination.id !== bufferId) {
			if (inflightHaulKeys.has(dedupeKey)) {
				expected.add(dedupeKey);
			}
			continue;
		}
		const amount = Math.min(source.amount, destination.headroom);
		expected.add(dedupeKey);
		// 专线 carve-out (specs/controller-supply-line): 收紧期 cc 货运压过孵化线,
		// 分配器按任务优先级给专线先挑空闲搬运力
		const dedicatedBoost =
			supplyLineTight && destination.id === bufferId
				? CONTROLLER_BUFFER_CONFIG.dedicatedLinePriority - priorityFor("haul") - destination.priority
				: 0;
		const distance = Math.max(
			Math.abs(source.x - destination.x),
			Math.abs(source.y - destination.y),
		);
		const task = board.upsert(
			{
				dedupeKey,
				kind: "haul",
				roomName: room.roomName,
				targetId: source.id,
				targetPos: { x: source.x, y: source.y, roomName: room.roomName },
				destId: destination.id,
				destPos: { x: destination.x, y: destination.y, roomName: room.roomName },
				resourceType: RESOURCE_ENERGY,
				amount,
				priority: priorityFor("haul") + destination.priority + bias("haul") + dedicatedBoost,
				requiredCapabilities: ["carry", "move"],
				deadline: ctx.tick + Math.min(600, roundTripEstimate(amount, distance) + 100),
			},
			ctx.tick,
		);
		// 在途承诺入账本 (目的地 committedTo 的数据源); 合并任务若预留泄漏则补挂
		if (task.createdAt === ctx.tick || ledger.reservationIdOf(task.id) === undefined) {
			reserve(ctx, {
				owner: task.id,
				roomName: room.roomName,
				amount,
				destId: destination.id,
				...(task.deadline !== undefined ? { expiresAt: task.deadline } : {}),
			});
		}
	}

	// 消失的主体 → 取消其任务 (工地建成/移除、满仓、堆叠消失); 节流期保持存活者除外
	for (const task of board.list({ roomName: room.roomName, kinds: PLANNED_KINDS })) {
		if (
			!expected.has(task.dedupeKey) &&
			task.status !== "completed" &&
			task.status !== "cancelled"
		) {
			board.cancel(task.id, ctx.tick, "subject-gone");
		}
	}
}

export function runEconomyPlanners(ctx: TickContext, board: TaskBoard): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		planEconomyRoom(ctx, board, room);
	}
}
