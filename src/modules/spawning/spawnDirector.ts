/**
 * SpawnDirector (docs/nexus-design/07 / api/07 §7.5) — 编排层 (任务 6.1 拆分后):
 * 死亡回收 → DemandSources (定编/缺口聚合) → SpawnArbiter (每 spawn 裁决) →
 * SpawnCommand (broker spawn 管线提交)。职责分布:
 * - demandSources.ts: 存活/在途计数、四路需求源 (standing/task/replacement/courier/bootstrap)
 * - spawnArbiter.ts: 闸门链 (secured→让位→自举→urgent→攒能等待) 与体型定档
 * - bodyFactory.ts: 纯函数体型生成 (不读 Game)
 * - broker spawn 管线: 命令执行与结果回调 (预约核销/簿记)
 * 无状态: 每 Tick 由存活/在途/任务重新计算缺口; 替补窗口实装 (§7.5)。
 */
import type { TickContext } from "@/core";
import { directiveFor } from "@/modules/strategy";
import { downgradeEmergency } from "@/core/world";
import { STRATEGY_CONFIG } from "@/config/strategy";
import { generateCreepName } from "@/utils/naming";
import { UnitData } from "@/constant/CreepConstant";
import {
	bodyCost,
	buildBody,
	isSpawnUnit,
	type SpawnUnit,
} from "@/modules/spawning/bodyFactory";
import { commitReservation, createLedger, harvestIncomeOf, releaseReservation, reserve } from "@/modules/economy";
import { workPerUpgraderBody } from "@/modules/economy/workforce";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { takeCourierRequests } from "@/core/store/runtime";
import { SPAWN_CONFIG } from "@/config/economy";
import type { TaskBoard } from "@/modules/tasks";
import { sharedBrokerForDirectCommands } from "@/modules/agents/actionBroker";
import {
	anyRoomRush,
	effectiveTarget,
	replacementLead,
	staffingCount,
	unitForTaskKind,
	unitTargets,
	type SpawnRequest,
} from "@/modules/spawning/demandSources";
import { arbitrateForSpawn } from "@/modules/spawning/spawnArbiter";

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
	// 重置对账 (实服 4wt 重开路径, sim 无法暴露): dead 名单由「上 tick 存在→本 tick
	// 消失」推导, 但服务器重置清空 Game.creeps 而 Memory 保留——上 tick 视图已空,
	// 陈旧 units 记录永不入 dead。逐 tick 快照对账兜底: 记录不在 Game.creeps 即清。
	// 注意孵化中的单位在 Game.creeps 可见 (spawning 状态), 不会被误清。
	for (const name of Object.keys(ctx.memory.units)) {
		if (!(name in Game.creeps)) {
			delete ctx.memory.units[name];
			const engineCreeps = (typeof Memory !== "undefined" ? Memory : undefined) as
				| { creeps?: Record<string, unknown> }
				| undefined;
			if (engineCreeps?.creeps) {
				delete engineCreeps.creeps[name];
			}
		}
	}

	const spawns = Object.values(Game.spawns);
	if (spawns.length === 0) {
		return;
	}
	/** spawn 空闲起算 tick (攒能等待超时兜底): 跨 Tick 持久化, 修复每 Tick 重建
	 *  使 capacityWaitTicks 超时永不触发的死代码 (specs/workforce-staffing 顺手修)。
	 *  陈旧键清理改按存活 spawn id 集合比对——idleSince 的键是 hex id, 而
	 *  Game.spawns 的键是 spawn 名, 拿 id 去 in Game.spawns 恒 miss → 每 tick
	 *  全量误删, 超时降档窗口永远归零 (sim 实证 idle 恒 0, carrier 500 成本
	 *  单位缺编 6000t 不降档, 让位期攒能死锁) */
	const spawnIdleSince = ctx.memory.spawn.idleSince ?? {};
	const liveSpawnIds = new Set(spawns.map((spawn) => String(spawn.id)));
	for (const id of Object.keys(spawnIdleSince)) {
		if (!liveSpawnIds.has(id)) {
			delete spawnIdleSince[id];
		}
	}
	ctx.memory.spawn.idleSince = spawnIdleSince;

	const count = staffingCount(ctx, spawns);
	const { staffed } = count;

	// 战略指令 (设计 D5): survive 姿态暂停非关键岗位的新排 (缺口与替补均停),
	// carrier/harvester 与从零起步的 bootstrap 不受影响; 不做身体缩水 (避免与替补窗口耦合);
	// 降级紧急时 upgrader 豁免暂停名单 (bugs/P1-10: 保升级岗位不断供, 宁可挤占也要保级);
	// 涓流期 (全场无 storage) upgrader 同豁免 (E18): 低 RCL 库存天然贴地, 瞬时
	// 存量击穿临界线是常态——开局 survive 窗口把 upgrader/worker 全停会让升级链
	// 与基建停摆数千 tick (sim 实证 t0-5300 控制器进度 0, upgrade 任务 available
	// 4600t 无人认领, race 参照 L2@676)。
	const downgradeActive = Object.values(world.rooms).some((room) =>
		downgradeEmergency(room.controller),
	);
	const trickleEconomy = !Object.values(world.rooms).some((room) =>
		room.stores.some((store) => store.structureType === "storage"),
	);
	const pauseUnits =
		directiveFor(ctx).posture === "survive"
			? STRATEGY_CONFIG.surviveSpawnPauseUnits.filter(
					// upgrader 仅在【非涓流且非降级紧急】时才随 survive 暂停:
					// 涓流期 (无 storage) 豁免见上; 降级紧急豁免 (bugs/P1-10)。
					(unit) =>
						unit !== "upgrader" || (!downgradeActive && !trickleEconomy),
				)
			: [];

	// ── Demand Sources (demandSources.ts): 四路需求聚合 ──────────────────
	// 单需求源异常不阻断孵化线 (任务 6.4): 每源独立 try/catch, 失败记遥测继续
	const requests = new Map<string, SpawnRequest>();
	let targetsProbe: number | string = "?";
	// 批次 AD: 外矿多源并发请求需多键并存 (单 unit 键会让 N 源竞争 1 请求位);
	// 批次 AD 复合键仅用于 raceRemote 段 (rkey 参数), 常规段维持 unit 单键。
	const addRequest = (
		unit: SpawnRequest["unit"],
		priority: number,
		purpose: string,
		taskId?: string,
		rkey?: string,
		budget?: number,
	): void => {
		if (pauseUnits.includes(unit)) {
			return;
		}
		const key = rkey ?? unit;
		const existing = requests.get(key);
		if (!existing || priority < existing.priority) {
			requests.set(key, { unit, priority, purpose, taskId, ...(budget !== undefined ? { budget } : {}) });
		}
	};
	/** 需求源隔离执行器: 抛错只告警, 孵化线不瘫 (6.4) */
	const safeSource = (source: string, produce: () => void): void => {
		try {
			produce();
		} catch (err) {
			ctx.errors.report({
				module: "spawn-demand",
				tick: ctx.tick,
				code: "UNEXPECTED",
				message: `需求源 ${source} 异常, 本 tick 跳过: ${String(err)}`,
			});
			ctx.logger.warn(`spawn-demand.${source}`, `需求源 ${source} 异常, 本 tick 跳过: ${String(err)}`);
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

	if (count.aliveTotal === 0) {
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
		// carrier 可按类型覆盖优先级 (物流骨干不被任务驱动请求永久压队)
		const anyRush = anyRoomRush(ctx);
		const spawnRoomCreeps = Object.values(world.rooms)[0]?.creeps ?? [];
		const spawnRoomObs = Object.values(world.rooms)[0];
		let targets: Record<SpawnUnit, number> | undefined;
		safeSource("unit-targets", () => {
			targets = unitTargets(ctx, board);
		});
		if (ctx.tick < 6000 && ctx.tick % 100 === 0) {
			targetsProbe = targets?.upgrader ?? "?";
		}
		// 批次 AD (上游 minUp/fed 门的本矿映射): 本矿采集/搬运满编而远程源
		// 仍有空缺时, 升级编制让位外矿链 (地板 1 语义)——上游 want[] 里升级体
		// 只有 minUp=1 地板与 fed/盈余门放行的加编, 外矿 work 恒在其后; 本矿
		// 升级定编 (收入折算) 在外矿未铺满期全额挂账会让 rush 提级替补 (2)
		// 恒压外矿请求, 16k 实证 remoteMiner 全场 0 只。外矿补齐即恢复。
		const remoteDeficit =
			anyRush &&
			staffed("harvester") >= Math.max(1, targets?.harvester ?? 0) &&
			staffed("carrier") >= Math.max(1, targets?.carrier ?? 0) &&
			raceRemoteDeficitOf(ctx, board);
		safeSource("standing", () => {
			if (!targets) {
				return;
			}
			for (const unitName of SPAWN_CONFIG.standingUnits) {
				// 水位门: cc 存量低于升级抽水缓冲时暂停升级体孵化, 孵化槽让位物流。
				// rush 档豁免 (冲级火力是主要目的): 涓流期 cc 频繁低于门槛会反复停孵
				// 升级体, 升级链人力不足 → cc 更空 → 死循环 (sim 实锤 upgrade 6 任务
				// 仅 3 只在岗, control 掉 25%)。
				if (
					unitName === "upgrader" &&
					!downgradeActive &&
					!anyRush &&
					ccBelowSpawnGate(ctx)
				) {
					continue;
				}
				if (
					unitName === "upgrader" &&
					remoteDeficit &&
					staffed("upgrader") >= 1
				) {
					continue; // 外矿空缺期升级编制地板 1 (上游 minUp)
				}
				if (staffed(unitName) < effectiveTarget(ctx, unitName as never, targets)) {
				// 半缺口不孵闸 (race-speedrun 任务4.3, race bot manageUpgrade L133 口径):
				// 升级体缺口 WORK 不足半只新体 (2×缺口WORK < 单体WORK) 时放弃孵化——
				// 为凑 1-2 WORK 的尾差孵小体是 churn (短寿命小体反复换代),
				// 宁可让在编体多跑一拍; 保级窗口豁免 (downgradeActive 恒保底)。
				if (unitName === "upgrader" && !downgradeActive) {
					const spawnRoom = Object.values(world.rooms)[0];
					if (spawnRoom) {
						const perBody = workPerUpgraderBody(ctx, spawnRoom.roomName);
						const staffedWork = spawnRoom.creeps
							.filter((c) => c.unitCode === UNIT_CODES.upgrader && !c.spawning)
							.reduce((sum, c) => sum + c.bodyWork, 0);
						const targetWork = effectiveTarget(ctx, "upgrader" as never, targets) * perBody;
						if (2 * (targetWork - staffedWork) < perBody) {
							continue;
						}
					}
				}
				const basePriority =
					SPAWN_CONFIG.standingPriorityByUnit[unitName] ?? SPAWN_CONFIG.standingPriority;
				// 冲级档孵化提级传导 (bugs/P1-19): rush 期 upgradeBias 在任务层提前,
				// 孵化层 upgrader 请求若恒 6 会被 fill_spawn 1 恒压队。
				// 分档 (race-speedrun 6.1 第六轮 A/B):
				// - RCL1: 首只即提级——RCL2 只需 200 进度, 升级体早 ~400t 上岗;
				// - RCL2: 不提级 (建立期越位让升级体吸干孵化能量, 40k L3 实测 -3k);
				// - RCL3 起在册 ≥1 后提级: 第三只起 staffing 请求恒输 carrier churn
				//   (L3), 末段定编只到位 2 只, 每代空窗 (40k 实证 t39362-39902)。
				// worker 缺位建造提级 (race 换班制语义): 工地存在而 worker 全灭时
				// 提到 L2——cc/ext 不成则升级体长腿/容量锁死, 建造是唯一出口。
				let priority = basePriority;
				if (
					unitName === "upgrader" &&
					anyRush &&
					((spawnRoomObs?.rcl ?? 99) <= 1 ||
						((spawnRoomObs?.rcl ?? 0) >= 3 &&
							spawnRoomCreeps.some((c) => c.unitCode === UNIT_CODES.upgrader)))
				) {
					priority = Math.min(priority, SPAWN_CONFIG.rushUpgradeSpawnPriority);
				} else if (unitName === "worker" && workerBuildCriticalOf(ctx, board)) {
					priority = Math.min(priority, 2);
				}
				addRequest(unitName as never, priority, `staffing:${unitName}`);
				}
			}
		});
		safeSource("task-driven", () => {
			if (!targets) {
				return;
			}
			const rushMode = anyRoomRush(ctx);
			// 过道矿任务豁免 (specs/mission-pool-retirement mine 行): 带 resourceType
			// 的 harvest 是元素矿/沉积矿合约 (economy/mineralWork 定编 directSpawn
			// 桥接自孵 power-*/deposit-* 战斗件), 不归 harvester 定编——资源判据
			// 与能量采集任务 (无 resourceType 字段) 严格二分。
			const isMineralTask = (task: { resourceType?: ResourceConstant }) =>
				task.resourceType !== undefined;
			// 外矿孵化 (批次 AD, 上游 nextSpawn 外矿段整体口径):
			// ① manual 档维持批次 H 定向替补环 (原语义);
			// ② rush 档走上游分支序闸——本矿编制未满 → 外矿请求不进池 (与上游
			//    spawnIt 只取 want[0]、want = 本矿 work 前置/remotes 垫底等价);
			//    在编判定按源 TTL 无缝换班 (alive = TTL > 3×body + walk×pace)。
			if (rushMode) {
				raceRemoteRequests(ctx, board, staffed, targets, addRequest);
			} else {
			const remoteRoomsOnDuty = new Set(
				board
					.list({ kinds: ["harvest"], statuses: ["leased", "in_progress"] })
					.filter(
						(t) =>
							t.targetPos?.roomName !== undefined &&
							t.targetPos.roomName !== t.roomName &&
							!isMineralTask(t),
					)
					.map((t) => t.targetPos?.roomName),
			);
			for (const task of board.list({ kinds: ["harvest"], statuses: ["available"] })) {
				if (isMineralTask(task)) continue;
				const remoteRoom = task.targetPos?.roomName;
				if (!remoteRoom || remoteRoom === task.roomName) continue;
				if (remoteRoomsOnDuty.has(remoteRoom)) continue;
				// 定向替补优先级严格压过普通任务驱动请求 (批次 K: 同级先到
				// 先占坑, 普通请求把 remote 挤出池——矿工死后 30k 无替补)
				addRequest("harvester", task.priority - 1, `remote:harvest:${task.id}`, task.id);
			}
			}
			for (const task of board.list({ statuses: ["available"] })) {
				if (task.kind === "harvest" && isMineralTask(task)) continue;
				const unit = unitForTaskKind(task.kind);
				if (unit && staffed(unit) < effectiveTarget(ctx, unit, targets)) {
					addRequest(unit, task.priority, unit);
				}
			}
		});
		// 替补窗口 (docs/nexus-design/07 §7.5): TTL 低于 lead = 生产 + 实测路程 P95 + 余量 时提前补位;
		// 关键岗位允许短暂在编重叠 (staffed ≤ target), 廉价岗位严格不超编 (staffed < target)。
		// staffed 已在 staffingCount 内剔除将死体 (race-speedrun 任务2.2)——替补天然
		// 允许与将死体重叠, 死亡潮窗口内提前发出替补请求。
		safeSource("replacement", () => {
			if (!targets) {
				return;
			}
			for (const room of Object.values(world.rooms)) {
				for (const creep of room.creeps) {
					const unit = unitFromCodeOf(creep.unitCode);
					if (!unit) {
						continue;
					}
					const target = effectiveTarget(ctx, unit, targets);
					// 错峰窗口按批规模放大 (race-speedrun 6.1): 窗口 = 定编 × 生产
					// 周期, 替补触发点错峰 ≥ 整代替补的孵化时长, 消灭「整代到期 →
					// 孵化槽排队 → 在岗阶梯下滑」潮 (40k 实证 t28.5-29.9k 全代重孵)
					if (
						creep.ticksToLive >=
						replacementLead(ctx, unit, room.roomName, creep.name, target)
					) {
						continue;
					}
					const overlapping = REPLACEMENT_KEY_UNITS.includes(unit)
						? staffed(unit) <= target
						: staffed(unit) < target;
					if (overlapping) {
						// 替补等级跟随被替类型常驻档: 换代是编制维持的一部分,
						// 恒殿后 L11 会被涓流期孵化槽饿死——同龄批次集中到期时
						// 死亡速率 > 孵化速率, 人口崩塌 (sim t12k 22→7 实锤)
						const unitLevel =
							SPAWN_CONFIG.standingPriorityByUnit[unit] ?? SPAWN_CONFIG.standingPriority;
						// 冲级档升级替补越位 (race-speedrun 6.1 第四轮): rushUpgradeSpawnPriority
						// 只作用于替补请求——缺编建立期维持 standing 序 (carrier 先于 upgrader,
						// 能量通道先建, boot 绿门不漂移); 换代期升级体抢在 carrier churn 前
						// 上槽, 消灭「单只死→补 1500t」空窗 (40k 实证 +8.9% / L4 提前 4925t)
						addRequest(
							unit,
							anyRush && unit === "upgrader"
								? Math.min(unitLevel, SPAWN_CONFIG.rushUpgradeSpawnPriority)
								: unitLevel,
							`replacement:${unit}`,
						);
					}
				}
			}
		});
	}

	// 拉能快递 (specs/rush-courier): 消费 planning 阶段过五闸门的需求,
	// 优先级最低 (40) —— 任何基础编制/任务/替补请求都排在前面
	safeSource("courier", () => {
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
	});

	// 孵化链路遥测 (任务 6.4): 队列深度峰值 + 拒绝计数 + 等待时长 EMA, 按窗口节流落盘。
	// pendingSince 记类型请求首次入池 tick, 被孵化或出池时结算 EMA 并清账——键集有界。
	const telemetry = (spawnState.telemetry ??= {
		tick: 0,
		queueDepthPeak: 0,
		waitEma: {},
		denyReasons: {},
	});
	const pendingSince = (telemetry as { pendingSince?: Record<string, number> }).pendingSince ?? {};
	(telemetry as { pendingSince?: Record<string, number> }).pendingSince = pendingSince;
	for (const unit of requests.keys()) {
		if (pendingSince[unit] === undefined) {
			pendingSince[unit] = ctx.tick;
		}
	}
	const windowElapsed = ctx.tick - telemetry.tick >= SPAWN_CONFIG.spawnTelemetry.aggregateTicks;
	if (windowElapsed) {
		telemetry.tick = ctx.tick;
	}
	telemetry.queueDepthPeak = Math.max(telemetry.queueDepthPeak, requests.size);

	if (requests.size === 0) {
		spawnState.telemetry = telemetry;
		return;
	}

	const ordered = [...requests.values()].sort((a, b) => a.priority - b.priority);
	if (ctx.tick < 6000 && ctx.tick % 100 === 0) {
		ctx.logger?.warn?.(
			"probe-pool",
			`t${ctx.tick} pause=[${pauseUnits.join(",")}] upgraderTarget=${targetsProbe} pool=[${ordered.map((r) => `${r.unit}:${r.priority}:${r.purpose.slice(0, 12)}`).join(",")}] avail=${Object.values(Game.spawns)[0]?.room.energyAvailable}`,
		);
	}
	for (const spawn of spawns) {
		if (spawn.spawning) {
			continue;
		}
		const result = arbitrateForSpawn(ctx, spawn, world.rooms[spawn.room.name], ordered, board, {
			staffed,
			idleSince: spawnIdleSince,
			downgradeActive,
			onDeny: (reason) => {
				telemetry.denyReasons[reason] = (telemetry.denyReasons[reason] ?? 0) + 1;
			},
		});
		if (!result) {
			continue;
		}
		const { request, body } = result;
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
		// 主孵化链保持原生同步直调 (HEAD 形态): 孵化时机在 agents 阶段即时生效,
		// 经 intent 管线会推迟到 commit 阶段造成整链时序漂移 (6.1 拆分实证 L3 +1261t)。
		// 原生调用权收编进 broker 属 6.2 范围, 与 directSpawn 一并迁移。
		const code = spawn.spawnCreep(body, name, {
			memory: {
				unit: request.unit,
				homeRoom: spawn.room.name,
				// 定向任务绑定 (外矿替补): 出生即指向目标任务, 分配器沿既有
				// 租约路径接管 (claim 要求 available, 抢先占位防本地槽虹吸)
				...(request.taskId ? { taskId: request.taskId } : {}),
			},
		});
		if (code === OK) {
			ctx.memory.units[name] = {
				name,
				unitCode: request.unit,
				homeRoom: spawn.room.name,
				bornAt: ctx.tick,
				lastTaskChange: ctx.tick,
			};
			// worker 出生史累计标记 (workerBuildCriticalOf 豁免口径, 死亡不清)。
			// request.unit 是类型名 (SpawnUnit), 与 UNIT_CODES 代号 ("W") 比较
			// 恒 false 会导致标记永不落盘 (c16 实锤 economy.workerEverBorn 缺失)
			if (request.unit === "worker") {
				ctx.memory.economy.workerEverBorn = true;
			}
			// 等待时长 EMA 结算 (6.4): 入池→孵化成交的等待时长
			const since = pendingSince[request.unit];
			if (since !== undefined) {
				const alpha = 1 - 2 ** (-1 / SPAWN_CONFIG.spawnTelemetry.waitEmaTicks);
				telemetry.waitEma[request.unit] =
					(telemetry.waitEma[request.unit] ?? 0) * (1 - alpha) + (ctx.tick - since) * alpha;
				delete pendingSince[request.unit];
			}
			if (reservationId) {
				commitReservation(ctx, reservationId, bodyCost(body));
			}
		} else {
			if (reservationId) {
				releaseReservation(ctx, reservationId, "spawn-failed");
			}
			ctx.logger.warn(`spawn.${code}`, `生产 ${request.unit} 失败: ${code}`);
		}
	}
}

/** 代号 → 类型名 (demandSources 单源再导出, 替补窗口扫描用) */
function unitFromCodeOf(code: string) {
	return unitFromCode(code);
}

/**
 * cc 水位门: 存量 < 在座升级 WORK×2×缓冲 tick 时为 true。
 * 多房语义: 任一有 cc 的房低于水位即暂停升级体孵化 (保守口径, 修复旧实现
 * 首个有 cc 房即 return 的单房短路)。
 * Available 口径 (specs/resource-ledger): cc 在途承诺 (committedTo) 计入存量——
 * 补货任务已发出时水位即将回升, 不暂停孵化。
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
	const ledger = createLedger(ctx);
	let anyBelow = false;
	for (const room of Object.values(world.rooms)) {
		const buffer = room.controllerBuffer;
		if (!buffer) {
			continue;
		}
		const store = room.stores.find((s) => s.id === buffer.id);
		if (
			store &&
			store.energy + ledger.committedTo(room.roomName, store.id) <
				upgradeWork * 2 * CONTROLLER_BUFFER_CONFIG.spawnGateBufferTicks
		) {
			anyBelow = true;
		}
	}
	return anyBelow;
}

import { unitFromCode, workerBuildCriticalOf } from "@/modules/spawning/demandSources";
import { unitCode } from "@/constant/UnitConstant";
import { roomWorldCoord } from "@/utils/roomCoord";
import { REMOTE_CARRY_CONFIG } from "@/config/economy";
import { hasRemoteSpawnBudget } from "@/modules/spawning/remoteBudget";
import { REPLACEMENT_CONFIG } from "@/config/economy";
import { rushBodyWork } from "@/utils/rushBodies";
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";
const REPLACEMENT_KEY_UNITS = REPLACEMENT_CONFIG.keyUnits;

// ==================== 直接孵化 (编队/扩张/援助/控制台) ====================

/** 直接孵化请求 (任务 6.2): 一次性/指令式孵化语义, 不参与定编与预算竞争 */
export interface DirectSpawnRequest {
	/** emergency=急救/控制台 (pc 陪护); direct=编队/扩张计划件 */
	mode: "emergency" | "direct";
	/** 类型 id (UnitData 词表或 SpawnUnit 词表) */
	unit: string;
	/** 写入 creep memory 的业务字段 (unit/cache 由命令层补齐) */
	memory: Record<string, unknown>;
	/** 显式体型 (编队压缩体); 缺省按类型定义源解析 */
	body?: BodyPartConstant[];
	/** 体名覆盖 (如标注归属 pc), 缺省取 UnitConstant 体名词表 */
	bodyNameOverride?: string;
}

/**
 * 直接孵化接口: 绕过任务板/池, 按 SpawnRequest 立即下蛋 (同步返回码)。
 * 体型定义源统一 (6.2): 显式 body 优先 → SpawnUnit 走 BodyFactory (按容量定型,
 * body policy 唯一来源) → 特化战件回退 UnitData.bodypart (legacy 词表, 8.x 收编中)。
 * @returns spawnCreep 返回码 (OK=0 为成功)
 */
export function directSpawn(room: Room, request: DirectSpawnRequest): number {
	const { unit, memory, body, bodyNameOverride, mode } = request;
	const spawns = room.find(FIND_MY_SPAWNS);
	const spawn = spawns.find((s) => !s.spawning);
	if (!spawn) return ERR_BUSY;
	const config = (UnitData as unknown as Record<string, { level: number }>)[unit];
	if (!config) {
		return ERR_INVALID_ARGS;
	}
	let bodyFinal = body;
	if (!bodyFinal) {
		if (isSpawnUnit(unit)) {
			bodyFinal = buildBody(unit, room.energyCapacityAvailable) ?? undefined;
		} else {
			const preset = (UnitData as unknown as Record<string, { bodypart: BodyPartConstant[][] }>)[unit]
				?.bodypart;
			bodyFinal = preset && preset.length > 0 ? (preset[0]!.flat() as BodyPartConstant[]) : undefined;
		}
	}
	if (!bodyFinal?.length) return ERR_NOT_ENOUGH_RESOURCES;
	const mem = { ...memory, unit, cache: {} } as CreepMemory;
	// 命名入参必须是类型 id: 传代号会让 unitBodyName 回退成代号本身, 拼出 `H H-1A2B` 双段前缀。
	// 体名覆盖只替换首段, 代号段恒由生成器产出——感知侧 unitCodeFromName 依赖该形态解析类型。
	const name = generateCreepName(unit, {
		random: Math.random,
		exists: (n) => n in Game.creeps,
		...(bodyNameOverride ? { bodyName: bodyNameOverride } : {}),
	});
	// 经命令边界同步执行 (api/17 spawn 管线): 原生调用权收编进 broker,
	// 返回码透传给调用方 (emergency/direct 的一次性语义需要同步结果)
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `direct-spawn:${mode}:${spawn.id}:${Game.time}:${name}`,
		tick: Game.time,
		actorName: spawn.room.name,
		kind: "spawnCreep",
		pipeline: "spawn",
		priority: 80,
		targetId: spawn.id,
		payload: { body: bodyFinal, creepName: name, memory: mem as Record<string, unknown> },
		dedupeKey: `direct-spawn:${spawn.id}:${Game.time}:${name}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

// ==================== 外矿主链 (批次 AD, 上游 nextSpawn 外矿段整体口径) ====================

/** 远程源空缺判定 (上游 work(s) alive 口径的布尔化): 预算内最近远程源无
 *  在岗矿工 (TTL > 3×body + walk×pace) 即 true——升级编制让位的开关。
 *  只认【带 targetId 的正式任务】: 占位任务 (无 id, 矿工还在路上) 恒算
 *  空缺会把 upgrader 永久压在地板 (升级速率 8/t → 3/t 实证), 外矿链
 *  爬坡期升级面不陪葬——上游 minUp 语义是「地板 + fed 门」, 不是清零。 */
export function raceRemoteDeficitOf(ctx: TickContext, board: TaskBoard): boolean {
	const homeRoom = Object.values(ctx.world.current?.rooms ?? {})[0];
	if (!homeRoom) return false;
	const homeRoomName = homeRoom.roomName;
	const walk = (room: string) => remoteWalkLeadOf(ctx, homeRoomName, room, 2);
	for (const task of board.list({ kinds: ["harvest"], statuses: ["available", "leased", "in_progress"] })) {
		if (task.resourceType !== undefined) continue;
		const targetRoom = task.targetPos?.roomName;
		if (!targetRoom || targetRoom === task.roomName) continue;
		if (!task.targetId) continue; // 占位任务不算空缺
		const lead = walk(targetRoom);
		const holder = task.assignedTo
			? ctx.memory.units[task.assignedTo]
			: undefined;
		const creep = holder ? Game.creeps[holder.name] : undefined;
		if (
			creep &&
			!creep.spawning &&
			unitCode(holder!.unitCode) === UNIT_CODES.remoteMiner &&
			(creep.ticksToLive ?? 0) > creep.body.length * 3 + lead
		) {
			continue; // 该源在岗
		}
		return true; // 有正式源空缺
	}
	return false;
}

/** 换班提前量: 路程未实测回退线性房距估算 (上游 dist 未实测时同款退化) */
function remoteWalkLeadOf(ctx: TickContext, homeRoomName: string, targetRoomName: string, pace: number): number {
	const cached = ctx.memory.economy.remoteSourcesByHome?.[homeRoomName];
	const hit = cached?.find((e) => e.room === targetRoomName);
	if (hit) return hit.dist * pace;
	const home = roomWorldCoord(homeRoomName);
	const target = roomWorldCoord(targetRoomName);
	const linear = home && target ? Math.max(Math.abs(home.x - target.x), Math.abs(home.y - target.y)) : 1;
	return (30 + linear * 20 + 20) * pace;
}

/**
 * rush 档外矿请求产出 (批次 AD):
 * - 分支序闸 (上游 spawnIt want[0] 语义): 本矿 harvester/carrier 定编未满 →
 *   外矿请求整段不进池——AC 病理 (远程请求 priority 69 压过本矿替补) 的根治;
 * - 按源无缝换班 (上游 work(s)/alive 逐位): 矿工 TTL > 3×body + walk×pace
 *   即视为在岗, 否则发替补 (priority 同任务档, 定向绑定 taskId);
 * - hauler 按上游公式逐源定编: needCarry = ceil(dug×(2×dist+6)×slack/50),
 *   haveCarry = 该源在岗 hauler CARRY 部件和, 缺口发 carrier (remote:carry 绑定);
 * - reserver: 上游 resLead 口径 (TTL > 300 + 3×body + walk), claims=2 随预算。
 * 预算闸: 部件数走 remoteSpawnLeftoverOf (批次 L 总量门, 本矿计划编成先扣)。
 */
function raceRemoteRequests(
	ctx: TickContext,
	board: TaskBoard,
	staffed: (unit: string) => number,
	targets: Record<SpawnUnit, number>,
	addRequest: (unit: SpawnUnit, priority: number, purpose: string, taskId?: string, rkey?: string, budget?: number) => void,
): void {
	// 分支序闸 ①: 本矿采集面未满编 → 外矿整段让位 (上游 want[0] 恒本矿)。
	// 定编口径: effectiveTarget 的 dying 剔除口径与 staffed 对齐 (存活+在途),
	// 直接用 targets 面值——replacement 环已按同口径发缺口请求。
	if (staffed("harvester") < Math.max(1, targets.harvester)) return;
	// 分支序闸 ②: 搬运未满编 → 拦 hauler 请求 (上游 hauler 段在两个本矿源
	// work 之后)。**只拦 hauler**——miner/reserver 与搬运编制解耦: 闸②若整段
	// return, 矿工死绝→堆空→carry 取消→hauler 闲编→闸关→矿工不补, 自锁死循环
	// (28k 实证 8 远程任务全 available, remoteMiner 0 只)。上游无此耦合:
	// miner 请求在 work(s) 内部先于 hauler 判定。

	const homeRoom = Object.values(ctx.world.current?.rooms ?? {})[0];
	if (!homeRoom) return;
	const homeRoomName = homeRoom.roomName;
	const rcl = homeRoom.rcl;
	const capacity = homeRoom.energyCapacity;
	const slack = rcl < 3 ? 0.998 : 0.81;

	// 活体索引: 按目标源/房间聚合 (units 注册表 + 引擎侧 body 读数)
	type Duty = { ttl: number; bodyLen: number; work: number; carry: number; taskId?: string | undefined };
	const byTask = new Map<string, Duty[]>();
	// 搬运力按目标房聚合 (上游 haveCarry 口径: 该源在岗 hauler 的 CARRY 和;
	// 绑定到目标房任一 carry 任务的都算——按源细分反而漏计堆→多源共运)
	const carryByRoom = new Map<string, number>();
	let idleCarry = 0;
	for (const record of Object.values(ctx.memory.units)) {
		if (record.homeRoom !== homeRoomName) continue;
		const creep = Game.creeps[record.name];
		if (!creep || creep.spawning) continue;
		const code = unitCode(record.unitCode);
		if (code !== UNIT_CODES.remoteMiner && code !== UNIT_CODES.carrier && code !== UNIT_CODES.reserver) continue;
		// 任务指针以 creep.memory 为准 (claim 的唯一写入口); units 注册表的
		// taskId 无人同步, 读它 = vacancy 恒空 → 同任务无限重发孵化请求
		// (6k 实证单位爆到 51 只, RM 全场 idle)
		const taskId = creep.memory.taskId;
		const duty: Duty = {
			ttl: creep.ticksToLive ?? 0,
			bodyLen: creep.body.length,
			work: creep.getActiveBodyparts(WORK),
			carry: creep.getActiveBodyparts(CARRY),
			taskId,
		};
		if (code === UNIT_CODES.remoteMiner || code === UNIT_CODES.reserver) {
			if (!taskId) continue;
			const list = byTask.get(taskId);
			if (list) list.push(duty);
			else byTask.set(taskId, [duty]);
		} else {
			// carrier: 绑定任务 → 目标房计入搬运力; 未绑定 → idle 池
			const boundTask = taskId ? board.get(taskId) : undefined;
			const destRoom = boundTask?.targetPos?.roomName;
			if (destRoom && destRoom !== homeRoomName) {
				carryByRoom.set(destRoom, (carryByRoom.get(destRoom) ?? 0) + duty.carry);
			} else {
				idleCarry += duty.carry;
			}
		}
	}

	// 远程任务面: budget 裁剪在 planRemoteHarvest 已做 (容量驱动),
	// 此处逐任务产出 miner/hauler/reserver 请求 (上游 work(s) 顺序: miner → hauler → reserver)
	const remoteTasks = board
		.list({ kinds: ["harvest"], statuses: ["available", "leased", "in_progress"] })
		.filter(
			(t) =>
				t.resourceType === undefined &&
				t.targetPos?.roomName !== undefined &&
				t.targetPos.roomName !== t.roomName,
		)
		.sort((a, b) => (a.targetPos!.roomName < b.targetPos!.roomName ? -1 : 1));
	for (const task of remoteTasks) {
		const targetRoom = task.targetPos!.roomName;
		const walk = remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 2); // 矿工 pace ≈ 2 (W:M = 5:3)
		const miners = byTask.get(task.id) ?? [];
		// ① 矿工 (上游 alive 口径: spawning 视为满 TTL)
		const aliveMiner = miners.filter((m) => m.ttl > m.bodyLen * 3 + walk);
		const minerParts = Math.max(6, Math.floor((capacity - 100) / 100) + 2);
		if (aliveMiner.length === 0 && hasRemoteSpawnBudget(ctx, homeRoomName, minerParts)) {
			// 预算分档 (上游 minerEnergyCapacity 口径: income>0 用满容量攒大件,
			// 收入未起按 energyAvailable 降档)——收入信号取本矿实测采集流
			// (上游 getRoomStats().income 同源口径)。编制比较在 fleetWork 波动时
			// 开窗震荡, 且本地满编后 incomeUp 恒真 → 满容量档在涓流期恒攒不满,
			// RM 饿死 (15k 实证 RM 仅 1 只, t2300 后零孵化)。
			const incomeUp = harvestIncomeOf(ctx, homeRoom) > 0;
			const avail = Object.values(Game.spawns)[0]?.room.energyAvailable ?? 300;
			addRequest(
				"remoteMiner",
				task.priority,
				`remote:miner:${task.id}`,
				task.id,
				`rm:${task.id}`,
				incomeUp ? undefined : avail,
			);
		}
		// ② hauler (上游 needCarry 公式): dug = min(10, 2×ΣW)
		const dug = Math.min(10, 2 * aliveMiner.reduce((s, m) => s + m.work, 0));
		const needCarry = Math.ceil((dug * (2 * remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 1) + 6) * slack) / 50);
		const haveCarry = idleCarry + (carryByRoom.get(targetRoom) ?? 0);
		if (dug > 0 && haveCarry < needCarry && hasRemoteSpawnBudget(ctx, homeRoomName, 48)) {
			// 分支序闸 ② (仅 hauler): 本矿搬运缺编时外矿 hauler 让位
			if (staffed("carrier") < Math.max(1, targets.carrier)) continue;
			// 绑定该源的回运任务 (available carry 即本源产出堆), 无则裸请求由分配器指派
			const carryTask = board
				.list({ kinds: ["carry"], statuses: ["available"] })
				.find((t) => t.targetPos?.roomName === targetRoom);
			addRequest("carrier", REMOTE_CARRY_CONFIG.carryPriority, `remote:carry:${carryTask?.id ?? task.id}`, carryTask?.id, `rc:${task.id}`);
		}
	}
	// ③ reserver (上游 resLead 口径): 每房一单, TTL > 300 + 3×body + walk
	const reserveTasks = board
		.list({ kinds: ["reserve"], statuses: ["available", "leased", "in_progress"] })
		.filter((t) => t.targetPos?.roomName !== undefined && t.targetPos.roomName !== t.roomName);
	const seenRooms = new Set<string>();
	for (const task of reserveTasks) {
		const targetRoom = task.targetPos!.roomName;
		if (seenRooms.has(targetRoom)) continue;
		seenRooms.add(targetRoom);
		const walk = remoteWalkLeadOf(ctx, homeRoomName, targetRoom, 1);
		// holder 判定与 RM 同源修正: creep.memory 是任务指针的唯一事实源
		const holders = Object.values(ctx.memory.units).filter((r) => {
			if (r.homeRoom !== homeRoomName || unitCode(r.unitCode) !== UNIT_CODES.reserver) return false;
			const creep = Game.creeps[r.name];
			return creep !== undefined && creep.memory.taskId !== undefined;
		});
		// 全局预订件上限 (上游 claims=2): reserver 部件小 (650 能量) 且 priority
		// 与 RM 同档, 无上限时 pool.find 恒先孵它, RM (270+) 攒能期被挤到恒饿
		// (40k 实证 reserver 6 只 / RM 0 只)。含孵化中——请求池逐拍重建,
		// 只算已落体会在同一窗口并发发出 N 个请求
		const aliveReservers = Object.values(ctx.memory.units).filter((r) => {
			if (r.homeRoom !== homeRoomName || unitCode(r.unitCode) !== UNIT_CODES.reserver) return false;
			const creep = Game.creeps[r.name];
			return creep !== undefined && (creep.spawning || (creep.ticksToLive ?? 0) > 100);
		}).length;
		const aliveHolder = holders.some((r) => {
			const creep = Game.creeps[r.name];
			return creep && !creep.spawning && (creep.ticksToLive ?? 0) > 300 + creep.body.length * 3 + walk;
		});
		if (!aliveHolder && aliveReservers < 2 && hasRemoteSpawnBudget(ctx, homeRoomName, 4)) {
			addRequest("reserver", task.priority + 1, `remote:reserve:${targetRoom}`, task.id, `rr:${targetRoom}`);
		}
	}
}
