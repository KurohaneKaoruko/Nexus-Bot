import { UnitData } from "@/constant/CreepConstant";
import { generateCreepName } from "@/utils/naming";
import { buildBody, isSpawnUnit } from "@/modules/spawning/bodyFactory";
import { sharedBrokerForDirectCommands } from "@/modules/agents/actionBroker";

// ==================== 直接孵化 (编队/扩张/援助/控制台) ====================

/** 直接孵化请求 (任务 6.2): 一次性/指令式孵化语义, 不参与定编与预算竞争 */
export interface DirectSpawnRequest {
	/** emergency=急救/控制台 (pc 陪护); direct=编队/扩张计划件 */
	mode: "emergency" | "direct";
	/** 类型 id (UnitData 词表或 SpawnUnit 词表) */
	unit: string;
	/** 写入 creep memory 的业务字段 (unit/cache 由命令层补齐) */
	memory: Record<string, unknown>;
	/** 显式体型 (编队压缩体); 缺省按类型定义源解析 */
	body?: BodyPartConstant[];
	/** 体名覆盖 (如标注归属 pc), 缺省取 UnitConstant 体名词表 */
	bodyNameOverride?: string;
}

/**
 * 直接孵化接口: 绕过任务板/池, 按 SpawnRequest 立即下蛋 (同步返回码)。
 * 体型定义源统一 (6.2): 显式 body 优先 → SpawnUnit 走 BodyFactory (按容量定型,
 * body policy 唯一来源) → 特化战件回退 UnitData.bodypart (legacy 词表, 8.x 收编中)。
 * @returns spawnCreep 返回码 (OK=0 为成功)
 */
export function directSpawn(room: Room, request: DirectSpawnRequest): number {
	const { unit, memory, body, bodyNameOverride, mode } = request;
	const spawns = room.find(FIND_MY_SPAWNS);
	const spawn = spawns.find((s) => !s.spawning);
	if (!spawn) return ERR_BUSY;
	const config = (UnitData as unknown as Record<string, { level: number }>)[unit];
	if (!config) {
		return ERR_INVALID_ARGS;
	}
	let bodyFinal = body;
	if (!bodyFinal) {
		if (isSpawnUnit(unit)) {
			bodyFinal = buildBody(unit, room.energyCapacityAvailable) ?? undefined;
		} else {
			const preset = (UnitData as unknown as Record<string, { bodypart: BodyPartConstant[][] }>)[unit]
				?.bodypart;
			bodyFinal = preset && preset.length > 0 ? (preset[0]!.flat() as BodyPartConstant[]) : undefined;
		}
	}
	if (!bodyFinal?.length) return ERR_NOT_ENOUGH_RESOURCES;
	const mem = { ...memory, unit, cache: {} } as CreepMemory;
	// 命名入参必须是类型 id: 传代号会让 unitBodyName 回退成代号本身, 拼出 `H H-1A2B` 双段前缀。
	// 体名覆盖只替换首段, 代号段恒由生成器产出——感知侧 unitCodeFromName 依赖该形态解析类型。
	const name = generateCreepName(unit, {
		random: Math.random,
		exists: (n) => n in Game.creeps,
		...(bodyNameOverride ? { bodyName: bodyNameOverride } : {}),
	});
	// 经命令边界同步执行 (api/17 spawn 管线): 原生调用权收编进 broker,
	// 返回码透传给调用方 (emergency/direct 的一次性语义需要同步结果)
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `direct-spawn:${mode}:${spawn.id}:${Game.time}:${name}`,
		tick: Game.time,
		actorName: spawn.room.name,
		kind: "spawnCreep",
		pipeline: "spawn",
		priority: 80,
		targetId: spawn.id,
		payload: { body: bodyFinal, creepName: name, memory: mem as Record<string, unknown> },
		dedupeKey: `direct-spawn:${spawn.id}:${Game.time}:${name}`,
	});
	return result.accepted ? OK : (result.nativeReturnCode ?? ERR_INVALID_ARGS);
}
