
/**
 * 任务提交
 */
import { getMissionFromPoolById, deleteMissionFromPool, submitMission } from '@/modules/spawning/mission/pool/MissionPools';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { getMissionPools } from '@/core/store/accessor';

export default class MissionSubmit extends Room {
    // 提交运输任务
    override submitTransportMission(id: Task['id'], amount: TransportTask['amount']) {
        const task = getMissionFromPoolById(this.name, MISSION_POOLS.transport, id);
        if (!task) return;
        amount = (task.data as TransportTask).amount - amount;
        if (amount < 0) amount = 0;
        
        const deleteFunc = (taskdata: TransportTask) =>{
            if(taskdata.amount <= 0) return true;
            return false;
        }

        submitMission(this.name, MISSION_POOLS.transport, id, {amount} as any, deleteFunc);
        return OK;
    }

    // 提交孵化任务
    override submitSpawnMission(id: Task['id']) {
        const task = getMissionFromPoolById(this.name, MISSION_POOLS.spawn, id);
        if (!task) return;
        deleteMissionFromPool(this.name, MISSION_POOLS.spawn, id);
        return OK;
    }

    /**
     * 删除指定 unit 的孵化任务
     * @description 用于防御结束后撤销未孵化的防御兵孵化队列，避免继续出兵浪费能量。
     */
    override deleteSpawnMissionsByRole(units: string[] | string): number {
        const unitSet = new Set(Array.isArray(units) ? units : [units]);
        const pools = getMissionPools()?.[this.name];
        const tasks = pools?.spawn;
        if (!Array.isArray(tasks) || tasks.length === 0) return 0;

        let removed = 0;
        const remaining: Task[] = [];

        for (const task of tasks) {
            const data = task?.data as SpawnTask | undefined;
            const unit = data?.memory?.unit;
            if (unit && unitSet.has(unit)) {
                removed++;
                continue;
            }
            remaining.push(task);
        }

        if (pools) pools.spawn = remaining as any;

        delete (this as any)._spawnMissionNumCache;
        delete (this as any)._spawnMissionNumCacheTick;
        return removed;
    }

    // 提交mine任务
    submitMineMission(id: Task['id'], data: Partial<MineTask>) {
        const task = getMissionFromPoolById(this.name, MISSION_POOLS.mine, id);
        if (!task) return;
        
        // 合并数据
        const newData = { ...task.data, ...data };
        
        const deleteFunc = (taskdata: MineTask) => {
            // deposit 标记非激活时仅更新状态, 生命周期由消费方管理
            if (task.type === 'deposit' && (taskdata as DepositMineTask).active === false) {
                return false;
            }
            return false;
        }

        submitMission(this.name, MISSION_POOLS.mine, id, newData, deleteFunc);
        return OK;
    }
}
