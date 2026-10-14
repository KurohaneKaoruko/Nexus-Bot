
import base from '@/console/base';
import diag from '@/console/function/diag';
import info from '@/console/function/info';
import room from '@/console/function/room';
import mine from '@/console/function/mine';
import layout from '@/console/function/layout';
import market from '@/console/function/market';
import resource from '@/console/function/resource';
import expand from '@/console/function/expand';
import spawn from '@/modules/industry/console/spawn';
import terminal from '@/modules/industry/console/terminal';
import lab from '@/modules/industry/console/lab';
import factory from '@/modules/industry/console/factory';
import powerSpawn from '@/modules/industry/console/powerspawn';
import nuker from '@/modules/industry/console/nuker';
import helps from '@/console/help'
import { registerRoomAutoStartProvider } from '@/console/roomAutoStart';
import { mountQoS } from '@/core/qos';
import { ensureEventApi } from '@/core/event';

// console 侧向 core 注入房间自动开局实现（消除 core→console 反向依赖）
registerRoomAutoStartProvider({
    startFirstRoom(roomName) {
        room.room.start(roomName, undefined, { quiet: true });
    },
    applyAutoStart(roomName, autoStart) {
        room.room.add(roomName, autoStart.layout);
        room.room.mode(roomName, autoStart.mode);
        layout.layout.build(roomName, autoStart.layout);
        layout.layout.auto(roomName, true);
    },
});

const plugins = [
    base,
    diag,
    info,
    room,
    layout,
    market,
    mine,
    resource,
    expand,
    lab,
    spawn,
    nuker,
    factory,
    terminal,
    powerSpawn,
]

/** 控制台命令拓展 */
export const ConsoleExtension = function () {
    plugins.forEach(plugin => _.assign(globalThis, plugin));
    mountQoS();          // 控制台人机入口保留 globalThis.qos（运行时消费已改模块 import）
    ensureEventApi();    // 控制台人机入口保留 globalThis.event
    helps.map(item => {
        if ((globalThis as any)[item.alias]) return;
        Object.defineProperty(globalThis, item.alias, { get: item.exec })
    })
}
