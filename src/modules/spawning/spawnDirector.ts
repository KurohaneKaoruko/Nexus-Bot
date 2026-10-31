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
import {
	bodyCost,
	buildBody,
	isSpawnUnit,
	type SpawnUnit,
} from "@/modules/spawning/bodyFactory";
import { commitReservation, createLedger, releaseReservation, reserve } from "@/modules/economy";
import { workPerUpgraderBody } from "@/modules/economy/workforce";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { takeCourierRequests } from "@/core/store/runtime";
import { SPAWN_CONFIG } from "@/config/economy";
import { REPLACEMENT_CONFIG } from "@/config/economy";
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";
import { rushBodyWork } from "@/utils/rushBodies";
import { unitFromCode, workerBuildCriticalOf } from "@/modules/spawning/demandSources";
import type { TaskBoard } from "@/modules/tasks";
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
import { raceRemoteDeficitOf, raceRemoteRequests } from "@/modules/spawning/raceRemote";

export { directSpawn } from "@/modules/spawning/directSpawn";
export type { DirectSpawnRequest } from "@/modules/spawning/directSpawn";
export { raceRemoteDeficitOf } from "@/modules/spawning/raceRemote";

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
			// 名册口径 (docs/24 §24.5.2): 替补窗口在旧 rooms 房序遍历上并入外房
			// remoteUnits (尾序)——外矿/侦查件常驻外房, 视野口径漏检使外死件
			// 永不触发替补。请求顺序影响孵化槽排队序, 保持旧序不漂移门读数;
			// 归房按 homeRoom (孵化簿记的母房), lead 计算不随驻地漂移
			const homeOf = (name: string): string | undefined =>
				ctx.memory.units[name]?.homeRoom ?? Game.creeps[name]?.memory.homeRoom;
			const candidates = [
				...Object.values(world.rooms).flatMap((room) => room.creeps),
				...world.remoteUnits,
			];
			for (const creep of candidates) {
				const unit = unitFromCodeOf(creep.unitCode);
				if (!unit) {
					continue;
				}
				const homeRoomName = homeOf(creep.name) ?? creep.roomName;
				const target = effectiveTarget(ctx, unit, targets);
				// 错峰窗口按批规模放大 (race-speedrun 6.1): 窗口 = 定编 × 生产
				// 周期, 替补触发点错峰 ≥ 整代替补的孵化时长, 消灭「整代到期 →
				// 孵化槽排队 → 在岗阶梯下滑」潮 (40k 实证 t28.5-29.9k 全代重孵)
				if (
					creep.ticksToLive >=
					replacementLead(ctx, unit, homeRoomName, creep.name, target)
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
		pendingSince: {},
	});
	const pendingSince = (telemetry.pendingSince ??= {});
	// 键口径: 按 request.unit 记账。requests 的 map 键含 raceRemote 复合键
	// (rm:{taskId}), 若照抄会把一次性任务 ID 写进持久层且清账路径永远匹配不上
	// (bugs/room-observation-growth-audit 实锤 80k 时 2809 键 56KB 无界增长)。
	const unitsInPool = new Set<string>();
	for (const request of requests.values()) {
		unitsInPool.add(request.unit);
		if (pendingSince[request.unit] === undefined) {
			pendingSince[request.unit] = ctx.tick;
		}
	}
	// 出池清账: 本 Tick 不在池的词表键结算 EMA 后摘键 (与孵化成交路径同口径);
	// 非词表键 (历史泄漏的复合键) 不结算直接摘除。
	for (const unit of Object.keys(pendingSince)) {
		if (unitsInPool.has(unit)) continue;
		const since = pendingSince[unit];
		if (since !== undefined && isSpawnUnit(unit)) {
			const alpha = 1 - 2 ** (-1 / SPAWN_CONFIG.spawnTelemetry.waitEmaTicks);
			telemetry.waitEma[unit] =
				(telemetry.waitEma[unit] ?? 0) * (1 - alpha) + (ctx.tick - since) * alpha;
		}
		delete pendingSince[unit];
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

const REPLACEMENT_KEY_UNITS = REPLACEMENT_CONFIG.keyUnits;
