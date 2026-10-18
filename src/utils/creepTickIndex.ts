import { UNITS } from '@/constant/CreepConstant';
import { isUnitId } from '@/constant/CreepConstant'

type TargetRoomCreepInfo = {
    ticksToLive: number | undefined
    spawning: boolean
    sourceRoom: string | undefined
}

type TargetRoomUnitMap = Record<string, TargetRoomCreepInfo[]>
type UnitCountMap = Record<string, number>
type ExpandRoleCountMap = Record<string, UnitCountMap>
type MinRespawnGapMap = Record<string, number>

type CreepTickIndexCache = {
    time: number
    byTargetRoom: Record<string, TargetRoomUnitMap>
    teamCreeps: Creep[]
    allUnitCounts: UnitCountMap
    byAssignedRoom: Record<string, UnitCountMap>
    downgradedLogisticsByAssignedRoom: Record<string, UnitCountMap>
    byExpandPlan: ExpandRoleCountMap
    minRespawnGapByAssignedRoomUnit: Record<string, MinRespawnGapMap>
    /** 孵化中的蛋按 targetRoom 分组计数 (蛋不在 Game.creeps, 防重复派单的蛋窗口覆盖) */
    eggsByTargetRoom: Record<string, UnitCountMap>
}

const EMPTY_TARGET_ROOM_ROLE_MAP: TargetRoomUnitMap = Object.freeze({}) as TargetRoomUnitMap
const EMPTY_ROLE_COUNT_MAP: UnitCountMap = Object.freeze({}) as UnitCountMap
// 只有 transporter 继续走“缩水体型补正”：
// - transporter 是纯吞吐位，恢复期补一只满体型通常是收益；
// - manager 是中心单点位，若把缩水 manager 当作“缺口”继续补，会在中心区叠出多只堵路。
const DOWNGRADED_LOGISTICS_ROLE_SET = new Set<string>([UNITS.transporter])

let tickCache: CreepTickIndexCache | undefined

function buildCache(): CreepTickIndexCache {
    // Single tick scan builds all shared creep indices.
    const byTargetRoom: Record<string, TargetRoomUnitMap> = {}
    const teamCreeps: Creep[] = []
    const allUnitCounts: UnitCountMap = {}
    const byAssignedRoom: Record<string, UnitCountMap> = {}
    const downgradedLogisticsByAssignedRoom: Record<string, UnitCountMap> = {}
    const byExpandPlan: ExpandRoleCountMap = {}
    const minRespawnGapByAssignedRoomUnit: Record<string, MinRespawnGapMap> = {}

    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName]
        if (!creep) continue
        const unit = creep.memory.unit
        if (!isUnitId(unit)) continue

        allUnitCounts[unit] = (allUnitCounts[unit] || 0) + 1

        if (unit.startsWith('team')) {
            teamCreeps.push(creep)
        }

        const targetRoom = creep.memory.targetRoom
        if (targetRoom) {
            if (!byTargetRoom[targetRoom]) {
                byTargetRoom[targetRoom] = {}
            }
            if (!byTargetRoom[targetRoom][unit]) {
                byTargetRoom[targetRoom][unit] = []
            }

            byTargetRoom[targetRoom][unit].push({
                ticksToLive: creep.ticksToLive,
                spawning: creep.spawning,
                sourceRoom: creep.memory.sourceRoom,
            })
        }

        const expandId = (creep.memory as any).expandId as string | undefined
        if (expandId) {
            if (!byExpandPlan[expandId]) {
                byExpandPlan[expandId] = {}
            }
            byExpandPlan[expandId][unit] = (byExpandPlan[expandId][unit] || 0) + 1
        }

        const assignedRoom = creep.memory.home || creep.memory.homeRoom || creep.memory.sourceRoom || creep.room.name
        if (assignedRoom && typeof creep.ticksToLive === 'number') {
            if (!minRespawnGapByAssignedRoomUnit[assignedRoom]) {
                minRespawnGapByAssignedRoomUnit[assignedRoom] = {}
            }
            const respawnGap = creep.ticksToLive - creep.body.length * 4
            const minRespawnGap = minRespawnGapByAssignedRoomUnit[assignedRoom][unit]
            if (minRespawnGap == null || respawnGap < minRespawnGap) {
                minRespawnGapByAssignedRoomUnit[assignedRoom][unit] = respawnGap
            }
        }

        const ttl = creep.ticksToLive
        if (typeof ttl === 'number' && ttl < creep.body.length * 3) continue

        if (assignedRoom) {
            if (!byAssignedRoom[assignedRoom]) {
                byAssignedRoom[assignedRoom] = {}
            }
            byAssignedRoom[assignedRoom][unit] = (byAssignedRoom[assignedRoom][unit] || 0) + 1

            if (creep.memory.downgraded && DOWNGRADED_LOGISTICS_ROLE_SET.has(unit)) {
                if (!downgradedLogisticsByAssignedRoom[assignedRoom]) {
                    downgradedLogisticsByAssignedRoom[assignedRoom] = {}
                }
                downgradedLogisticsByAssignedRoom[assignedRoom][unit] =
                    (downgradedLogisticsByAssignedRoom[assignedRoom][unit] || 0) + 1
            }
        }
    }

    // 孵化中的蛋索引: spawnCreep 意图当 tick 生效, 蛋下一 tick 才进 Game.creeps——
    // 蛋期 (大体型 100+ tick) 不在 Game.creeps 快照, directSpawn 同步派单的
    // 防重复计数若只看活 creep 会在蛋窗口重复下单
    const eggsByTargetRoom: Record<string, UnitCountMap> = {}
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName]
        if (!spawn || !spawn.spawning) continue
        const eggMemory = Memory.creeps?.[spawn.spawning.name]
        const eggUnit = eggMemory?.unit
        if (!eggUnit || !isUnitId(eggUnit)) continue
        const eggTargetRoom = eggMemory.targetRoom
        if (!eggTargetRoom) continue
        if (!eggsByTargetRoom[eggTargetRoom]) {
            eggsByTargetRoom[eggTargetRoom] = {}
        }
        eggsByTargetRoom[eggTargetRoom][eggUnit] =
            (eggsByTargetRoom[eggTargetRoom][eggUnit] || 0) + 1
    }

    return {
        time: Game.time,
        byTargetRoom,
        teamCreeps,
        allUnitCounts,
        byAssignedRoom,
        downgradedLogisticsByAssignedRoom,
        byExpandPlan,
        minRespawnGapByAssignedRoomUnit,
        eggsByTargetRoom,
    }
}

