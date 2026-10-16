// @ts-nocheck
/**
 * 布局域房间上下文工具: CPU 计时、RCL、中心点解析、动态规划器输出归一化。
 */
import { decompress } from '@/utils/compress';
import { plannerLog as log } from '../memory';
import { getLayoutRecord } from '../memory';
import type { CachedLayout, DynamicPlannerRawResult, LayoutCenter, LayoutStructMap } from './types'

export function cpuNow(): number {
	return Game.cpu.getUsed();
}

export function cpuDelta(start: number): number {
	return Game.cpu.getUsed() - start;
}

export function cpuFmt(v: number): string {
	return v.toFixed(2);
}

/** 房间 RCL (controller 缺失视为 0) */
export function roomLevel(room: Room): number {
	return room.controller ? room.controller.level : 0;
}

/** 解析布局中心点: 优先 storagePos/centerPos 旗帜, 其次布局记录中的 center */
export function resolveCenter(roomName: string): LayoutCenter | null {
	const PosFlag = Game.flags.storagePos || Game.flags.centerPos;
	if (PosFlag && PosFlag.pos.roomName === roomName) {
		return { x: PosFlag.pos.x, y: PosFlag.pos.y };
	}
	const center = getLayoutRecord(roomName)?.center;
	return center ? { x: center.x, y: center.y } : null;
}

/** 布局中的核心枢纽期望位 (storage/terminal 首点) */
export function getCoreDepotPointFromLayout(layoutMemory: any, roomName: string, structureType: 'storage' | 'terminal'): { x: number; y: number } | null {
	const points = layoutMemory?.[structureType];
	if (!points || points.length === 0) return null;
	const [x, y] = decompress(points[0]);
	if (x < 0 || x > 49 || y < 0 || y > 49) return null;
	return { x, y };
}

/** 归一化动态规划器输出，提供统一的 center 与 structMap，避免调用方依赖具体 planner 版本 */
export function normalizeDynamicPlannerResult(roomName: string, layoutType: string, raw: any): { center: LayoutCenter; structMap: LayoutStructMap } | null {
	if (!raw) {
		log(`动态布局失败: ${roomName} ${layoutType} planner 返回空`);
		return null;
	}
	const data = raw as DynamicPlannerRawResult;
	const centerPos = data.centerPos ? { x: data.centerPos.x, y: data.centerPos.y } : null;

	if (!centerPos) {
		log(`动态布局失败: ${roomName} ${layoutType} 缺少 centerPos`);
		return null;
	}
	if (!data.structMap) {
		log(`动态布局失败: ${roomName} ${layoutType} 缺少 structMap`);
		return null;
	}
	return { center: centerPos, structMap: data.structMap };
}

/** 命中缓存后构造返回副本 (隔离外部修改) */
export function cachedLayoutCopy(cached: CachedLayout): CachedLayout {
	return {
		...cached,
	};
}
