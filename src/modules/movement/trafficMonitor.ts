/**
 * 路口拥堵检测 (docs/nexus-design/08 §8.4/§8.6), vendor 文件零改动:
 * 快照差分识别「持移动意图却未移动」的单位 → 滚动阻塞计数;
 * 阻塞位置聚集 → 路口热点频率 (每诊断窗口衰减, 条目有上限);
 * 分级响应在 Agent 提案层消费计数: 让路 (endTickResolve 推开) → 路径重置 → 释放任务。
 * 位置缓存为模块级跨 Tick 状态, global 重置自动重建 (与 Broker 单例同模式)。
 */
import { TRAFFIC_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core/tickContext";
import type { WorldView } from "@/core/world";

/** Agent 提案层消费的升级动作 (阈值内为 none) */
export type CongestionAction = "none" | "repath" | "release";

/** 上一 Tick 的位置缓存: creep 名 → 坐标 */
const lastPositions = new Map<string, { x: number; y: number }>();

/** 登记「本 Tick 该单位有移动意图」(由 Broker 的 move 结果回填) */
export function noteMoveIntent(ctx: TickContext, creepName: string): void {
	const blocked = ctx.memory.traffic.blocked;
	const record = blocked[creepName];
	if (record) {
		record.lastTick = ctx.tick;
	} else {
		blocked[creepName] = { count: 0, lastTick: ctx.tick };
	}
}

/**
 * 每 Tick 位置差分 (commit 段 endTickResolve 之后调用, 此时位置已定):
 * 有移动意图且与上 Tick 位置相同 → 阻塞计数 +1 并计入热点; 移动过 → 计数清零。
 * 长期未更新的意图记录随保留窗口淘汰 (有界)。
 */
export function updateCongestion(ctx: TickContext, world: WorldView): void {
	const traffic = ctx.memory.traffic;
	const seen = new Set<string>();

	for (const room of Object.values(world.rooms)) {
		for (const creep of room.creeps) {
			seen.add(creep.name);
			const record = traffic.blocked[creep.name];
			if (!record) {
				lastPositions.set(creep.name, { x: creep.x, y: creep.y });
				continue;
			}
			const previous = lastPositions.get(creep.name);
			lastPositions.set(creep.name, { x: creep.x, y: creep.y });
			if (previous && previous.x === creep.x && previous.y === creep.y) {
				record.count += 1;
				const key = `${room.roomName}:${creep.x}:${creep.y}`;
				const hotspot = traffic.hotspots[key] ?? { freq: 0, lastTick: ctx.tick };
				hotspot.freq += 1;
				hotspot.lastTick = ctx.tick;
				traffic.hotspots[key] = hotspot;
			} else {
				record.count = 0;
			}
		}
	}

	// 消失单位的位置缓存与超期意图记录淘汰
	for (const name of lastPositions.keys()) {
		if (!seen.has(name)) {
			lastPositions.delete(name);
		}
	}
	for (const [name, record] of Object.entries(traffic.blocked)) {
		if (!seen.has(name) && ctx.tick - record.lastTick > TRAFFIC_CONFIG.blockedRetentionTicks) {
			delete traffic.blocked[name];
		}
	}
}

/** 热点衰减 + 条目上限 (超出按最久未更新淘汰; 每诊断窗口调用一次) */
export function decayHotspots(ctx: TickContext): void {
	const hotspots = ctx.memory.traffic.hotspots;
	for (const key of Object.keys(hotspots)) {
		const hotspot = hotspots[key]!;
		hotspot.freq *= TRAFFIC_CONFIG.hotspotDecay;
		if (hotspot.freq < 1) {
			delete hotspots[key];
		}
	}
	const keys = Object.keys(hotspots);
	if (keys.length > TRAFFIC_CONFIG.hotspotMaxEntries) {
		keys
			.sort((a, b) => hotspots[a]!.lastTick - hotspots[b]!.lastTick)
			.slice(0, keys.length - TRAFFIC_CONFIG.hotspotMaxEntries)
			.forEach((key) => delete hotspots[key]);
	}
}

/**
 * 单位的拥堵升级判定 (Agent 提案层调用):
 * 让路由 endTickResolve 的推开机制天然承担 (非驻点单位 isWorkTile=true),
 * 这里返回路径重置与任务释放的升级档位。
 */
export function congestionAction(ctx: TickContext, creepName: string): CongestionAction {
	const count = ctx.memory.traffic.blocked[creepName]?.count ?? 0;
	if (count >= TRAFFIC_CONFIG.releaseTicks) {
		return "release";
	}
	if (count >= TRAFFIC_CONFIG.repathTicks) {
		return "repath";
	}
	return "none";
}

/** 释放任务/重置路径后清零计数, 避免下一任务立刻再次触发同档动作 */
export function clearBlocked(ctx: TickContext, creepName: string): void {
	const record = ctx.memory.traffic.blocked[creepName];
	if (record) {
		record.count = 0;
	}
}
