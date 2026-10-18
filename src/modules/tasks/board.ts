/**
 * TaskBoard (docs/nexus-design/05 / api/05 §5.3–5.7): 任务事实源。
 * 无状态门面: 直接操作 Memory.Nexus.tasks 记录表, 每 Tick 可安全重建实例。
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
} from "@/core/store/taskSchema";

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
	/** 各状态任务计数 (任务 5.3 账本可审计): 由索引桶直读, O(状态数) */
	counts(): Record<TaskStatus, number>;
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

export { TERMINAL_STATUSES };

/**
 * 哈希索引 (任务 5.3): 按 room/kind/status/assignee 分桶的 id 集合, 与任务生命周期
 * 同步更新。模块级 WeakMap 挂在记录表对象上——派生状态不落 Memory, 对象重建
 * (Memory 修复/全局重置) 时自动按现状重建; 查询成本 = 命中桶规模, 与任务总量解耦。
 */
interface TaskIndex {
	room: Map<string, Set<string>>;
	kind: Map<string, Set<string>>;
	status: Map<string, Set<string>>;
	assignee: Map<string, Set<string>>;
}

const taskIndexCache = new WeakMap<object, TaskIndex>();

function bucketAdd(map: Map<string, Set<string>>, key: string, id: string): void {
	let set = map.get(key);
	if (set === undefined) {
		set = new Set();
		map.set(key, set);
	}
	set.add(id);
}

function bucketDelete(map: Map<string, Set<string>>, key: string, id: string): void {
	const set = map.get(key);
	if (set === undefined) {
		return;
	}
	set.delete(id);
	if (set.size === 0) {
		map.delete(key);
	}
}

function indexAdd(index: TaskIndex, task: NexusTask): void {
	bucketAdd(index.room, task.roomName, task.id);
	bucketAdd(index.kind, task.kind, task.id);
	bucketAdd(index.status, task.status, task.id);
	if (task.assignedTo !== undefined) {
		bucketAdd(index.assignee, task.assignedTo, task.id);
	}
}

function indexRemove(index: TaskIndex, task: NexusTask): void {
	bucketDelete(index.room, task.roomName, task.id);
	bucketDelete(index.kind, task.kind, task.id);
	bucketDelete(index.status, task.status, task.id);
	if (task.assignedTo !== undefined) {
		bucketDelete(index.assignee, task.assignedTo, task.id);
	}
}

/** 索引取用: 首次访问全量建桶, 之后跨实例/跨 Tick 复用 (对象身份不变则增量维护) */
function taskIndexOf(tasks: Record<string, NexusTask>): TaskIndex {
	let index = taskIndexCache.get(tasks);
	if (index === undefined) {
		index = { room: new Map(), kind: new Map(), status: new Map(), assignee: new Map() };
		for (const task of Object.values(tasks)) {
			indexAdd(index, task);
		}
		taskIndexCache.set(tasks, index);
	}
	return index;
}

/** 状态迁移 (含索引桶同步, 唯一改 status 的入口) */
function transition(index: TaskIndex, task: NexusTask, next: TaskStatus): void {
	bucketDelete(index.status, task.status, task.id);
	task.status = next;
	bucketAdd(index.status, next, task.id);
}

/** 指派变更 (含索引桶同步, 唯一改 assignedTo 的入口): next 缺省为解除指派 */
function reassign(index: TaskIndex, task: NexusTask, next?: string): void {
	if (task.assignedTo !== undefined) {
		bucketDelete(index.assignee, task.assignedTo, task.id);
	}
	if (next !== undefined) {
		task.assignedTo = next;
		bucketAdd(index.assignee, next, task.id);
	} else {
		delete task.assignedTo;
	}
}

/** 桶并集 (多 kind/多 status 查询的候选集) */
function unionOfBuckets(map: Map<string, Set<string>>, keys: readonly string[]): Set<string> {
	const out = new Set<string>();
	for (const key of keys) {
		const set = map.get(key);
		if (set !== undefined) {
			for (const id of set) {
				out.add(id);
			}
		}
	}
	return out;
}

/** 字段级核验: 候选桶只保证必要不充分 (minPriority/unassignedOnly 不入索引, 残留桶条目在此滤除) */
function matchesQuery(task: NexusTask, query?: TaskQuery): boolean {
	if (query?.statuses && !query.statuses.includes(task.status)) {
		return false;
	}
	if (query?.roomName && task.roomName !== query.roomName) {
		return false;
	}
	if (query?.kinds && !query.kinds.includes(task.kind)) {
		return false;
	}
	if (query?.assignedTo && task.assignedTo !== query.assignedTo) {
		return false;
	}
	if (query?.minPriority !== undefined && task.priority < query.minPriority) {
		return false;
	}
	if (query?.unassignedOnly && task.assignedTo !== undefined) {
		return false;
	}
	return true;
}

/** 记录摘除 (含索引桶同步, 唯一 delete 任务的入口) */
function dropTask(index: TaskIndex, tasks: Record<string, NexusTask>, task: NexusTask): void {
	indexRemove(index, task);
	delete tasks[task.id];
}

