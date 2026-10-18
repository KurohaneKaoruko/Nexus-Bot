/**
 * Actor 所有权机制 (api/16 actor-ownership spec):
 * 一个 Actor 一个 owner —— acquire/release/ownerOf/assertOwner + 租约续期 +
 * 死亡自动释放 + 孵化中名单不可夺取。
 *
 * 三档模式 (记录/告警/拦截) 经 config/ownership.ts 配置切换, 默认"仅记录":
 * 记录档不改变任何行为, 只收集冲突面 (design.md D1 渐进收紧)。
 *
 * 数据分级 (design.md D1 / 任务 2.2):
 * - 租约活跃数据 → global 运行时层 (单 Tick 可重建, 不占 Memory);
 * - 跨 Tick 持久索引 → Memory.Nexus.runtime.actorOwnershipIndex,
 *   只存 owner 名与到期 tick, schema 版本管理, 旧 Memory 引导为空状态。
 */

import { actorEntry, isSpawningActor } from "@/runtime/actorRegistry";
import { OWNERSHIP_CONFIG } from "@/config/ownership";
import type { OwnershipMemory } from "@/core/store/memorySchema";

export type OwnershipMode = "record" | "warn" | "enforce";

/** owner 候选注册 (任务 2.4): 每条控制路径一个, 带静态优先级 */
export interface OwnerCandidate {
	name: string;
	/** 数值越高优先级越高; 拦截档下高优先级持有者不被低优先级夺取 */
	priority: number;
}

export interface OwnershipLease {
	owner: string;
	acquiredTick: number;
	/** 租约到期 tick (acquiredTick + leaseTicks; 持有者须在此之前续期) */
	expiresAt: number;
}

export interface OwnershipConflictRecord {
	tick: number;
	actorName: string;
	holder: string;
	challenger: string;
	/** 同一对 (actor, holder, challenger) 的累计冲突数 (遥测聚合口径) */
	count: number;
}

export interface ActorOwnershipRuntime {
	/** actor 名 → 当前租约 (global 层, 单 Tick 重建的权威态) */
	leases: Record<string, OwnershipLease>;
	/** owner 候选名册 */
	candidates: Record<string, number>;
	/** 冲突热点聚合 (有界环形, 只保留最近 N 对) */
	conflicts: OwnershipConflictRecord[];
	/** 被拦截命令计数 (拦截档遥测) */
	suppressedCount: number;
	/** 重建锚点 tick */
	tick: number;
}

const CONFLICT_RING_LIMIT = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownershipRuntime(): ActorOwnershipRuntime {
	const nexus = globalThis as unknown as Record<string, unknown>;
	const N = isPlainObject(nexus["Nexus"]) ? nexus["Nexus"] : {};
	nexus["Nexus"] = N;
	const runtime = isPlainObject(N["runtime"]) ? N["runtime"] : {};
	N["runtime"] = runtime;
	const existing = runtime["actorOwnership"];
	const reg: Record<string, unknown> =
		isPlainObject(existing) && isPlainObject(existing["leases"]) ? existing : {};
	runtime["actorOwnership"] = reg;
	const root = reg as unknown as ActorOwnershipRuntime;
	if (!isPlainObject(root.leases)) root.leases = {};
	if (!isPlainObject(root.candidates)) root.candidates = {};
	if (!Array.isArray(root.conflicts)) root.conflicts = [];
	if (typeof root.suppressedCount !== "number") root.suppressedCount = 0;
	if (typeof root.tick !== "number") root.tick = -1;
	return root;
}

/** Tick 开场对账: 恢复持久索引 + 过期租约回收 + 死亡释放 (perception 后调用一次) */
export function sweepOwnership(tick: number): void {
	const rt = ownershipRuntime();
	restoreFromIndex(tick);
	rt.tick = tick;
	for (const [actorName, lease] of Object.entries(rt.leases)) {
		const entry = actorEntry(actorName);
		const actorGone = entry === undefined; // 注册表重建后仍不在世界 = 死亡
		const expired = lease.expiresAt <= tick;
		if (actorGone || expired) {
			// 死亡释放: 同 Tick 立即可被新 owner 获取 (spec: 死亡即释放)
			delete rt.leases[actorName];
		}
	}
}

