/**
 * 战斗命令适配层 (openspec nexus-architecture-refactor 8.1/8.2 轨道 E):
 * defense/units 与 teams 编队的直连动作统一经本层向 ActionBroker 提交,
 * 原生调用权收编进 broker —— 战斗域不再直接触碰游戏突变 API。
 *
 * 语义契约:
 * - 同步窗口: 调用即经 executeNow 执行并返回原生返回码, 决策算法按返回码
 *   分支的控制流与直连时代完全一致;
 * - 双相位适用: agents 阶段 (defense/units 经 legacy-exec 驱动) 与
 *   commit 段晚于 Broker 的 Teams 状态机都可使用 (executeNow 不依赖
 *   commit 窗口);
 * - 所有权: 战斗 actor 由本层持有 (acquire), 解散时先归还再清理队伍。
 */
import { COMBAT_ADAPTER_CONFIG } from "@/config/combat";
import { acquire, registerOwnerCandidate, release } from "@/runtime/actorOwnership";
import {
	sharedBrokerForDirectCommands,
	type ActionKind,
	type ActionPayload,
	type ActionPipeline,
} from "@/modules/agents/actionBroker";

const OWNER = COMBAT_ADAPTER_CONFIG.ownerName;
const ACTION_PRIORITY = COMBAT_ADAPTER_CONFIG.actionPriority;
const FLAG_PRIORITY = COMBAT_ADAPTER_CONFIG.flagPriority;

/** owner 候选登记 (幂等): 模块加载时执行一次 */
let candidateRegistered = false;
function ensureCandidate(): void {
	if (!candidateRegistered) {
		registerOwnerCandidate(OWNER, COMBAT_ADAPTER_CONFIG.ownerPriority);
		candidateRegistered = true;
	}
}

/** 提交前登记所有权: 本层是战斗 actor 的控制路径 */
function hold(creepName: string): void {
	ensureCandidate();
	acquire(creepName, OWNER, Game.time);
}

/** 计划序号 (同 Tick 内保证计划 id/dedupeKey 唯一) */
let seq = 0;
function nextId(): number {
	if (seq >= Number.MAX_SAFE_INTEGER) {
		seq = 0;
	}
	return ++seq;
}

interface CombatPlanArgs {
	actorName: string;
	kind: ActionKind;
	targetId?: string;
	targetPos?: { x: number; y: number; roomName: string };
	pipeline?: ActionPipeline;
	priority?: number;
	payload?: ActionPayload;
}

