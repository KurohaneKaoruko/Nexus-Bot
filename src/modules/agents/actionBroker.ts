/**
 * ActionBroker (api/06): 行动提案登记与统一提交。
 * submit 只登记不执行; commit 按管线仲裁 (同 actor 同管线留最高优先级,
 * 跨管线并行) 后校验、检查所有权并调用原生 API —— 全项目唯一的原生行动调用点。
 */
import type { NexusTask, SerializedPosition } from "@/core/store/taskSchema";
import type { Logger } from "@/core/logger";
import { assertOwner } from "@/runtime/actorOwnership";

export type ActionKind =
	| "move"
	| "harvest"
	| "pickup"
	| "withdraw"
	| "transfer"
	| "build"
	| "upgradeController"
	| "drop"
	| "attack"
	| "rangedAttack"
	| "heal"
	| "repair"
	| "activateSafeMode"
	| "suicide"
	| "createSite"
	| "removeSite"
	| "destroyStructure"
	| "spawnCreep"
	| "cancelSpawn"
	| "marketDeal"
	| "terminalSend"
	| "cancelMarketOrder"
	| "claimController"
	| "reserveController"
	| "usePower"
	| "enableRoom"
	| "combatMove"
	| "combatStep"
	| "combatStrike"
	| "combatHealAction"
	| "combatMoveByPath"
	| "createFlag"
	| "removeFlag"
	| "runLabReaction"
	| "factoryProduce"
	| "processPowerSpawn"
	| "createMarketOrder"
	| "changeMarketOrderPrice"
	| "extendMarketOrder";

/** combat = Creep 战斗; tower = 塔结构行动; defense = 房间级防御意图 (SafeMode);
 *  construction = 工地/结构变更; spawn = 孵化; market = 交易/发送;
 *  claim = 占领/预订; power = PowerCreep 能力; flag = 旗标创建/移除 */
export type ActionPipeline =
	| "move"
	| "work"
	| "carry"
	| "controller"
	| "combat"
	| "tower"
	| "defense"
	| "construction"
	| "spawn"
	| "market"
	| "claim"
	| "power"
	| "flag";

export interface ActionPlan {
	id: string;
	tick: number;
	/** 持有租约的任务 ID; 结构 actor (塔/SafeMode) 无任务, 可缺省 */
	taskId?: string | undefined;
	actorName: string;
	kind: ActionKind;
	targetId?: string | undefined;
	targetPos?: SerializedPosition | undefined;
	resourceType?: ResourceConstant | undefined;
	amount?: number | undefined;
	priority: number;
	pipeline: ActionPipeline;
	dedupeKey: string;
	/** 移动意图场景标签 (任务 5.1: 目标/优先级/理由三元): 如 "scout-room"/"return-home",
	 *  供结果回投与移动遥测按场景归因; 非移动管线可缺省 */
	reason?: string | undefined;
	/** 扩展参数 (新管线的命令载荷; 按管线解释) */
	payload?: ActionPayload | undefined;
}

