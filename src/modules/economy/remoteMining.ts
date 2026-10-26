/**
 * 外矿同名-unit 实现: 侦查邻房 → 记录远程 source → 产出跨房采集任务。
 * 远程 harvester 与本矿同名 (memory.targetRoom 区分), 任务 kind 仍为 harvest。
 * 侦查无状态化: 邻房不可见时产出 scout 任务 (到达即获视野), 可见时产出采集任务。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { priorityFor } from "@/core/store/taskSchema";
import { RESERVE_CONFIG, SCOUT_CONFIG } from "@/config/economy";
import { roomModeProfileFor } from "@/modules/strategy";

/** 己方用户名 (任一自有 spawn 的 owner; 无 spawn 的角落场景由调用侧兜底为不抢订) */
function myUsername(): string | undefined {
	for (const spawn of Object.values(Game.spawns)) {
		return spawn.owner?.username;
	}
	return undefined;
}

/** 邻房名计算: 已抽公共 utils/roomCoord (bugs/P1-17), 此处仅再导出兼容本文件内引用 */
import { neighborRooms } from "@/utils/roomCoord";
import { REMOTE_CARRY_CONFIG } from "@/config/economy";
import { remoteSourceWeightOf } from "@/modules/economy/income";
import { isProductionSecured } from "@/modules/economy/productionGate";
import { remoteSpawnLeftoverOf } from "@/modules/spawning/remoteBudget";
import { UNIT_CODES, unitCode } from "@/constant/UnitConstant";

// ==================== 全图源注册 (批次 AD, 上游 sources() 逐位口径) ====================

/** 注册表条目: 与上游 sources() 同构 */
export interface RemoteSourceEntry {
	k: string;
	room: string;
	i: number;
	dist: number;
	home: boolean;
	/** 视野到位后回填的真实源 id (消费方按 source id 查实测路长) */
	id?: string;
}

/**
 * 全图源注册 (上游 sources() 逐位): 本房 + 4 正邻 + 4 对角 (上游 diag 判据:
 * 与本房共享两条边才收, 即全部 4 对角), 每房 2 源 (SRC 固定布局假设由
 * find 实测替代), spawn→源 PathFinder 实测路长, home 优先 / dist 升序。
 * 关键差异 (AC 败因修正): PathFinder 对**不可见房**照常工作 (引擎地形全知),
 * 无视野也能开矿——scout 只是视野加速器, 不是开门前置。
 * 首次注册后 Memory 恒用 (上游同款缓存, 源位与地形不变)。
 */
export function remoteSourcesOf(ctx: TickContext, homeRoomName: string): RemoteSourceEntry[] {
	const cached = ctx.memory.economy.remoteSources;
	if (cached && cached.length > 0) return cached;
	const homeRoom = Game.rooms[homeRoomName];
	const origin = homeRoom?.find(FIND_MY_SPAWNS)[0]?.pos ?? undefined;
	if (!origin) return [];
	// neighborRooms 已含全部 8 邻房 (正交 + 对角), 勿再并 diagonalNeighbors
	// ——角落房双注册会吃掉预算槽 (20k 实证 4 槽只开 3 房)
	const rooms = [homeRoomName, ...neighborRooms(homeRoomName)];
	const list: RemoteSourceEntry[] = [];
	for (const roomName of rooms) {
		const room = Game.rooms[roomName];
		const sources = room ? room.find(FIND_SOURCES) : [];
		// 无视野房: 引擎 find 不可用, 但源位可从地形推 (上游固定 SRC 布局,
		// 我们无此假设)——退化为按房间级注册, dist 用 PathFinder 到房心的路径,
		// 矿工到达获视野后由 ensureRemoteSourceIntel 修正为逐源
		const anchors: Array<{ x: number; y: number }> = room
			? sources.map((s) => ({ x: s.pos.x, y: s.pos.y }))
			: [{ x: 25, y: 25 }];
		anchors.forEach((a, i) => {
			const r = PathFinder.search(origin, { pos: new RoomPosition(a.x, a.y, roomName), range: 1 }, { maxOps: 20000 });
			list.push({ k: `${roomName}:${i}`, room: roomName, i, dist: r.path.length, home: roomName === homeRoomName });
		});
	}
	list.sort((a, b) => (a.home === b.home ? a.dist - b.dist : a.home ? -1 : 1));
	ctx.memory.economy.remoteSources = list;
	return list;
}

