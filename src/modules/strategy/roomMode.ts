/**
 * 房间运行模式解析 (specs/room-mode-profiles / docs/nexus-design/21):
 * 显式设置 (Memory.Nexus.rooms[x].mode) > 变体固定档 (profile.roomMode) >
 * 配置默认档 (auto 按 CPU 档位) > main。
 * 消费方一律经本入口读 profile 参数, 不得散落模式字符串比较;
 * 非法持久化值回退默认链并限频告警 (持久层迁移只洗历史, 运行期写入仍可能引入)。
 */
import {
	ROOM_MODE_CONFIG,
	ROOM_MODE_PROFILES,
	type RoomModeName,
	type RoomModeProfile,
} from "@/config/roomMode";
import type { TickContext } from "@/core";

const MODE_NAMES: ReadonlySet<string> = new Set(Object.keys(ROOM_MODE_PROFILES));

/**
 * 纯解析 (可离线推演): 显式合法值优先; 未设置或非法值走默认链——
 * 变体固定档 (race 等变体无条件取档), 否则配置固定档, 最后按 CPU 档位
 * (高速/冲级服默认 rush, 常规服 main)。
 */
export function resolveRoomMode(
	explicit: string | undefined,
	cpuLimit: number,
	variantDefault?: RoomModeName,
): RoomModeName {
	if (explicit !== undefined && MODE_NAMES.has(explicit)) {
		return explicit as RoomModeName;
	}
	if (variantDefault !== undefined && MODE_NAMES.has(variantDefault)) {
		return variantDefault;
	}
	const fixed = ROOM_MODE_CONFIG.defaultMode;
	if (fixed !== "auto") {
		return fixed;
	}
	return cpuLimit >= ROOM_MODE_CONFIG.cpuLimitRushThreshold ? "rush" : "main";
}

/** 房间模式: 读持久化显式值 + 变体固定档 + CPU 档默认; 非法显式值限频告警后回退 */
export function roomModeFor(ctx: TickContext, roomName: string): RoomModeName {
	const explicit = ctx.memory.rooms[roomName]?.mode;
	const cpuLimit = typeof Game.cpu.limit === "number" ? Game.cpu.limit : 0;
	const mode = resolveRoomMode(explicit, cpuLimit, ctx.profile.roomMode);
	if (explicit !== undefined && mode !== explicit) {
		ctx.logger.warn(
			`room-mode:${roomName}`,
			`非法模式值 "${String(explicit)}", 回退默认链 → ${mode}`,
		);
	}
	return mode;
}

/** 房间模式参数档案: 消费方统一入口 */
export function roomModeProfileFor(ctx: TickContext, roomName: string): RoomModeProfile {
	return ROOM_MODE_PROFILES[roomModeFor(ctx, roomName)];
}
