/**
 * broker 执行器共享工具 (api/06): 提交基座、无效拒绝构造、目标解析与返回码归因。
 * 从 actionBroker 闭包原样提升 (拆分任务 3.4), 零逻辑改动。
 */
import type {
	ActionKind,
	ActionPipeline,
	ActionResult,
} from "@/modules/agents/brokerTypes";

/** 提交基座: execute() 内组装的归因字段, 执行器只补结果语义 */
export type ExecutorBase = {
	planId: string;
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	intentReason: string | undefined;
};

/** 未触达原生 API 的拒绝构造器: 无 nativeReturnCode, 不伪造返回码 */
export type InvalidFn = (reason: string) => ActionResult;

export function makeInvalid(base: ExecutorBase): InvalidFn {
	return (reason: string): ActionResult => ({
		...base,
		accepted: false,
		category: "invalid",
		reason,
	});
}

/** 泛型目标解析: id → 游戏对象 (缺失/过期返回 undefined) */
export function resolveTarget<T extends _HasId>(id: string | undefined): T | undefined {
	return (id ? Game.getObjectById(id as Id<T>) : undefined) ?? undefined;
}

/** 原生返回码 → 接受/重试/重规划/非法 四类归因 */
export function triageCode(code: number): { accepted: boolean; category: ActionResult["category"] } {
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
