
import { getStructData } from '@/core/store/accessor';
import { isWarMode } from '@/core/store/accessor';

/** PowerSpawn 烧电: RCL8 + 开关 + 战争豁免 + 资源门槛 (原 PowerSpawnWork 原型方法改写) */
export function powerSpawnWork(room: Room): void {
    if (room.level < 8) return;
    const powerSpawn = room.powerSpawn;
    if (!powerSpawn) return;
    // 战争时不处理
    if (isWarMode()) return;
    const mem = getStructData(room.name);
    // 关停时不处理
    if(!mem?.powerSpawn) return;
    // 能量不足不处理
    const mode = mem?.powerSpawnMode ?? 'auto';
    if (mode === 'manual' && room.getResAmount(RESOURCE_ENERGY) < 50000) return;
    const store = powerSpawn.store;
    if((store[RESOURCE_ENERGY] ?? 0) < 50 || (store[RESOURCE_POWER] ?? 0) < 1) return;
    powerSpawn.processPower();
}
