/**
 * ActionBroker (api/06): 行动提案登记与统一提交。
 * submit 只登记不执行; commit 按管线仲裁 (同 actor 同管线留最高优先级,
 * 跨管线并行) 后校验、检查所有权并调用原生 API —— 全项目唯一的原生行动调用点。
 */
import { assertOwner } from "@/runtime/actorOwnership";
import type {
	ActionBroker,
	ActionPlan,
	ActionPipeline,
	ActionResult,
	BrokerDeps,
} from "@/modules/agents/brokerTypes";
import { BATCH_PIPELINES, CREEP_PIPELINES } from "@/modules/agents/brokerTypes";
import { makeInvalid } from "@/modules/agents/brokerExecutorsShared";
import { executeCreepAction } from "@/modules/agents/brokerCreepActions";
import {
	executeFlagAction,
	executeStructureAction,
	executeSystemAction,
} from "@/modules/agents/brokerStructActions";

export type {
	ActionBroker,
	ActionKind,
	ActionPayload,
	ActionPipeline,
	ActionPlan,
	ActionResult,
	BrokerDeps,
	MoveOptsPayload,
	ResultCategory,
} from "@/modules/agents/brokerTypes";

export function createBroker(deps: BrokerDeps): ActionBroker {
	const plans = new Map<string, ActionPlan>();
	const lastResults = new Map<string, ActionResult>();

	function submit(plan: ActionPlan): void {
		plans.set(plan.dedupeKey, plan);
	}

	function execute(plan: ActionPlan): ActionResult {
		const base = {
			planId: plan.id,
			actorName: plan.actorName,
			kind: plan.kind,
			pipeline: plan.pipeline,
			intentReason: plan.reason,
		};
		const invalid = makeInvalid(base);

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

		return executeCreepAction(creep, plan, base, deps, invalid);
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
