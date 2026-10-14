/**
 * 任务 DTO 与类型注册表 (api/05 §5.2)。
 * 任务以序列化 DTO 形式持久化于 Memory.Nexus.tasks;
 * 原生目标对象在执行 Tick 用 Game.getObjectById 重新解析, 绝不落 Memory。
 */

export const TASK_KINDS = [
	"harvest",
	"haul",
	"fill_spawn",
	"upgrade",
	"build",
	"scout",
	"reserve",
	"claim",
	"defend",
	"retreat",
	"repair",
	"attack",
	"heal",
	"boost",
	"terminal_transfer",
	"factory_produce",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export type TaskStatus =
	| "available"
	| "leased"
	| "in_progress"
	| "completed"
	| "failed"
	| "cancelled";

export interface SerializedPosition {
	x: number;
	y: number;
	roomName: string;
}

export interface NexusTask {
	id: string;
	dedupeKey: string;
	kind: TaskKind;
	status: TaskStatus;
	roomName: string;
	targetId?: string;
	targetPos?: SerializedPosition;
	/** 搬运类任务的目的地 (配额分配的交付结构) */
	destId?: string;
	destPos?: SerializedPosition;
	resourceType?: ResourceConstant;
	amount?: number;
	priority: number;
	createdAt: number;
	updatedAt: number;
	deadline?: number;
	requiredCapabilities: string[];
	assignedTo?: string;
	leaseUntil?: number;
	lastProgressTick?: number;
	attempts: number;
	maxAttempts: number;
	failureReason?: string;
}

/** 创建合同: 省略自动生成字段 (id/createdAt/updatedAt/attempts), 其余必填 */
export interface NewTaskInput {
	dedupeKey: string;
	kind: TaskKind;
	roomName: string;
	targetId?: string;
	targetPos?: SerializedPosition;
	destId?: string;
	destPos?: SerializedPosition;
	resourceType?: ResourceConstant;
	amount?: number;
	priority: number;
	deadline?: number;
	requiredCapabilities: string[];
	maxAttempts?: number;
}

/** 租约与失败上限政策 (api/05 §5.5): 不同任务不同租约, 不搞一刀切 */
export const LEASE_POLICY = {
	defaultTicks: 50,
	byKind: {
		harvest: 100,
		upgrade: 100,
		build: 80,
		haul: 40,
		fill_spawn: 40,
		defend: 40,
		retreat: 20,
		repair: 80,
	} as Partial<Record<TaskKind, number>>,
	heartbeatGraceTicks: 20,
	maxAttemptsByKind: {
		harvest: 5,
		haul: 6,
		fill_spawn: 8,
		upgrade: 5,
		build: 5,
		defend: 8,
		retreat: 3,
		repair: 5,
	} as Partial<Record<TaskKind, number>>,
} satisfies {
	defaultTicks: number;
	heartbeatGraceTicks: number;
	byKind: Partial<Record<TaskKind, number>>;
	maxAttemptsByKind: Partial<Record<TaskKind, number>>;
};

export function leaseTicksFor(kind: TaskKind): number {
	return LEASE_POLICY.byKind[kind] ?? LEASE_POLICY.defaultTicks;
}

export function maxAttemptsFor(kind: TaskKind): number {
	return LEASE_POLICY.maxAttemptsByKind[kind] ?? 5;
}

/**
 * 任务优先级政策 (docs/nexus-design/06 §6.2 能源序 + docs/nexus-design/09 §9.3 防御序):
 * 供能 > 防御 (defend 92 / retreat 90 达抢占线, 撤退优先于经济滞回) > 采集 > 搬运 > 建造/维修 > 升级。
 */
export const TASK_PRIORITY = {
	fill_spawn: 95,
	defend: 92,
	retreat: 90,
	harvest: 70,
	haul: 60,
	scout: 55,
	build: 50,
	repair: 45,
	upgrade: 30,
} as const satisfies Partial<Record<TaskKind, number>>;

export function priorityFor(kind: TaskKind): number {
	return (TASK_PRIORITY as Record<string, number | undefined>)[kind] ?? 50;
}

export interface TaskQuery {
	roomName?: string;
	kinds?: TaskKind[];
	statuses?: TaskStatus[];
	minPriority?: number;
	unassignedOnly?: boolean;
}

export function isTaskKind(value: string): value is TaskKind {
	return (TASK_KINDS as readonly string[]).includes(value);
}