/** 新管线命令载荷: 按管线解释, 未列字段忽略 */
export interface ActionPayload {
	/** createSite: 结构类型常量名 */
	structureType?: BuildableStructureConstant;
	/** spawnCreep: 体型 */
	body?: BodyPartConstant[];
	/** spawnCreep: 孵化名 */
	creepName?: string;
	/** spawnCreep: 记忆 */
	memory?: Record<string, unknown>;
	/** marketDeal: 买单/卖单 ID */
	orderId?: string;
	/** terminalSend: 目的房 */
	destinationRoom?: string;
	/** marketDeal/terminalSend: 资源描述已由 resourceType 承载 */
	/** createMarketOrder: 挂单价/总量; changeMarketOrderPrice: 新价 (静态注入也经 payload 承载) */
	/** runLabReaction: 反应底物 lab */
	/** usePower: PowerConstant 数值 */
	power?: number;
	/** combatStrike: 打击方式 (近战/远程/范围远程) */
	strike?: "attack" | "rangedAttack" | "rangedMassAttack";
	/** combatStrike: 目标类别 (Creep 或 Structure, 决定解析口径) */
	strikeTarget?: "creep" | "structure";
	/** combatHealAction: 治疗方式 (近身/远程) */
	healMode?: "heal" | "rangedHeal";
	/** combatStep: 移动方向 (1-8) */
	direction?: number;
	/** combatMove: 移动选项 (range/视觉样式/成本回调等, 原样透传给 moveTo) */
	moveOpts?: MoveOptsPayload;
	/** combatMoveByPath: 路径点序列 */
	path?: { x: number; y: number; roomName: string }[];
	/** createFlag/removeFlag: 旗标名 */
	flagName?: string;
	/** createFlag: 旗标颜色 */
	color?: ColorConstant;
	/** createFlag: 旗标副色 */
	secondaryColor?: ColorConstant;
	/** runLabReaction: 反应底物 lab (lab1/lab2 与原生 API 同序) */
	lab1Id?: string;
	lab2Id?: string;
	/** createMarketOrder: 订单方向 (买单/卖单) */
	orderType?: "buy" | "sell";
	/** createMarketOrder: 挂单价 */
	price?: number;
	/** createMarketOrder: 挂单总量 */
	totalAmount?: number;
}

/** combatMove 的移动选项载荷: 字段原样映射 MoveToOpts; costCallback 为函数引用, 仅限同 Tick 消费 */
export interface MoveOptsPayload {
	range?: number;
	visualizePathStyle?: { stroke: string };
	ignoreCreeps?: boolean;
	maxRooms?: number;
	reusePath?: number;
	costCallback?: (roomName: string, costMatrix: CostMatrix) => void;
}

export type ResultCategory = "accepted" | "retryable" | "replan" | "invalid" | "suppressed";

/**
 * 命令结果 (api/17 command-boundary spec 结果语义真实):
 * - category: 内部处置五分类, 必有;
 * - nativeReturnCode: 原生 API 返回码, 仅在命令真正触达原生 API 时存在;
 *   校验/仲裁阶段被拒的命令 MUST NOT 伪造该字段 (缺省即"未触达")。
 */
export interface ActionResult {
	planId: string;
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	accepted: boolean;
	nativeReturnCode?: number;
	category: ResultCategory;
	reason?: string;
	/** 在途意图的场景标签 (任务 5.1 理由回投): 来自 ActionPlan.reason, 供遥测归因 */
	intentReason?: string | undefined;
	/** 本 tick 实际转移的能量 (transfer 交付量记账口径, 执行侧 carry 差分) */
	movedEnergy?: number;
}

export interface BrokerDeps {
	logger: Logger;
	/** 任务查询与 replan 反馈 (fail 会计尝试次数并按上限终态化) */
	getTask: (taskId: string) => NexusTask | undefined;
	onReplan: (taskId: string, creepName: string, reason: string) => void;
}

export interface ActionBroker {
	submit(plan: ActionPlan): void;
	commit(now: number): readonly ActionResult[];
	lastResult(actorName: string, pipeline?: ActionPipeline): ActionResult | undefined;
	/**
	 * 立即执行单条命令 (不经仲裁队列): 供 commit 阶段晚于 broker 的
	 * 直接孵化/紧急命令使用 —— 原生调用权仍在 broker, 只是同步窗口。
	 */
	executeNow(plan: ActionPlan): ActionResult;
}

/** 以 creep 为 actor 的管线 (所有权检查适用域); 结构/房间级 actor 无租约语义 */
const CREEP_PIPELINES: ReadonlySet<string> = new Set([
	"move",
	"work",
	"carry",
	"controller",
	"combat",
	"claim",
]);

/**
 * 房间级批量管线 (api/17 命令边界): actor 是房间/结构名, 一 pass 天然提交多条
 * 独立命令 (如布局放量一次放多个工地)。"同 actor 同 pipeline 留一"仲裁只对
 * creep 行动有意义 (一个机体一 tick 一个动作); 对批量管线做去重会把放量压成
 * 每 tick 1 条 (sim 实锤 45k 全房仅 6 工地, 源容器 0), 故豁免仲裁。
 */
