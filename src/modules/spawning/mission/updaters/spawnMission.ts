
import { addMissionToPool } from '@/modules/spawning/mission/pool/MissionPools';
import { MISSION_POOLS } from '@/constant/MissionConstant';
import { UnitData } from '@/constant/CreepConstant';
import { decompressBodyConfig } from '@/utils/compress';
import { isEnergyCheckEnabled } from '@/config/capabilities';

export default class SpawnMission extends Room {
    /**
     * rush spawn 平衡（水位门）：控制器容器水位低于升级抽水速率 × 10-tick
     * 缓冲时，暂停升级孵化并清掉升级挂单，把 spawn 让给物流/建造层；
     * 仓库续上后自动恢复。分级下探后的升级单随时能孵，不受此门影响。
     *
     * @returns true 表示本 tick 升级孵化被暂停。
     */
    /**
     * spawn 更新入口
     * @description 按类型规则检查缺口并生成对应孵化任务
     * @returns true 表示已执行检查，false 表示不满足条件（例如无 spawn）
     */


    /** 单类型孵化判定与发单：rush 体型现算 / 缺口门 / 降级 L5 与加急分层 */


    /**
     * 添加孵化任务（spawn）
     * @param name - 孵化任务标识（常用 UnitData[unit].code）
     * @param body - 身体配置（数组或压缩字符串）
     * @param level - 任务优先级；<0 时使用默认等级
     * @param unit - unit 类型
     * @param memory - creep memory（会克隆并写入 unit）
     * @param upbody - 是否启用升级 body（可选）
     * @returns OK 表示入队成功，-1 表示失败
     */
    override SpawnMissionAdd(name: string, body: ((BodyPartConstant | number)[])[] | string, level: number, unit: string, memory?: CreepMemory, upbody?: boolean) {
        if (!(UnitData as any) [unit]) {
            console.log(`unit ${unit} 不存在`);
            return -1;
        }

        if (!memory) memory = {} as CreepMemory;
        else memory = { ...(memory as any) } as CreepMemory;
        memory.unit = unit;

        if (level < 0) level = (UnitData as Record<string, { level: number }>)[unit]?.level ?? 0;
        let bodypart: BodyPartConstant[];
        let energy = 0;
        if (typeof body === 'string') {
            bodypart = this.GenerateBodys(decompressBodyConfig(body), unit);
            energy = this.CalculateEnergy(bodypart);
        } else {
            bodypart = this.GenerateBodys(body, unit);
            energy = this.CalculateEnergy(bodypart);
        }

        if (energy > this.energyCapacityAvailable && isEnergyCheckEnabled()) return -1;

        if (upbody === undefined) {
            addMissionToPool(this.name, MISSION_POOLS.spawn, 'spawn', level, { name, body, memory, energy });
        } else {
            addMissionToPool(this.name, MISSION_POOLS.spawn, 'spawn', level, { name, body, memory, energy, upbody: !!upbody });
        }
        return OK;
    }
}
