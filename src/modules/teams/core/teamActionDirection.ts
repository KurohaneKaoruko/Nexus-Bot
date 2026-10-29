/**
 * TeamAction 域模块: 方向解算: 缓存路径方向/小队移动方向/越界推挤。
 * 从 TeamAction.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */

import TeamUtils from '@/modules/teams/core/TeamUtils';
import TeamCache from '@/modules/teams/core/TeamCache';
import TeamVisual from '@/modules/teams/core/TeamVisual';
import { combatMove } from '@/modules/combat';
import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const teamActionObjDirection: Pick<
    TeamActionApi,
    'getSamllMoveDirection' | 'getTeamMoveDirection' | 'moveOuterBorder'
> & ThisType<TeamActionApi> = {


    /**
     * 相邻移动，小队中只有一个爬与目标相邻时，通过该方法获取下一步的移动方向使得攻击姿态最佳（有两个爬相邻）
     *
     * @return 返回移动的方向
     */
    getSamllMoveDirection(team: Team, targetPos: RoomPosition) {
        const creeps = team.creeps;
        // 左上角坐标
        const originPos = TeamUtils.getTeamPos(team)!

        // 检查指定方向小队是否可以移动
        const checkTeamMoveAble = (direction: DirectionConstant) => {
            // 移动后的左上角坐标
            const pos = originPos.getDirectPos(direction)
            // 移动后的小队位置
            const nextTeamPos = Object.values(this.POS_MARK_MAP).map(([x, y]) => {
                return new RoomPosition(pos.x + x!, pos.y + y!, pos.roomName)
            })
            // 移动后需要检查的小队位置，如果有位置等于现有的爬的位置则不用检查
            const nextCheckPos = nextTeamPos.filter((np) => !creeps.some((creep) => creep.pos.isEqualTo(np)))
            // 需要考虑其他爬
            return nextCheckPos.every((np) => np.walkable(true))
        }

        const diffX = targetPos.x - originPos.x
        const diffY = targetPos.y - originPos.y
        if (diffX == -1 && diffY == -1) {
            // 左上角
            if (checkTeamMoveAble(LEFT)) return LEFT
            if (checkTeamMoveAble(TOP)) return TOP
        } else if (diffX == 2 && diffY == -1) {
            // 右上角
            if (checkTeamMoveAble(TOP)) return TOP
            if (checkTeamMoveAble(RIGHT)) return RIGHT
        } else if (diffX == 2 && diffY == 2) {
            // 右下角
            if (checkTeamMoveAble(RIGHT)) return RIGHT
            if (checkTeamMoveAble(BOTTOM)) return BOTTOM
        } else if (diffX == -1 && diffY == 2) {
            // 左下角
            if (checkTeamMoveAble(BOTTOM)) return BOTTOM
            if (checkTeamMoveAble(LEFT)) return LEFT
        }

        return undefined
    },



    /**
     * 获取小队移动方向
     */
    getTeamMoveDirection(team: Team, goals: {pos: RoomPosition}[], pathMode?: 'flee') {
        const creeps = team.creeps
        const originPos = TeamUtils.getTeamPos(team)!
        const status = pathMode || team.status
        const needAvoid = status === 'flee' || status === 'avoid'
        const isFlee = status === 'flee'
        const oldMoveMode = team.moveMode
        const isFourTeam = creeps.length >= 3
        const teamFlag = team.flag
        const safeGoals = (goals || []).filter((g: any) => g && g.pos) as { pos: RoomPosition }[]
        team.moveMode = status

        // 和上一 tick 的移动模式相同，并且不需要避让，则检查缓存并按缓存移动
        if (!needAvoid && status === oldMoveMode &&
            teamFlag && originPos.roomName !== teamFlag.pos.roomName &&
            this.checkCachePath(team)
        ) {
            return this.getDirectionByCachePath(team)
        } else {
            this.clearPathCache(team)
        }


        // 和爬相邻的目标
        const nearGoals = safeGoals.filter((goal) => creeps.find((creep) => creep.pos.isNearTo(goal.pos)))
        if (!needAvoid && nearGoals.length) {
            // 当第一个目标是旗帜，代表没有其他目标
            if (nearGoals[0] instanceof Flag) {
                return this.getSamllMoveDirection(team, nearGoals[0].pos)
            }

            // 找血量最少的那个
            const target = (nearGoals as (Creep | Structure)[]).reduce((min, cur) => (min.hits < cur.hits ? min : cur))
            if (isFourTeam) {
                return this.getSamllMoveDirection(team, target.pos)
            } else if (target instanceof Creep) {
                return originPos.getDirectionTo(target.pos)
            }

        }

        const allGoals: { pos: RoomPosition; range: number }[] = []
        // 修改范围，逃跑模式下避开有攻击力的爬
        safeGoals.forEach((goal: any) => {
            // 逃跑状态只避开爬和塔
            if (isFlee && !(goal instanceof Creep) && !(goal instanceof StructureTower)) return

            goal['_range'] =
                !isFlee
                    ? 1
                    : !(goal instanceof Creep)
                    ? 50
                    : goal.getActiveBodyparts(RANGED_ATTACK)
                    ? 5
                    : goal.getActiveBodyparts(ATTACK)
                    ? 3
                    : 1

            // 调整 spawn 的范围，避免被踩死
            if (goal instanceof StructureSpawn &&
                teamFlag &&
                !(goal.pos.isEqualTo(teamFlag.pos)) &&
                team.actionMode !== 'rush' &&
                team.actionMode !== 'press') {
                (goal as any) ['_range'] = 2
            }
            const allowEdgeChase = !needAvoid && goal && 'hits' in goal
            const pos = allowEdgeChase && goal.pos?.isRoomEdge?.() ? TeamUtils.pushInsideRoomPos(goal.pos, 1) : goal.pos
            allGoals.push({ pos, range: goal['_range'] })
        })

        if (isFlee) {
            allGoals.push(...((team as any) ['_avoidObjs'] || []))
            if (allGoals.length === 0) {
                let towers = Game.rooms[originPos.roomName]?.tower || [];
                allGoals.push(...towers.map((tower) => ({ pos: tower.pos, range: 50 })))
            }

            // 逃跑时尝试往家里跑，或者是最近的安全出口
            // 添加通往 homeRoom 的出口作为目标
            if (team.homeRoom && originPos.roomName !== team.homeRoom) {
                const route = Game.map.findRoute(originPos.roomName, team.homeRoom);
                if (route && route !== ERR_NO_PATH && route.length > 0) {
                    const exitDir = route[0]!.exit!;
                    const exit = originPos.findClosestByRange(exitDir);
                    if (exit) {
                        // 设为极高优先级（range 很大，因为排序是 b.range - a.range）
                        // 但实际上 PathFinder 的 goal 是 range 越小越好到达，这里逻辑有点绕
                        // 上面代码是 allGoals.sort((a, b) => b.range - a.range)， range 大的排前面
                        // 而在 Flee 模式下，PathFinder 是远离 goals。
                        // 所以这里如果是为了"去"某个地方，不能直接加到 flee 的 goals 里。
                        // Flee 模式下的 PathFinder 只能用来"远离"危险。
                        // 如果要"去"安全的地方，应该把安全地点设为 PathFinder 的目标，并把 flee 设为 false。
                        // 但目前的架构限制了 getTeamMoveDirection 必须一次性决定。

                        // 妥协方案：如果周围没有危险源，或者危险源很远，就切换回普通移动模式去安全点。
                        // 现有的逻辑是：只要 status 是 flee，就强制 flee。
                        const exitDirection = originPos.getDirectionTo(exit) as DirectionConstant | 0
                        if (exitDirection) {
                            const calcClearance = (pos: RoomPosition) => {
                                let min = Infinity
                                safeGoals.forEach((g: any) => {
                                    if (!g?.pos) return
                                    if (g.pos.roomName !== pos.roomName) return
                                    let dangerRange = 0
                                    if (g instanceof StructureTower) dangerRange = 20
                                    else if (g instanceof Creep) dangerRange = (g as any) ['_range'] || 0
                                    else return
                                    min = Math.min(min, pos.getRangeTo(g.pos) - dangerRange)
                                })
                                ;((team as any) ['_avoidObjs'] || []).forEach((o: any) => {
                                    if (!o?.pos) return
                                    if (o.pos.roomName !== pos.roomName) return
                                    const dangerRange = o.range || 0
                                    min = Math.min(min, pos.getRangeTo(o.pos) - dangerRange)
                                })
                                return min
                            }

                            const curClearance = calcClearance(originPos)
                            const nextPos = originPos.getDirectPos(exitDirection)
                            const nextClearance = calcClearance(nextPos)
                            // 方向直返前先做一次“首步可走”校验：避免返回不可通行方向导致队伍持续撞墙
                            // 若被挡住，则不直返，继续走下面的 PathFinder（flee）逻辑去尝试躲避绕行
                            if (this.hasObstacleInPath(creeps, nextPos)) {
                                // fallthrough
                            } else if ((curClearance >= 4 && nextClearance >= 0) || nextClearance >= curClearance) {
                                return exitDirection
                            }
                        }
                    }
                }
            }
        }

        const newGoals: { pos: RoomPosition; range: number }[] = []
        const visited = new Set<number>()
        const rangePlus = status === 'flee' ? 2 : status === 'avoid' ? 1 : 0

        allGoals.sort((a, b) => b.range - a.range)

        // 一体机或者二人小队模式
        if (!isFourTeam) {
            allGoals.forEach((goal) => {
                // 不考虑在房间边缘的目标
                if (goal.pos.isRoomEdge()) return;

                if (visited.has(goal.pos.hashCode())) return

                visited.add(goal.pos.hashCode())
                newGoals.push({ pos: goal.pos, range: goal.range + rangePlus })
            })
        } else {
            // 四人小队模式
            allGoals.forEach((goal) => {
                // 不考虑在房间边缘的目标
                if (goal.pos.isRoomEdge()) return

                for (const item of [
                    [0, 0],
                    [-1, 0],
                    [0, -1],
                    [-1, -1],
                ]) {
                    const raw = new RoomPosition(goal.pos.x + item[0]!, goal.pos.y + item[1]!, goal.pos.roomName)
                    const pos = TeamUtils.pushInsideRoomPos(raw, 1)
                    if (visited.has(pos.hashCode())) return

                    visited.add(pos.hashCode())
                    newGoals.push({ pos, range: goal.range + rangePlus })
                }
            })
        }

        // 调试
        const costMatrixFlag = Game.flags[`costMatrixShow`]

        const result = PathFinder.search(originPos, newGoals, {
            roomCallback: (roomName) => {
                const bypassRooms = (Memory as Memory & { bypassRooms?: string[] }).bypassRooms
                if (bypassRooms?.includes(roomName)) return false

                // 防止 costMatrix 缓存长期堆积：同 tick 内只会清理一次（内部有 tick 去重）
                TeamCache.cleanupGlobalCostMatrixCache(Game.time)

                // 生成稳定的避让对象哈希：只让“位于该房间的避让对象”影响 key，
                // 避免跨房间时避让对象变化导致缓存抖动，同时防止简单 key 撞车。
                let avoidHash = ''
                const avoidObjs = (team as any) ['_avoidObjs'] as { pos: RoomPosition; range?: number }[] | undefined
                if (avoidObjs?.length) {
                    const objsInRoom = avoidObjs.filter((o) => o.pos.roomName === roomName)
                    if (objsInRoom.length) {
                        const signature = objsInRoom
                            .map((o) => `${o.pos.x},${o.pos.y},${o.range || 0}`)
                            .sort()
                            .slice(0, 12)
                            .join('|')
                        let hash = 0
                        for (let i = 0; i < signature.length; i++) hash = (hash * 31 + signature.charCodeAt(i)) | 0
                        avoidHash = `_${objsInRoom.length}_${(hash >>> 0).toString(36)}`
                    }
                }

                // 可见房间：CostMatrix 会把“非本队伍 creep”当成障碍（255），因此必须按队伍隔离缓存，
                // 否则多队伍同 tick 会互相复用矩阵，导致寻路失败/原地不动。
                const isVisible = !!Game.rooms[roomName]
                const structHitLimit = team.cache.structHitLimit || this.structHitLimit
                const isSpawnDanger = !!team.cache.isSpawnDanger
                const damageLimit = (team as any) ['_max_damage'] || 0
                const swampCost = needAvoid ? 50 : 5

                // 缓存 key 需要包含所有会改变矩阵的关键参数，避免“不同参数共用同一矩阵”带来矛盾：
                // - isFourTeam：4 人/3 人会用 2x2 逻辑抬高 cost
                // - rangePlus / swampCost：避伤/绕路策略差异
                // - structHitLimit / isSpawnDanger：通行建筑阈值与 spawn 周边禁行
                // - damageLimit：基于伤害阈值的禁行区域
                const paramKey = `p${isFourTeam ? 1 : 0}_${rangePlus}_${swampCost}_${structHitLimit}_${isSpawnDanger ? 1 : 0}_${damageLimit}`

                // 缓存有效期：可见房间 1 tick（及时反映 creep 占位变化），不可见房间 5 tick（降低 CPU）。
                const cacheKey = `${roomName}${avoidHash}_${paramKey}${isVisible ? `_t${team.name}` : ''}`
                const cached = TeamCache.globalCostMatrixCache[cacheKey]
                if (cached && Game.time - cached.tick < (isVisible ? 1 : 5)) return cached.matrix

                const costs = this.getMoveAbleCostMatrix(
                    roomName,
                    creeps,
                    (team as any) ['_avoidObjs'],
                    damageLimit,
                    rangePlus,
                    isFourTeam,
                    swampCost,
                    structHitLimit,
                    isSpawnDanger,
                )

                // 更新缓存
                TeamCache.globalCostMatrixCache[cacheKey] = {
                    matrix: costs,
                    tick: Game.time
                };

                if (costMatrixFlag && costMatrixFlag.pos.roomName === roomName && costMatrixFlag.color === COLOR_RED) {
                    TeamVisual.drawRoomArray(roomName, costs)
                }

                return costs
            },
            flee: status === 'flee',
            maxRooms: originPos.roomName === team.flag?.pos.roomName ? 2 : 20,
            maxOps: 8000,
        })

        // 没找到路径或者路径堵塞了
        if (!result.path.length || this.hasObstacleInPath(creeps, result.path[0]!)) {
            // 无其他目标
            if (goals[0] instanceof Flag) {
                // 休眠
                team.status = 'sleep'
            }
            return
        }

        TeamCache.cacheTeamPath[team.name] = result.path
        return originPos.getDirectionTo(result.path.shift()!)
    },




    /**
     * 移出边界
     */
    moveOuterBorder(creep: Creep, nearCreep: Creep) {
        const targetPos = creep.pos.nearPos(1).find((pos) => pos.walkable(true) && nearCreep.pos.isNearTo(pos))
        if (targetPos) {
            combatMove(creep, creep.pos.getDirectionTo(targetPos))
        }
    },
};

export default teamActionObjDirection;
