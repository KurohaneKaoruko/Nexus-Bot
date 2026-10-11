/**
 * TaskBoard (docs/nexus-design/05 / api/05 §5.3–5.7): 任务事实源。
 * 无状态门面: 直接操作 Memory.nexus.tasks 记录表, 每 Tick 可安全重建实例。
 * 不变量: dedupeKey 幂等; 只有持有者可操作任务; 租约到期自动回收;
 *         失败按类型封顶; 终态不复活。
 */
import {
	leaseTicksFor,
	maxAttemptsFor,
	type NewTaskInput,
	type NexusTask,
	type TaskQuery,
	type TaskStatus,
} from "@/store/taskSchema";

export interface ReconcileSummary {
	/** 持有者死亡/租约到期导致的释放 */
	released: number;
	/** 超过截止时间被取消 */
	expired: number;
	/** 进入 failed 终态 */
	failed: number;
	/** 终态记录超期清理 */
	collected: number;
	/** 同键重复存活任务去重 (自愈: 历史缺陷可能堆积, 每键只保留最早一条存活) */
	compacted: number;
}

export interface ReconcileOptions {
	/** 存活判定 (来自感知快照) */
	isAlive: (creepName: string) => boolean;
	/** 终态记录保留时长, 超期清理以约束 Memory (缺省 500 tick) */
	terminalRetentionTicks?: number;
}

export interface TaskBoard {
	get(id: string): NexusTask | undefined;
	list(query?: TaskQuery): NexusTask[];
	upsert(input: NewTaskInput, now: number): NexusTask;
	claim(taskId: string, creepName: string, now: number, leaseTicks?: number): boolean;
	heartbeat(taskId: string, creepName: string, now: number, leaseTicks?: number): boolean;
	markProgress(taskId: string, creepName: string, now: number): boolean;
	complete(taskId: string, creepName: string, now: number): boolean;
	fail(taskId: string, creepName: string | undefined, now: number, reason: string): boolean;
	release(taskId: string, creepName: string | undefined, now: number, reason?: string): boolean;
	cancel(taskId: string, now: number, reason: string): boolean;
	reconcile(now: number, options: ReconcileOptions): ReconcileSummary;
}

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

/** 由去重键生成稳定 id: 同键合并靠 upsert, id 仅保证唯一 */
function newTaskId(now: number): string {
	const rand = Math.floor(Math.random() * 0xffff)
		.toString(16)
		.padStart(4, "0");
	return `t${now.toString(36)}${rand}`;
}

