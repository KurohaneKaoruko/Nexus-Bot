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
