/**
 * 布局子系统与 Memory.Nexus 的边界适配:
 * 未合并规划算法只经由此文件读写布局记录, 不感知 schema 细节;
 * 记录创建/重置的唯一入口, 保证形状与 memorySchema 一致。
 */
import { PLANNER_CONFIG } from "@/config/planner";
import { getSkipBuildTypes } from "@/config/capabilities";
import type { LayoutMemory, LayoutRoomRecord } from "@/core/store/memorySchema";

/** 布局持久化根 (Memory.Nexus.layout); 校准保证存在 */
export function layoutRoot(): LayoutMemory {
	const memory = Memory.Nexus;
	if (!memory) {
		throw new Error("Memory.Nexus 未初始化 (校准应先于布局模块运行)");
	}
	return memory.layout;
}

/** 取单房布局记录 (只读语义, 不存在返回 undefined) */
export function getLayoutRecord(roomName: string): LayoutRoomRecord | undefined {
	return layoutRoot().rooms[roomName];
}

/** 取或创建单房布局记录 (新建为空数据 + autobuild 开) */
export function ensureLayoutRecord(roomName: string): LayoutRoomRecord {
	const rooms = layoutRoot().rooms;
	const existing = rooms[roomName];
	if (existing) {
		return existing;
	}
	const record: LayoutRoomRecord = {
		type: "auto",
		data: {},
		autobuild: true,
		buildLevel: 0,
	};
	rooms[roomName] = record;
	return record;
}

/** 布局重算落盘: 写入新数据, 同步类型/中心/时间戳 */
export function writeLayoutData(
	record: LayoutRoomRecord,
	type: LayoutRoomRecord["type"],
	center: { x: number; y: number },
	data: Record<string, number[]>,
): void {
	record.type = type;
	record.center = { x: center.x, y: center.y };
	record.data = data;
	record.updatedAt = Game.time;
}

/** 布局事件日志 (生成/失败等低频事件, 不限频) */
export function plannerLog(message: string): void {
	console.log(`[nexus][layout] ${message}`);
}

/** rampart 起建 RCL (冲级姿态接入后可按房间模式推迟) */
export function rampartMinRcl(): number {
	return PLANNER_CONFIG.rampartMinRcl;
}

/** 动态布局计算允许的最低 CPU 桶 */
export function dynamicBucketFloor(): number {
	return PLANNER_CONFIG.dynamicBucketFloor;
}

/** 不自动建造的结构类型 (变体裁剪用, 如冲级服跳过 factory/nuker) */
export function skipBuildTypes(): readonly string[] {
	return getSkipBuildTypes();
}
