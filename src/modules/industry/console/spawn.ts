
import { UNITS, UnitData } from '@/constant/CreepConstant';
import { directSpawn } from '@/modules/spawning/spawnDirector';
import { decompressBodyConfig } from '@/utils/compress';

export default {
    spawn: {
        creep(roomName: string, bodypart: string, unit: string, memory?: any) {
            if (!roomName || !unit) return -1;
            if (!(UnitData as any) [unit]) return -1;
            const room = Game.rooms[roomName];
            if(!memory) memory = {};
            if (!memory.home && !memory.homeRoom && !memory.sourceRoom) memory.home = roomName;
            const ret = directSpawn(room!, { mode: 'direct', unit, body: decompressBodyConfig(bodypart) as any, memory: _.cloneDeep(memory) });
            if (ret !== 0) console.log(`[${roomName}] 孵化失败: 返回码 ${ret}`);
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
                directSpawn(room!, { mode: 'direct', unit, memory: _.cloneDeep(memory) });
            }
            console.log(`[${roomName}] 即将孵化 ${unit}, 数量: ${num} \n memory: ${JSON.stringify(memory)}`);
            return 0;
        },
        sign(roomName: string, targetRoom: string, sign: string) {
            const room = Game.rooms[roomName];
            directSpawn(room!, { mode: 'direct', unit: UNITS.scout, memory: { homeRoom: roomName, targetRoom: targetRoom, sign: sign } as any });
            console.log(`[${roomName}] 即将孵化scout到${targetRoom}进行签名。签名内容: ${sign}`);
            return 0;
        },
        stomp(roomName: string, targetRoom: string, num: number = 1) {
            const room = Game.rooms[roomName];
            for (let i = 0; i < num; i++) {
                directSpawn(room!, { mode: 'direct', unit: UNITS.scout, memory: {
                    homeRoom: roomName,
                    targetRoom,
                    stompSite: true
                } as any });
            }
            console.log(`[${roomName}] 即将孵化 ${num} 个 scout 前往 ${targetRoom} 踩工地。`);
            return 0;
        },
    }
}
