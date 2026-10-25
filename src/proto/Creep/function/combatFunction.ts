
/**
 * 战斗功能类
 * 提供战斗相关方法的原型扩展
 */
import { inWhitelist } from '@/utils/whitelist';
import { getRoomTickCacheValue } from '@/utils/roomTickCache';

export default class CombatFunction extends Creep {
    /**
     * 查找敌对 creep
     * @param range 搜索范围，默认为整个房间
     * @param options 过滤选项
     * @returns Creep[] 敌对 creep 数组
     */
    override findHostileCreeps(
        range?: number,
        options?: {
            excludeWhitelist?: boolean;
            hasAttack?: boolean;
            hasRangedAttack?: boolean;
            hasHeal?: boolean;
        }
    ): Creep[] {
        const opts = {
            excludeWhitelist: true,
            hasAttack: false,
            hasRangedAttack: false,
            hasHeal: false,
            ...options
        };

        const baseHostiles = getRoomTickCacheValue(this.room, 'combat_hostile_creeps_all', () =>
            this.room.find(FIND_HOSTILE_CREEPS) as Creep[]
        );

        let hostiles = baseHostiles;
        if (opts.excludeWhitelist) {
            hostiles = hostiles.filter((creep) => !inWhitelist(creep.owner.username));
        }
        if (opts.hasAttack) {
            hostiles = hostiles.filter((creep) => creep.getActiveBodyparts(ATTACK) > 0);
        }
        if (opts.hasRangedAttack) {
            hostiles = hostiles.filter((creep) => creep.getActiveBodyparts(RANGED_ATTACK) > 0);
        }
        if (opts.hasHeal) {
            hostiles = hostiles.filter((creep) => creep.getActiveBodyparts(HEAL) > 0);
        }
        if (range) {
            hostiles = hostiles.filter((creep) => this.pos.inRangeTo(creep, range));
        }
        return hostiles;
    }

}
