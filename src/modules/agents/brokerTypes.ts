/**
 * ActionBroker (api/06) 类型契约: 行动 kind/管线/计划/载荷/结果与 broker 依赖接口族,
 * 以及 creep 管线与批量管线集合。执行逻辑见 actionBroker.ts 与两族执行器模块。
 */
import type { NexusTask, SerializedPosition } from "@/core/store/taskSchema";
import type { Logger } from "@/core/logger";

export type ActionKind =
	| "move"
	| "harvest"
	| "pickup"
	| "withdraw"
	| "transfer"
	| "build"
	| "upgradeController"
	| "drop"
	| "attack"
	| "rangedAttack"
	| "heal"
	| "repair"
	| "activateSafeMode"
	| "suicide"
	| "renew"
	| "createSite"
	| "removeSite"
	| "destroyStructure"
	| "spawnCreep"
	| "cancelSpawn"
	| "marketDeal"
	| "terminalSend"
	| "cancelMarketOrder"
	| "claimController"
	| "reserveController"
	| "usePower"
	| "enableRoom"
	| "combatMove"
	| "combatStep"
	| "combatStrike"
	| "combatHealAction"
	| "combatMoveByPath"
	| "createFlag"
	| "removeFlag"
	| "runLabReaction"
	| "factoryProduce"
	| "processPowerSpawn"
	| "createMarketOrder"
	| "changeMarketOrderPrice"
	| "extendMarketOrder";

/** combat = Creep 战斗; tower = 塔结构行动; defense = 房间级防御意图 (SafeMode);
 *  construction = 工地/结构变更; spawn = 孵化; market = 交易/发送;
 *  claim = 占领/预订; power = PowerCreep 能力; flag = 旗标创建/移除 */
export type ActionPipeline =
	| "move"
	| "work"
	| "carry"
	| "controller"
	| "combat"
	| "tower"
	| "defense"
	| "construction"
	| "spawn"
	| "market"
	| "claim"
	| "power"
	| "flag";

export interface ActionPlan {
	id: string;
	tick: number;
	/** 持有租约的任务 ID; 结构 actor (塔/SafeMode) 无任务, 可缺省 */
	taskId?: string | undefined;
	actorName: string;
	kind: ActionKind;
	targetId?: string | undefined;
	targetPos?: SerializedPosition | undefined;
	resourceType?: ResourceConstant | undefined;
	amount?: number | undefined;
	priority: number;
	pipeline: ActionPipeline;
	dedupeKey: string;
	/** 移动意图场景标签 (任务 5.1: 目标/优先级/理由三元): 如 "scout-room"/"return-home",
	 *  供结果回投与移动遥测按场景归因; 非移动管线可缺省 */
	reason?: string | undefined;
	/** 扩展参数 (新管线的命令载荷; 按管线解释) */
	payload?: ActionPayload | undefined;
}

/** 新管线命令载荷: 按管线解释, 未列字段忽略 */
export interface ActionPayload {
	/** createSite: 结构类型常量名 */
	structureType?: BuildableStructureConstant;
	/** spawnCreep: 体型 */
	body?: BodyPartConstant[];
	/** spawnCreep: 孵化名 */
	creepName?: string;
	/** spawnCreep: 记忆 */
	memory?: Record<string, unknown>;
	/** marketDeal: 买单/卖单 ID */
	orderId?: string;
	/** terminalSend: 目的房 */
	destinationRoom?: string;
	/** marketDeal/terminalSend: 资源描述已由 resourceType 承载 */
	/** createMarketOrder: 挂单价/总量; changeMarketOrderPrice: 新价 (静态注入也经 payload 承载) */
	/** runLabReaction: 反应底物 lab */
	/** usePower: PowerConstant 数值 */
	power?: number;
	/** combatStrike: 打击方式 (近战/远程/范围远程) */
	strike?: "attack" | "rangedAttack" | "rangedMassAttack";
	/** combatStrike: 目标类别 (Creep 或 Structure, 决定解析口径) */
	strikeTarget?: "creep" | "structure";
	/** combatHealAction: 治疗方式 (近身/远程) */
	healMode?: "heal" | "rangedHeal";
	/** combatStep: 移动方向 (1-8) */
	direction?: number;
	/** combatMove: 移动选项 (range/视觉样式/成本回调等, 原样透传给 moveTo) */
	moveOpts?: MoveOptsPayload;
	/** combatMoveByPath: 路径点序列 */
	path?: { x: number; y: number; roomName: string }[];
	/** createFlag/removeFlag: 旗标名 */
	flagName?: string;
	/** createFlag: 旗标颜色 */
	color?: ColorConstant;
	/** createFlag: 旗标副色 */
	secondaryColor?: ColorConstant;
	/** runLabReaction: 反应底物 lab (lab1/lab2 与原生 API 同序) */
	lab1Id?: string;
	lab2Id?: string;
	/** createMarketOrder: 订单方向 (买单/卖单) */
	orderType?: "buy" | "sell";
	/** createMarketOrder: 挂单价 */
	price?: number;
	/** createMarketOrder: 挂单总量 */
	totalAmount?: number;
}