export function registerOwnerCandidate(name: string, priority: number): void {
	const rt = ownershipRuntime();
	rt.candidates[name] = priority;
}

export function ownerOf(actorName: string): string | undefined {
	return ownershipRuntime().leases[actorName]?.owner;
}

function recordConflict(rt: ActorOwnershipRuntime, actorName: string, holder: string, challenger: string, tick: number): void {
	// 聚合同一对冲突, 环形有界: 旧条目被同 key 就地累加, 不同 key 挤掉最老
	const existing = rt.conflicts.find((c) => c.actorName === actorName && c.holder === holder && c.challenger === challenger);
	if (existing) {
		existing.tick = tick;
		existing.count++;
	} else {
		if (rt.conflicts.length >= CONFLICT_RING_LIMIT) {
			rt.conflicts.shift();
		}
		rt.conflicts.push({ tick, actorName, holder, challenger, count: 1 });
	}
	// warn 档限频告警 (任务 3.8): 同一对冲突在窗口内只喊一次
	if (OWNERSHIP_CONFIG.mode === "warn" && tick - existingWarnTick(actorName, holder, challenger) >= OWNERSHIP_CONFIG.warnIntervalTicks) {
		markWarnTick(actorName, holder, challenger, tick);
		console.log(`[ownership.conflict] ${actorName}: holder=${holder} challenger=${challenger} tick=${tick}`);
	}
}

/** warn 限频簿记 (global 层, 有界) */
const warnTicks = new Map<string, number>();
function warnKey(actorName: string, holder: string, challenger: string): string {
	return `${actorName}|${holder}|${challenger}`;
}
function existingWarnTick(actorName: string, holder: string, challenger: string): number {
	return warnTicks.get(warnKey(actorName, holder, challenger)) ?? Number.MIN_SAFE_INTEGER;
}
function markWarnTick(actorName: string, holder: string, challenger: string, tick: number): void {
	if (warnTicks.size > CONFLICT_RING_LIMIT) {
		warnTicks.clear();
	}
	warnTicks.set(warnKey(actorName, holder, challenger), tick);
}

export interface AcquireResult {
	/** true = 获取成功 (或记录档下的"不拦截") */
	acquired: boolean;
	/** 冲突时的现有持有者 */
	holder?: string | undefined;
	/** 拦截原因: conflict=已有持有者; spawning=孵化中保护 */
	reason?: "conflict" | "spawning";
}

/**
 * 获取控制权。语义随模式:
 * - record: 总是 acquired (行为零变化), 冲突只记账;
 * - warn: 同 record + 限频告警日志;
 * - enforce: 后到低优先级方被拒 (acquired=false); 高优先级方允许夺取。
 * 孵化中名单在所有模式下都不可夺取 (防御性语义, 不改变现有行为的"获取"方向)。
 */
export function acquire(actorName: string, owner: string, tick: number, options?: { priority?: number }): AcquireResult {
	const rt = ownershipRuntime();
	const existing = rt.leases[actorName];

	if (isSpawningActor(actorName)) {
		// 孵化中: 记录冲突但不产生租约变更 —— 现有持有者(如有)不动, 挑战者不接管
		if (existing && existing.owner !== owner) {
			recordConflict(rt, actorName, existing.owner, owner, tick);
		}
		return { acquired: existing?.owner === owner, holder: existing?.owner, reason: "spawning" };
	}

	if (existing && existing.owner !== owner) {
		recordConflict(rt, actorName, existing.owner, owner, tick);
		if (OWNERSHIP_CONFIG.mode === "enforce") {
			const holderPriority = rt.candidates[existing.owner] ?? 0;
			const challengerPriority = options?.priority ?? rt.candidates[owner] ?? 0;
			if (challengerPriority <= holderPriority) {
				rt.suppressedCount++;
				return { acquired: false, holder: existing.owner, reason: "conflict" };
			}
		}
	}

	// 记录/告警档: 后到者覆写租约 (行为与无本机制时一致 —— 都执行, 最后说话者胜);
	// 拦截档高优先级夺取也走这里
	rt.leases[actorName] = {
		owner,
		acquiredTick: tick,
		expiresAt: tick + OWNERSHIP_CONFIG.leaseTicks,
	};
	return { acquired: true };
}

