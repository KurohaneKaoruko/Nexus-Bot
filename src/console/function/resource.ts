
import { getResourceManage } from '@/core/store/accessor';
import { BASE_CONFIG } from '@/constant/BaseConstant';
import { createTaskBoard } from '@/modules/tasks';

/**
 * 资源控制台命令：
 * - `resource.manage`：维护供需阈值；
 * - `resource.transport`：手动下发运输任务。
 */
export default {
    resource: {
        manage: {
            /**
             * 设置房间资源阈值。
             */
            set(roomName: string, resource: string, data: { source: number, target: number }) {
                const RESOURCE_ABBREVIATIONS = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource;
                const source = data.source ?? Infinity;
                const target = data.target ?? 0;
                const mem = getResourceManage(roomName) as any;
                mem[resource] = [target, source];
                globalThis.log(`[资源管理] 已设置房间 ${roomName} 的 ${resource} 供应阈值为 ${source}  需求阈值为 ${target}`);
                return OK;
            },
            /**
             * 删除单个资源阈值设置。
             */
            remove(roomName: string, resource: string) {
                const RESOURCE_ABBREVIATIONS = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource;
                const mem = getResourceManage(roomName) as any;
                if (mem[resource]) {
                    delete mem[resource];
                    globalThis.log(`[资源管理] 已移除房间 ${roomName} 的 ${resource} 供需设置`);
                }
                return OK;
            },
            /**
             * 清空房间所有资源阈值设置。
             */
            clear(roomName: string) {
                const mem = getResourceManage();
                delete mem[roomName];
                globalThis.log(`[资源管理] 已清空房间 ${roomName} 的资源管理设置`);
                return OK;
            },
            show: {
                /**
                 * 输出全部房间资源阈值。
                 */
                all() {
                    const botmem = getResourceManage();
                    for (const roomName in botmem) {
                        console.log(`房间${roomName}:`);
                        for (const res in botmem[roomName]) {
                            console.log(`   -资源${res}:`);
                            console.log(`      -供应阈值: ${(botmem[roomName] as any)[res] ?? Infinity}`);
                            console.log(`      -需求阈值: ${(botmem[roomName] as any)[res] ?? 0}`);
                        }
                    }
                    return OK;
                },
                /**
                 * 输出指定房间资源阈值。
                 */
                room(roomName: string): number | Error | void {
                    if (!roomName) return Error('必须指定房间');
                    const botmem = getResourceManage();
                    if (!botmem[roomName]) return Error('该房间没有资源管理设置');
                    for (const res in botmem[roomName]) {
                        console.log(`资源${res}:`);
                        console.log(`   -供应阈值: ${(botmem[roomName] as any)[res] ?? Infinity}`);
                        console.log(`   -需求阈值: ${(botmem[roomName] as any)[res] ?? 0}`);
                    }
                },
                /**
                 * 输出指定资源在全部房间中的阈值设置。
                 */
                res(res: string) {
                    if (!res) return Error('必须指定资源');
                    const RESOURCE_ABBREVIATIONS = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                    res = RESOURCE_ABBREVIATIONS[res] || res;
                    const botmem = getResourceManage();
                    for (const roomName in botmem) {
                        if ((botmem[roomName] as any)[res]) {
                            console.log(`房间${roomName} 资源${res}:`);
                            console.log(`   -供应阈值: ${(botmem[roomName] as any)[res] ?? Infinity}`);
                            console.log(`   -需求阈值: ${(botmem[roomName] as any)[res] ?? 0}`);
                        }
                    }
                    return OK;
                }
            }
        },
        transport: {
            /**
             * 手动创建一次运输任务。
             */
            task(roomName: string, source: string, target: string, resource: string, amount: number) {
                const RESOURCE_ABBREVIATIONS = BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource
                const room = Game.rooms[roomName];
                if (!room) return Error('房间不存在');
                let sourceId = null;
                let targetId = null;
                if (source == 'storage') sourceId = room.storage!.id!;
                else if (source == 'terminal') sourceId = room.terminal!.id!;
                else if (source == 'factory') sourceId = room.factory!.id!;
                if (target == 'storage') targetId = room.storage!.id!;
                else if (target == 'terminal') targetId = room.terminal!.id!;
                else if (target == 'factory') targetId = room.factory!.id!;

                if (!sourceId || !targetId) return Error('源或目标不存在');
                if (sourceId == targetId) return Error('源和目标不能相同');

                // 任务板 carry 人操单 (原 transport 池单, 域 3.4 收口):
                // 同键幂等, 矿物方向待矿物执行分支 (摸底档 N 节)
                const srcObj = Game.getObjectById(sourceId);
                const dstObj = Game.getObjectById(targetId);
                if (!srcObj || !dstObj) return Error('源或目标不可见');
                const board = createTaskBoard((Memory as any).Nexus?.tasks ?? {});
                board.upsert({
                    dedupeKey: `carry:manual:${roomName}:${sourceId}:${targetId}:${resource}`,
                    kind: 'carry',
                    roomName,
                    targetId: sourceId,
                    targetPos: { x: srcObj.pos.x, y: srcObj.pos.y, roomName },
                    destId: targetId,
                    destPos: { x: dstObj.pos.x, y: dstObj.pos.y, roomName },
                    resourceType: resource as ResourceConstant,
                    amount,
                    priority: 4,
                    requiredCapabilities: ['carry', 'move'],
                    deadline: Game.time + 600,
                }, Game.time);
                return OK;
            }
        }
    }
};
