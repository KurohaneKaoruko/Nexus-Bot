/**
 * PowerCreep 能力 Adapter (api/17 command-boundary / 任务 3.6):
 * prototype PowerCreep 角色的 usePower/enableRoom 经本层同步走 broker power 管线。
 * 返回码透传 (调用方的重试/移动逻辑依赖同步结果)。
 */
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';

/** 执行一个 PowerCreep 能力 (usePower); 返回原生返回码 */
export function pcUsePower(pc: PowerCreep, power: PowerConstant, target?: RoomObject): number {
	const targetId =
		target && 'id' in target && typeof (target as { id?: unknown }).id === 'string'
			? ((target as { id: string }).id)
			: undefined;
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-power:${pc.name}:${Game.time}:${power}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'usePower',
		pipeline: 'power',
		priority: 50,
		...(targetId ? { targetId } : {}),
		payload: { power: power as number },
		dedupeKey: `pc-power:${pc.name}:${Game.time}:${power}:${targetId ?? 'self'}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** 启用房间 Power (enableRoom); 返回原生返回码 */
export function pcEnableRoom(pc: PowerCreep, controller: StructureController): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-enable:${pc.name}:${Game.time}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'enableRoom',
		pipeline: 'power',
		priority: 50,
		targetId: controller.id,
		dedupeKey: `pc-enable:${pc.name}:${Game.time}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 移动 (moveTo); 返回原生返回码。moveOpts 透传 range/plainCost/swampCost 等 */
export function pcMoveTo(
	pc: PowerCreep,
	target: { x?: number; y?: number; roomName?: string } | { pos: RoomPosition } | RoomPosition | { room: unknown; pos: RoomPosition } | undefined,
	moveOpts: Record<string, any> = {},
): number {
	const pos =
		target instanceof RoomPosition
			? target
			: target && 'pos' in target && target.pos
				? (target as { pos: RoomPosition }).pos
				: new RoomPosition((target as any)?.x ?? 25, (target as any)?.y ?? 25, (target as any)?.roomName ?? pc.pos.roomName);
	const payloadMove: Record<string, any> = {};
	for (const key of ['range', 'visualizePathStyle', 'ignoreCreeps', 'maxRooms', 'reusePath', 'plainCost', 'swampCost']) {
		if (moveOpts[key] !== undefined) payloadMove[key] = moveOpts[key];
	}
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-move:${pc.name}:${Game.time}:${pos.x},${pos.y}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'move',
		pipeline: 'power',
		priority: 50,
		targetPos: { x: pos.x, y: pos.y, roomName: pos.roomName },
		payload: { moveOpts: payloadMove },
		dedupeKey: `pc-move:${pc.name}:${Game.time}:${pos.x},${pos.y}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 资源转移 (transfer); 返回原生返回码 */
export function pcTransfer(
	pc: PowerCreep,
	target: AnyStoreStructure | Creep | PowerCreep,
	resourceType: ResourceConstant,
	amount?: number,
): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-transfer:${pc.name}:${Game.time}:${target.id}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'transfer',
		pipeline: 'power',
		priority: 50,
		targetId: target.id,
		resourceType,
		...(amount !== undefined ? { amount } : {}),
		dedupeKey: `pc-transfer:${pc.name}:${Game.time}:${target.id}:${resourceType}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 资源提取 (withdraw); 返回原生返回码 */
export function pcWithdraw(
	pc: PowerCreep,
	target: AnyStoreStructure | Tombstone | Ruin,
	resourceType: ResourceConstant,
	amount?: number,
): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-withdraw:${pc.name}:${Game.time}:${target.id}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'withdraw',
		pipeline: 'power',
		priority: 50,
		targetId: target.id,
		resourceType,
		...(amount !== undefined ? { amount } : {}),
		dedupeKey: `pc-withdraw:${pc.name}:${Game.time}:${target.id}:${resourceType}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 退役 (suicide); 返回原生返回码 */
export function pcSuicide(pc: PowerCreep): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-suicide:${pc.name}:${Game.time}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'suicide',
		pipeline: 'power',
		priority: 50,
		dedupeKey: `pc-suicide:${pc.name}:${Game.time}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** Creep 退役 (suicide, pc-heal 治疗手等经 power 管线提交); 返回原生返回码 */
export function pcHealerSuicide(creep: Creep): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-heal-suicide:${creep.name}:${Game.time}`,
		tick: Game.time,
		actorName: creep.name,
		kind: 'suicide',
		pipeline: 'power',
		priority: 50,
		dedupeKey: `pc-heal-suicide:${creep.name}:${Game.time}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** Creep 治疗 (heal, pc-heal 治疗手); 返回原生返回码 */
export function pcHealerHeal(creep: Creep, target: Creep | PowerCreep): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-heal-heal:${creep.name}:${Game.time}:${target.name}`,
		tick: Game.time,
		actorName: creep.name,
		kind: 'heal',
		pipeline: 'power',
		priority: 50,
		targetId: target.id,
		dedupeKey: `pc-heal-heal:${creep.name}:${Game.time}:${target.id}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** Creep 远程治疗 (rangedHeal, pc-heal 治疗手); 返回原生返回码 */
export function pcHealerRangedHeal(creep: Creep, target: Creep | PowerCreep): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-heal-ranged:${creep.name}:${Game.time}:${target.name}`,
		tick: Game.time,
		actorName: creep.name,
		kind: 'combatHealAction',
		pipeline: 'power',
		priority: 50,
		targetId: target.id,
		payload: { healMode: 'rangedHeal' },
		dedupeKey: `pc-heal-ranged:${creep.name}:${Game.time}:${target.id}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** Creep 移动 (moveTo, pc-heal 治疗手跟随); 返回原生返回码 */
export function pcHealerMoveTo(creep: Creep, target: RoomPosition | { pos: RoomPosition }, moveOpts: Record<string, any> = {}): number {
	const pos = target instanceof RoomPosition ? target : target.pos;
	const payloadMove: Record<string, any> = {};
	for (const key of ['range', 'visualizePathStyle', 'ignoreCreeps', 'maxRooms', 'reusePath', 'plainCost', 'swampCost']) {
		if (moveOpts[key] !== undefined) payloadMove[key] = moveOpts[key];
	}
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-heal-move:${creep.name}:${Game.time}:${pos.x},${pos.y}`,
		tick: Game.time,
		actorName: creep.name,
		kind: 'move',
		pipeline: 'power',
		priority: 50,
		targetPos: { x: pos.x, y: pos.y, roomName: pos.roomName },
		payload: { moveOpts: payloadMove },
		dedupeKey: `pc-heal-move:${creep.name}:${Game.time}:${pos.x},${pos.y}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** 旗标移除 (remove, assist 人操旗); 返回原生返回码 */
export function pcFlagRemove(flag: Flag): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-flag-remove:${flag.name}:${Game.time}`,
		tick: Game.time,
		actorName: flag.pos.roomName,
		kind: 'removeFlag',
		pipeline: 'flag',
		priority: 50,
		payload: { flagName: flag.name },
		dedupeKey: `pc-flag-remove:${flag.name}:${Game.time}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 续命 (renew); 返回原生返回码 */
export function pcRenew(pc: PowerCreep, target: StructurePowerSpawn | StructurePowerBank): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-renew:${pc.name}:${Game.time}:${target.id}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'renew',
		pipeline: 'power',
		priority: 50,
		targetId: target.id,
		dedupeKey: `pc-renew:${pc.name}:${Game.time}:${target.id}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** PC 单步方向移动 (move); 返回原生返回码 */
export function pcStep(pc: PowerCreep, direction: DirectionConstant): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-step:${pc.name}:${Game.time}:${direction}`,
		tick: Game.time,
		actorName: pc.name,
		kind: 'combatStep',
		pipeline: 'power',
		priority: 50,
		payload: { direction },
		dedupeKey: `pc-step:${pc.name}:${Game.time}:${direction}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}

/** Creep 单步方向移动 (move, pc-heal 治疗手跟随); 返回原生返回码 */
export function pcHealerStep(creep: Creep, direction: DirectionConstant): number {
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `pc-heal-step:${creep.name}:${Game.time}:${direction}`,
		tick: Game.time,
		actorName: creep.name,
		kind: 'combatStep',
		pipeline: 'power',
		priority: 50,
		payload: { direction },
		dedupeKey: `pc-heal-step:${creep.name}:${Game.time}:${direction}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}
