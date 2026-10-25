
import { isWarMode } from '@/core/store/accessor';
import { getStructData } from '@/core/store/accessor';
import { isRoomTickAligned } from '@/utils/roomPhase';
import { industryProduce } from '@/modules/industry/industryAdapter';
import { priorityFor } from '@/core/store/taskSchema';
import type { TaskBoard } from '@/modules/tasks';

/** 工厂生产: 冷却/战争/关停/等级失配门 + 原料检查 + 产出回灌任务 (原 FactoryWork 改写) */
export function factoryWork(room: Room, board?: TaskBoard): void {
    const factory = room.factory;
    // 工厂不存在时不处理
    if (!factory) return;
    // 冷却时不处理
    if (factory.cooldown != 0) return;
    if (isWarMode()) return;

    const memory = getStructData(room.name);
    // 关停时不处理
    if (!memory || !memory.factory) return;
    // 没有任务时不处理
    const product = memory.factoryProduct;
    if (!product) return;

    const info = (COMMODITIES as any)?.[product as any];
    const productLevel = Number(info?.level ?? 0);
    const flv = Number(factory.level || (memory as any).factoryLevel || 0);
    if (productLevel && productLevel !== flv) {
        (memory as any).factoryProduct = null;
        (memory as any).factoryAmount = 0;
        delete (memory as any).factoryWaitSince;
        return;
    }

    // 原料
    const components = COMMODITIES[product as CommodityConstant]?.components;
    // 原料不足时不处理
    if (!components || Object.keys(components).some((c: any) => (factory.store as any) [c] < (components as any) [c])) return;

    // 经命令边界同步执行: 原生调用权收编进 broker
    const result = industryProduce(factory, product as CommodityConstant);

    if (isRoomTickAligned(room.name, 100) || result != OK){
        if((factory.store[product] ?? 0) > 0 && room.storage && board) {
            // 产出回灌任务板 carry (同键幂等)
            board.upsert({
                dedupeKey: `carry:factory:${room.name}:${product}`,
                kind: 'carry',
                roomName: room.name,
                targetId: factory.id,
                targetPos: { x: factory.pos.x, y: factory.pos.y, roomName: room.name },
                destId: room.storage.id,
                destPos: { x: room.storage.pos.x, y: room.storage.pos.y, roomName: room.name },
                resourceType: product as ResourceConstant,
                amount: factory.store[product] ?? 0,
                priority: priorityFor('carry'),
                requiredCapabilities: ['carry', 'move'],
                deadline: Game.time + 300,
            }, Game.time);
        }
    }
}
