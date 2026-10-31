import { inWhitelist } from '@/utils/whitelist';

interface RoomEnemyCache {
    EnemyCreeps?: Creep[];
    EnemyPowerCreeps?: PowerCreep[];
    EnemyStructures?: AnyOwnedStructure[];
}

/**
 * 敌情域：敌方单位/建筑缓存查询与房主/建筑入口。
 */
export default class SecurityFunction extends Room {

    override findEnemyCreeps(opts?: any) {
        const cache = this as unknown as RoomEnemyCache;
        const base = cache.EnemyCreeps ||
            (cache.EnemyCreeps = this.find(FIND_HOSTILE_CREEPS, { filter: (c: Creep) => !inWhitelist(c.owner.username) }))
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
    }

    /** 寻找敌方PowerCreep */
    override findEnemyPowerCreeps(opts?: any) {
        const cache = this as unknown as RoomEnemyCache;
        const base = cache.EnemyPowerCreeps ||
            (cache.EnemyPowerCreeps = this.find(FIND_HOSTILE_POWER_CREEPS, { filter: (c: PowerCreep) => !inWhitelist(c.owner.username) }))
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
    }

    /**
     * 寻找敌方建筑
     */
    override findEnemyStructures(opts?: any) {
        const cache = this as unknown as RoomEnemyCache;
        const base = cache.EnemyStructures ||
            (cache.EnemyStructures = this.find(FIND_HOSTILE_STRUCTURES, { filter: (c: AnyOwnedStructure) => !inWhitelist(c.owner?.username) }))
        const filter = opts?.filter
        if (!filter) return base
        return base.filter(filter)
    }

    /**
     * 获取房间所有者名字
     */
    override getOwner() {
        return this.controller?.owner ? this.controller.owner.username : '';
    }

    /**
     * 获取房间内所有建筑
     */
    override getStructures() {
        if (this.structures) return this.structures;
        this.structures = this.find(FIND_STRUCTURES);
        return this.structures;
    }
}
