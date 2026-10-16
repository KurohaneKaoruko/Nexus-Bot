// @ts-nocheck
/**
 * 布局计算的三级 TTL 缓存: 参数精确 key / 动态最近一次 / 动态输入签名。
 */
import type { CachedLayout, LayoutCenter, LayoutStructMap, LayoutMemoryMap } from './types'

/** 缓存有效期（tick） */
export const CACHE_TTL = 50;

type CacheStore = {
	byKey: { [key: string]: CachedLayout };
	lastKeyByRoomLayout: { [key: string]: string };
	byDynamicSig: { [key: string]: string };
};

/** 获取布局缓存容器（存放在 global 上） */
function getCacheStore(): CacheStore {
	const g = global as any;
	if (!g.__layoutPlannerCache) {
		g.__layoutPlannerCache = { byKey: {}, lastKeyByRoomLayout: {}, byDynamicSig: {} };
	}
	return g.__layoutPlannerCache;
}

/** 生成静态布局缓存 key */
export function makeCacheKey(roomName: string, layoutType: string, center: LayoutCenter): string {
	return `${roomName}:${layoutType}:${center.x}:${center.y}`;
}

/** 生成动态布局“输入签名”缓存 key */
export function makeDynamicSigKey(
	roomName: string,
	layoutType: string,
	pointsSig: string,
	fixedCenter: LayoutCenter | null
): string {
	const c = fixedCenter ? `${fixedCenter.x},${fixedCenter.y}` : '-';
	return `${roomName}:${layoutType}:sig:${c}:${pointsSig}`;
}

/** 深拷贝 structMap，避免外部修改污染缓存 */
export function cloneStructMap(structMap: LayoutStructMap): LayoutStructMap {
	const next: LayoutStructMap = {};
	for (const s in structMap) next[s] = structMap[s].map! ((p) => [p[0], p[1]]);
	return next;
}

/** 深拷贝 layoutMemory，避免外部修改污染缓存 */
export function cloneLayoutMemory(layoutMemory: LayoutMemoryMap): LayoutMemoryMap {
	const next: LayoutMemoryMap = {};
	for (const s in layoutMemory) next[s] = layoutMemory[s].slice! ();
	return next;
}

/** 按参数精确命中缓存（用于静态布局） */
export function getCachedLayout(roomName: string, layoutType: string, center: LayoutCenter): CachedLayout | null {
	const store = getCacheStore();
	const key = makeCacheKey(roomName, layoutType, center);
	const cached = store.byKey[key];
	if (!cached) return null;
	if (cached.expiresAt < Game.time) {
		delete store.byKey[key];
		return null;
	}
	return cached;
}

/** 写入缓存，并记录 room+layoutType 的最新 key；动态布局时可额外记录输入签名映射 */
export function setCachedLayout(entry: Omit<CachedLayout, 'createdAt' | 'expiresAt'>, options?: { dynamicSigKey?: string }): void {
	const store = getCacheStore();
	const cached: CachedLayout = { ...entry, createdAt: Game.time, expiresAt: Game.time + CACHE_TTL };
	store.byKey[entry.key] = cached;
	store.lastKeyByRoomLayout[`${entry.roomName}:${entry.layoutType}`] = entry.key;
	if (options?.dynamicSigKey) store.byDynamicSig[options.dynamicSigKey] = entry.key;
}

/** 动态布局复用“最近一次”缓存（典型场景：先 visual 再 build） */
export function getLastCachedByRoomLayout(roomName: string, layoutType: string): CachedLayout | null {
	const store = getCacheStore();
	const lastKey = store.lastKeyByRoomLayout[`${roomName}:${layoutType}`];
	if (!lastKey) return null;
	const cached = store.byKey[lastKey];
	if (!cached) return null;
	if (cached.expiresAt < Game.time) {
		delete store.byKey[lastKey];
		delete store.lastKeyByRoomLayout[`${roomName}:${layoutType}`];
		return null;
	}
	return cached;
}

/** 动态布局按输入签名命中缓存（适合重复预览/批量 build） */
export function getCachedDynamicBySig(sigKey: string): CachedLayout | null {
	const store = getCacheStore();
	const key = store.byDynamicSig[sigKey];
	if (!key) return null;
	const cached = store.byKey[key];
	if (!cached) {
		delete store.byDynamicSig[sigKey];
		return null;
	}
	if (cached.expiresAt < Game.time) {
		delete store.byKey[key];
		delete store.byDynamicSig[sigKey];
		return null;
	}
	return cached;
}