function getCache(): CreepTickIndexCache {
    // Cache invalidates automatically every tick.
    if (!tickCache || tickCache.time !== Game.time) {
        tickCache = buildCache()
    }
    return tickCache
}

export function getCreepByTargetRoom(targetRoom: string): TargetRoomUnitMap {
    return getCache().byTargetRoom[targetRoom] || EMPTY_TARGET_ROOM_ROLE_MAP
}

/** 目标房角色计数 (活 creep + 孵化中的蛋): directSpawn 同步派单的防重复口径 */
export function getUnitCountByTargetRoom(targetRoom: string, unit: string): number {
    const cache = getCache()
    const alive = cache.byTargetRoom[targetRoom]?.[unit]?.length ?? 0
    const eggs = cache.eggsByTargetRoom[targetRoom]?.[unit] ?? 0
    return alive + eggs
}

export function getTeamCreeps(): Creep[] {
    return getCache().teamCreeps
}

export function getCreepRoleCountsAll(): UnitCountMap {
    return getCache().allUnitCounts
}

export function getCreepNumByAssignedRoom(assignedRoom: string): UnitCountMap {
    const cache = getCache()
    if (!cache.byAssignedRoom[assignedRoom]) {
        cache.byAssignedRoom[assignedRoom] = {}
    }
    return cache.byAssignedRoom[assignedRoom]
}

export function getDowngradedLogisticsCountByAssignedRoom(assignedRoom: string): UnitCountMap {
    return getCache().downgradedLogisticsByAssignedRoom[assignedRoom] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsByPlan(planId: string): UnitCountMap {
    return getCache().byExpandPlan[planId] || EMPTY_ROLE_COUNT_MAP
}

export function getExpandCreepCountsAll(): ExpandRoleCountMap {
    return getCache().byExpandPlan
}

export function hasSoonDeadCreepByAssignedRoomRole(assignedRoom: string, unit: string, bufferTick = 10): boolean {
    const minRespawnGap = getCache().minRespawnGapByAssignedRoomUnit[assignedRoom]?.[unit]
    return typeof minRespawnGap === 'number' && minRespawnGap <= bufferTick
}
