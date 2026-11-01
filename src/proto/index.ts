
/**
 * 原型库公共面 (库侧入口)。
 *
 * @remarks
 * 库叶子供跨域借用: 克瑞普记忆缓存 / boost 缓存 / 采集工位评估。
 * 驱动侧入口保持显式: `features` (特性链驱动) 与 `PowerCreep` (pc 驱动) 由装配层
 * 直接引用, 不并入本入口, 避免借用库函数时拖入驱动图。
 */
export { ensureMemoryCache, clearMemoryCache } from '@/proto/Creep/function/cacheFunction'
export { getBoostCache } from '@/proto/Creep/function/boostFunction'
export { evaluateSourceWorkTiles } from '@/proto/Creep/function/sourceFunction'
