
import { LabMap } from '@/constant/ResourceConstant'
import { compress } from '@/utils/compress';
import { ensureBoostLabs } from '@/modules/industry/labReservations';
import { BASE_CONFIG } from '@/constant/BaseConstant';
import { getAutoLabData, getRoomData, getStructData } from '@/core/store/accessor';

export default {
    lab: {
        // 开启lab
        open(roomName?: string) {
            if (!roomName) {
                let ok = 0;
                let skip = 0;
                for (const rn of Object.keys(getRoomData())) {
                    const room = Game.rooms[rn];
                    if (!room || !room.my) {
                        skip++;
                        continue;
                    }
                    const BotMemStructures = getStructData(rn) as any;
                    BotMemStructures['lab'] = true;
                    ok++;
                }
                globalThis.log(`已开启全部房间lab合成: 成功 ${ok}, 跳过 ${skip}`);
                return OK;
            }
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未添加。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            BotMemStructures['lab'] = true;
            globalThis.log(`[${roomName}] 已开启lab合成。`);
            return OK;
        },
        // 关闭lab
        stop(roomName?: string) {
            if (!roomName) {
                let ok = 0;
                let skip = 0;
                for (const rn of Object.keys(getRoomData())) {
                    const room = Game.rooms[rn];
                    if (!room || !room.my) {
                        skip++;
                        continue;
                    }
                    const BotMemStructures = getStructData(rn) as any;
                    BotMemStructures['lab'] = false;
                    ok++;
                }
                globalThis.log(`已关闭全部房间lab合成: 成功 ${ok}, 跳过 ${skip}`);
                return OK;
            }
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未添加。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            BotMemStructures['lab'] = false;
            globalThis.log(`[${roomName}] 已关闭lab合成。`);
            return OK;
        },
        // 设置lab合成底物
        set(roomName: string, product: string, amount: number = 0) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            const BotMemStructures = getStructData(roomName) as any;
            if (product) {
                if (!(LabMap as any) [product]) {
                    globalThis.log(`不存在Lab合成产物 ${product} 。`);
                    return;
                }
                let A = (LabMap as any)[product]?.raw1;
                let B = (LabMap as any)[product]?.raw2;
                BotMemStructures['labAtype'] = A;
                BotMemStructures['labBtype'] = B;
                BotMemStructures['labAmount'] = Math.max(0, amount);
                globalThis.log(`[${roomName}] 已设置lab合成底物为 ${A} 和 ${B}。`);
            }
            const labAflag = Game.flags[`labA`] || Game.flags[`lab-A`];
            const labBflag = Game.flags[`labB`] || Game.flags[`lab-B`];
            if(labAflag && labBflag && labAflag.pos.roomName === roomName && labBflag.pos.roomName === roomName) {
                const labA = labAflag.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_LAB) as StructureLab | undefined;
                const labB = labBflag.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_LAB) as StructureLab | undefined;
                if (!labA || !labB) {
                    globalThis.log(`[${roomName}] 未找到 labA/labB 旗帜所在位置的 Lab。`);
                } else {
                    BotMemStructures['labA'] = compress(labA.pos.x, labA.pos.y);
                    BotMemStructures['labB'] = compress(labB.pos.x, labB.pos.y);
                    globalThis.log(`[${roomName}] 已设置底物lab为 (${labA.pos.x},${labA.pos.y}) 和 (${labB.pos.x},${labB.pos.y})。`);
                }
                labAflag.remove();
                labBflag.remove();
            }
            BotMemStructures['lab'] = true;
            globalThis.log(`[${roomName}] 已开启lab合成。`);
            return OK;
        },
        setboost(roomName: string) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            // 手动长期征用：通过旗帜设置某个 lab 固定填充指定 boost 资源（mode: 'fixed'）
            const boostLabs = ensureBoostLabs(roomName);
            for(const id of Object.keys(boostLabs)) {
                const lab = Game.getObjectById(id) as StructureLab;
                if(!lab) delete boostLabs[id];
            }
            for(const flag of Game.rooms[roomName]!.find(FIND_FLAGS)) {
                const labsetMatch = flag.name.match(/^labset[-#/ ](\w+)(?:[-#/ ].*)?$/);
                if(!labsetMatch) continue;
                const lab = flag.pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === STRUCTURE_LAB);
                if (!lab) continue;
                const RES = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                let resourceType = (RES as Record<string, ResourceConstant>)[labsetMatch[1]!] || labsetMatch[1] as ResourceConstant;
                if (!resourceType || !(LabMap as any) [resourceType]) {
                    delete boostLabs[lab.id];
                    flag.remove();
                    console.log(`在房间 ${roomName} 删除了 lab(${lab.id}) 的强化资源设置`);
                    continue;
                }
                boostLabs[lab.id] = { mineral: resourceType, mode: 'fixed' };
                console.log(`在房间 ${roomName} 设置了 lab(${lab.id}) 的强化资源: ${resourceType}`);
                flag.remove();
            }
            return OK;
        },
        addboost(roomName: string, mineral: ResourceConstant, amount: number=3000) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            room.AssignBoostTask(mineral, amount);
            return OK;
        },
        removeboost(roomName: string, mineral: string) {
            const room = Game.rooms[roomName];
            if(!room || !room.my) {
                globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                return;
            }
            room.RemoveBoostTask(mineral);
            return OK;
        },
        auto: {
            set(roomName: string, product: string, amount: number=30000) {
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!(LabMap as any) [product]) {
                    globalThis.log(`资源 ${product} 不存在。`);
                    return;
                }
                const BotMem = getAutoLabData(roomName);
    
                amount = amount || 0;
                BotMem[product] = amount;
                globalThis.log(`已设置 ${roomName} 的自动lab合成: ${product} - ${amount}`);
                if (amount > 0) globalThis.log(`合成任务限额: ${amount}`);
                return OK;
            },
            remove(roomName: string, product?: string) {
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    globalThis.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!(LabMap as any)[product as string]) {
                    globalThis.log(`资源 ${product} 不存在。`);
                    return;
                }
                const BotMem = getAutoLabData(roomName);
    
                delete (BotMem as any)[product as string];
                globalThis.log(`已删去 ${roomName} 的自动lab合成: ${product}`);
                return OK;
            },
            list(listRoomName: string) {
                const BotMemAutoFactory = getAutoLabData();
                if(listRoomName) {
                    const autoLab = BotMemAutoFactory[listRoomName];
                    if(!autoLab || autoLab.length == 0) {
                        globalThis.log(`[${listRoomName}]没有开启自动lab合成`);
                    } else {
                        console.log(`[${listRoomName}]自动lab合成有: `);
                        for (const product in BotMemAutoFactory[listRoomName]) {
                            console.log(`\n    -${product} - ${autoLab[product]}`);
                        }
                    }
                    return OK;
                }

                if(!BotMemAutoFactory || Object.keys(BotMemAutoFactory).length == 0) {
                    globalThis.log(`没有房间开启自动lab合成`);
                }
                for(const memRoomName in BotMemAutoFactory) {
                    if(!BotMemAutoFactory[memRoomName] ||
                        BotMemAutoFactory[memRoomName].length == 0) {
                        continue;
                    }
                    console.log(`[${memRoomName}]自动lab合成有: `);
                    for (const product in BotMemAutoFactory[memRoomName]) {
                        console.log(`\n    -${product} - ${BotMemAutoFactory[memRoomName][product]}`);
                    }
                }
                return OK;
            }
        }
    }
}