/**
 * 有视野后的逐源修正 (源位实测定型): 把 room:0/room:1 的锚点从房心换成
 * 真实源位并重算 dist。矿工/reserver 首次进房时调用, 每条只修一次。
 */
export function ensureRemoteSourceIntel(ctx: TickContext, homeRoomName: string, remoteRoomName: string): void {
	const cached = ctx.memory.economy.remoteSources;
	if (!cached) return;
	const room = Game.rooms[remoteRoomName];
	if (!room) return;
	const sources = room.find(FIND_SOURCES);
	const origin = Game.rooms[homeRoomName]?.find(FIND_MY_SPAWNS)[0]?.pos;
	if (!origin) return;
	for (const entry of cached) {
		if (entry.room !== remoteRoomName) continue;
		const src = entry.id ? sources.find((s) => s.id === entry.id) : sources[entry.i];
		if (!src) continue;
		if (entry.id) continue; // 已绑定真实源位, 不重算
		const r = PathFinder.search(origin, { pos: src.pos, range: 1 }, { maxOps: 20000 });
		entry.dist = r.path.length;
		entry.id = src.id;
	}
	cached.sort((a, b) => (a.home === b.home ? a.dist - b.dist : a.home ? -1 : 1));
}

/**
 * 单源实测路长登记 (视野内源直接绑定 id + dist; 注册表未初始化时先建)。
 * 消费方: 换班提前量与搬运定编的 walkLead。
 */
export function registerRemoteSourceDist(
	ctx: TickContext,
	homeRoomName: string,
	source: Source,
	roomName: string,
): number {
	const cached = ctx.memory.economy.remoteSources;
	if (cached) {
		const hit = cached.find((e) => e.id === source.id);
		if (hit) return hit.dist;
	}
	const origin = Game.rooms[homeRoomName]?.find(FIND_MY_SPAWNS)[0]?.pos;
	if (!origin) return 0;
	const r = PathFinder.search(origin, { pos: source.pos, range: 1 }, { maxOps: 20000 });
	if (cached) {
		cached.push({ k: `${roomName}:${source.id}`, room: roomName, i: -1, dist: r.path.length, home: false, id: source.id });
		cached.sort((a, b) => (a.home === b.home ? a.dist - b.dist : a.home ? -1 : 1));
	}
	return r.path.length;
}

/** 远程源旁容器 (可见房直查): 距源 ≤ containerRange 的第一个容器 */
function remoteSourceContainer(
	room: Room,
	source: Source,
): StructureContainer | undefined {
	return room
		.find(FIND_STRUCTURES, {
			filter: (s): s is StructureContainer =>
				s.structureType === STRUCTURE_CONTAINER &&
				s.pos.inRangeTo(source.pos, REMOTE_CARRY_CONFIG.containerRange),
		})
		.find((c) => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0 || c.store.energy > 0);
}

/**
 * 远程容器回运任务 (bugs/race-strategy-port W1-2): 源旁容器存量过阈值即产
 * carry (容器→本矿), 远程矿工驻源卸容器、本矿 carrier 跨房拉回——
 * 5W 矿工自回运的长途往返是采集面塌陷主因 (2×路程 tick 全程 0 采集)。
 */