export function release(actorName: string, owner: string): void {
	const rt = ownershipRuntime();
	const lease = rt.leases[actorName];
	if (lease && lease.owner === owner) {
		delete rt.leases[actorName];
	}
}

/** 租约续期: owner 在到期前调用则延长; 非持有者调用无效果 */
export function renew(actorName: string, owner: string, tick: number): boolean {
	const rt = ownershipRuntime();
	const lease = rt.leases[actorName];
	if (!lease || lease.owner !== owner) {
		return false;
	}
	lease.expiresAt = tick + OWNERSHIP_CONFIG.leaseTicks;
	return true;
}

/**
 * 断言所有权: broker commit 前的检查点 (任务 3.7 接入点)。
 * 返回 true = 放行。拦截档下非 owner 命令被拒并计数; 其余档只记账。
 */
export function assertOwner(actorName: string, owner: string, tick: number): boolean {
	const rt = ownershipRuntime();
	const lease = rt.leases[actorName];
	if (!lease) {
		// 无租约 = 无主 Actor: 放行 (所有权机制不要求全员持证, 只管冲突面)
		return true;
	}
	if (lease.owner === owner) {
		renew(actorName, owner, tick);
		return true;
	}
	recordConflict(rt, actorName, lease.owner, owner, tick);
	if (OWNERSHIP_CONFIG.mode === "enforce") {
		rt.suppressedCount++;
		return false;
	}
	return true;
}

/** 冲突热点报告 (任务 2.4 输出): 按冲突对聚合, 降序 */
export function conflictReport(): readonly OwnershipConflictRecord[] {
	return [...ownershipRuntime().conflicts].sort((a, b) => b.count - a.count);
}

// ── 跨 Tick 持久索引 (任务 2.2) ─────────────────────────────
// 活跃租约的权威态在 global 层; Memory 侧只存 owner 名与到期 tick,
// global 重置后由此恢复所有权事实。损坏自愈为空索引, 不抛异常。

function persistentIndex(): OwnershipMemory {
	const nexus = Memory as unknown as { Nexus?: { ownership?: unknown } };
	const root = nexus.Nexus ?? {};
	const raw = root.ownership;
	if (
		typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
		typeof (raw as OwnershipMemory).actors === "object"
	) {
		return raw as OwnershipMemory;
	}
	const fresh: OwnershipMemory = { indexVersion: 1, actors: {} };
	root.ownership = fresh;
	nexus.Nexus = root as NonNullable<typeof nexus.Nexus>;
	return fresh;
}

/** Tick 收尾: 活跃租约落持久索引 (global 重置窗口的恢复源) */
export function persistOwnership(_tick: number): void {
	const rt = ownershipRuntime();
	const idx = persistentIndex();
	// 全量重建索引内容 (以 global 层为准), 已删 actor 的条目随之消失
	idx.actors = {};
	for (const [name, lease] of Object.entries(rt.leases)) {
		idx.actors[name] = { owner: lease.owner, expiresAt: lease.expiresAt };
	}
}

/** Tick 开场 (sweepOwnership 内调用): 从持久索引恢复 global 层缺失的租约 */
function restoreFromIndex(tick: number): void {
	const rt = ownershipRuntime();
	const idx = persistentIndex();
	for (const [name, entry] of Object.entries(idx.actors)) {
		if (rt.leases[name]) {
			continue; // global 层已有权威态
		}
		if (entry.expiresAt <= tick) {
			continue; // 重置窗口内已过期, 不复活
		}
		rt.leases[name] = {
			owner: entry.owner,
			acquiredTick: tick,
			expiresAt: entry.expiresAt,
		};
	}
}
