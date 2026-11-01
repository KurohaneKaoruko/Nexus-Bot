
import { getRoomData } from '@/core/store/accessor';
import { UNITS } from '@/constant/CreepConstant';
import { inWhitelist } from '@/utils/whitelist';
import { getCreepNumByAssignedRoom } from '@/utils/creepTickIndex';
import SourceFunction from '@/proto/Room/function/sourceFunction';
import BodyFunction from '@/proto/Room/function/bodyFunction';
import BoostFunction from '@/proto/Room/function/boostFunction';
import SecurityFunction from '@/proto/Room/function/securityFunction';
import ControllerBufferFunction from '@/proto/Room/function/controllerBufferFunction';


/**
 * 一些基础的功能
 */
export default class BaseFunction extends Room {
    // 判断是否在白名单中
    override isWhiteList() {
        return inWhitelist(this.controller?.owner?.username);
    }

    override getCenter() {
        const center = getRoomData()?.[this.name]?.center;
        if (center) return new RoomPosition(center.x, center.y, this.name);
        return new RoomPosition(25, 25, this.name);
    }

    // 获取房间指定资源储备
    override getResAmount(resource: ResourceConstant) {
        if (!RESOURCES_ALL.includes(resource)) return 0;
        let amount = 0;
        if(this.storage) amount += this.storage.store[resource];
        if(this.terminal) amount += this.terminal.store[resource];

        return amount;
    }

    // 获取属于该房间的creep数量
    override getCreepNum() {
        return getCreepNumByAssignedRoom(this.name);
    }

    // 获取当前房间的有效等级，根据可用能量判断
    override getEffectiveRoomLevel() {
        let lv = this.level;
        const availableEnergy = this.energyCapacityAvailable;
        const CS_SE = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION];
        const EEC = EXTENSION_ENERGY_CAPACITY;
        const CS_SS = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN];
        const SEC = SPAWN_ENERGY_CAPACITY;
        
        while (lv > 1 && availableEnergy < CS_SE[lv]! * EEC[lv]! + SEC * CS_SS[lv]!) {
            lv--;
        }
        return lv;
    }

    // 检查spawn和tower是否需要补充能量
    override CheckSpawnAndTower(){
        const towers = (this.tower || [])
                .filter(tower => tower && tower.store.getFreeCapacity(RESOURCE_ENERGY) > 100);
        if (this.energyAvailable === this.energyCapacityAvailable && towers.length === 0) {
            return false;
        }
        return true;
    }

    override getEnergyProfile() {
        const cap = this.energyCapacityAvailable || 0;
        const avail = this.energyAvailable || 0;
        const storageEnergy = this.storage?.store[RESOURCE_ENERGY] || 0;
        const terminalEnergy = this.terminal?.store[RESOURCE_ENERGY] || 0;
        const containerEnergy = (this.container || []).reduce((sum, c) => sum + (c?.store[RESOURCE_ENERGY] || 0), 0);
        const linkEnergy = (this.link || []).reduce((sum, l) => sum + (l?.store[RESOURCE_ENERGY] || 0), 0);
        const totalEnergy = avail + storageEnergy + terminalEnergy + containerEnergy + linkEnergy;
        return { cap, avail, storageEnergy, terminalEnergy, containerEnergy, linkEnergy, totalEnergy };
    }

    override updateEnergyState(force = false) {
        if (!force && this.memory.energyStateTick && this.memory.energyState) {
            const interval = this.memory.energyState === 'CRITICAL' ? 2 : 5;
            if (Game.time - this.memory.energyStateTick < interval) return this.memory.energyState;
        }
        const { cap, avail, totalEnergy } = this.getEnergyProfile();
        const capRef = Math.max(300, cap);
        const creepNum = this.getCreepNum();
        const logisticNum =
            (creepNum[UNITS.carrier] || 0) +
            (creepNum[UNITS.transporter] || 0) +
            (creepNum[UNITS.manager] || 0) +
            (creepNum[UNITS.universal] || 0);
        const spawnNeedsEnergy = this.CheckSpawnAndTower();
        const energyRatio = capRef > 0 ? (avail / capRef) : 0;
        const hasStoredEnergy = totalEnergy >= capRef;
        const logisticThin = logisticNum <= 1;

        type EnergyState = NonNullable<RoomMemory['energyState']>;
        let state: EnergyState;
        if (avail < Math.min(300, capRef) && totalEnergy < capRef) {
            // spawn/extension 空且**储能也见底**才是真饥荒；
            // 储能还在就只是补能延迟（快递在途），判荒会让外矿停摆、升级归零，越闸越穷
            state = 'CRITICAL';
        } else if (logisticNum === 0 && spawnNeedsEnergy && hasStoredEnergy) {
            state = 'CRITICAL';
        } else if (spawnNeedsEnergy && hasStoredEnergy && logisticThin && energyRatio < 0.35) {
            state = energyRatio < 0.2 ? 'CRITICAL' : 'LOW';
        } else if (totalEnergy < capRef * 5) {
            state = 'LOW';
        } else if (totalEnergy >= capRef * 50) {
            state = 'SURPLUS';
        } else {
            state = 'NORMAL';
        }

        this.memory.energyReserve = Math.floor(capRef * 2);
        this.memory.energyState = state;
        this.memory.energyStateTick = Game.time;
        return state;
    }

    override getEnergyState() {
        return this.updateEnergyState(false);
    }

    override isDefending() {
        if ((this.memory as any).defend) return true;
        const until = (this.memory as any).defendUntil as number | undefined;
        return !!(until && until > Game.time);
    }

    override isResourceTransferInSafe() {
        //  判断“是否允许向该房间转入资源”应基于实际攻防态（defend/breached/冷却），而不是用 tower 数量当代理。
        if (!this.my) return false;
        if (!this.storage || !this.terminal) return false;
        if (this.level < 6) return false;
        const owner = this.controller?.owner?.username;
        if (owner && (this.storage.owner.username !== owner || this.terminal.owner.username !== owner)) return false;
        if (this.controller?.safeMode) return true;

        if (this.isDefending()) return false;
        if ((this.memory as any).breached) return false;

        const unsafeUntil = (this.memory as any).resourceUnsafeUntil as number | undefined;
        if (unsafeUntil && unsafeUntil > Game.time) return false;
        return true;
    }



}


function applyMixin(source: Function): void {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source.prototype))) {
        if (name === 'constructor') continue;
        Object.defineProperty(BaseFunction.prototype, name, descriptor);
    }
}

applyMixin(SourceFunction);
applyMixin(BodyFunction);
applyMixin(BoostFunction);
applyMixin(SecurityFunction);
applyMixin(ControllerBufferFunction);
