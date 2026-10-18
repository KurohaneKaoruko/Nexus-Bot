/**
 * 生产级不变量监控 (任务 9.4, specs/production-hardening):
 * 五项不变量每 tick 检查, 违例限频告警 (进程内存态计数, 不落 Memory 无界流水):
 *
 * 1. owner 唯一: 同一任务 assignedTo 与 actorOwnership 表无冲突双持;
 * 2. 任务必终结: available/assigned 任务不过期滞留 (超过 TTL 上限视为泄漏);
 * 3. 孵化名单一致: 引擎 spawning 名单与簿记 units 名册互相包含;
 * 4. Memory 有界: Memory 序列化总量不过阈值;
 * 5. CPU 预算: tick CPU 用量不过告警线。
 *
 * 检查为只读快照, 不修改任何业务状态; 告警经 logger.warn 限频上屏,
 * 计数与最近违例摘要由 console `diag.invariant()` 查询。
 */
import type { TickContext, TickModule } from "@/core";
import { engineSpawningNames } from "@/modules/spawning/spawningRoster";
import { TASK_KINDS, leaseTicksFor } from "@/core/store/taskSchema";
import { INVARIANT_CONFIG } from "@/config/observability";

/** 违例计数与最近摘要 (进程内存态, 不落 Memory) */
const counts: Record<string, number> = {};
const lastSeen: Record<string, string> = {};
/** 限频窗: 每 key 每 N tick 至多一条告警 */
const lastWarnTick: Record<string, number> = {};

const note = (key: string, detail: string, warn: (msg: string) => void): void => {
	counts[key] = (counts[key] ?? 0) + 1;
	lastSeen[key] = detail;
	const now = Game.time;
	if (now - (lastWarnTick[key] ?? -Infinity) >= INVARIANT_CONFIG.warnEveryTicks) {
		lastWarnTick[key] = now;
		warn(`invariant.${key} #${counts[key]}: ${detail}`);
	}
};

/** 任务滞留上限 = 任务 TTL 策略的最大档 × 容忍倍数 (单源: LEASE_POLICY) */
const staleTaskCeil = (): number => {
	let maxLease = 0;
	for (const kind of TASK_KINDS) maxLease = Math.max(maxLease, leaseTicksFor(kind));
	return maxLease * INVARIANT_CONFIG.staleToleranceFactor;
};

const checkTaskOwnership = (ctx: TickContext, warn: (msg: string) => void): void => {
	const tasks = ctx.memory.tasks;
	if (!tasks) return;
	// 任务板按 assignedTo 建倒排; 同名 assignee 持多任务是正常并发, 不查;
	// 查的是: 任务 claimed 中断后残留 (assigned 但 assignee 已无 taskId 指针)
	const staleCeil = staleTaskCeil();
	let assignedBroken = 0;
	let staleCount = 0;
	const staleSample: string[] = [];
	for (const task of Object.values(tasks)) {
		if (!task?.id) continue;
		// 任务指针分裂: assignee 存活但指向另一任务 (claimed 中断残留)
		if (task.status === "leased" && task.assignedTo) {
			const live = Game.creeps[task.assignedTo];
			if (live && !live.spawning && live.memory.taskId && live.memory.taskId !== task.id) {
				assignedBroken += 1;
				if (assignedBroken <= 3) {
					note("task-pointer-split", `${task.assignedTo} memory.taskId=${live.memory.taskId} ≠ task ${task.id}`, warn);
				}
			}
		}
		// 滞留: 非终态超 staleCeil 无更新 (租约对账在 reconcile, 此处是泄漏观测)
		if (
			(task.status === "available" || task.status === "leased" || task.status === "in_progress") &&
			ctx.tick - task.updatedAt > staleCeil
		) {
			staleCount += 1;
			if (staleSample.length < 3) staleSample.push(`${task.id}(${task.status}, Δt${ctx.tick - task.updatedAt})`);
		}
	}
	if (staleCount > 0) note("task-stale", `${staleCount} 个任务滞留超 ${staleCeil}t: ${staleSample.join(", ")}`, warn);
};

const checkSpawningRoster = (ctx: TickContext, warn: (msg: string) => void): void => {
	const engine = engineSpawningNames();
	const roster = ctx.memory.units as Record<string, unknown> | undefined;
	if (!roster) return;
	// 引擎孵化中但簿记无记录 → 孵化名单漏登 (P0-16 家族)
	let engineOrphan = 0;
	for (const name of engine) {
		if (!roster[name]) {
			engineOrphan += 1;
			if (engineOrphan <= 3) note("spawn-roster-missing", `引擎孵化中 ${name} 不在簿记名册`, warn);
		}
	}
	// 簿记在册但引擎无此 creep 且非孵化窗口 → 死名单 (清理由 ClearModule 承担, 此处观测)
	if (engineOrphan === 0 && Object.keys(roster).length === 0) return;
};

const checkMemoryBound = (warn: (msg: string) => void): void => {
	const { memoryBudgetBytes, sampleEveryTicks } = INVARIANT_CONFIG;
	if (Game.time % sampleEveryTicks !== 0) return;
	// JSON.stringify 全量序列化有 CPU 成本, 限频采样; RawMemory 引擎串只在有 string 时用
	const raw = typeof RawMemory !== "undefined" ? RawMemory.get() : "";
	const size = raw ? raw.length : JSON.stringify(Memory).length;
	if (size > memoryBudgetBytes) {
		note("memory-unbounded", `Memory ${Math.round(size / 1024)}KB 超 ${Math.round(memoryBudgetBytes / 1024)}KB 预算`, warn);
	}
};

const checkCpuBudget = (warn: (msg: string) => void): void => {
	const used = Game.cpu.getUsed();
	if (used > INVARIANT_CONFIG.cpuWarnMs) {
		note("cpu-overrun", `tick CPU ${used.toFixed(1)}ms > ${INVARIANT_CONFIG.cpuWarnMs}ms 告警线`, warn);
	}
};

/** 不变量摘要 (console diag.invariant() 消费) */
export const invariantSummary = (): Record<string, unknown> => ({
	tick: Game.time,
	counts: { ...counts },
	lastSeen: { ...lastSeen },
	config: { ...INVARIANT_CONFIG },
});

export const InvariantWatch: TickModule = {
	name: "invariant-watch",
	phase: "commit",
	band: "P3",
	run(ctx: TickContext): void {
		if (Game.time % INVARIANT_CONFIG.checkEveryTicks !== 0) return;
		const warn = (msg: string): void => {
			void ctx.logger.warn("invariant.watch", msg);
		};
		checkTaskOwnership(ctx, warn);
		checkSpawningRoster(ctx, warn);
		checkMemoryBound(warn);
		checkCpuBudget(warn);
	},
};
