import { UNITS, UnitData, UnitLevelData } from '@/constant/CreepConstant';

/**
 * 体型生成域：按等级、能量预算生成/计价 body。
 * 外矿搬运路面配比由 spawnArbiter 按 remote 路网覆盖率直接决定，不经本域。
 */
export default class BodyFunction extends Room {
    override GetUnitBodys(unit: string, upbody?:boolean, energyBudget?: number, miniBody?: boolean) {
        let lv = this.level;
        let body: any[] = [];
        const budget = energyBudget ?? this.energyCapacityAvailable;

        const unitData = UnitData as Record<string, { bodypart?: any[] } | undefined>;
        if (unit === UNITS.manager && energyBudget !== undefined) {
            const minConfig = unitData[unit]?.bodypart;
            if (minConfig) {
                const minBody = this.GenerateBodys(minConfig, unit);
                const minCost = this.CalculateEnergy(minBody);
                if (budget < minCost) return [];
            }
        }

        if ((UnitLevelData as any) [unit]) {
            while (lv >= 1) {
                const bodyconfig = ((UnitLevelData as any) [unit] as any) [lv];
                if (!bodyconfig) return unitData[unit]?.bodypart || [];
                if (miniBody && bodyconfig.minipart) {
                    body = bodyconfig.minipart;
                } else if (upbody && bodyconfig.upbodypart) {
                    body = bodyconfig.upbodypart;
                } else {
                    body = bodyconfig.bodypart
                }
                if (budget >=
                    this.CalculateEnergy(this.GenerateBodys(body))) break;
                lv--;
            }
            if (lv === 0) return [];
        } else return unitData[unit]?.bodypart || [];

        if (lv !== 8) return [...body];

        switch (unit) {
            case UNITS.harvester:
                if((this.source || []).some(s => (s.effects||[])
                    .some(e => e.effect == PWR_REGEN_SOURCE))) {
                    body = UnitLevelData[unit][lv].upbodypart;
                }
                break;
            default:
                break;
        }
        return [...body];
    }

    /* 生成指定体型 */
    override GenerateBodys(bodypart: any[], unit='') {
        if (!Array.isArray(bodypart)) return []
        if (!bodypart.length) return []

        let [work, carry, move, attack, range_attack, heal, claim, tough] = [0, 0, 0, 0, 0, 0, 0, 0];
        if (bodypart.every(item => typeof item[0] == 'string' && Number.isFinite(item[1]))) {
            for (let body of bodypart) {
                if(body[0] === WORK) work += body[1];
                if(body[0] === CARRY) carry += body[1];
                if(body[0] === MOVE) move += body[1];
                if(body[0] === ATTACK) attack += body[1];
                if(body[0] === RANGED_ATTACK) range_attack += body[1];
                if(body[0] === HEAL) heal += body[1];
                if(body[0] === CLAIM) claim += body[1];
                if(body[0] === TOUGH) tough += body[1];
            }
        } else return [];

        let body_list: any = [];
        // 生成优先级，越往前越优先

        switch (unit) {
        case UNITS['power-attack']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            if (move) body_list = AddList(body_list, move - 1, MOVE)
            if (attack) body_list = AddList(body_list, attack, ATTACK)
            if (move) body_list = AddList(body_list, 1, MOVE)
            break;
        case UNITS['power-carry']:
            if (tough) body_list = AddList(body_list, tough, TOUGH)
            while (carry > 0 || move > 0) {
                if (carry) body_list = AddList(body_list, 1, CARRY)
                if (move) body_list = AddList(body_list, 1, MOVE)
                carry--; move--;
            }
            break;
        default:
            for (let body of bodypart) {
                if (BODYPARTS_ALL.includes(body[0]))  {
                    body_list = AddList(body_list, body[1], body[0])
                }
            }
            break;
        }
        return body_list
    }

    /* 计算孵化所需能量 */
    override CalculateEnergy(bodypartList: any[]) {
        var num = 0
        for (var part of bodypartList) {
        if (part == WORK) num += 100
        if (part == CARRY) num += 50
        if (part == MOVE) num += 50
        if (part == ATTACK) num += 80
        if (part == RANGED_ATTACK) num += 150
        if (part == HEAL) num += 250
        if (part == CLAIM) num += 600
        if (part == TOUGH) num += 10
        }
        return num
    }

}

function AddList(list: any[], num: number, type: any) {
    for (let i = 0; i < num; i++) {
        list.push(type)
    }
    return list
}
