/**
 * TeamAction 域模块: 数据属性: 位置掩码映射与建筑血量阈值。
 * 从 TeamAction.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */



import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const teamActionObjData: Pick<TeamActionApi, 'POS_MARK_MAP' | 'structHitLimit'> & ThisType<TeamActionApi> = {
    /**
     * 位置掩码映射
     */
    POS_MARK_MAP : {
        ['↖']: [0, 0],
        ['↗']: [1, 0],
        ['↙']: [0, 1],
        ['↘']: [1, 1],
    },


    /**
     * 低于多少血量的建筑视为可以通行
     */
    structHitLimit : 10e3,
};

export default teamActionObjData;