/** combatMove 的移动选项载荷: 字段原样映射 MoveToOpts; costCallback 为函数引用, 仅限同 Tick 消费 */
export interface MoveOptsPayload {
	range?: number;
	visualizePathStyle?: { stroke: string };
	ignoreCreeps?: boolean;
	maxRooms?: number;
	reusePath?: number;
	plainCost?: number;
	swampCost?: number;
	costCallback?: (roomName: string, costMatrix: CostMatrix) => void;
}

export type ResultCategory = "accepted" | "retryable" | "replan" | "invalid" | "suppressed";

/**
 * 命令结果 (api/17 command-boundary spec 结果语义真实):
 * - category: 内部处置五分类, 必有;
 * - nativeReturnCode: 原生 API 返回码, 仅在命令真正触达原生 API 时存在;
 *   校验/仲裁阶段被拒的命令 MUST NOT 伪造该字段 (缺省即"未触达")。
 */
export interface ActionResult {
	planId: string;
	actorName: string;
	kind: ActionKind;
	pipeline: ActionPipeline;
	accepted: boolean;
	nativeReturnCode?: number;
	category: ResultCategory;
	reason?: string;
	/** 在途意图的场景标签 (任务 5.1 理由回投): 来自 ActionPlan.reason, 供遥测归因 */
	intentReason?: string | undefined;
	/** 本 tick 实际转移的能量 (transfer 交付量记账口径, 执行侧 carry 差分) */
	movedEnergy?: number;
}

export interface BrokerDeps {
	logger: Logger;
	/** 任务查询与 replan 反馈 (fail 会计尝试次数并按上限终态化) */
	getTask: (taskId: string) => NexusTask | undefined;
	onReplan: (taskId: string, creepName: string, reason: string) => void;
}

export interface ActionBroker {
	submit(plan: ActionPlan): void;
	commit(now: number): readonly ActionResult[];
	lastResult(actorName: string, pipeline?: ActionPipeline): ActionResult | undefined;
	/**
	 * 立即执行单条命令 (不经仲裁队列): 供 commit 阶段晚于 broker 的
	 * 直接孵化/紧急命令使用 —— 原生调用权仍在 broker, 只是同步窗口。
	 */
	executeNow(plan: ActionPlan): ActionResult;
}

/** 以 creep 为 actor 的管线 (所有权检查适用域); 结构/房间级 actor 无租约语义 */
export const CREEP_PIPELINES: ReadonlySet<string> = new Set([
	"move",
	"work",
	"carry",
	"controller",
	"combat",
	"claim",
]);

/**
 * 房间级批量管线 (api/17 命令边界): actor 是房间/结构名, 一 pass 天然提交多条
 * 独立命令 (如布局放量一次放多个工地)。"同 actor 同 pipeline 留一"仲裁只对
 * creep 行动有意义 (一个机体一 tick 一个动作); 对批量管线做去重会把放量压成
 * 每 tick 1 条 (sim 实锤 45k 全房仅 6 工地, 源容器 0), 故豁免仲裁。
 */
export const BATCH_PIPELINES: ReadonlySet<string> = new Set([
	"construction",
	"market",
	"claim",
	"power",
	"flag",
]);