function upsertRemoteCarry(
	ctx: TickContext,
	board: TaskBoard,
	homeRoomName: string,
	remoteRoom: Room,
	source: Source,
	expected: Set<string>,
): void {
	const container = remoteSourceContainer(remoteRoom, source);
	if (
		container &&
		container.store.energy >= container.store.getCapacity(RESOURCE_ENERGY) * REMOTE_CARRY_CONFIG.carryTriggerRatio
	) {
		const key = `carry:${homeRoomName}:remote:${container.id}`;
		expected.add(key);
		board.upsert(
			{
				dedupeKey: key,
				kind: "carry",
				roomName: homeRoomName,
				targetId: container.id,
				targetPos: {
					x: container.pos.x,
					y: container.pos.y,
					roomName: remoteRoom.name,
				},
				amount: container.store.energy,
				priority: REMOTE_CARRY_CONFIG.carryPriority,
				requiredCapabilities: ["carry", "move"],
			},
			ctx.tick,
		);
	}
	// 无容器/容器未到发车线的矿工 drop: 堆量过线即回运——远程能量不回运
	// 等于白挖 (堆按 ENERGY_DECAY 衰减), 这是外矿收入真正的实现段。
	// 批次 AD (上游 hauler 口径): 未预订源照拉 (上游 5/t 照 haul, 预订翻倍
	// 由 reserver 跟进); rush 档堆线降为 100 (驻点矿工 10/t, 500 线要攒 50t,
	// 期间堆衰减)——manual 档维持 500 (boot 实证 L3 慢 1,374t 的细流教训)。
	const reservedByMe =
		myUsername() !== undefined &&
		remoteRoom.controller?.reservation?.username === myUsername();
	const rushDrop = roomModeProfileFor(ctx, homeRoomName).remoteMining === "auto";
	if (!reservedByMe && remoteRoom.controller?.reservation) return; // 他人预订不碰
	const dropLine = rushDrop ? 100 : REMOTE_CARRY_CONFIG.dropMinAmount;
	for (const drop of remoteRoom.find(FIND_DROPPED_RESOURCES, {
		filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= dropLine,
	})) {
		const key = `carry:${homeRoomName}:remote:drop:${drop.pos.x},${drop.pos.y}`;
		expected.add(key);
		board.upsert(
			{
				dedupeKey: key,
				kind: "carry",
				roomName: homeRoomName,
				targetId: drop.id,
				targetPos: { x: drop.pos.x, y: drop.pos.y, roomName: remoteRoom.name },
				amount: drop.amount,
				priority: REMOTE_CARRY_CONFIG.carryPriority,
				requiredCapabilities: ["carry", "move"],
			},
			ctx.tick,
		);
	}
}

/** 外矿回运任务自清: 未被本轮货源覆盖的空闲任务 (容器拆/堆消失) 取消。
 *  已租用/在途任务保留——载体可能在返程, 撤销会让载着的能量失去交付目标。 */
function cancelStaleRemoteCarryTasks(
	ctx: TickContext,
	board: TaskBoard,
	roomName: string,
	expected: ReadonlySet<string>,
): void {
	for (const task of board.list({ kinds: ["carry"], roomName, statuses: ["available"] })) {
		const target = task.targetPos?.roomName;
		if (!target || target === task.roomName) continue;
		if (!expected.has(task.dedupeKey)) {
			board.cancel(task.id, ctx.tick, "subject-gone");
		}
	}
}

/**
 * 外矿任务产出 (remoteMining 政策, 用户口径 2026-10-15):
 * - "auto" (仅 rush): 自动扫描发展——邻房不可见派 scout, 可见无主即登记采集;
 * - "manual" (main 系): 只挖 Memory.Nexus.economy.remoteTargets 显式登记的源,
 *   未登记的邻房一概不碰 (侦查也不派);
 * - "off": 不挖。
 */
