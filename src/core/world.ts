/**
 * 世界观测契约: 感知模块每 Tick 产出的纯数据快照 (ID + 数字, 不含 API 对象),
 * 下游任务源/分配/生产一律读快照, 不各自扫房间 (docs/nexus-design/03 §3.4)。
 */
import { DOWNGRADE_CONFIG } from "@/config/economy";

export interface SourceSummary {
	id: string;
	roomName: string;
	x: number;
	y: number;
	energy: number;
	energyCapacity: number;
}

export interface EnergyStructureSummary {
	id: string;
	structureType: "spawn" | "extension";
	roomName: string;
	x: number;
	y: number;
	energy: number;
	energyCapacity: number;
	/** 孵化剩余 tick (spawn 专属, 空闲/extension 为 null)——孵化槽空闲前瞻用 */
	spawnRemainingTicks: number | null;
}

export interface SiteSummary {
	id: string;
	structureType: string;
	roomName: string;
	x: number;
	y: number;
}

/** 落地能量 (墓碑/掉落) */
export interface PileSummary {
	id: string;
	roomName: string;
	x: number;
	y: number;
	amount: number;
}

export interface StoreSummary {
	id: string;
	structureType: string;
	roomName: string;
	x: number;
	y: number;
	energy: number;
	energyCapacity: number;
}

export interface CreepSummary {
	name: string;
	/** 游戏对象 ID (治疗/战斗目标解析用, 与 name 不同源) */
	id: string;
	roomName: string;
	/** 从名称解析的代号 (CODE-HEX 命名约定) */
	unitCode: string;
	x: number;
	y: number;
	ticksToLive: number;
	carryEnergy: number;
	freeCapacity: number;
	spawning: boolean;
	/** 当前生命 (治疗/撤退判定用) */
	hits: number;
	hitsMax: number;
	/** 身体部件计数 (能力画像用) */
	bodyWork: number;
	bodyCarry: number;
	bodyMove: number;
	bodyClaim: number;
	/** 战斗部件计数 (Phase 3: 战斗/非战斗判定与治疗能力) */
	bodyAttack: number;
	bodyRanged: number;
	bodyHeal: number;
	bodyTough: number;
}

/** 敌方单位摘要 (docs/nexus-design/09 §9.2): 能力由实际部件构成推导 */
export interface HostileCreepSummary {
	id: string;
	name: string;
	/** 主人名 (NPC Invader 为 "Invader") */
	owner: string;
	/** NPC (Invader 系) 与玩家敌人分类 */
	isNpc: boolean;
	x: number;
	y: number;
	hits: number;
	hitsMax: number;
	/** 存活战斗部件计数 */
	bodyAttack: number;
	bodyRanged: number;
	bodyHeal: number;
	bodyTough: number;
	bodyMove: number;
	/** 带 Boost 的部件数 (能力放大近似) */
	boostedParts: number;
}

/** 己方塔摘要 (塔控与补给配额用) */
export interface TowerSummary {
	id: string;
	roomName: string;
	x: number;
	y: number;
	energy: number;
	energyCapacity: number;
}

/** 可受损结构摘要 (维修目标与濒毁判定用) */
export interface DamageableSummary {
	id: string;
	structureType: string;
	roomName: string;
	x: number;
	y: number;
	hits: number;
	hitsMax: number;
}

export interface ControllerSummary {
	id: string;
	x: number;
	y: number;
	/** 控制等级 (与 RoomObservation.rcl 同源, 摘要自包含便于下游单读) */
	level?: number;
	/** 当前升级进度 (未暴露时缺省) */
	progress?: number;
	/** 升级进度上限 */
	progressTotal?: number;
	/** 降级剩余 tick (bugs/P1-10 降级守护输入; 满级或刚被升级重置满额时缺省) */
	ticksToDowngrade?: number;
	/** SafeMode 可用次数 (缺省视为 0) */
	safeModeAvailable?: number;
	/** SafeMode 剩余 tick (激活中) */
	safeMode?: number;
	/** SafeMode 冷却剩余 tick */
	safeModeCooldown?: number;
}

