/**
 * EX-MACHINA NEXUS project-level API contracts.
 *
 * These are custom architecture contracts, not native Screeps declarations.
 * Compile this file inside a project with a pinned `@types/screeps` package.
 * Implementations and runtime behavior still require tests against the target
 * Screeps: World server. Do not store live Screeps object references in Memory.
 */

export type PriorityBand = "P0" | "P1" | "P2" | "P3";
export type NexusPosture = "survive" | "develop" | "expand" | "war";
export type TaskStatus =
	| "available"
	| "leased"
	| "in_progress"
	| "completed"
	| "failed"
	| "cancelled";

export type TaskKind =
	| "harvest"
	| "haul"
	| "fill_spawn"
	| "upgrade"
	| "build"
	| "repair"
	| "scout"
	| "reserve"
	| "claim"
	| "defend"
	| "attack"
	| "heal"
	| "boost"
	| "terminal_transfer"
	| "factory_produce";

export type ActionKind =
	| "move"
	| "harvest"
	| "pickup"
	| "withdraw"
	| "transfer"
	| "build"
	| "repair"
	| "upgradeController"
	| "dismantle"
	| "attack"
	| "rangedAttack"
	| "rangedMassAttack"
	| "heal"
	| "rangedHeal"
	| "claimController"
	| "reserveController"
	| "attackController"
	| "signController"
	| "boost"
	| "usePower"
	| "structureAction";

export type ActionPipeline =
	| "move"
	| "work"
	| "carry"
	| "melee"
	| "ranged"
	| "heal"
	| "controller"
	| "structure"
	| "power";

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

export interface UnitMemory {
	homeRoom?: string;
	taskId?: string;
	bornAt: number;
	lastTaskChange: number;
	lastPosition?: SerializedPosition;
	stuckSince?: number;
}

export interface RoomIntelMemory {
	roomName: string;
	lastSeen: number;
	ownerUsername?: string;
	reservationUsername?: string;
	controllerLevel?: number;
	sources: Array<{ id: string; x: number; y: number }>;
	exits: Partial<Record<1 | 3 | 5 | 7, string>>;
	threatScore: number;
	threatLastSeen?: number;
	confidence: "fresh" | "aging" | "stale" | "unknown";
}

export interface ResourceReservation {
	id: string;
	owner: string;
	roomName: string;
	storeId?: string;
	resourceType: ResourceConstant;
	amount: number;
	createdAt: number;
	expiresAt: number;
	status: "reserved" | "committed" | "released";
}

export interface GlobalMemory {
	posture: NexusPosture;
	lastStrategicUpdate: number;
	goals: Record<string, number>;
}

export interface EconomyMemory {
	reserveEnergy: number;
	reservations: Record<string, ResourceReservation>;
}

export interface NexusMemory {
	schemaVersion: number;
	global: GlobalMemory;
	rooms: Record<string, RoomIntelMemory>;
	tasks: Record<string, NexusTask>;
	units: Record<string, UnitMemory>;
	economy: EconomyMemory;
}

export interface CpuBudgetView {
	readonly used: number;
	readonly limit: number;
	readonly tickLimit: number;
	readonly bucket: number;
	canRun(band: PriorityBand, estimatedCost?: number): boolean;
}

export interface TickContext {
	readonly tick: number;
	readonly shardName: string;
	readonly cpu: CpuBudgetView;
	readonly memory: NexusMemory;
}

export interface CapabilityProfile {
	work: number;
	carry: number;
	move: number;
	melee: number;
	ranged: number;
	heal: number;
	claim: number;
	tough: number;
	ttlRemaining: number;
	fatigue: number;
	freeCarry: number;
}

export interface AllocationCandidate {
	creepName: string;
	taskId: string;
	capabilityFit: number;
	travelCost: number;
	riskCost: number;
	switchCost: number;
	urgency: number;
	utility: number;
	criticality: number;
}

export interface ActionPlan {
	id: string;
	tick: number;
	taskId: string;
	actorName: string;
	kind: ActionKind;
	targetId?: string;
	targetPos?: SerializedPosition;
	resourceType?: ResourceConstant;
	amount?: number;
	priority: number;
	issuedBy: string;
	expectedPipeline: ActionPipeline;
	dedupeKey: string;
}

export interface ActionResult {
	planId: string;
	tick: number;
	accepted: boolean;
	nativeReturnCode: number;
	category: "accepted" | "retryable" | "replan" | "invalid" | "suppressed";
	reason?: string;
}