export function planRemoteHarvest(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
): void {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (profile.remoteMining === "off") return;
	// 本轮实际存在的回运货源 (容器/掉落堆), 用于清掉消失货源的残留任务
	const expectedCarryKeys = new Set<string>();

	// 批次 AD (上游整体口径): RCL2 即开门, 无 RCL3/secured 门——上游
	// REMOTES[rcl] RCL2=4 源; secured 门转由 spawnArbiter 分支序闸承接
	// (外矿请求在本矿采集面饱和线后, 不再靠任务板前置门)。
	if (profile.remoteMining === "auto" && room.rcl >= 2) {
		planAutoRemote(ctx, room, board, expectedCarryKeys);
		cancelStaleRemoteCarryTasks(ctx, board, room.roomName, expectedCarryKeys);
		return;
	}

	if (profile.remoteMining === "manual") {
		const targets = ctx.memory.economy.remoteTargets ?? [];
		for (const targetRoomName of targets) {
			const remoteRoom = Game.rooms[targetRoomName];
			// 无视野: 对手动指定的房间定向侦查 (不扫列表外邻房)
			if (!remoteRoom) {
				board.upsert({
					dedupeKey: `scout:${room.roomName}:${targetRoomName}`,
					kind: "scout",
					roomName: room.roomName,
					targetPos: { x: 25, y: 25, roomName: targetRoomName },
					priority: priorityFor("scout"),
					requiredCapabilities: ["move"],
				}, ctx.tick);
				continue;
			}
			if (remoteRoom.controller?.my) continue;
			if (remoteRoom.controller?.owner) continue;
			// 预订线 (对齐 Rosmarin race): 未预订源容量减半 (1500 vs 3000),
			// 收入翻倍的前置。衰减到续订线以下即重发 (防裸奔减半期);
			// 他人预订不抢 (reserveController 对他订无效, 派件纯浪费)。
			const reservation = remoteRoom.controller?.reservation;
			const mine = myUsername() !== undefined && reservation?.username === myUsername();
			if (
				remoteRoom.controller &&
				(!reservation || (mine && reservation.ticksToEnd < RESERVE_CONFIG.refreshTicks))
			) {
				board.upsert({
					dedupeKey: `reserve:${room.roomName}:${targetRoomName}`,
					kind: "reserve",
					roomName: room.roomName,
					targetId: remoteRoom.controller.id,
					targetPos: {
						x: remoteRoom.controller.pos.x,
						y: remoteRoom.controller.pos.y,
						roomName: targetRoomName,
					},
					priority: priorityFor("reserve"), // 预订是外矿收入翻倍的前置, 与侦查同档
					requiredCapabilities: ["claim", "move"],
				}, ctx.tick);
			}
			for (const source of remoteRoom.find(FIND_SOURCES)) {
				board.upsert({
					dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
					kind: "harvest",
					roomName: room.roomName,
					targetId: source.id,
					targetPos: {
						x: source.pos.x,
						y: source.pos.y,
						roomName: targetRoomName,
					},
					priority: priorityFor("harvest"), // 与本矿对齐: urgent 门 (70) 之下远程工恒无替补 (bugs (十二))
					requiredCapabilities: ["work", "move"],
				}, ctx.tick);
				upsertRemoteCarry(ctx, board, room.roomName, remoteRoom, source, expectedCarryKeys);
			}
		}
		cancelStaleRemoteCarryTasks(ctx, board, room.roomName, expectedCarryKeys);
		return;
	}
}

/**
 * auto 档外矿主链 (批次 AD, 上游 getActiveSources 口径):
 * - 全图注册表 remoteSourcesOf (16+ 源, home 优先 dist 升序);
 * - 容量驱动预算: 剩余孵化部件容量 ÷ 每源开销 (上游背包容量同源);
 * - 有视野房: 常规登记 (预订 + harvest + 回运 + 情报修正);
 * - 无视野房: 直接登记注册表条目对应的**源位未知**任务——矿工带注册表
 *   dist 出发, 到达获视野后 ensureRemoteSourceIntel 修正源位。
 *   上游同款: 无视野不是开门前置 (引擎地形全知)。
 */
