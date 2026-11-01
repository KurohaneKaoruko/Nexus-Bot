/**
 * Intel 三态读取 (docs/nexus-design/13 §24.6.1)。
 *
 * 字段三态: 缺省 = 未知; null = 已知为空; 有值但 lastSeen 早于
 * staleTicks = 过期。读取统一经此模块, 消费方不直接翻 Memory.rooms。
 * 新鲜度 confidence = 0.5 ^ (未见 tick / confidenceHalfLife), 现算不落盘。
 */
import { INTEL_CONFIG } from "@/config/remote";
import type { RoomIntelRecord } from "@/core/store/memorySchema";

export type IntelFieldState<T> =
	| { state: "unknown" }
	| { state: "empty" }
	| { state: "fresh"; value: T }
	| { state: "stale"; value: T };

/** 单一字段的三态: undefined → unknown, null → empty, 有值按 lastSeen 分 fresh/stale */
export function intelField<T>(record: RoomIntelRecord, field: keyof RoomIntelRecord, now: number): IntelFieldState<T> {
	const raw = record[field] as T | undefined | null;
	if (raw === undefined) return { state: "unknown" };
	if (raw === null) return { state: "empty" };
	return now - record.lastSeen > INTEL_CONFIG.staleTicks ? { state: "stale", value: raw } : { state: "fresh", value: raw };
}

/** 记录整体新鲜度: 未见超过 staleTicks 即过期 (scout 派遣判据) */
export function intelStale(record: RoomIntelRecord | undefined, now: number): boolean {
	if (!record) return true;
	return now - record.lastSeen > INTEL_CONFIG.staleTicks;
}

/** 置信度现算 (不每 tick 写 Memory): 0.5 ^ (未见 tick / 半衰期) */
export function intelConfidence(record: RoomIntelRecord, now: number): number {
	return Math.pow(0.5, (now - record.lastSeen) / INTEL_CONFIG.confidenceHalfLife);
}