/** 同步提交一条战斗命令, 返回原生返回码 (决策算法按其分支) */
function submitCombat(args: CombatPlanArgs): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `combat-${args.kind}-${args.actorName}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: args.actorName,
		kind: args.kind,
		targetId: args.targetId,
		targetPos: args.targetPos,
		priority: args.priority ?? ACTION_PRIORITY,
		pipeline: args.pipeline ?? "combat",
		dedupeKey: `combat:${args.actorName}:${args.kind}:${Game.time}:${nextId()}`,
		payload: args.payload,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

// ── Creep 战斗命令 (与原生 API 同签名同返回码) ──────────────────

/** 近战攻击 (Creep/PowerCreep 或 Structure 目标) */
export function combatAttack(creep: Creep, target: Creep | PowerCreep | Structure): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatStrike",
		targetId: target.id,
		payload: {
			strike: "attack",
			strikeTarget: target instanceof Structure ? "structure" : "creep",
		},
	});
}

/** 远程攻击 (Creep/PowerCreep 或 Structure 目标) */
export function combatRangedAttack(creep: Creep, target: Creep | PowerCreep | Structure): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatStrike",
		targetId: target.id,
		payload: {
			strike: "rangedAttack",
			strikeTarget: target instanceof Structure ? "structure" : "creep",
		},
	});
}

/** 范围远程攻击 (无目标) */
export function combatRangedMassAttack(creep: Creep): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatStrike",
		payload: { strike: "rangedMassAttack" },
	});
}

/** 近身治疗 */
export function combatHeal(creep: Creep, target: Creep): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatHealAction",
		targetId: target.id,
		payload: { healMode: "heal" },
	});
}

/** 远程治疗 */
export function combatRangedHeal(creep: Creep, target: Creep): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatHealAction",
		targetId: target.id,
		payload: { healMode: "rangedHeal" },
	});
}

/** 定向移动 (move) */
export function combatMove(creep: Creep, direction: DirectionConstant): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatStep",
		payload: { direction },
	});
}

/** 移动到目标 (moveTo; 选项原样透传) */
export function combatMoveTo(
	creep: Creep,
	target: RoomPosition | { pos: RoomPosition },
	opts?: {
		range?: number;
		visualizePathStyle?: { stroke: string };
		ignoreCreeps?: boolean;
		maxRooms?: number;
		reusePath?: number;
		costCallback?: (roomName: string, costMatrix: CostMatrix) => void;
	},
): number {
	hold(creep.name);
	const pos = target instanceof RoomPosition ? target : target.pos;
	const payload: ActionPayload = {};
	if (opts) {
		const moveOpts: NonNullable<ActionPayload["moveOpts"]> = {};
		if (opts.range !== undefined) moveOpts.range = opts.range;
		if (opts.visualizePathStyle) moveOpts.visualizePathStyle = opts.visualizePathStyle;
		if (opts.ignoreCreeps !== undefined) moveOpts.ignoreCreeps = opts.ignoreCreeps;
		if (opts.maxRooms !== undefined) moveOpts.maxRooms = opts.maxRooms;
		if (opts.reusePath !== undefined) moveOpts.reusePath = opts.reusePath;
		if (opts.costCallback) moveOpts.costCallback = opts.costCallback;
		payload.moveOpts = moveOpts;
	}
	return submitCombat({
		actorName: creep.name,
		kind: "combatMove",
		targetPos: { x: pos.x, y: pos.y, roomName: pos.roomName },
		payload,
	});
}

/** 按路径移动 (moveByPath) */
export function combatMoveByPath(creep: Creep, path: RoomPosition[]): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "combatMoveByPath",
		payload: { path: path.map((p) => ({ x: p.x, y: p.y, roomName: p.roomName })) },
	});
}

/** 自毁 (编队孤儿善后) */
export function combatSuicide(creep: Creep): number {
	hold(creep.name);
	return submitCombat({
		actorName: creep.name,
		kind: "suicide",
	});
}

// ── 旗标命令 (编队指挥旗) ─────────────────────────────────────

/** 创建指挥旗 */
export function combatCreateFlag(
	roomName: string,
	x: number,
	y: number,
	flagName: string,
): number | string {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `combat-createFlag-${flagName}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: roomName,
		kind: "createFlag",
		targetPos: { x, y, roomName },
		priority: FLAG_PRIORITY,
		pipeline: "flag",
		dedupeKey: `combat-flag:create:${flagName}:${Game.time}:${nextId()}`,
		payload: { flagName },
	});
	// createFlag 成功返回旗标名 (字符串), 失败返回负数错误码
	if (result.accepted) {
		return flagName;
	}
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

/** 移除旗标 (名字缺失时静默成功 —— 与可选链直连调用同语义) */
export function combatRemoveFlag(flagName: string | undefined): number {
	if (!flagName) {
		return OK;
	}
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `combat-removeFlag-${flagName}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: "flags",
		kind: "removeFlag",
		priority: FLAG_PRIORITY,
		pipeline: "flag",
		dedupeKey: `combat-flag:remove:${flagName}:${Game.time}:${nextId()}`,
		payload: { flagName },
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

// ── 所有权生命周期 ────────────────────────────────────────────

/** 所有权登记: 编队驱动入口调用, 战斗 actor 由适配层持有 */
export function holdActor(creepName: string): void {
	hold(creepName);
}

/** 解散交接: 先归还全体成员控制权, 再由调用方清理队伍数据 (无真空) */
export function releaseTeamActors(creepIds: ReadonlyArray<Id<Creep>>): void {
	for (const id of creepIds) {
		const creep = Game.getObjectById(id);
		if (creep) {
			release(creep.name, OWNER);
		}
	}
}