function planAutoRemote(
	ctx: TickContext,
	room: RoomObservation,
	board: TaskBoard,
	expected: Set<string>,
): void {
	const rcl = room.rcl;
	if (rcl < 2) return;
	const all = remoteSourcesOf(ctx, room.roomName);
	// 容量驱动预算 (上游 getActiveSources 背包口径, 批次 AD 三轮): 剩余孵化
	// 部件容量 ÷ 每源开销——本地编制先扣 (remoteSpawnLeftoverOf 同源), 余量
	// 自然限制外矿扩张; RCL 固定表 ([.., 4, 16, ..]) 是对上游的误读, RCL3 一夜
	// 16 源会挤爆孵化线重演 AC 病理。已在岗远程件从容量实扣 (非按任务数虚算)。
	const leftover = remoteSpawnLeftoverOf(ctx, room.roomName);
	// 已占坑: 在岗远程件部件实扣
	let usedParts = 0;
	for (const record of Object.values(ctx.memory.units)) {
		if (record.homeRoom !== room.roomName) continue;
		const creep = Game.creeps[record.name];
		if (!creep) continue;
		const code = unitCode(record.unitCode);
		if (code !== UNIT_CODES.remoteMiner && code !== UNIT_CODES.reserver) continue;
		const taskId = creep.memory.taskId;
		const taskRoom = taskId !== undefined ? ctx.memory.tasks[taskId]?.targetPos?.roomName : undefined;
		if (taskRoom === undefined || taskRoom === room.roomName) continue;
		usedParts += creep.body.length;
	}
	// 每源开销 ~30 部件当量: 矿工 9 件 × 寿命系数 + hauler 距离折算
	// (上游 computeRemoteSourceSpawnUsage: minerBody × 1500/(1500-dist) + dist×0.08)
	const budget = Math.floor((leftover - usedParts) / 30);
	if (budget <= 0) return;
	// 预算裁剪: 本矿源恒保留 (home), 远程取最近 N 条 (上游 remotes slice 同款)
	const remotes: RemoteSourceEntry[] = [];
	for (const entry of all) {
		if (entry.home) continue;
		if (remotes.length >= budget) break;
		remotes.push(entry);
	}
	// 按房分组登记 (预订每房一条)
	const byRoom = new Map<string, RemoteSourceEntry[]>();
	for (const entry of remotes) {
		const list = byRoom.get(entry.room);
		if (list) list.push(entry);
		else byRoom.set(entry.room, [entry]);
	}
	// 占位任务退役前置: 有视野的房一律撤 probe (不限预算内)——视野到达后
	// dist 修正可能把该房挤出预算, 遍历内撤销会漏, probe 与正式任务并存
	// 分裂定编 (20k 实证 3 房双份任务)
	for (const probe of board.list({ kinds: ["harvest"], roomName: room.roomName, statuses: ["available", "leased", "in_progress"] })) {
		const probeRoom = probe.targetPos?.roomName;
		if (probe.targetId === undefined && probeRoom !== undefined && Game.rooms[probeRoom]) {
			board.cancel(probe.id, ctx.tick, "subject-gone");
		}
	}
	for (const [neighborName, entries] of byRoom) {
		const neighbor = Game.rooms[neighborName];
		if (neighbor) {
			// 有视野: 占位退役已前置统一处理, 这里只做情报修正 + 己方/有主跳过
			ensureRemoteSourceIntel(ctx, room.roomName, neighborName);
			if (neighbor.controller?.my || neighbor.controller?.owner) continue;
			if (neighbor.find(FIND_SOURCES).length === 0) continue;
			const reservation = neighbor.controller?.reservation;
			const mine = myUsername() !== undefined && reservation?.username === myUsername();
			if (
				neighbor.controller &&
				(!reservation || (mine && reservation.ticksToEnd < RESERVE_CONFIG.refreshTicks))
			) {
				board.upsert({
					dedupeKey: `reserve:${room.roomName}:${neighborName}`,
					kind: "reserve",
					roomName: room.roomName,
					targetId: neighbor.controller.id,
					targetPos: { x: neighbor.controller.pos.x, y: neighbor.controller.pos.y, roomName: neighborName },
					priority: priorityFor("reserve"),
					requiredCapabilities: ["claim", "move"],
				}, ctx.tick);
			}
			for (const source of neighbor.find(FIND_SOURCES)) {
				registerRemoteSourceDist(ctx, room.roomName, source, neighborName);
				board.upsert({
					dedupeKey: `harvest:${room.roomName}:remote:${source.id}`,
					kind: "harvest",
					roomName: room.roomName,
					targetId: source.id,
					targetPos: { x: source.pos.x, y: source.pos.y, roomName: neighborName },
					priority: priorityFor("harvest"),
					requiredCapabilities: ["work", "move"],
				}, ctx.tick);
				upsertRemoteCarry(ctx, board, room.roomName, neighbor, source, expected);
			}
			continue;
		}
		// 无视野: 上游同款直接开矿 (引擎地形全知, 无视野不是前置)——发
		// **无 targetId 占位采集任务** (矿工到房获视野后自认空闲源, 下一 tick
		// 走有视野分支挂带 id 的正式任务), scout 并行加速视野; 注册表条目
		// 已含实测 dist, 换班提前量不依赖视野。
		board.upsert({
			dedupeKey: `harvest:${room.roomName}:remote:${neighborName}:probe${entries[0]?.i ?? 0}`,
			kind: "harvest",
			roomName: room.roomName,
			targetPos: { x: 25, y: 25, roomName: neighborName },
			priority: priorityFor("harvest"),
			requiredCapabilities: ["work", "move"],
		}, ctx.tick);
		expected.add(`harvest:${room.roomName}:remote:${neighborName}:probe${entries[0]?.i ?? 0}`);
		board.upsert({
			dedupeKey: `scout:${room.roomName}:${neighborName}`,
			kind: "scout",
			roomName: room.roomName,
			targetPos: { x: 25, y: 25, roomName: neighborName },
			priority: priorityFor("scout"),
			requiredCapabilities: ["move"],
		}, ctx.tick);
	}
}