/** 各状态计数 (任务 5.3 账本可审计): 索引桶 O(1) 直读, 供 diag/遥测查询 */
export function taskStatusCounts(tasks: Record<string, NexusTask>): Record<TaskStatus, number> {
	const index = taskIndexOf(tasks);
	return {
		available: index.status.get("available")?.size ?? 0,
		leased: index.status.get("leased")?.size ?? 0,
		in_progress: index.status.get("in_progress")?.size ?? 0,
		completed: index.status.get("completed")?.size ?? 0,
		failed: index.status.get("failed")?.size ?? 0,
		cancelled: index.status.get("cancelled")?.size ?? 0,
	};
}

/** 由去重键生成稳定 id: 同键合并靠 upsert, id 仅保证唯一 (同 tick 批量建的
 *  16bit 随机段有生日碰撞概率, 碰撞静默覆盖会丢任务——碰撞加递增后缀, 不再消耗随机流) */
function newTaskId(now: number, tasks: Record<string, NexusTask>): string {
	const prefix = `t${now.toString(36)}`;
	let id = `${prefix}${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
	if (tasks[id] === undefined) {
		return id;
	}
	let n = 1;
	while (tasks[`${id}~${n}`] !== undefined) {
		n += 1;
	}
	return `${id}~${n}`;
}

export function createTaskBoard(tasks: Record<string, NexusTask>): TaskBoard {
	/** 惰性索引访问: 只读/未触达实例不支付建桶成本 */
	const idx = (): TaskIndex => taskIndexOf(tasks);

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
		const index = idx();
		transition(index, task, "available");
		reassign(index, task, undefined);
		delete task.leaseUntil;
	}

	const board: TaskBoard = {
		get: find,

		/** 索引桶选取: 提供的维度里取最小桶为候选, 逐桶取交集; 无维度则全量键 */
		list(query?: TaskQuery): NexusTask[] {
			const index = idx();
			const buckets: Array<Set<string>> = [];
			if (query?.roomName !== undefined) {
				buckets.push(index.room.get(query.roomName) ?? new Set());
			}
			if (query?.kinds !== undefined) {
				buckets.push(unionOfBuckets(index.kind, query.kinds));
			}
			if (query?.statuses !== undefined) {
				buckets.push(unionOfBuckets(index.status, query.statuses));
			}
			if (query?.assignedTo !== undefined) {
				buckets.push(index.assignee.get(query.assignedTo) ?? new Set());
			}
			let source: Iterable<string>;
			if (buckets.length === 0) {
				source = Object.keys(tasks);
			} else {
				// 最小桶起步: 候选规模与命中集同阶, 与任务总量无关 (任务 5.3)
				buckets.sort((a, b) => a.size - b.size);
				const first = buckets[0];
				const kept = new Set<string>();
				outer: for (const id of first ?? []) {
					for (let i = 1; i < buckets.length; i += 1) {
						if (!buckets[i]?.has(id)) {
							continue outer;
						}
					}
					kept.add(id);
				}
				source = kept;
			}
			const out: NexusTask[] = [];
			for (const id of source) {
				const task = tasks[id];
				if (task === undefined || !matchesQuery(task, query)) {
					continue;
				}
				out.push(task);
			}
			return out;
		},

		counts(): Record<TaskStatus, number> {
			return taskStatusCounts(tasks);
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
			for (const task of Object.values(tasks)) {
				if (task.dedupeKey === input.dedupeKey && TERMINAL_STATUSES.has(task.status)) {
					dropTask(idx(), tasks, task);
				}
			}
			const task: NexusTask = {
				id: newTaskId(now, tasks),
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
			indexAdd(idx(), task);
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
			const index = idx();
			transition(index, task, "leased");
			reassign(index, task, creepName);
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
				transition(idx(), task, "in_progress");
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
			transition(idx(), task, "completed");
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
				transition(idx(), task, "failed");
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
			transition(idx(), task, "cancelled");
			task.failureReason = reason;
			task.updatedAt = now;
			return true;
		},

		reconcile(now: number, options: ReconcileOptions): ReconcileSummary {
			const retention = options.terminalRetentionTicks ?? 500;
			const summary: ReconcileSummary = {
				released: 0,
				expired: 0,
				failed: 0,
				collected: 0,
				compacted: 0,
			};
			const aliveSeen = new Set<string>();
			const index = idx();
			for (const task of Object.values(tasks)) {
				// 同键去重 (自愈): 只保留最早的一条存活任务, 重复的直接删除
				if (!TERMINAL_STATUSES.has(task.status)) {
					if (aliveSeen.has(task.dedupeKey)) {
						dropTask(index, tasks, task);
						summary.compacted += 1;
						continue;
					}
					aliveSeen.add(task.dedupeKey);
				}
				if (TERMINAL_STATUSES.has(task.status)) {
					if (now - task.updatedAt > retention) {
						dropTask(index, tasks, task);
						summary.collected += 1;
					}
					continue;
				}
				if (task.deadline !== undefined && now > task.deadline) {
					transition(index, task, "cancelled");
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
