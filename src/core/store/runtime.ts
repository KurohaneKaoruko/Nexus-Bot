/**
 * global 运行时层 (docs/nexus-design/02 §2.4 / 持久化分级 D9 / docs/nexus-design/19 §19.5):
 * 跨 Tick 存活、代码重载即失的进程级缓存, 只放重建廉价数据
 * (紧急重估标志 / 转移环形日志 / 观测输入摘要 / 单 Tick 编队需求队列) —— 丢失最多退化一个观测窗口,
 * 不影响行为正确性; 决策状态 (姿态/政策/编队记录) 一律走 Memory。
 * 挂载点 globalThis.nexus.runtime (沙盒内即 global 这一层);
 * 读取一律经本访问器, 缺失或损坏自愈为安全空状态, 不向调用方抛异常。
 */
import { STRATEGY_CONFIG } from "@/config/strategy";
import { CLUSTER_CONFIG } from "@/config/cluster";
import type { Posture, SquadKind, SquadSlotDef } from "@/core/store/memorySchema";
import type { TaskKind } from "@/core/store/taskSchema";

export interface StrategyTransitionRecord {
	from: Posture;
	to: Posture;
	at: number;
	reason: string;
}

export interface StrategyRuntime {
	/** 紧急重估标志 tick (库存穿越置位, 战略模块消费后清除) */
	urgentAtTick?: number;
	/** 最近转移环形日志 (有界, 控制台排障用; 重载即失可接受) */
	transitions: StrategyTransitionRecord[];
	/** 最近一次重估输入摘要 (观测用) */
	lastInputs?: {
		stock: number;
		sourceCount: number;
		starvationTicks: number;
		maxThreatScore: number;
	};
}

/**
 * 编队需求 (docs/nexus-design/19 §19.4 集群 / docs/nexus-design/20):
 * 职能系统在自身阶段 (防御 = emergency) 写入, 编队模块在 planning 阶段消费并清空 ——
 * 本 Tick 汇总的事实, 不是跨 Tick 事件总线 (docs/nexus-design/03 §3.6)。
 * 丢失去只影响一个 Tick 的编队续期, 下次请求即恢复 (TTL 迟滞兜底)。
 */
export interface SquadRequest {
	kind: SquadKind;
	roomName: string;
	/** 期望槽位数 (= 期望成员数), 编队模块按配置上限收敛; 异构时由 slotDefs 决定 */
	slots: number;
	/** 异构槽位定义 (specs/squad-heterogeneous-slots): 缺省时按 slots/taskKind/capabilities 构造单条目同质定义 */
	slotDefs?: SquadSlotDef[];
	/** 槽位任务种类 */
	taskKind: TaskKind;
	/** 每槽位所需能力 */
	capabilities: string[];
	priority: number;
	/** 需求方给出的原因摘要 (可归因) */
	reason: string;
}

export interface ClusterRuntime {
	/** 本 Tick 收集到的编队需求 (编队模块消费后清空) */
	requests: SquadRequest[];
}

/** 拉能快递孵化需求 (specs/rush-courier): economy planning 产出, 孵化阶段消费即清 */
export interface CourierSpawnRequest {
	roomName: string;
	/** 快递体型预算 (spawn 存量与运作线之上的盈余, 只抽不伤底仓) */
	budget: number;
	priority: number;
	reason: string;
}

export interface CourierRuntime {
	/** 本 Tick 的快递孵化需求 (每房至多一条, 消费后清空) */
	requests: CourierSpawnRequest[];
}

