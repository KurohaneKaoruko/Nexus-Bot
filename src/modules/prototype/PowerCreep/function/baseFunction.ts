
import { inWhitelist } from '@/utils/whitelist';
import { getStructData } from '@/core/store/accessor';

export default class BaseFunction extends PowerCreep {
    getOpsTransferTarget(): StructureStorage | StructureTerminal | null {
        const storage = this.room!.storage!;
        if (storage && storage.store.getFreeCapacity(RESOURCE_OPS) > 0) return storage;

        const terminal = this.room!.terminal!;
        if (terminal && terminal.store.getFreeCapacity(RESOURCE_OPS) > 0) return terminal;

        return null;
    }

    override isWhiteList() {
        return inWhitelist(this.owner.username);
    }
    override PowerEnabled(): boolean {
        const controller = this.room?.controller;
        if(!controller!.isPowerEnabled) {
            if(this.pos.isNearTo(controller!)) this.enableRoom(controller!);
            else this.moveTo(controller!)
            return true;
        }
        return false
    }
    override transferOPS(): boolean {
        if (this.store.getFreeCapacity() === 0 && this.store[RESOURCE_OPS] > 200) {
            // 没有可存放多余 OPS 的容器时，必须跳过转存逻辑，把 tick 让给扩容等能力处理。
            const target = this.getOpsTransferTarget();
            if (!target) return false;

            const halfOps = Math.floor(this.store[RESOURCE_OPS] / 2);
            const free = target.store.getFreeCapacity(RESOURCE_OPS);
            const amount = Math.min(halfOps, this.store[RESOURCE_OPS] - 200, free);
            if (amount <= 0) return false;
            if (this.pos.isNearTo(target)) {
                const code = this.transfer(target, RESOURCE_OPS, amount);
                if (code === OK) return true;
                if (code === ERR_NOT_IN_RANGE) return true;
                return false;
            } else {
                this.moveTo(target);
            }
            return true;
        }
        if(this.ticksToLive! < 50 && this.store[RESOURCE_OPS] > 0) {
            const target = this.getOpsTransferTarget();
            if (!target) return false;

            if (this.pos.isNearTo(target)) {
                const code = this.transfer(target, RESOURCE_OPS);
                if (code === OK) return true;
                if (code === ERR_NOT_IN_RANGE) return true;
                return false;
            } else {
                this.moveTo(target);
            }
            return true;
        }
        return false;
    }
    override withdrawOPS(amount: number = 200): boolean {
        const storageOps = this.room?.storage?.store[RESOURCE_OPS] ?? 0;
        const terminalOps = this.room?.terminal?.store[RESOURCE_OPS] ?? 0;
        if(this.store[RESOURCE_OPS] < amount && (storageOps > amount || terminalOps > amount)) {
            const target = storageOps > amount ? this.room?.storage : this.room?.terminal;
            if(!target) return false;
            if(this.pos.isNearTo(target)) {
                this.withdraw(target, RESOURCE_OPS, amount - this.store[RESOURCE_OPS]);
            } else {
                this.moveTo(target);
            }
            return true;
        }
        return false
    }
    private tryRenewAt(target: StructurePowerSpawn | StructurePowerBank): boolean {
        if (!this.pos.isNearTo(target)) {
            this.moveTo(target);
            return true;
        }

        const result = this.renew(target);
        return result === OK || result === ERR_NOT_IN_RANGE;
    }
    override ToRenew(): boolean {
        if(this.ticksToLive! > 500) return false;
        const powerSpawn = this.room?.powerSpawn;
        if(this.room?.controller?.my && powerSpawn) {
            return this.tryRenewAt(powerSpawn);
        }
        if(!(/^[EW]\d*[1-9][NS]\d*[1-9]$/.test(this.room!.name!))) {
            const powerBank = this.room!.find! (FIND_STRUCTURES, {filter: (s) => s.structureType === STRUCTURE_POWER_BANK})[0]! as StructurePowerBank;
            if (powerBank) {
                return this.tryRenewAt(powerBank);
            }
        }
        if (Game.flags[this.name + '-renew']) {
            const flag = Game.flags[this.name + '-renew'];
            if(this.pos.roomName !== flag!.pos.roomName! || this.pos.isRoomEdge()) {
                this.moveTo(flag!);
                return true;
            } else if(this.room!.powerSpawn!) {
                return this.tryRenewAt(this.room!.powerSpawn!);
            }
        }
        return false;
    }
    override transferPower() {
        const mem = getStructData(this.room!.name!);
        if(!mem || !mem.powerSpawn) return false;

        const powerSpawn = this.room!.powerSpawn!;
        if (!powerSpawn) return false;
        const storage = this.room!.storage!;
        if (!storage) return false;
        if ((storage.store[RESOURCE_POWER] ?? 0) < 100) return false;
        if ((storage.store[RESOURCE_ENERGY] ?? 0) < 10000) return false;

        if (this.pos.isNearTo(powerSpawn)) {
            if (powerSpawn.store[RESOURCE_POWER] < 50 && this.store[RESOURCE_POWER] > 0) {
                this.transfer(powerSpawn, RESOURCE_POWER);
                return true;
            }
        }

        if (this.pos.isNearTo(storage)) {
            if (powerSpawn.store[RESOURCE_POWER] > 60 && this.store[RESOURCE_POWER] > 0) {
                this.transfer(storage, RESOURCE_POWER);
                return true;
            }
            if ((powerSpawn.store[RESOURCE_POWER] ?? 0) < 50 && (this.store[RESOURCE_POWER] ?? 0) == 0) {
                this.withdraw(storage, RESOURCE_POWER, 100);
                return true;
            }
        }
        return false;
    }
    override moveToRoom(roomName: string, opts: MoveToOpts = {}): boolean {
        if (!this.room || this.room!.name === roomName) return false;

        const route = Game.map.findRoute(this.room!.name, roomName, {
            routeCallback: (r: string) => {
                const status = Game.map.getRoomStatus(r);
                if (status.status !== 'normal') return Infinity;
                return 1;
            }
        });

        if (route === ERR_NO_PATH || route.length <= 0) {
            this.moveTo(new RoomPosition(25, 25, roomName), opts);
            return true;
        }

        const nextRoom = route[0]!.room!;
        const exitDir = this.room!.findExitTo(nextRoom);
        if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
            this.moveTo(new RoomPosition(25, 25, nextRoom), opts);
            return true;
        }

        const exitTiles = this.room!.find(exitDir as FindConstant);
        const exitPos = this.pos.findClosestByRange(exitTiles);
        if (!exitPos) return false;

        this.moveTo(exitPos, opts);
        return true;
    }
}
