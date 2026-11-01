/**
 * TeamAction 域模块: 代价矩阵: getMoveAbleCostMatrix 可通行矩阵构建。
 * 从 TeamAction.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */

import TeamCache from '@/modules/teams/core/TeamCache';
import TeamCalc from '@/modules/teams/core/TeamCalc';
import RoomArray from '@/modules/teams/core/RoomArray'
import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const tempRoomArray = new RoomArray()

const teamActionObjCostMatrix: Pick<TeamActionApi, 'getMoveAbleCostMatrix'> & ThisType<TeamActionApi> = {

    /**
     * 获取 CostMatrix
     *
     * @param roomName 房间名
     * @param myCreeps 我的爬
     * @param avoidObjects 需要避开的对象
     * @param damageLimit 伤害阈值
     * @param damageRangePlus 伤害范围增加
     * @param isFourTeam 是否是四人小队
     * @param swampCost 沼泽消耗
     * @param structHitLimit 建筑血量阈值，低于该值的建筑不会被视为障碍物
     * @param isSpawnDanger spawn 是否危险，即 spawn 周围 1 格是否禁止通行
     */
    getMoveAbleCostMatrix(
        this: TeamActionApi,
        roomName: string,
        myCreeps: Creep[],
        avoidObjects?: { pos: RoomPosition; range: number }[],
        damageLimit = 0,
        damageRangePlus = 0,
        isFourTeam = false,
        swampCost = 5,
        structHitLimit = this.structHitLimit,
        isSpawnDanger = false,
    ) {
        const costs = new PathFinder.CostMatrix()
        const terrain = new Room.Terrain(roomName)
        const room = Game.rooms[roomName]
        const towerDamageMap =
            damageLimit > 0 && (!room || room.my)
                ? TeamCache.getTowerDamageMap(roomName)
                : TeamCache.emptyRoomArray

        // 设置地形数据，同时避开塔伤会导致破防的地方
        towerDamageMap.forEach((x, y, damage) => {
            const terrainType = terrain.get(x, y)
            costs.set(
                x,
                y,
                terrainType === TERRAIN_MASK_WALL ? 255 : terrainType === TERRAIN_MASK_SWAMP ? swampCost : 1,
            )
            // 超过伤害阈值的地方设置为无法通过
            if (damage > damageLimit && terrainType !== TERRAIN_MASK_WALL) {
                costs.set(x, y, 254)
            }
        })

        const structures = TeamCache.getStructures(roomName)

        structures.forEach((struct) => {
            if (struct.structureType === STRUCTURE_ROAD) {
                costs.set(struct.pos.x, struct.pos.y, 1)
            }
        })

        // 不能行走的建筑
        structures.forEach((struct) => {
            if (
                struct.structureType !== STRUCTURE_ROAD &&
                struct.structureType !== STRUCTURE_CONTAINER &&
                (struct.structureType !== STRUCTURE_RAMPART || !struct.my)
            ) {
                if (!struct.hits || struct.hits >= structHitLimit) {
                    costs.set(struct.pos.x, struct.pos.y, 255)
                } else {
                    costs.set(struct.pos.x, struct.pos.y, 100)
                }
            }

            if (isSpawnDanger && struct.structureType === STRUCTURE_SPAWN) {
                struct.pos.nearPos().forEach((pos) => {
                    costs.set(pos.x, pos.y, 249)
                })
            }
        })

        const myCreepsIdSet = new Set(myCreeps.map((creep) => creep.id))
        let init = false

        if (room) {
            // 房间存在的话，避开房间中的非小队 creep，暂时不考虑 pc（不会真有 pc 直接撞上来吧？）
            room.find(FIND_CREEPS).forEach((creep) => {
                if (!myCreepsIdSet.has(creep.id)) {
                    costs.set(creep.pos.x, creep.pos.y, 255)
                }

                if (creep.my) return;
                // 敌人单位要计算周围伤害
                const atkDamage = TeamCalc.calcAttackDamage(creep)
                const rangeDamage = TeamCalc.calcRangeDamage(creep)

                if (atkDamage + rangeDamage > 0 && !init) {
                    init = true
                    tempRoomArray.fill(0)
                }

                // 如果敌人疲劳, 则缩短范围
                const rangeMinus = creep.fatigue > 80 ? 1 : 0;

                if (atkDamage > 0) {
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 2 + damageRangePlus - rangeMinus, (x, y, val) => {
                        tempRoomArray.set(x, y, val + atkDamage)
                    })
                }

                if (rangeDamage > 0) {
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 4 + damageRangePlus - rangeMinus, (x, y, val) => {
                        tempRoomArray.set(x, y, val + rangeDamage)
                    })
                    tempRoomArray.forNear(creep.pos.x, creep.pos.y, 2 + damageRangePlus - rangeMinus, (x, y, val) => {
                        // 对四人小队的多余伤害：1 + 0.4 + 0.4 = 1.8
                        tempRoomArray.set(x, y, val + rangeDamage * 1.8)
                    })
                }
            })
        }

        if (init) {
            tempRoomArray.forEach((x, y, val) => {
                const damage = towerDamageMap.get(x, y) + val
                // 超过伤害阈值的地方设置为几乎无法通过
                if (damage > damageLimit && costs.get(x, y) < 249) {
                    costs.set(x, y, 249)
                }
            })
        }

        if (avoidObjects?.length) {
            avoidObjects.forEach((e) => {
                if (e.pos.roomName !== roomName) return

                tempRoomArray.forNear(e.pos.x, e.pos.y, e.range, (x, y) => {
                    if (costs.get(x, y) < 249) costs.set(x, y, 249)
                })
            })
        }

        let val: number
        for (let x = 0; x < 49; x++) {
            for (let y = 0; y < 49; y++) {
                val = costs.get(x, y)
                if (val < 250 && terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
                    costs.set(x, y, val + 5)
                }
            }
        }

        if (isFourTeam) {
            // 如果是四人小队就调整一下
            for (let x = 0; x < 49; x++) {
                for (let y = 0; y < 49; y++) {
                    // 尽量不出房间
                    if (x == 0 || y == 0 || y == 48 || x == 48 || x == 49 || y == 49) {
                        costs.set(x, y, Math.max(costs.get(x, y), 50))
                    }

                    const c = Math.max(
                        costs.get(x, y),
                        costs.get(x + 1, y),
                        costs.get(x, y + 1),
                        costs.get(x + 1, y + 1),
                    )
                    costs.set(x, y, c)
                }
            }
        }

        return costs
    },
};

export default teamActionObjCostMatrix;
