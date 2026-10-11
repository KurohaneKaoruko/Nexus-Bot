/**
 * 塔控制 (docs/nexus-design/09 §9.3/§9.4):
 * 目标按「即刻危险 × 战略价值 × 击杀可行性」排序 (复用威胁贡献排序: 接近度×类别×部件能力,
 * 治疗者按部件权重计入); 多塔贪心分配避免过度集火将亡低价值目标;
 * 低于能源储量线停修缮只保留对敌/治疗。
 * 纯函数模块: 分配结果由 defense/index.ts 的模块装配提交 ActionBroker (结构 actor)。
 */
import { COMBAT_CONFIG, TOWER_CONFIG } from "@/config/defense";
import type { CreepSummary, DamageableSummary, HostileCreepSummary, RoomObservation } from "@/core/world";
import { rankHostiles } from "@/modules/defense/threatModel";

export interface TowerAssignment {
	towerId: string;
	kind: "attack" | "heal" | "repair";
	targetId: string;
}

/** 塔单发伤害近似 (近距离满伤; 距离衰减不做精确建模, 只影响过量估计) */
const TOWER_SHOT_DAMAGE = 600;

/** 击杀可行性折算的有效生命: 现有生命 + 治疗压制量 */
function effectiveHp(hostile: HostileCreepSummary): number {
	return hostile.hits + hostile.bodyHeal * TOWER_CONFIG.healDenialFactor;
}

/** 最重伤的己方单位 (比例最低者) */
function mostWounded(room: RoomObservation): CreepSummary | undefined {
	let worst: CreepSummary | undefined;
	for (const creep of room.creeps) {
		if (creep.hitsMax <= 0 || creep.hits >= creep.hitsMax * COMBAT_CONFIG.healThreshold) {
			continue;
		}
		if (!worst || creep.hits / creep.hitsMax < worst.hits / worst.hitsMax) {
			worst = creep;
		}
	}
	return worst;
}

/** 最受损结构 (比例最低者; 塔修缮只挑一个代表目标) */
function mostDamaged(damageables: DamageableSummary[]): DamageableSummary | undefined {
	let worst: DamageableSummary | undefined;
	for (const structure of damageables) {
		if (structure.hitsMax <= 0 || structure.hits >= structure.hitsMax) {
			continue;
		}
		if (!worst || structure.hits / structure.hitsMax < worst.hits / worst.hitsMax) {
			worst = structure;
		}
	}
	return worst;
}

/**
 * 生成本 Tick 的塔行动分配 (纯函数, 只读快照):
 * 有敌 → 开火 (排序 + 防过度集火); 无敌有伤 → 治疗; 无敌无伤且能源高于储量线 → 修缮。
 */
export function assignTowers(room: RoomObservation): TowerAssignment[] {
	const assignments: TowerAssignment[] = [];
	const towers = room.towers.filter((tower) => tower.energy > 0);

	if (room.hostiles.length > 0) {
		const ranked = rankHostiles(room);
		const assignedDamage = new Map<string, number>();
		for (const tower of towers) {
			// 按威胁排序取目标: 已分配火力覆盖其有效生命的目标跳过 (防过度集火),
			// 单发足以击杀的低血目标仍会被射击 (0 < 有效生命)
			let chosen: HostileCreepSummary | undefined;
			for (const hostile of ranked) {
				const spent = assignedDamage.get(hostile.id) ?? 0;
				if (spent < effectiveHp(hostile) + TOWER_CONFIG.overkillHeadroom) {
					chosen = hostile;
					break;
				}
			}
			if (!chosen) {
				// 全部目标已被覆盖: 集火最高威胁仍好过空转
				chosen = ranked[0];
			}
			if (!chosen) {
				continue;
			}
			assignedDamage.set(chosen.id, (assignedDamage.get(chosen.id) ?? 0) + TOWER_SHOT_DAMAGE);
			assignments.push({ towerId: tower.id, kind: "attack", targetId: chosen.id });
		}
		return assignments;
	}

	const wounded = mostWounded(room);
	if (wounded) {
		for (const tower of towers) {
			assignments.push({ towerId: tower.id, kind: "heal", targetId: wounded.id });
		}
		return assignments;
	}

	// 修缮属于非关键用途: 能源低于储量线时停止, 只保留对敌/治疗
	const damaged = mostDamaged(room.damageables);
	if (damaged && towers.some((tower) => tower.energy > TOWER_CONFIG.energyFloor)) {
		const repairer = towers.find((tower) => tower.energy > TOWER_CONFIG.energyFloor);
		if (repairer) {
			assignments.push({ towerId: repairer.id, kind: "repair", targetId: damaged.id });
		}
	}
	return assignments;
}
