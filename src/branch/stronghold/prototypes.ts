import mountCreep from "@/proto/Creep";
import mountRoom from "@/proto/Room";
import mountRoomPosition from "@/proto/RoomPosition";
import "@/core/structureCache";

let mounted = false;

/**
 * 挂载编队战斗依赖的原型扩展:
 * Creep 行为/缓存、Room 索敌与任务接口、RoomPosition 跨房与安全点判定,
 * 以及 room.tower / room.level / room.my 等结构缓存访问器。
 */
export function mountStrongholdPrototypes(): void {
    if (mounted) return;
    mountCreep();
    mountRoom();
    mountRoomPosition();
    mounted = true;
}
