
/**
 * 任务提交 (spawn 池链; transport/mine 提交面随域 3.4 池退役删除)
 */
import { getMissionFromPoolById, deleteMissionFromPool } from '@/modules/spawning/mission/pool/MissionPools';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { getMissionPools } from '@/core/store/accessor';

export default class MissionSubmit extends Room {
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

}
