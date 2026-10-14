/** 白名单 (友军/和平玩家) 查询: 按 tick 缓存 set, 避免高频重建 */
import { getWhitelistIds } from '@/core/store/accessor';

let cachedWhitelistTick = -1
let cachedWhitelistSet: Set<string> = new Set()

export const getWhitelistSet = (): Set<string> => {
    if (cachedWhitelistTick === Game.time) return cachedWhitelistSet
    cachedWhitelistTick = Game.time
    cachedWhitelistSet = new Set<string>(getWhitelistIds())
    return cachedWhitelistSet
}

export const inWhitelist = (username?: string): boolean => {
    if (!username) return false
    return getWhitelistSet().has(username)
}
