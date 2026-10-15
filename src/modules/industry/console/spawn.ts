
import { UNITS, UnitData } from '@/constant/CreepConstant';

export default {
    spawn: {
        creep(roomName: string, bodypart: string, unit: string, memory?: any) {
            if (!roomName || !unit) return -1;
            if (!(UnitData as any) [unit]) return -1;
            const room = Game.rooms[roomName];
            if(!memory) memory = {};
            if (!memory.home && !memory.homeRoom && !memory.sourceRoom) memory.home = roomName;
            room!.SpawnMissionAdd('', bodypart, -1, unit, _.cloneDeep(memory));
            console.log(`[${roomName}] 即将孵化 ${unit}, 体型: ${JSON.stringify(bodypart)} \n memory: ${JSON.stringify(memory)}`);
            return 0;
        },
        unit(roomName: string, unit: string, memory?: any, num?: number) {
            if (!roomName || !unit) return -1;
            if (!(UnitData as any) [unit]) return -1;
            if (!num) num = 1;
            const room = Game.rooms[roomName];
            if(!memory) memory = {};
            if (!memory.home && !memory.homeRoom && !memory.sourceRoom) memory.home = roomName;
            for (let i = 0; i < num; i++) {
                room!.SpawnMissionAdd('', '', -1, unit, _.cloneDeep(memory));
            }
            console.log(`[${roomName}] 即将孵化 ${unit}, 数量: ${num} \n memory: ${JSON.stringify(memory)}`);
            return 0;
        },
        sign(roomName: string, targetRoom: string, sign: string) {
            const room = Game.rooms[roomName];
            room!.SpawnMissionAdd('', '', 0, UNITS.scout, { homeRoom: roomName, targetRoom: targetRoom, sign: sign } as any);
            console.log(`[${roomName}] 即将孵化scout到${targetRoom}进行签名。签名内容: ${sign}`);
            return 0;
        },
        stomp(roomName: string, targetRoom: string, num: number = 1) {
            const room = Game.rooms[roomName];
            for (let i = 0; i < num; i++) {
                room!.SpawnMissionAdd('', '', 0, UNITS.scout, {
                    homeRoom: roomName,
                    targetRoom,
                    stompSite: true
                } as any);
            }
            console.log(`[${roomName}] 即将孵化 ${num} 个 scout 前往 ${targetRoom} 踩工地。`);
            return 0;
        },
    }
}
