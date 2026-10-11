/**
 * 世界观测契约: 感知模块每 Tick 产出的纯数据快照 (ID + 数字, 不含 API 对象),
 * 下游任务源/分配/生产一律读快照, 不各自扫房间 (docs/nexus-design/03 §3.4)。
 */

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
	roleCode: string;
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
	/** SafeMode 可用次数 (缺省视为 0) */
	safeModeAvailable?: number;
	/** SafeMode 剩余 tick (激活中) */
	safeMode?: number;
	/** SafeMode 冷却剩余 tick */
	safeModeCooldown?: number;
}

export interface RoomObservation {
	roomName: string;
	rcl: number;
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
}

export interface WorldView {
	tick: number;
	rooms: Record<string, RoomObservation>;
}

/** 跨 Tick 感知状态: 当 Tick 快照 + 本 Tick 发现的死亡单位 */
export interface WorldHolder {
	current: WorldView | null;
	dead: string[];
}

export function createWorldHolder(): WorldHolder {
	return { current: null, dead: [] };
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
	return names;
}

/** 从名称解析角色代号 (CODE-HEX 约定) */
export function roleCodeFromName(name: string): string {
	return name.split("-")[0] ?? name;
}
