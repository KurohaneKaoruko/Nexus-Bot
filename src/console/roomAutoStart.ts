
/**
 * 房间自动开局提供方（解耦倒置）：core 的 RoomRunner 在首个己方房间落地时
 * 需要「开局」能力，但开局流程属 console（人机指令层）——此处只定义接口与注册点，
 * 实现由组合根的 console 扩展注册，消除 core→console 反向依赖。
 */
import type { RoomModeName } from '@/modules/strategy/roomModeAccess';

export type RoomAutoStartConfig = {
    layout?: string;
    mode?: RoomModeName;
};

export type RoomAutoStartProvider = {
    /** 落地自启：按默认参数静默启动首个己方房间 */
    startFirstRoom: (roomName: string) => void;
    /** 按 RoomAutoStart 配置落地：add + mode + 布局构建 + 布局自动档 */
    applyAutoStart: (roomName: string, autoStart: RoomAutoStartConfig) => void;
};

let provider: RoomAutoStartProvider | null = null;

/** 组合根（console 扩展）注册实现；须先于首次 RoomRunner 运行 */
export const registerRoomAutoStartProvider = (p: RoomAutoStartProvider): void => {
    provider = p;
};

/** 未注册时返回 null（RoomRunner 跳过自动开局，行为等价于「无可开局动作」） */
export const getRoomAutoStartProvider = (): RoomAutoStartProvider | null => provider;

/**
 * 落地自启判定：
 * - 有效房间：已加入控制列表且属于自己的房间；
 * - 有效房间为 0 且拥有房间为 1 → 视为落地后的首个房间，自动按默认参数启动运行。
 *   （重生/重置后残留的控制列表条目因无视野无法确认归属，不计入有效房间，
 *     因此重生到新房间时同样会自动启动。）
 *
 * 判定实时计算（调用方少、成本低），不引入额外缓存。
 */
import { getRoomData } from '@/core/store/accessor';

export const shouldAutoStartFirstRoom = (): boolean => {
    let ownedCount = 0;
    for (const room of Object.values(Game.rooms)) {
        if (room && room.controller && room.controller.my) ownedCount++;
    }
    if (ownedCount !== 1) return false;

    let validCount = 0;
    for (const name of Object.keys(getRoomData())) {
        const room = Game.rooms[name];
        if (room && room.controller && room.controller.my) validCount++;
    }
    return validCount === 0;
};

/**
 * 落地首房的默认运行模式：
 * - 订阅档位（最大可用 CPU ≥ 100，Game.cpu.limit）→ 直接 `rush` 冲级，
 *   把订阅 CPU 的产能优势立刻兑现成升级速度；
 * - 免费档（limit 20）→ 维持 `main`。
 */
export const resolveFirstRoomMode = (): 'main' | 'rush' => {
    const limit = typeof Game.cpu?.limit === 'number' ? Game.cpu.limit : 0;
    return limit >= 100 ? 'rush' : 'main';
};
