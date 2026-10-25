
import { UNITS } from '@/constant/CreepConstant';
import { getLabAB } from '@/modules/industry';
import { getOutMineData, getStructData } from '@/core/store/accessor';
import { pcUsePower, pcMoveTo } from './powerAdapter';

export default class PowerCreepUsePower extends PowerCreep {
    private usePowerOrMove(
        power: PowerConstant,
        target: RoomObject,
        range = 3,
        moveOpts: MoveToOpts = { plainCost: 1, swampCost: 1 }
    ): boolean {
        const moveRange = (moveOpts as any).range ?? range;
        const moveOptions = moveRange === (moveOpts as any).range ? moveOpts : { ...moveOpts, range: moveRange };
        if (!this.pos.inRangeTo(target, range)) {
            pcMoveTo(this, target, moveOptions);
            return true;
        }

        const result = pcUsePower(this, power, target);
        if (result === OK) {
            return true;
        }
        if (result === ERR_NOT_IN_RANGE) {
            pcMoveTo(this, target, moveOptions);
            return true;
        }
        return false;
    }

    override Generate_OPS() {
        const powers = this.powers;
        const power = powers[PWR_GENERATE_OPS];
        if(!power) return false;
        if(power.cooldown! > 0) return false;
        if(this.store.getFreeCapacity() <= 0) return false;
        return pcUsePower(this, PWR_GENERATE_OPS) === OK;
    }
    override Regen_Source() {
        if (this.room!.memory.defend!) return false;
        const sources = this.room!.source! || [];
        const source = sources.find(s => !s.effects || !s.effects.some(e => e.effect == PWR_REGEN_SOURCE && e.ticksRemaining));
        if(!source) return false;
        return this.usePowerOrMove(PWR_REGEN_SOURCE, source, 3, { plainCost: 1, swampCost: 1 });
    }
    override Regen_Mineral() {
        if (this.room!.memory.defend!) return false;
        const mineral = this.room!.mineral!;
        if (!mineral) return false;
        if (mineral.mineralAmount == 0) return false;
        if (mineral.effects?.some(e => e.effect == PWR_REGEN_MINERAL && e.ticksRemaining)) return false;
        return this.usePowerOrMove(PWR_REGEN_MINERAL, mineral, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Spawn() {
        if(!this.room!.spawn) return false;
        if(this.store[RESOURCE_OPS] < 100) return false;
        if (this.room!.my!) {
            const units = [
                UNITS['power-attack'], UNITS['power-heal'], UNITS['power-carry'], 'power-defend',
                UNITS['deposit-harvest'], UNITS['deposit-transfer'],
                UNITS['team-attack'], UNITS['team-dismantle'], UNITS['team-ranged'], UNITS['team-heal'],
            ]
            // 战件/power 件孵化已桥接 directSpawn 不入 spawn 池——孵化需求
            // 改蛋感知口径: 本房任一 spawn 正在孵 units 内角色的蛋
            const unitSet = new Set<string>(units);
            const hasUnitEgg = this.room!.spawn!.some(
                (s) => s.spawning && Memory.creeps?.[s.spawning.name]?.unit && unitSet.has(Memory.creeps[s.spawning.name]!.unit!)
            );
            // mine 池判定改读 OutMineData 簿记 (powerMine/depositMine 非空即有过道矿在编)
            const outMine = getOutMineData(this.room!.name);
            const hasMineWork = Object.keys(outMine.powerMine ?? {}).length > 0 ||
                Object.keys(outMine.depositMine ?? {}).length > 0;
            if (!Game.flags[this.name+'-upspawn'] && !this.room!.memory.defend &&
                (!hasMineWork || !hasUnitEgg)) return false;
        }
        const spawns = this.room!.spawn!;
        if(!spawns) return false;
        const spawn = spawns.find(s => !s.effects || 
            !s.effects.some(e => e.effect == PWR_OPERATE_SPAWN && e.ticksRemaining > 0));
        if(!spawn) return false;
        return this.usePowerOrMove(PWR_OPERATE_SPAWN, spawn, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Extension() {        
        if(!this.room!.storage && !this.room!.terminal) return false;
        if(this.store[RESOURCE_OPS] < 2) return false;
        if(this.room!.energyAvailable! > this.room!.energyCapacityAvailable! / 2) return false;
        let target = this.room!.storage! as any;
        if (!target || target.store.energy < 10000) {
            target = this.room!.terminal!;
        }
        if (!target || target.store.energy < 10000) return false;

        return this.usePowerOrMove(PWR_OPERATE_EXTENSION, target, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Storage() {
        const storage = this.room!.storage!;
        if(!storage) return false;
        if(this.store[RESOURCE_OPS] < 100) return false;
        if(storage.store.getFreeCapacity() > 5000) return false;
        if(storage.effects && storage.effects.some(e => 
            e.effect == PWR_OPERATE_STORAGE && e.ticksRemaining > 0)
        ) return false;
        return this.usePowerOrMove(PWR_OPERATE_STORAGE, storage, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Tower() {
        if(!this.room!.memory.defend) return false;
        if(this.store[RESOURCE_OPS] < 10) return false;

        const towers = this.room!.tower!;
        if(!towers) return false;
        const tower = towers.find(t => !t.effects ||
            !t.effects.some(e => e.effect == PWR_OPERATE_TOWER && e.ticksRemaining > 0)
        );
        if(!tower) return false;

        return this.usePowerOrMove(PWR_OPERATE_TOWER, tower, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Factory() {
        // 没有factory时不处理
        const factory = this.room!.factory!;
        if(!factory) return false;
        // ops不足时不处理
        if(this.store[RESOURCE_OPS] < 100) return false;
        // 已有效果未结束时不处理
        if(factory.effects && factory.effects.some(e => e.effect == PWR_OPERATE_FACTORY && e.ticksRemaining > 0)) return false;

        // 当 factory 没有等级时，先用一次技能固定等级，避免资源管理分配任务时无法正确判断房间的 factory 等级。
        if (!factory.level) {
            return this.usePowerOrMove(PWR_OPERATE_FACTORY, factory, 3, { plainCost: 1, swampCost: 1 });
        }

        // 没有任务时不处理
        const memory = getStructData(this.room!.name!);
        if(!memory || !memory.factoryProduct) return false;

        // factory等级不匹配时不处理（不再依赖 memory.factoryLevel）
        const product = memory.factoryProduct as keyof typeof COMMODITIES;
        if (COMMODITIES[product]?.level != factory.level) return false;
        // 资源不充足时不处理
        const components = COMMODITIES[product]?.components;
        for(const resource in components) {
            if (((factory.store as any)[resource] ?? 0) < ((components as Record<string, number>)[resource] ?? 0)) return false;
        }
        if(factory.level && factory.level !== this.powers[PWR_OPERATE_FACTORY]?.level) return false;

        return this.usePowerOrMove(PWR_OPERATE_FACTORY, factory, 3, { plainCost: 1, swampCost: 1 });
    }
    override Operate_Lab() {
        if(!this.room!.lab) return false;
        if(this.store[RESOURCE_OPS] < 10) return false;

        const botmem = getStructData(this.room!.name!);
        if (!botmem || !botmem.lab) return false;
        const { labA, labB, labAId, labBId } = getLabAB(this.room!.name!, this.room);
        if (!labA || !labB || !labAId || !labBId) return false;
        const labAtype = botmem.labAtype;
        const labBtype = botmem.labBtype;
        if (!labAtype || !labBtype ||
            (labA.store[labAtype] ?? 0) < 1000 ||
            (labB.store[labBtype] ?? 0) < 1000) {
            return false;
        }
        
        const product = (REACTIONS[labAtype] as any) [labBtype]!;

        if (!labAtype || !labBtype) return false;
        const lab = this.room!.lab?.find((l: StructureLab) => {
            if(l.id === labAId || l.id === labBId) return false;
            if(botmem.boostLabs?.[l.id]) return false;
            if(l.mineralType != product) return false;
            return !l.effects || l.effects.every(e => e.effect != PWR_OPERATE_LAB)
        });
        if(!lab) return false;
        return this.usePowerOrMove(PWR_OPERATE_LAB, lab, 3, { plainCost: 1, swampCost: 1 }) ?? false;
    }
    override Operate_Power() {
        const powerSpawn = this.room!.powerSpawn!;
        if(!powerSpawn) return false;
        const mem = getStructData(this.room!.name!);
        if(!mem || !mem.powerSpawn) return false;
        if(this.store[RESOURCE_OPS] < 200) return false;
        if ((this.room!.storage?.store[RESOURCE_POWER] ?? 0) < 5000) return false;
        if(powerSpawn.effects && powerSpawn.effects.some(e => e.effect == PWR_OPERATE_POWER && e.ticksRemaining > 0)) return false;

        return this.usePowerOrMove(PWR_OPERATE_POWER, powerSpawn, 3, { plainCost: 1, swampCost: 1 });
    }
    
    override Shield(pos: RoomPosition) {
        const powers = this.powers;
        if(PWR_SHIELD in powers && powers[PWR_SHIELD].cooldown! <= 0) {
            if(this.pos.inRangeTo(pos, 0)) {
                pcUsePower(this, PWR_SHIELD);
            } else {
                pcMoveTo(this, pos);
            }
            return true;
        }
        return false;
    }

    override Disrupt_Tower() {
        const power = this.powers[PWR_DISRUPT_TOWER];
        if (!power || power.cooldown! > 0) return false;
        if (this.store[RESOURCE_OPS] < 10) return false;

        const targets = this.room!.find! (FIND_STRUCTURES, {
            filter: (s: AnyStructure) => {
                if (s.structureType !== STRUCTURE_TOWER) return false;
                if ((s as any).my) return false;
                const effects = (s as any).effects as PowerEffect[] | undefined;
                if (!effects) return true;
                return !effects.some(e => e.effect === PWR_DISRUPT_TOWER && e.ticksRemaining > 0);
            }
        }) as StructureTower[];

        if (targets.length <= 0) return false;
        const target = this.pos.findClosestByRange(targets);
        if (!target) return false;

        const result = pcUsePower(this, PWR_DISRUPT_TOWER, target);
        if (result === ERR_NOT_IN_RANGE) {
            pcMoveTo(this, target, { plainCost: 1, swampCost: 1 });
        }
        return result === OK || result === ERR_NOT_IN_RANGE;
    }

    override Disrupt_Spawn() {
        const power = this.powers[PWR_DISRUPT_SPAWN];
        if (!power || power.cooldown! > 0) return false;
        if (this.store[RESOURCE_OPS] < 10) return false;

        const targets = this.room!.find! (FIND_HOSTILE_STRUCTURES, {
            filter: (s: AnyStructure) => {
                if (s.structureType !== STRUCTURE_SPAWN) return false;
                const effects = (s as any).effects as PowerEffect[] | undefined;
                if (!effects) return true;
                return !effects.some(e => e.effect === PWR_DISRUPT_SPAWN && e.ticksRemaining > 0);
            }
        }) as StructureSpawn[];

        if (targets.length <= 0) return false;
        const target = this.pos.findClosestByRange(targets);
        if (!target) return false;

        const result = pcUsePower(this, PWR_DISRUPT_SPAWN, target);
        if (result === ERR_NOT_IN_RANGE) {
            pcMoveTo(this, target, { plainCost: 1, swampCost: 1 });
        }
        return result === OK || result === ERR_NOT_IN_RANGE;
    }
}