export interface TaskQuery {
	roomName?: string;
	kinds?: TaskKind[];
	statuses?: TaskStatus[];
	minPriority?: number;
	unassignedOnly?: boolean;
}

export interface ReconcileSummary {
	released: number;
	failed: number;
	expired: number;
	completed: number;
}

export interface TaskBoard {
	get(id: string): NexusTask | undefined;
	list(query?: TaskQuery): readonly NexusTask[];
	upsert(input: NewTaskInput): NexusTask;
	claim(taskId: string, creepName: string, now: number, leaseTicks: number): boolean;
	heartbeat(taskId: string, creepName: string, now: number, leaseTicks: number): boolean;
	markProgress(taskId: string, creepName: string, now: number): boolean;
	complete(taskId: string, creepName: string, now: number): boolean;
	fail(taskId: string, creepName: string | undefined, now: number, reason: string): boolean;
	release(taskId: string, creepName: string, now: number, reason?: string): boolean;
	cancel(taskId: string, now: number, reason: string): boolean;
	reconcile(now: number, liveness: UnitLiveness): ReconcileSummary;
}

export type NewTaskInput = Omit<
	NexusTask,
	"status" | "createdAt" | "updatedAt" | "attempts" | "assignedTo" | "leaseUntil"
> &
	Partial<Pick<NexusTask, "status" | "createdAt" | "updatedAt" | "attempts">>;

export interface UnitLiveness {
	exists(creepName: string): boolean;
	isSpawning(creepName: string): boolean;
}

export interface ResourceRequest {
	id: string;
	owner: string;
	roomName: string;
	resourceType: ResourceConstant;
	amount: number;
	priority: number;
	deadline?: number;
}

export interface EconomyLedger {
	getAvailable(roomName: string, resourceType: ResourceConstant): number;
	reserve(request: ResourceRequest, now: number, ttl: number): ResourceReservation | undefined;
	commit(reservationId: string, amount: number, now: number): boolean;
	release(reservationId: string, reason: string, now: number): boolean;
	expire(now: number): number;
}

export interface SpawnRequest {
	id: string;
	purpose: string;
	homeRoom: string;
	targetRoom?: string;
	taskId?: string;
	priority: number;
	energyBudget: number;
	requiredCapabilities: string[];
	expectedTravelTicks?: number;
	safetyMarginTicks?: number;
	replacementFor?: string;
	expiresAt?: number;
}

export interface BodyPlan {
	body: BodyPartConstant[];
	energyCost: number;
	estimatedSpawnTicks: number;
	capabilities: CapabilityProfile;
}

export interface SpawnConstraints {
	maxBodyParts: number;
	reserveEnergy: number;
	minimumTravelRatio?: number;
}

export interface SpawnDirector {
	enqueue(request: SpawnRequest): void;
	cancel(requestId: string, reason: string): boolean;
	reconcile(ctx: TickContext): void;
	plan(ctx: TickContext): readonly SpawnCommand[];
}

export interface SpawnCommand {
	requestId: string;
	spawnName: string;
	creepName: string;
	bodyPlan: BodyPlan;
}

export interface SerializedGoal {
	pos: SerializedPosition;
	range: number;
}

export interface RoutePolicy {
	avoidHostileRooms: boolean;
	plainCost: number;
	swampCost: number;
	maxOps: number;
	maxRooms: number;
	allowRooms?: string[];
	avoidRooms?: string[];
}

export interface PathPlan {
	createdAt: number;
	origin: SerializedPosition;
	goals: SerializedGoal[];
	path: SerializedPosition[];
	cost: number;
	ops: number;
	incomplete: boolean;
	policyVersion: number;
}

export interface NavigationService {
	findPath(origin: SerializedPosition, goals: SerializedGoal[], policy: RoutePolicy): PathPlan;
	invalidateRoom(roomName: string): void;
	invalidateTarget(targetId: string): void;
}

export interface ModuleError {
	module: string;
	tick: number;
	code: "DATA" | "API" | "POLICY" | "INVARIANT" | "UNEXPECTED";
	message: string;
	roomName?: string;
	creepName?: string;
	taskId?: string;
	nativeReturnCode?: number;
}

export interface TelemetrySink {
	increment(metric: string, amount?: number): void;
	gauge(metric: string, value: number): void;
	observe(metric: string, value: number): void;
	reportError(error: ModuleError): void;
}
