/**
 * ActionBroker (api/06): 行动提案登记与统一提交。
 * submit 只登记不执行; commit 按管线仲裁 (同 actor 同管线留最高优先级,
 * 跨管线并行) 后校验并调用原生 API —— 全项目唯一的原生行动调用点。
 */
import type { NexusTask, SerializedPosition } from "@/core/store/taskSchema";
import type { Logger } from "@/core/logger";

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
	| "suicide";

/** combat = Creep 战斗; tower = 塔结构行动; defense = 房间级防御意图 (SafeMode) */
export type ActionPipeline =
	| "move"
	| "work"
	| "carry"
	| "controller"
	| "combat"
	| "tower"
	| "defense";

export interface ActionPlan {
	id: string;
	tick: number;
	/** 持有租约的任务 ID; 结构 actor (塔/SafeMode) 无任务, 可缺省 */
	taskId?: string;
	actorName: string;
	kind: ActionKind;
	targetId?: string;
	targetPos?: SerializedPosition;
	resourceType?: ResourceConstant;
	amount?: number;
	priority: number;
	pipeline: ActionPipeline;
	dedupeKey: string;
}

export type ResultCategory = "accepted" | "retryable" | "replan" | "invalid" | "suppressed";

export interface ActionResult {
	planId: string;
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	accepted: boolean;
	nativeReturnCode: number;
	category: ResultCategory;
	reason?: string;
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
}

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
		};
		const invalid = (reason: string): ActionResult => ({
			...base,
			accepted: false,
			nativeReturnCode: -1,
			category: "invalid",
			reason,
		});

		// 结构 actor (塔/SafeMode) 无租约语义, 走独立执行路径 (同样统一经本函数提交)
		if (plan.pipeline === "tower" || plan.pipeline === "defense") {
			return executeStructureAction(plan, base, invalid);
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
						category: "replan",
						reason: "target-gone",
					};
				}
				if ((target.store[plan.resourceType ?? RESOURCE_ENERGY] ?? 0) <= 0) {
					return {
						...base,
						accepted: false,
						nativeReturnCode: ERR_NOT_ENOUGH_ENERGY,
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
						nativeReturnCode: ERR_INVALID_TARGET,
						category: "replan",
						reason: "target-gone",
					};
				}
				if (creep.store[plan.resourceType ?? RESOURCE_ENERGY] <= 0) {
					// 快照与实际负载出现偏差: 交回分配环重推导, 不作为无效告警刷屏
					return {
						...base,
						accepted: false,
						nativeReturnCode: ERR_NOT_ENOUGH_ENERGY,
						category: "replan",
						reason: "carry-empty",
					};
				}
				const code = creep.transfer(target, plan.resourceType ?? RESOURCE_ENERGY);
				const t = triage(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			case "build": {
				const site = resolve<ConstructionSite>(plan.targetId);
				if (!site) {
					// 工地建成/消失: replan 且视为成功路径 (任务完成由对账确认)
					return {
						...base,
						accepted: false,
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_NOT_ENOUGH_RESOURCES,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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
						nativeReturnCode: ERR_INVALID_TARGET,
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

	return {
		submit,

		commit(): readonly ActionResult[] {
			// 管线仲裁: 同 actor 同 pipeline 只保留优先级最高的计划
			const kept = new Map<string, ActionPlan>();
			for (const plan of plans.values()) {
				const key = `${plan.actorName}:${plan.pipeline}`;
				const incumbent = kept.get(key);
				if (!incumbent || plan.priority > incumbent.priority) {
					kept.set(key, plan);
				}
			}

			const results: ActionResult[] = [];
			for (const plan of plans.values()) {
				const key = `${plan.actorName}:${plan.pipeline}`;
				const winner = kept.get(key);
				if (winner !== plan) {
					const suppressed: ActionResult = {
						planId: plan.id,
						actorName: plan.actorName,
						kind: plan.kind,
						pipeline: plan.pipeline,
						accepted: false,
						nativeReturnCode: -1,
						category: "suppressed",
						reason: "pipeline-conflict",
					};
					results.push(suppressed);
					lastResults.set(`${plan.actorName}:${plan.pipeline}`, suppressed);
					continue;
				}
				const result = execute(plan);
				results.push(result);
				lastResults.set(key, result);
				if (result.category === "replan" && plan.taskId) {
					deps.onReplan(
						plan.taskId,
						plan.actorName,
						result.reason ?? result.nativeReturnCode.toString(),
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
