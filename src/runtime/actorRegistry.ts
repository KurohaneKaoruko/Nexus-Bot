/**
 * Actor 所有权登记表 (api/16 actor-ownership spec):
 * 每 Tick 从游戏世界重建的注册表层 —— 谁活着、谁在孵化、谁已死。
 * 与租约表 (actorOwnership) 分工: 本表回答"世界里有哪些 Actor",
 * 租约表回答"谁持有它们的控制权"。
 *
 * 数据位置: global 运行时层 (globalThis.Nexus.runtime.actorRegistry),
 * 单 Tick 重建, 不占 Memory 序列化成本 (design.md D1)。
 */

export type ActorKind = "creep" | "powerCreep" | "structure";

export interface ActorEntry {
	kind: ActorKind;
	/** 对象在世界中可见 (非孵化中) */
	live: boolean;
	/** 孵化中 (Creep.spawning / PowerCreep 尚未出生) */
	spawning: boolean;
	/** 本 Tick 观测到的存活证据 tick */
	seenTick: number;
}

export interface ActorRegistryRuntime {
	/** actor 名/ID → 登记项 */
	actors: Record<string, ActorEntry>;
	/** 上一次重建 tick (防同 Tick 重复全量扫) */
	builtTick: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取运行时层: 缺失或损坏自愈为空表, 不向调用方抛异常 (与 nexusRuntime 同口径) */
export function actorRegistry(): ActorRegistryRuntime {
	const nexus = globalThis as unknown as Record<string, unknown>;
	const N = isPlainObject(nexus["Nexus"]) ? nexus["Nexus"] : {};
	(nexus as Record<string, unknown>)["Nexus"] = N;
	const runtime = isPlainObject(N["runtime"]) ? N["runtime"] : {};
	N["runtime"] = runtime;
	const existing = runtime["actorRegistry"];
	const reg: Record<string, unknown> =
		isPlainObject(existing) && isPlainObject(existing["actors"]) ? existing : { actors: {} };
	runtime["actorRegistry"] = reg;
	return reg as unknown as ActorRegistryRuntime;
}

/**
 * 全量重建: 每 Tick 调用一次 (perception 阶段后)。
 * 幂等: 同 Tick 重复调用直接返回。
 * 死亡自动释放的判定基础 —— 上 Tick 在表、本 Tick 不在世界的即视为死亡,
 * 由 actorOwnership.sweepDead 依据本表快照清理租约。
 */
export function rebuildActorRegistry(tick: number): void {
	const reg = actorRegistry();
	if (reg.builtTick === tick) {
		return;
	}
	const actors: Record<string, ActorEntry> = {};
	for (const creep of Object.values(Game.creeps)) {
		actors[creep.name] = {
			kind: "creep",
			live: !creep.spawning,
			spawning: Boolean(creep.spawning),
			seenTick: tick,
		};
	}
	for (const powerCreep of Object.values(Game.powerCreeps ?? {})) {
		actors[powerCreep.name] = {
			kind: "powerCreep",
			live: Boolean(powerCreep.room),
			spawning: false,
			seenTick: tick,
		};
	}
	// 结构 actor 只登记被租约持有的 (塔/SafeMode 等), 由 ownership 侧写入;
	// 全量登记结构对冲突检测无收益, 省掉遍历成本。
	for (const [name, entry] of Object.entries(reg.actors)) {
		if (entry.kind === "structure") {
			const obj = Game.getObjectById(name as Id<Structure>);
			if (obj) {
				actors[name] = { kind: "structure", live: true, spawning: false, seenTick: tick };
			}
		}
	}
	reg.actors = actors;
	reg.builtTick = tick;
}

export function actorEntry(name: string): ActorEntry | undefined {
	return actorRegistry().actors[name];
}

export function isLiveActor(name: string): boolean {
	const e = actorEntry(name);
	return Boolean(e && e.live);
}

/** 孵化中名单: 名字在册且 spawning 标记为真 (不可被夺取/清理的判据) */
export function isSpawningActor(name: string): boolean {
	const e = actorEntry(name);
	return Boolean(e && e.spawning);
}
