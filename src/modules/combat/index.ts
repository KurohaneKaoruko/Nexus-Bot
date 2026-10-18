/**
 * 战斗域模块公共面: 适配层是 defense/teams 域共享的命令提交边界
 * (openspec nexus-architecture-refactor 轨道 E)。
 */
export {
	combatAttack,
	combatRangedAttack,
	combatRangedMassAttack,
	combatHeal,
	combatRangedHeal,
	combatMove,
	combatMoveTo,
	combatMoveByPath,
	combatSuicide,
	combatCreateFlag,
	combatRemoveFlag,
	holdActor,
	releaseTeamActors,
} from "@/modules/combat/combatAdapter";
