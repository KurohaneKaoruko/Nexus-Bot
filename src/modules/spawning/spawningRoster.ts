/**
 * 孵化中名单统一接口 (任务 6.3, 收编 bugs/P0-16 修复为架构层):
 * - 引擎侧判据: 任一 spawn 的 spawning.name 命中即孵化中;
 * - 簿记侧判据: units 名册在册 (spawn 受理即登记, 覆盖引擎快照的同 tick 窗口)。
 * ClearModule 清理白名单 / visuals 孵化条 / economy idleSpawns 统计一律走本接口,
 * 不再各自遍历 Game.spawns (散落判据在 spawn shim 与实服间语义漂移)。
 */

/** 引擎可见的孵化中名字集合 (每 tick 重建, 调用方逐 tick 缓存一次) */
export function engineSpawningNames(): Set<string> {
	const names = new Set<string>();
	for (const spawnName in Game.spawns) {
		const spawning = Game.spawns[spawnName]?.spawning;
		if (spawning) {
			names.add(spawning.name);
		}
	}
	return names;
}

/**
 * 统一判据: 名字是否处于孵化中 (引擎 spawning 或簿记名册在册)。
 * roster 传调用方已有的簿记名册 (ctx.memory.units), 避免重复取根。
 */
export function isSpawningUnit(
	name: string,
	roster: Record<string, unknown> | undefined,
	engineNames?: Set<string>,
): boolean {
	if (engineNames?.has(name)) {
		return true;
	}
	if (!engineNames) {
		for (const spawnName in Game.spawns) {
			const spawning = Game.spawns[spawnName]?.spawning;
			if (spawning && spawning.name === name) {
				return true;
			}
		}
	}
	return roster ? name in roster : false;
}

/** 当前 tick 孵化中的 spawn 数 (economy idleSpawns 统计用) */
export function busySpawnCount(): number {
	let busy = 0;
	for (const spawnName in Game.spawns) {
		if (Game.spawns[spawnName]?.spawning) {
			busy += 1;
		}
	}
	return busy;
}