/** 活跃远程采集任务数 (定编口径: 本矿 harvester 编制 = 本矿源数 + 远程任务数)。
 *  带 resourceType 的 harvest 是过道矿合约 (economy/mineralWork, directSpawn
 *  桥接自孵战斗件), 不计入 harvester 定编。 */
export function activeRemoteHarvestCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["harvest"] })) {
		if (task.resourceType !== undefined) continue;
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/**
 * 活跃外矿回运任务数 (定编口径): 每个容器/掉落堆回运点都需要专属运力。
 * 本矿 carrier 定编只覆盖本矿货源, 不计这批任务则外矿能量在源头衰减,
 * 回运任务恒 available。
 */
export function activeRemoteCarryCount(ctx: TickContext, board: TaskBoard): number {
	let n = 0;
	for (const task of board.list({ kinds: ["carry"] })) {
		if (task.targetPos?.roomName && task.targetPos.roomName !== task.roomName) n++;
	}
	return n;
}

/** 外矿待回运存量 (能量): 容器/掉落堆任务登记量之和, 作为运力加编信号 */
export function activeRemoteCarryBacklog(ctx: TickContext, board: TaskBoard): number {
	let total = 0;
	for (const task of board.list({ kinds: ["carry"] })) {
		if (!task.targetPos?.roomName || task.targetPos.roomName === task.roomName) continue;
		total += task.amount ?? 0;
	}
	return total;
}

/** 活跃侦查任务数 (定编口径): rush 档 3 房预算下 scout 任务 ≤3, 并行侦察
 *  才能跟上外矿扩张节奏——恒 1 串行侦察时 2 房 scout 任务长期 available
 *  无人认领, 外矿预算空转 (t30k 实证: 预算 3 房只用 1 房, race 同期 8 房全开)。
 *  并行受生产安全门钳制: 采集面未铺满时 scout 是能量税 (speedrun t10k 累计
 *  39k→32.8k 实证), 先保本地产出再摊侦察 */
export function activeScoutCount(ctx: TickContext, board: TaskBoard): number {
	const rooms = Object.values(ctx.world.current?.rooms ?? {});
	const secured = rooms.length > 0 && rooms.every((room) => isProductionSecured(ctx, room));
	if (!secured) {
		return 1;
	}
	return Math.min(board.list({ kinds: ["scout"] }).length, SCOUT_CONFIG.parallelCap);
}

/**
 * 本矿登记在板的远程源加权数 (升级定编口径, bugs (十二)): kind=harvest 且目标房 ≠ 本矿。
 * 直读 memory.tasks 原始记录 (升级定编每 tick 逐房调用, 不重复建板)。
 * 预订口径 (对齐 Rosmarin race): 己方预订源满容量 3000 记 1; 未预订源容量减半记 0.5
 * (防升级体按虚高收入超编, 外矿断供期反噬本地采集面)。
 * @deprecated 收入口径统一 (specs/resource-ledger): 折算逻辑迁 income.ts 的
 * remoteSourceWeightOf, 本包装仅供旧引用过渡, 随 legacy 清理移除。
 */
export function activeRemoteSourceCount(ctx: TickContext, roomName: string): number {
	return remoteSourceWeightOf(ctx, roomName);
}
