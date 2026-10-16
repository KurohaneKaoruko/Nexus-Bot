
import { isWarMode } from '@/core/store/accessor';
import { ensureLabAB, getLabAB } from '@/modules/industry/labReservations';
import { getStructData } from '@/core/store/accessor';
import { isRoomTickAligned } from '@/utils/roomPhase';
import { drawLabInfo } from '@/modules/visuals';

/** Lab 工作主入口: labAB 预留 + 可视化 + 战争豁免 + 反应 (原 LabWork 原型方法改写) */
export function labWork(room: Room): void {
    // 没有lab不处理
    if (!room.lab) return;

    ensureLabAB(room.name, room);

    // 可视化
    drawLabInfo(room.lab, room);

    if (isWarMode()) return;

    // 反应
    runLabReaction(room);
}

/** 反应执行 (每 5 tick 相位错峰, 原节奏位置 t%5==1) */
function runLabReaction(room: Room): void {
    // 每 5 tick 执行一次（叠加房间相位错峰，原节奏位置 t%5==1）
    if (!isRoomTickAligned(room.name, 5, 4)) return;
    // lab数量不足时不处理
    if (!room.lab || room.lab.length < 3) return;
    if (room.memory.defend) return;
    // lab关停时不合成
    const memory = getStructData(room.name);
    if (!memory || !memory.lab) return;
    // 读取 A/B（只读）；若未配置且未通过 labWork 的 ensure 修正，这里将直接返回空
    const { labA, labB, labAId, labBId } = getLabAB(room.name, room);
    if (!labA || !labB || !labAId || !labBId) return;

    const labAtype = memory.labAtype ;
    const labBtype = memory.labBtype;
    // 没有设置底物类型时不合成
    if (!labAtype || !labBtype) return;

    // 检查labA和labB是否有足够的资源
    if (labA.store[labAtype] < 5 || labB.store[labBtype] < 5) {
        return;
    }

    // 合成产物
    const labProduct = (REACTIONS[labAtype] as any) [labBtype]! as ResourceConstant;
    // 底物lab不存在时不合成
    if (!RESOURCES_ALL.includes(labProduct)) return;

    const boostLabs = memory.boostLabs;

    // 遍历其他lab进行合成
    for (let lab of room.lab) {
        if (lab.cooldown || !lab) continue;
        if (lab.id === labAId || lab.id === labBId) continue;
        // 如果有boost设置（被征用），则跳过
        if (boostLabs && boostLabs[lab.id]) continue;
        // 检查lab中是否存在与合成产物不同的资源
        if (lab.mineralType &&
            lab.mineralType !== labProduct) {
            continue; // 如果存在不同的资源，跳过这个lab
        }
        // 检查lab是否已满
        if (lab.store.getFreeCapacity(labProduct) === 0) {
            continue; // 如果lab已满，跳过这个lab
        }

        // 进行合成
        lab.runReaction(labA, labB);
    }
}
