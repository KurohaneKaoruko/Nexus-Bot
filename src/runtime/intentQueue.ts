/**
 * 命令意图提交助手 (api/17 command-boundary / Phase 2):
 * 职能系统经本层把"想做什么"提交给 broker 统一执行;
 * 本层只在 agents 阶段前被调用时入队, commit 阶段由 broker 统一仲裁执行。
 *
 * 与直连的区别: 提交方不再持有原生调用权 —— 守护清单上的条目随收编移除。
 * 队列落 global 运行时层 (单 Tick 生命周期, broker commit 时消费)。
 */
import type { ActionKind, ActionPayload, ActionPipeline } from "@/modules/agents/actionBroker";

interface QueuedIntent {
	id: string;
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	priority: number;
	targetId?: string;
	targetPos?: { x: number; y: number; roomName: string };
	resourceType?: string;
	amount?: number;
	payload?: ActionPayload;
	dedupeKey: string;
	/** 提交方的结果回调 (broker commit 后同步调用; 供预约核销/簿记等强一致逻辑) */
	onResult?: (accepted: boolean, nativeReturnCode: number | undefined) => void;
}

interface IntentQueueRuntime {
	intents: QueuedIntent[];
	seq: number;
	tick: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intentQueue(tick: number): IntentQueueRuntime {
	const nexus = globalThis as unknown as Record<string, unknown>;
	const N = isPlainObject(nexus["Nexus"]) ? nexus["Nexus"] : {};
	nexus["Nexus"] = N;
	const runtime = isPlainObject(N["runtime"]) ? N["runtime"] : {};
	N["runtime"] = runtime;
	const existing = runtime["intentQueue"];
	const q: Record<string, unknown> =
		isPlainObject(existing) && Array.isArray(existing["intents"]) ? existing : { intents: [], seq: 0 };
	// 新 Tick: 队列只在本 Tick 存活 (broker 未消费即作废, 不跨 Tick 累积)
	if (q["tick"] !== tick) {
		q["intents"] = [];
		q["seq"] = 0;
		q["tick"] = tick;
	}
	runtime["intentQueue"] = q;
	return q as unknown as IntentQueueRuntime;
}

export interface SubmitIntentInput {
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	priority: number;
	targetId?: string;
	targetPos?: { x: number; y: number; roomName: string };
	resourceType?: string;
	amount?: number;
	payload?: ActionPayload;
	/** 幂等键: 同 Tick 同键只保留最后一条 */
	dedupeKey?: string;
	/** broker 执行后的结果回调 (同步; 供预约核销/簿记) */
	onResult?: (accepted: boolean, nativeReturnCode: number | undefined) => void;
}

/** 提交一条命令意图 (登记, 不执行); 返回意图 ID */
export function submitIntent(tick: number, input: SubmitIntentInput): string {
	const q = intentQueue(tick);
	const id = `intent-${tick}-${q.seq++}`;
	const dedupeKey = input.dedupeKey ?? id;
	// 同键覆盖 (最后提交胜出)
	const idx = q.intents.findIndex((i) => i.dedupeKey === dedupeKey);
	const intent: QueuedIntent = { ...input, id, dedupeKey };
	if (idx >= 0) {
		q.intents[idx] = intent;
	} else {
		q.intents.push(intent);
	}
	return id;
}

/** broker commit 前: 取走全部排队的意图 (消费即清空) */
export function takeIntents(tick: number): readonly QueuedIntent[] {
	const q = intentQueue(tick);
	const out = q.intents;
	q.intents = [];
	return out;
}
