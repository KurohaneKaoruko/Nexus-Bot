/**
 * 房名解析与房类推导 (docs/nexus-design/13 §24.6.1)。
 *
 * kind 由房名坐标推导, 无需视野: 横或纵坐标为 10 的倍数 → highway;
 * 两坐标对 10 取余都在 4..6 → (5,5) 为 center、其余 keeper; 其他 normal。
 * 布局偏离标准命名生成规则的地图经 INTEL_CONFIG.kindOverride 覆盖。
 */
import { INTEL_CONFIG } from "@/config/remote";

export type RoomKind = "normal" | "highway" | "keeper" | "center";

/**
 * 房名 → 房间坐标 (E/W、N/S 各自的 0..9 取余口径, 非世界坐标)。
 * 取余结果与半球无关 (W5N8 与 E5S8 同构), kind 推导只用余数。
 * 非法房名返回 null。
 */
export function roomNameRemainder(roomName: string): { x: number; y: number } | null {
	const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
	if (!match) return null;
	return {
		x: parseInt(match[2] ?? "0", 10) % 10,
		y: parseInt(match[4] ?? "0", 10) % 10,
	};
}

/** 房类推导: 覆盖表优先, 其次房名坐标规则; 非法房名按 normal 处理 */
export function roomKind(roomName: string): RoomKind {
	const override = INTEL_CONFIG.kindOverride[roomName];
	if (override) return override;
	const rem = roomNameRemainder(roomName);
	if (!rem) return "normal";
	if (rem.x === 0 || rem.y === 0) return "highway";
	if (rem.x < 4 || rem.x > 6 || rem.y < 4 || rem.y > 6) return "normal";
	if (rem.x === 5 && rem.y === 5) return "center";
	return "keeper";
}

/** schema 迁移用的同构入口 (memorySchema.roomKindOf 委托至此, 保持单一实现) */
export const roomKindOf = roomKind;
