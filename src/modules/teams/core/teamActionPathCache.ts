/**
 * TeamAction 域模块: 路径缓存: checkCachePath 族缓存路径方向/障碍检测。
 * 从 TeamAction.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */

import TeamUtils from '@/modules/teams/core/TeamUtils';
import TeamCache from '@/modules/teams/core/TeamCache';
import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const teamActionObjPathCache: Pick<
    TeamActionApi,
    'getDirectionByCachePath' | 'hasObstacleInPath' | 'checkCachePath' | 'clearPathCache'
> & ThisType<TeamActionApi> = {

    /**
     * 根据缓存路径返回方向
     */
    getDirectionByCachePath(team: Team) {
        const originPos = TeamUtils.getTeamPos(team)!
        const path = TeamCache.cacheTeamPath[team.name]

        if (!path || !path.length) return undefined

        let nextPos = path[0]!
        let direction = originPos.getDirectionTo(nextPos)
        path.shift()
        if (!direction && path.length) {
            // 边界
            nextPos = path[0]!
            direction = originPos.getDirectionTo(nextPos)
            path.shift()
        }

        if (this.hasObstacleInPath(team.creeps, nextPos)) {
            return undefined
        }

        return direction
    },


    /**
     * 是否有东西挡在路径上
     */
    hasObstacleInPath(creeps: Creep[], nextPos: RoomPosition) {
        if (!nextPos) return true

        const directions = [RIGHT, BOTTOM_RIGHT, BOTTOM]
        const isFourTeam = creeps.length >= 3
        const posList = isFourTeam ? directions.map((dir) => nextPos.getDirectPos(dir)) : []
        posList.push(nextPos)

        const creepsPosSet = new Set(creeps.map((creep) => creep.pos.hashCode()))

        return !!posList.find((pos) => !creepsPosSet.has(pos.hashCode()) && !pos.walkable(true))
    },



    /**
     * 检查缓存路径是否正确
     */
    checkCachePath(team: Team) {
        const originPos = TeamUtils.getTeamPos(team)

        return !!(
            TeamCache.cacheTeamPath[team.name] &&
            TeamCache.cacheTeamPath[team.name]!.length &&
            originPos?.isCrossRoomNearTo(TeamCache.cacheTeamPath[team.name]![0]!)
        )
    },


    /**
     * 删除寻路缓存
     */
    clearPathCache(team: Team) {
        delete TeamCache.cacheTeamPath[team.name]
    },
};

export default teamActionObjPathCache;