/** 控制器升级缓冲 (specs/controller-upgrade-buffer): 采纳的 cc 容器 + 就位升级工位 */
export interface ControllerBufferSummary {
	/** 被采纳的容器结构 ID (控制器 adoptRange 范围内) */
	id: string;
	x: number;
	y: number;
	/** 就位升级工位: cc 相邻 ∩ 控制器升级射程 ∩ 可站位, 固定顺序 (工位任务 i ↔ slots[i]) */
	slots: Array<{ x: number; y: number }>;
}

export interface RoomObservation {
	roomName: string;
	rcl: number;
	/** 孵化能量容量 (spawn+ext 合计, 采集定编折算输入) */
	energyCapacity: number;
	controller?: ControllerSummary;
	sources: SourceSummary[];
	energyStructures: EnergyStructureSummary[];
	sites: SiteSummary[];
	piles: PileSummary[];
	stores: StoreSummary[];
	creeps: CreepSummary[];
	hostiles: HostileCreepSummary[];
	towers: TowerSummary[];
	damageables: DamageableSummary[];
	/** 任一 spawn 正在孵化 (拉能快递闸门: 孵化期不发车) */
	spawnBusy: boolean;
	/** 供能 link 结构数 (快递特化子模式退位判据) */
	linkCount: number;
	/** 控制器缓冲 (范围内无容器时缺省; specs/controller-upgrade-buffer) */
	controllerBuffer?: ControllerBufferSummary;
}

export interface WorldView {
	tick: number;
	rooms: Record<string, RoomObservation>;
	/** 可见非己方房中的己方单位 (外矿采集/侦查/预订件):
	 *  world.rooms 只收己方房, 这些单位不进任何房观察——没有此清单时
	 *  任务分配与 agent 驱动都看不见它们 (bugs/P1-18 断点④: 跨房爬到达即失联)。 */
	remoteUnits: CreepSummary[];
}

/** 跨 Tick 感知状态: 当 Tick 快照 + 本 Tick 发现的死亡单位与失守房间 */
export interface WorldHolder {
	current: WorldView | null;
	dead: string[];
	/** 本 Tick 发现的失守房间名 (上一 Tick 己方、本 Tick 可见且非己方, bugs/P1-10) */
	lostRooms: string[];
}

export function createWorldHolder(): WorldHolder {
	return { current: null, dead: [], lostRooms: [] };
}

/** 本 Tick 全部存活的本方单位名 */
export function aliveNames(world: WorldView | null): Set<string> {
	const names = new Set<string>();
	if (!world) {
		return names;
	}
	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			names.add(creep.name);
		}
	}
	for (const creep of world.remoteUnits) {
		names.add(creep.name);
	}
	return names;
}

/**
 * 降级紧急判定 (bugs/P1-10 / docs/nexus-design/17 §17.9): 剩余 tick 低于阈值即紧急。
 * 计时只减不增、升级即重置满额, 单阈值即天然防抖, 无需迟滞状态;
 * 满级/刚被升级重置 (字段缺省) 视为正常。
 */
export function downgradeEmergency(controller?: ControllerSummary): boolean {
	const ticks = controller?.ticksToDowngrade;
	return ticks !== undefined && ticks < DOWNGRADE_CONFIG.emergencyTicks;
}

/** 从名称解析角色代号 (命名约定 "N体 CODE-HEX" / 兼容旧 "CODE-HEX") */
export function unitCodeFromName(name: string): string {
	// "12体 U-3F2A" → 取空格后的 "U-3F2A"; 旧名无空格直接取前缀
	const codePart = name.includes(" ") ? (name.split(" ")[1] ?? name) : name;
	return codePart.split("-")[0] ?? codePart;
}