const BATCH_PIPELINES: ReadonlySet<string> = new Set([
	"construction",
	"market",
	"claim",
	"power",
	"flag",
]);

export function createBroker(deps: BrokerDeps): ActionBroker {
	const plans = new Map<string, ActionPlan>();
	const lastResults = new Map<string, ActionResult>();

	function submit(plan: ActionPlan): void {
		plans.set(plan.dedupeKey, plan);
	}

	function resolve<T extends _HasId>(id: string | undefined): T | undefined {
		return (id ? Game.getObjectById(id as Id<T>) : undefined) ?? undefined;
	}

	function triage(code: number): { accepted: boolean; category: ResultCategory } {
		switch (code) {
			case OK:
				return { accepted: true, category: "accepted" };
			case ERR_NOT_IN_RANGE:
			case ERR_TIRED:
			case ERR_NOT_ENOUGH_ENERGY:
			case ERR_NOT_ENOUGH_RESOURCES:
			case ERR_BUSY:
				return { accepted: false, category: "retryable" };
			case ERR_INVALID_TARGET:
			case ERR_FULL:
			case ERR_NO_BODYPART:
				return { accepted: false, category: "replan" };
			case ERR_NO_PATH:
				return { accepted: false, category: "replan" };
			default:
				return { accepted: false, category: "invalid" };
		}
	}

	function execute(plan: ActionPlan): ActionResult {
		const base = {
			planId: plan.id,
			actorName: plan.actorName,
			kind: plan.kind,
			pipeline: plan.pipeline,
			intentReason: plan.reason,
		};
	/** 未触达原生 API 的拒绝 (校验失败/租约丢失): 无 nativeReturnCode, 不伪造返回码 */
		const invalid = (reason: string): ActionResult => ({
			...base,
			accepted: false,
			category: "invalid",
			reason,
		});

		// 结构 actor (塔/SafeMode) 无租约语义, 走独立执行路径 (同样统一经本函数提交)
		if (plan.pipeline === "tower" || plan.pipeline === "defense") {
			return executeStructureAction(plan, base, invalid);
		}

		// 系统级管线 (construction/spawn/market/claim/power): 房间/结构/PC actor
		if (
			plan.pipeline === "construction" ||
			plan.pipeline === "spawn" ||
			plan.pipeline === "market" ||
			plan.pipeline === "claim" ||
			plan.pipeline === "power"
		) {
			return executeSystemAction(plan, base, invalid);
		}

		// 旗标管线 (flag): 编队指挥旗的创建/移除, actorName 为发起房名
		if (plan.pipeline === "flag") {
			return executeFlagAction(plan, base, invalid);
		}

		const creep = Game.creeps[plan.actorName];
		if (!creep || creep.spawning) {
			return invalid("actor-missing-or-spawning");
		}
		if (plan.taskId) {
			const task = deps.getTask(plan.taskId);
			if (!task || task.assignedTo !== plan.actorName) {
				return invalid("lease-lost");
			}
		}

		switch (plan.kind) {
			case "move": {
				if (!plan.targetPos) {
					return invalid("move-without-position");
				}
				const position = new RoomPosition(
					plan.targetPos.x,
					plan.targetPos.y,
					plan.targetPos.roomName,
				);
				// 同房目标禁出房寻路: 墙多地形上跨房捷径会把 creep 甩出视野, 在无人区耗死;
				// 跨房目标 (如归位) 保持默认跨房路由
				const code = creep.moveTo(position, {
					maxRooms: position.roomName === creep.pos.roomName ? 1 : 16,
				});
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "harvest": {
				const source = resolve<Source>(plan.targetId);
				if (!source) {
					const r: ActionResult = {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
					return r;
				}
				const code: number = creep.harvest(source);
				// 满载等待卸货不是任务失败 (无 carry 矿工落地采集 / 携带者等容器腾位): 重试不进失败计数
				if (code === ERR_FULL) {
					return {
						...base,
						accepted: false,
						nativeReturnCode: code,
						category: "retryable",
						reason: "carry-full",
					};
				}
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "pickup": {
				const pile = resolve<Resource>(plan.targetId);
				if (!pile) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.pickup(pile);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "withdraw": {
				const target = resolve<AnyStoreStructure>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				if ((target.store[plan.resourceType ?? RESOURCE_ENERGY] ?? 0) <= 0) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "store-empty",
					};
				}
				const code = creep.withdraw(target, plan.resourceType ?? RESOURCE_ENERGY);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "transfer": {
				const target = resolve<AnyStoreStructure>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				if (creep.store[plan.resourceType ?? RESOURCE_ENERGY] <= 0) {
					// 快照与实际负载出现偏差: 交回分配环重推导, 不作为无效告警刷屏
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "carry-empty",
					};
				}
				const before = creep.store[plan.resourceType ?? RESOURCE_ENERGY];
				const code = creep.transfer(target, plan.resourceType ?? RESOURCE_ENERGY);
				const t = triage(code);
				// 实际转移量按引擎应用口径折算: min(携带量, 目标空余)。
				// intent 在引擎相统一应用, JS 相内 store 不变, 差分法恒 0
				const free = target.store.getFreeCapacity(plan.resourceType ?? RESOURCE_ENERGY) ?? 0;
				const moved =
					code === OK ? Math.min(before, Math.max(0, free)) : 0;
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category, movedEnergy: moved };
			}
			case "build": {
				const site = resolve<ConstructionSite>(plan.targetId);
				if (!site) {
					// 工地建成/消失: replan 且视为成功路径 (任务完成由对账确认)
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "site-gone",
					};
				}
				const code = creep.build(site);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "upgradeController": {
				const controller = resolve<StructureController>(plan.targetId);
				if (!controller) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.upgradeController(controller);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "drop": {
				// 驻点矿工的卸货兜底: 落地成堆由 carrier 认领 (无目标结构)
				if (creep.store[plan.resourceType ?? RESOURCE_ENERGY] <= 0) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "carry-empty",
					};
				}
				const code = creep.drop(plan.resourceType ?? RESOURCE_ENERGY);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "attack": {
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.attack(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "rangedAttack": {
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.rangedAttack(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "heal": {
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.heal(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "repair": {
				const target = resolve<Structure>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = creep.repair(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "suicide": {
				// 快递交付: 墓碑能量落在升级消费圈 (specs/rush-courier); 无失败分支
				const code = creep.suicide();
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "combatMove": {
				const payload = plan.payload ?? {};
				if (!plan.targetPos) {
					return invalid("combatMove-missing-position");
				}
				const position = new RoomPosition(
					plan.targetPos.x,
					plan.targetPos.y,
					plan.targetPos.roomName,
				);
				const opts: MoveToOpts = {};
				if (payload.moveOpts) {
					const m = payload.moveOpts;
					if (m.range !== undefined) opts.range = m.range;
					if (m.visualizePathStyle) opts.visualizePathStyle = m.visualizePathStyle;
					if (m.ignoreCreeps !== undefined) opts.ignoreCreeps = m.ignoreCreeps;
					if (m.maxRooms !== undefined) opts.maxRooms = m.maxRooms;
					if (m.reusePath !== undefined) opts.reusePath = m.reusePath;
					if (m.costCallback) opts.costCallback = m.costCallback;
				}
				const code = creep.moveTo(position, opts);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "combatStep": {
				const payload = plan.payload ?? {};
				const direction = payload.direction;
				if (!direction || direction < 1 || direction > 8) {
					return invalid("combatStep-bad-direction");
				}
				const code = creep.move(direction as DirectionConstant);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "combatStrike": {
				const payload = plan.payload ?? {};
				const strike = payload.strike;
				if (strike === "rangedMassAttack") {
					const code = creep.rangedMassAttack();
					const t = triage(code);
					return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
				}
				if (!plan.targetId || (strike !== "attack" && strike !== "rangedAttack")) {
					return invalid("combatStrike-bad-args");
				}
				const target =
					payload.strikeTarget === "structure"
						? resolve<Structure>(plan.targetId)
						: resolve<AnyCreep>(plan.targetId);
				if (!target) {
					return { ...base, accepted: false, category: "replan", reason: "target-gone" };
				}
				const code =
					strike === "attack" ? creep.attack(target) : creep.rangedAttack(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "combatHealAction": {
				const payload = plan.payload ?? {};
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return { ...base, accepted: false, category: "replan", reason: "target-gone" };
				}
				const code =
					payload.healMode === "rangedHeal" ? creep.rangedHeal(target) : creep.heal(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "combatMoveByPath": {
				const payload = plan.payload ?? {};
				if (!payload.path?.length) {
					return invalid("combatMoveByPath-missing-path");
				}
				const path = payload.path.map((p) => new RoomPosition(p.x, p.y, p.roomName));
				const code = creep.moveByPath(path);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			default:
				return invalid("unknown-kind");
		}
	}

	/** 旗标执行: 编队指挥旗创建/移除 (房级命令, 无租约语义) */
	function executeFlagAction(
		plan: ActionPlan,
		base: { planId: string; actorName: string; kind: ActionKind; pipeline: ActionPipeline },
		invalid: (reason: string) => ActionResult,
	): ActionResult {
		const payload = plan.payload ?? {};
		switch (plan.kind) {
			case "createFlag": {
				if (!plan.targetPos || !payload.flagName) {
					return invalid("createFlag-missing-args");
				}
				// 无视野房借引擎原生实现 + 伪 room 接收者建旗 (与 RoomPosition.createFlag
				// 原型重写同口径); 编队指挥旗常落在尚无视野的目标房
				const visibleRoom = Game.rooms[plan.targetPos.roomName];
				const pos = new RoomPosition(plan.targetPos.x, plan.targetPos.y, plan.targetPos.roomName);
				// RoomPosition.createFlag 原型重写: 无视野房借原生实现 + 伪 room 建旗
				const code = visibleRoom
					? visibleRoom.createFlag(
							plan.targetPos.x,
							plan.targetPos.y,
							payload.flagName,
							payload.color,
							payload.secondaryColor,
						)
					: pos.createFlag(
							payload.flagName,
							payload.color ?? COLOR_WHITE,
							payload.secondaryColor ?? COLOR_WHITE,
						);
				// createFlag 成功返回旗标名 (字符串), 失败返回负数错误码
				if (typeof code === "string") {
					return { ...base, accepted: true, category: "accepted" };
				}
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "removeFlag": {
				if (!payload.flagName) {
					return invalid("removeFlag-missing-name");
				}
				const flag = Game.flags[payload.flagName];
				if (!flag) {
					return { ...base, accepted: false, category: "replan", reason: "flag-gone" };
				}
				const code = flag.remove();
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			default:
				return invalid("unknown-kind");
		}
	}

	/** 结构 actor 执行: 塔 (攻击/治疗/修缮) 与 controller (SafeMode), 无租约检查 */
	function executeStructureAction(
		plan: ActionPlan,
		base: { planId: string; actorName: string; kind: ActionKind; pipeline: ActionPipeline },
		invalid: (reason: string) => ActionResult,
	): ActionResult {
		if (plan.kind === "activateSafeMode") {
			const controller = resolve<StructureController>(plan.targetId ?? plan.actorName);
			if (!controller) {
				return invalid("controller-gone");
			}
			const code = controller.activateSafeMode();
			const t = triage(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		const tower = resolve<StructureTower>(plan.actorName);
		if (!tower) {
			return invalid("tower-gone");
		}
		switch (plan.kind) {
			case "attack": {
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = tower.attack(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "heal": {
				const target = resolve<Creep>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = tower.heal(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "repair": {
				const target = resolve<Structure>(plan.targetId);
				if (!target) {
					return {
						...base,
						accepted: false,
						category: "replan",
						reason: "target-gone",
					};
				}
				const code = tower.repair(target);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			default:
				return invalid("unknown-kind");
		}
	}

	/**
	 * 新管线执行 (construction/spawn/market/claim/power, api/17 command-boundary):
	 * 房间级命令, actorName 为发起房名或结构 ID; 无任务租约语义, 走独立路径。
	 */
	function executeSystemAction(
		plan: ActionPlan,
		base: { planId: string; actorName: string; kind: ActionKind; pipeline: ActionPipeline },
		invalid: (reason: string) => ActionResult,
	): ActionResult {
		const payload = plan.payload ?? {};
		switch (plan.kind) {
			case "createSite": {
				if (!plan.targetPos || !payload.structureType) {
					return invalid("createSite-missing-args");
				}
				const room = Game.rooms[plan.targetPos.roomName];
				if (!room) {
					return invalid("room-not-visible");
				}
				const code = room.createConstructionSite(
					plan.targetPos.x,
					plan.targetPos.y,
					payload.structureType,
				);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "removeSite": {
				const site = resolve<ConstructionSite>(plan.targetId);
				if (!site) {
					return { ...base, accepted: false, category: "replan", reason: "site-gone" };
				}
				const code = site.remove();
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "destroyStructure": {
				const structure = resolve<Structure>(plan.targetId);
				if (!structure) {
					return { ...base, accepted: false, category: "replan", reason: "structure-gone" };
				}
				const code = structure.destroy();
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "spawnCreep": {
				const spawn = resolve<StructureSpawn>(plan.targetId ?? plan.actorName);
				if (!spawn) {
					return invalid("spawn-gone");
				}
				if (!payload.body || !payload.creepName) {
					return invalid("spawnCreep-missing-args");
				}
				const code = spawn.spawnCreep(
					payload.body,
					payload.creepName,
					payload.memory ? { memory: payload.memory as CreepMemory } : undefined,
				);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "cancelSpawn": {
				const spawn = resolve<StructureSpawn>(plan.targetId ?? plan.actorName);
				if (!spawn) {
					return invalid("spawn-gone");
				}
				const code = spawn.spawning
					? spawn.spawning.cancel()
					: ERR_BUSY;
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "marketDeal": {
				if (!payload.orderId || !plan.resourceType || plan.amount === undefined) {
					return invalid("marketDeal-missing-args");
				}
				const room = Game.rooms[plan.actorName];
				if (!room?.terminal) {
					return invalid("no-terminal");
				}
				const order = Game.market.getAllOrders().find((o) => o.id === payload.orderId);
				if (!order) {
					return { ...base, accepted: false, category: "replan", reason: "order-gone" };
				}
				const code = Game.market.deal(order.id, plan.amount, plan.actorName);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "terminalSend": {
				const room = Game.rooms[plan.actorName];
				if (!room?.terminal) {
					return invalid("no-terminal");
				}
				if (!payload.destinationRoom || !plan.resourceType || plan.amount === undefined) {
					return invalid("terminalSend-missing-args");
				}
				const code = room.terminal.send(
					plan.resourceType,
					plan.amount,
					payload.destinationRoom,
				);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "cancelMarketOrder": {
				if (!payload.orderId) {
					return invalid("cancelMarketOrder-missing-args");
				}
				const code = Game.market.cancelOrder(payload.orderId);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "createMarketOrder": {
				if (!payload.orderType || !plan.resourceType || payload.price === undefined ||
					payload.totalAmount === undefined) {
					return invalid("createMarketOrder-missing-args");
				}
				const room = Game.rooms[plan.actorName];
				if (!room) {
					return invalid("room-not-visible");
				}
				const code = Game.market.createOrder({
					type: payload.orderType,
					resourceType: plan.resourceType,
					price: payload.price,
					totalAmount: payload.totalAmount,
					roomName: room.name,
				});
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "changeMarketOrderPrice": {
				if (!payload.orderId || payload.price === undefined) {
					return invalid("changeMarketOrderPrice-missing-args");
				}
				const code = Game.market.changeOrderPrice(payload.orderId, payload.price);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "extendMarketOrder": {
				if (!payload.orderId || plan.amount === undefined) {
					return invalid("extendMarketOrder-missing-args");
				}
				const code = Game.market.extendOrder(payload.orderId, plan.amount);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "runLabReaction": {
				if (!payload.lab1Id || !payload.lab2Id) {
					return invalid("runLabReaction-missing-args");
				}
				const lab = resolve<StructureLab>(plan.actorName);
				if (!lab) {
					return invalid("lab-gone");
				}
				const lab1 = resolve<StructureLab>(payload.lab1Id);
				const lab2 = resolve<StructureLab>(payload.lab2Id);
				if (!lab1 || !lab2) {
					return { ...base, accepted: false, category: "replan", reason: "substrate-lab-gone" };
				}
				const code = lab.runReaction(lab1, lab2);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "factoryProduce": {
				if (!plan.resourceType) {
					return invalid("factoryProduce-missing-args");
				}
				const factory = resolve<StructureFactory>(plan.actorName);
				if (!factory) {
					return invalid("factory-gone");
				}
				const code = factory.produce(plan.resourceType as CommodityConstant);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "processPowerSpawn": {
				const powerSpawn = resolve<StructurePowerSpawn>(plan.actorName);
				if (!powerSpawn) {
					return invalid("powerSpawn-gone");
				}
				const code = powerSpawn.processPower();
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "claimController":
			case "reserveController": {
				const creep = Game.creeps[plan.actorName];
				if (!creep || creep.spawning) {
					return invalid("actor-missing-or-spawning");
				}
				const controller = resolve<StructureController>(plan.targetId);
				if (!controller) {
					return { ...base, accepted: false, category: "replan", reason: "controller-gone" };
				}
				const code =
					plan.kind === "claimController"
						? creep.claimController(controller)
						: creep.reserveController(controller);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "usePower": {
				const powerCreep = Game.powerCreeps[plan.actorName as Id<PowerCreep>];
				if (!powerCreep || !powerCreep.room) {
					return invalid("powerCreep-not-in-world");
				}
				if (payload.power === undefined) {
					return invalid("usePower-missing-args");
				}
				const target = plan.targetId
					? (Game.getObjectById(plan.targetId as Id<RoomObject & _HasId>) ?? undefined)
					: undefined;
				const code = powerCreep.usePower(payload.power as PowerConstant, target as RoomObject | undefined);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "enableRoom": {
				const powerCreep = Game.powerCreeps[plan.actorName as Id<PowerCreep>];
				if (!powerCreep || !powerCreep.room) {
					return invalid("powerCreep-not-in-world");
				}
				const controller = resolve<StructureController>(plan.targetId);
				if (!controller) {
					return { ...base, accepted: false, category: "replan", reason: "controller-gone" };
				}
				const code = powerCreep.enableRoom(controller);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			default:
				return invalid("unknown-kind");
		}
	}

	return {
		submit,

		commit(): readonly ActionResult[] {
			// 管线仲裁: 同 actor 同 pipeline 只保留优先级最高的计划。
			// 批量管线 (construction 等) 豁免: 提交方已按 dedupeKey 去重,
			// 同 pass 多条是设计内批量命令, 无 "一机体一动作" 语义
			const batchKeys = new Set<string>();
			for (const plan of plans.values()) {
				if (BATCH_PIPELINES.has(plan.pipeline)) {
					batchKeys.add(`${plan.actorName}:${plan.pipeline}`);
				}
			}
			const kept = new Map<string, ActionPlan>();
			for (const plan of plans.values()) {
				const key = `${plan.actorName}:${plan.pipeline}`;
				if (batchKeys.has(key)) {
					kept.set(`${key}:${plan.dedupeKey}`, plan);
					continue;
				}
				const incumbent = kept.get(key);
				if (!incumbent || plan.priority > incumbent.priority) {
					kept.set(key, plan);
				}
			}

			const results: ActionResult[] = [];
			for (const plan of plans.values()) {
				const key = `${plan.actorName}:${plan.pipeline}`;
				const winner = batchKeys.has(key) ? kept.get(`${key}:${plan.dedupeKey}`) : kept.get(key);
				if (winner !== plan) {
					// 仲裁出局: 未触达原生 API, 无返回码
					const suppressed: ActionResult = {
						planId: plan.id,
						actorName: plan.actorName,
						kind: plan.kind,
						pipeline: plan.pipeline,
						accepted: false,
						category: "suppressed",
						reason: "pipeline-conflict",
					};
					results.push(suppressed);
					lastResults.set(`${plan.actorName}:${plan.pipeline}`, suppressed);
					continue;
				}
				// 所有权检查 (api/16 → 任务 3.7): creep actor 命令须由当前 owner 提交;
				// record/warn 档零拦截, enforce 档拒绝非 owner 命令 (分类记录)
				if (CREEP_PIPELINES.has(plan.pipeline) && !assertOwner(plan.actorName, "nexus-agent", plan.tick)) {
					const denied: ActionResult = {
						planId: plan.id,
						actorName: plan.actorName,
						kind: plan.kind,
						pipeline: plan.pipeline,
						accepted: false,
						category: "suppressed",
						reason: "not-owner",
					};
					results.push(denied);
					lastResults.set(key, denied);
					continue;
				}
				const result = execute(plan);
				results.push(result);
				lastResults.set(key, result);
				if (result.category === "replan" && plan.taskId) {
					deps.onReplan(
						plan.taskId,
						plan.actorName,
						result.reason ?? `code:${result.nativeReturnCode ?? "none"}`,
					);
				} else if (result.category === "invalid") {
					deps.logger.warn(
						`broker.invalid.${plan.kind}`,
						`${plan.actorName} ${plan.kind}: ${result.reason ?? "?"}`,
					);
				}
			}
			plans.clear();
			return results;
		},

		lastResult(actorName: string, pipeline?: ActionPipeline): ActionResult | undefined {
			if (pipeline) {
				return lastResults.get(`${actorName}:${pipeline}`);
			}
			for (const result of lastResults.values()) {
				if (result.actorName === actorName) {
					return result;
				}
			}
			return undefined;
		},

		executeNow(plan: ActionPlan): ActionResult {
			const result = execute(plan);
			lastResults.set(`${plan.actorName}:${plan.pipeline}`, result);
			if (result.category === "invalid") {
				deps.logger.warn(
					`broker.invalid.${plan.kind}`,
					`${plan.actorName} ${plan.kind}: ${result.reason ?? "?"}`,
				);
			}
			return result;
		},
	};
}

/** 每 Tick 共享单例: agent 模块 submit, broker 模块 commit (global 重置自动重建) */
let shared: { tick: number; broker: ActionBroker } | null = null;

export function getSharedBroker(tick: number, deps: BrokerDeps): ActionBroker {
	if (!shared || shared.tick !== tick) {
		shared = { tick, broker: createBroker(deps) };
	}
	return shared.broker;
}

/**
 * 无 ctx 场景的同步执行入口 (directSpawn 等命令层): 复用本 Tick 共享 broker。
 * broker 尚未初始化 (spawn 阶段早于 agents) 时以最小 deps 就地建一个 ——
 * 后续 ensureBroker 同 Tick 会带着完整 deps 覆盖重建, submit 队列不因此丢失。
 */
export function sharedBrokerForDirectCommands(): ActionBroker {
	const tick = Game.time;
	if (!shared || shared.tick !== tick) {
		const noop = () => false as const;
		shared = {
			tick,
			broker: createBroker({
				logger: {
					beginTick: (t: number) => {
						void t;
					},
					info: (message: string) => console.log(message),
					warn: (key: string, message: string) => {
						console.log(`[warn.${key}] ${message}`);
						return true;
					},
					error: noop as () => false,
				},
				getTask: () => undefined,
				onReplan: () => undefined,
			}),
		};
	}
	return shared.broker;
}