export interface NexusRuntimeRoot {
	strategy: StrategyRuntime;
	cluster: ClusterRuntime;
	courier: CourierRuntime;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取运行时根: 自愈创建/修复; 每次调用重新解析, 不缓存陈旧引用 */
export function nexusRuntime(): NexusRuntimeRoot {
	const root = globalThis as unknown as Record<string, unknown>;
	const existingNexus = root["Nexus"];
	const nexus: Record<string, unknown> = isPlainObject(existingNexus) ? existingNexus : {};
	root["Nexus"] = nexus;
	const existingRuntime = nexus["runtime"];
	const runtime: Record<string, unknown> = isPlainObject(existingRuntime) ? existingRuntime : {};
	nexus["runtime"] = runtime;
	const existingStrategy = runtime["strategy"];
	const strategy: Record<string, unknown> =
		isPlainObject(existingStrategy) && Array.isArray(existingStrategy["transitions"])
			? existingStrategy
			: { transitions: [] };
	runtime["strategy"] = strategy;
	const existingCluster = runtime["cluster"];
	const cluster: Record<string, unknown> =
		isPlainObject(existingCluster) && Array.isArray(existingCluster["requests"])
			? existingCluster
			: { requests: [] };
	runtime["cluster"] = cluster;
	const existingCourier = runtime["courier"];
	const courier: Record<string, unknown> =
		isPlainObject(existingCourier) && Array.isArray(existingCourier["requests"])
			? existingCourier
			: { requests: [] };
	runtime["courier"] = courier;
	return {
		strategy: strategy as unknown as StrategyRuntime,
		cluster: cluster as unknown as ClusterRuntime,
		courier: courier as unknown as CourierRuntime,
	};
}

/** 库存穿越检测置位紧急标志 (指令派生路径调用) */
export function markUrgentReeval(tick: number): void {
	nexusRuntime().strategy.urgentAtTick = tick;
}

/** 战略模块消费紧急标志: 存在未过期标志则清除并返回 true */
export function consumeUrgentReeval(now: number): boolean {
	const strategy = nexusRuntime().strategy;
	if (strategy.urgentAtTick !== undefined && now >= strategy.urgentAtTick) {
		delete strategy.urgentAtTick;
		return true;
	}
	return false;
}

/** 转移记录入环形日志 (超上限淘汰最旧) */
export function recordTransitionLog(entry: StrategyTransitionRecord): void {
	const strategy = nexusRuntime().strategy;
	strategy.transitions.push(entry);
	while (strategy.transitions.length > STRATEGY_CONFIG.transitionLogMax) {
		strategy.transitions.shift();
	}
}

/* ── 编队需求队列 (单 Tick 汇总, 编队模块消费后清空) ── */

/**
 * 登记一条编队需求: 同 (kind, roomName) 合并, 槽位/优先级取较大者 (防同 Tick 重复请求放大)。
 * 队列有界: 超出上限的需求丢弃 (下一 Tick 需求方会再报)。
 */
export function requestSquad(request: SquadRequest): void {
	const cluster = nexusRuntime().cluster;
	const existing = cluster.requests.find(
		(candidate) => candidate.kind === request.kind && candidate.roomName === request.roomName,
	);
	if (existing) {
		// 异构槽位合并按定义逐项取大 (同 taskKind 合并 count), 异 kind 追加;
		// 收敛在 applyRequest 的 clampSlotDefs, 此处只保证「需求放大」不被压小。
		if (request.slotDefs?.length) {
			const merged = [...(existing.slotDefs ?? [])];
			for (const def of request.slotDefs) {
				const same = merged.find((d) => d.taskKind === def.taskKind);
				if (same) {
					same.count = Math.max(same.count, def.count);
					same.capabilities = [...def.capabilities];
				} else {
					merged.push({ ...def, capabilities: [...def.capabilities] });
				}
			}
			existing.slotDefs = merged;
			existing.slots = merged.reduce((sum, d) => sum + d.count, 0);
		} else {
			existing.slots = Math.max(existing.slots, request.slots);
		}
		existing.priority = Math.max(existing.priority, request.priority);
		existing.taskKind = request.taskKind;
		existing.capabilities = [...request.capabilities];
		existing.reason = request.reason;
		return;
	}
	if (cluster.requests.length >= CLUSTER_CONFIG.maxPendingRequests) {
		return;
	}
	cluster.requests.push({ ...request, capabilities: [...request.capabilities] });
}

/** 消费并清空本 Tick 的编队需求 (编队模块 planning 阶段调用) */
export function takeSquadRequests(): SquadRequest[] {
	const cluster = nexusRuntime().cluster;
	const requests = cluster.requests;
	cluster.requests = [];
	return requests;
}

/** 登记一条快递孵化需求 (同房合并取较高优先级, 预算取较大者) */
export function requestCourier(request: CourierSpawnRequest): void {
	const courier = nexusRuntime().courier;
	const existing = courier.requests.find((candidate) => candidate.roomName === request.roomName);
	if (existing) {
		existing.priority = Math.max(existing.priority, request.priority);
		existing.budget = Math.max(existing.budget, request.budget);
		existing.reason = request.reason;
		return;
	}
	if (courier.requests.length >= 8) {
		return;
	}
	courier.requests.push({ ...request });
}

/** 消费并清空本 Tick 的快递孵化需求 (孵化阶段调用) */
export function takeCourierRequests(): CourierSpawnRequest[] {
	const courier = nexusRuntime().courier;
	const requests = courier.requests;
	courier.requests = [];
	return requests;
}