export function createTaskBoard(tasks: Record<string, NexusTask>): TaskBoard {
	function find(taskId: string): NexusTask | undefined {
		return tasks[taskId];
	}

	/**
	 * 同键查找: 优先返回存活 (非终态) 记录, 保证 upsert 永远合并到活任务;
	 * 全部为终态时返回第一条 (供失败冷却判定), 不然每 tick 都会新建任务导致任务表无界膨胀。
	 */
	function findByDedupeKey(dedupeKey: string): NexusTask | undefined {
		let terminal: NexusTask | undefined;
		for (const task of Object.values(tasks)) {
			if (task.dedupeKey !== dedupeKey) {
				continue;
			}
			if (!TERMINAL_STATUSES.has(task.status)) {
				return task;
			}
			terminal ??= task;
		}
		return terminal;
	}

	function toAvailable(task: NexusTask): void {
		task.status = "available";
		delete task.assignedTo;
		delete task.leaseUntil;
	}

	const board: TaskBoard = {
		get: find,

		list(query?: TaskQuery): NexusTask[] {
			return Object.values(tasks).filter((task) => {
				if (query?.statuses && !query.statuses.includes(task.status)) {
					return false;
				}
				if (query?.roomName && task.roomName !== query.roomName) {
					return false;
				}
				if (query?.kinds && !query.kinds.includes(task.kind)) {
					return false;
				}
				if (query?.minPriority !== undefined && task.priority < query.minPriority) {
					return false;
				}
				if (query?.unassignedOnly && task.assignedTo !== undefined) {
					return false;
				}
				return true;
			});
		},

		upsert(input: NewTaskInput, now: number): NexusTask {
			const existing = findByDedupeKey(input.dedupeKey);
			if (existing && TERMINAL_STATUSES.has(existing.status) === false) {
				// 同意图合并: 更新调度字段, 不动生命周期字段
				existing.priority = input.priority;
				existing.updatedAt = now;
				if (input.amount !== undefined) {
					existing.amount = input.amount;
				}
				if (input.deadline !== undefined) {
					existing.deadline = input.deadline;
				}
				return existing;
			}
			if (existing && existing.status === "failed" && now - existing.updatedAt < 100) {
				// 刚失败不久的同类任务不立刻重建 (防止失败循环堆积), 等 100 tick 冷却
				return existing;
			}
			// 同键旧终态记录回收: 槽位合并, 保证每键至多 1 条存活 + 1 条近期终态
			for (const [id, task] of Object.entries(tasks)) {
				if (task.dedupeKey === input.dedupeKey && TERMINAL_STATUSES.has(task.status)) {
					delete tasks[id];
				}
			}
			const task: NexusTask = {
				id: newTaskId(now),
				dedupeKey: input.dedupeKey,
				kind: input.kind,
				status: "available",
				roomName: input.roomName,
				priority: input.priority,
				createdAt: now,
				updatedAt: now,
				requiredCapabilities: [...input.requiredCapabilities],
				attempts: 0,
				maxAttempts: input.maxAttempts ?? maxAttemptsFor(input.kind),
			};
			if (input.targetId !== undefined) {
				task.targetId = input.targetId;
			}
			if (input.targetPos !== undefined) {
				task.targetPos = { ...input.targetPos };
			}
			if (input.destId !== undefined) {
				task.destId = input.destId;
			}
			if (input.destPos !== undefined) {
				task.destPos = { ...input.destPos };
			}
			if (input.resourceType !== undefined) {
				task.resourceType = input.resourceType;
			}
			if (input.amount !== undefined) {
				task.amount = input.amount;
			}
			if (input.deadline !== undefined) {
				task.deadline = input.deadline;
			}
			tasks[task.id] = task;
			return task;
		},

		claim(taskId: string, creepName: string, now: number, leaseTicks?: number): boolean {
			const task = find(taskId);
			if (!task || task.status !== "available") {
				return false;
			}
			if (task.deadline !== undefined && now > task.deadline) {
				return false;
			}
			task.status = "leased";
			task.assignedTo = creepName;
			task.leaseUntil = now + (leaseTicks ?? leaseTicksFor(task.kind));
			task.updatedAt = now;
			return true;
		},

		heartbeat(taskId: string, creepName: string, now: number, leaseTicks?: number): boolean {
			const task = find(taskId);
			if (!task || task.assignedTo !== creepName || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			if (task.leaseUntil !== undefined && task.leaseUntil <= now) {
				toAvailable(task);
				return false;
			}
			if (task.status === "leased") {
				task.status = "in_progress";
			}
			task.leaseUntil = now + (leaseTicks ?? leaseTicksFor(task.kind)) + 20;
			task.updatedAt = now;
			return true;
		},

		markProgress(taskId: string, creepName: string, now: number): boolean {
			const task = find(taskId);
			if (!task || task.assignedTo !== creepName || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			task.lastProgressTick = now;
			return true;
		},

		complete(taskId: string, creepName: string, now: number): boolean {
			const task = find(taskId);
			if (!task || task.assignedTo !== creepName || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			task.status = "completed";
			task.updatedAt = now;
			return true;
		},

		fail(taskId: string, creepName: string | undefined, now: number, reason: string): boolean {
			const task = find(taskId);
			if (!task || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			if (creepName !== undefined && task.assignedTo !== creepName) {
				return false;
			}
			task.attempts += 1;
			task.failureReason = reason;
			task.updatedAt = now;
			if (task.attempts >= task.maxAttempts) {
				task.status = "failed";
			} else {
				toAvailable(task);
			}
			return true;
		},

		release(taskId: string, creepName: string | undefined, now: number, reason?: string): boolean {
			const task = find(taskId);
			if (!task || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			if (creepName !== undefined && task.assignedTo !== creepName) {
				return false;
			}
			toAvailable(task);
			task.updatedAt = now;
			if (reason !== undefined) {
				task.failureReason = reason;
			}
			return true;
		},

		cancel(taskId: string, now: number, reason: string): boolean {
			const task = find(taskId);
			if (!task || TERMINAL_STATUSES.has(task.status)) {
				return false;
			}
			task.status = "cancelled";
			task.failureReason = reason;
			task.updatedAt = now;
			return true;
		},

		reconcile(now: number, options: ReconcileOptions): ReconcileSummary {
			const retention = options.terminalRetentionTicks ?? 500;
			const summary: ReconcileSummary = { released: 0, expired: 0, failed: 0, collected: 0, compacted: 0 };
			const aliveSeen = new Set<string>();
			for (const task of Object.values(tasks)) {
				// 同键去重 (自愈): 只保留最早的一条存活任务, 重复的直接删除
				if (!TERMINAL_STATUSES.has(task.status)) {
					if (aliveSeen.has(task.dedupeKey)) {
						delete tasks[task.id];
						summary.compacted += 1;
						continue;
					}
					aliveSeen.add(task.dedupeKey);
				}
				if (TERMINAL_STATUSES.has(task.status)) {
					if (now - task.updatedAt > retention) {
						delete tasks[task.id];
						summary.collected += 1;
					}
					continue;
				}
				if (task.deadline !== undefined && now > task.deadline) {
					task.status = "cancelled";
					task.failureReason = "deadline";
					task.updatedAt = now;
					summary.expired += 1;
					continue;
				}
				if (task.assignedTo !== undefined && !options.isAlive(task.assignedTo)) {
					toAvailable(task);
					task.updatedAt = now;
					summary.released += 1;
					continue;
				}
				if (task.leaseUntil !== undefined && task.leaseUntil <= now) {
					toAvailable(task);
					task.updatedAt = now;
					summary.released += 1;
				}
			}
			return summary;
		},
	};

	return board;
}
