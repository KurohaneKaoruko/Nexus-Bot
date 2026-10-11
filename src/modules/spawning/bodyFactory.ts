/**
 * BodyFactory (docs/nexus-design/07 §7.3): 模板 + 预算伸缩。
 * 每个角色一个可行走的段 (segment), 按能源预算重复 min..max 次;
 * 预算低于 min 段成本时不生产 (返回 null), 绝不加满 50 部件。
 * 代号与 src/constant/RoleConstant.ts 一致。
 */
export type EconomyRole = "universal" | "harvester" | "upgrader" | "worker" | "carrier";
/** 战斗角色 (Phase 3: 防守型 defender, 远程为主) */
export type CombatRole = "defender";
export type SpawnRole = EconomyRole | CombatRole;

interface SegmentDef {
	segment: BodyPartConstant[];
	/** 最少段数 (低于此成本不生产) */
	min: number;
	/** 最多段数 (RCL1–2 防超长身体: 生产慢、移动慢) */
	max: number;
}

const SEGMENTS: Record<SpawnRole, SegmentDef> = {
	universal: { segment: ["work", "carry", "move"], min: 1, max: 4 },
	// 带 carry (bugs/P0-3): 驻点矿工满载即转入 worksite 容器, 落地只剩容器满时的溢出兜底;
	// min 1 保证 RCL1 容量 300 可产 (min 2 的 400 会在开局死锁升级, sim 回归实证)
	harvester: { segment: ["work", "carry", "move"], min: 1, max: 6 },
	upgrader: { segment: ["work", "carry", "move"], min: 1, max: 4 },
	worker: { segment: ["work", "carry", "move"], min: 1, max: 4 },
	carrier: { segment: ["carry", "carry", "move"], min: 1, max: 4 },
	defender: { segment: ["ranged_attack", "move"], min: 1, max: 4 },
};

export function isEconomyRole(role: string): role is EconomyRole {
	return role in SEGMENTS && role !== "defender";
}

export function isSpawnRole(role: string): role is SpawnRole {
	return role in SEGMENTS;
}

function segmentCost(segment: BodyPartConstant[]): number {
	return segment.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

export function bodyCost(body: BodyPartConstant[]): number {
	return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

/** 生产时间: 经典规则每部件 3 tick (docs/nexus-design/07 §7.5, 以当前服务器为准) */
export function spawnTimeOf(body: BodyPartConstant[]): number {
	return body.length * 3;
}

export function buildBody(role: SpawnRole, budget: number): BodyPartConstant[] | null {
	const def = SEGMENTS[role];
	const cost = segmentCost(def.segment);
	if (budget < cost * def.min) {
		return null;
	}
	const segments = Math.min(def.max, Math.floor(budget / cost));
	const body: BodyPartConstant[] = [];
	for (let i = 0; i < segments; i += 1) {
		body.push(...def.segment);
	}
	return body;
}

/** 角色的典型生产时间上界 (替补窗口估算用: max 段) */
export function typicalSpawnTime(role: SpawnRole): number {
	return spawnTimeOf(buildBody(role, Number.MAX_SAFE_INTEGER) ?? []);
}
