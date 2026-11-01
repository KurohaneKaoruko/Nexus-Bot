
/**
 * 清理模块
 */
import { clearRoomRelatedMemory, getMissionPools, getRoomData } from '@/core/store/accessor';
import { hasMarketOrderApi } from '@/utils/marketUtils';
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';
import { engineSpawningNames } from '@/modules/spawning/spawningRoster';

export const ClearModule = {
    end: () => {
        if(Game.time % 100 == 0) {
            // 全局 Memory 清理
            memoryClear();
            // 清除过期与已完成订单
            orderClear();
        }
        
    },
}

function  memoryClear() {
    // 孵化中名单白名单 (bugs/P0-16): spawnCreep 意图执行后 creep 下一 tick 才进
    // Game.creeps 快照, 清理窗口与孵化期重叠会把孵化单 memory 判为孤儿删除,
    // 造成出生即丢角色。孵化中的名字一律不清理 (判据统一走 spawningRoster, 6.3)。
    // 第二道: 本 bot 簿记的 units 名册 (spawn 受理即登记)——覆盖 sim shim
    // 当 tick 写 memory 但 spawning 未上快照的同 tick 窗口。
    const spawningNames = engineSpawningNames();
    const roster = (Memory as { Nexus?: { units?: Record<string, unknown> } }).Nexus?.units;
    if (roster) {
        for (const name of Object.keys(roster)) spawningNames.add(name);
    }
    // 清理不存在的 creeps 的 memory
    for (let name in Memory.creeps) {
        if (Game.creeps[name]) continue;
        if (spawningNames.has(name)) continue; // 孵化中/已受理不清理 (P0-16a)
        delete Memory.creeps[name];
    }
    // 清理不存在的 powerCreeps 的 memory
    for (let name in Memory.powerCreeps) {
        if (Game.powerCreeps[name]) continue;
        delete Memory.powerCreeps[name];
    }
    // 清理不存在的 flags 的 memory
    for (let name in Memory.flags) {
        if (Game.flags[name]) continue;
        delete Memory.flags[name];
    }
    // 清理无用的任务池memory
    const rooms = getRoomData();
    const pools = getMissionPools();
    for (let roomName in pools) {
        if (Game.rooms[roomName]?.my) continue; // 己方房池子不清理（托管表未必建全）
        if(rooms[roomName]) continue;
        delete pools[roomName];
    }
    // 清理已失去控制权但仍在控制列表里的房间
    for (const roomName of Object.keys(rooms)) {
        const room = Game.rooms[roomName];
        if (!room) continue;
        if (room.controller?.my) continue;
        clearRoomRelatedMemory(roomName);
        console.log(`[控制列表清理] 房间 ${roomName} 已不属于自己，已清理相关 Memory`);
    }
    // 清理长时间没视野的房间memory
    for (let roomName in Memory.rooms) {
        let room = Game.rooms[roomName];
        let Mem = Memory.rooms[roomName];
        if (room?.my) continue;
        if (room) { // 有视野但非己方：仅清计数
            if (!Mem! ['MemoryClearCount']) continue;
            delete (Mem as any)['MemoryClearCount'];
            continue;
        }
        Mem! ['MemoryClearCount'] = (Mem! ['MemoryClearCount']! || 0) + 1
        if (Mem! ['MemoryClearCount']! < 10) continue;
        delete Memory.rooms[roomName];
    }
    // creepNum / spawnMissionNum 采用按需统计
}

// 清理订单
function orderClear() {
    if (!hasMarketOrderApi()) return;

    const TIME_THRESHOLD = 50000; // 过期时间阈值
    const MAX_ORDERS = 250; // 最大允许订单数
    const TARGET_ORDERS = 50; // 清理到
    const CANCEL_LIMIT = 100;

    const orders = Object.values(Game.market.orders);
    const currentTime = Game.time;

    let needReduce = 0;
    if (orders.length > MAX_ORDERS) {
        needReduce = Math.max(0, orders.length - TARGET_ORDERS);
    }

    const ordersToDelete: string[] = [];
    const selected = new Set<string>();
    let completedCount = 0;
    let expiredCount = 0;
    let reduceCount = 0;

    for (const order of orders) {
        if (ordersToDelete.length >= CANCEL_LIMIT) break;
        if (selected.has(order.id)) continue;

        if (order.remainingAmount !== 0) continue;
        ordersToDelete.push(order.id);
        selected.add(order.id);
        completedCount++;
        if (needReduce > 0) needReduce--;
    }

    for (const order of orders) {
        if (ordersToDelete.length >= CANCEL_LIMIT) break;
        if (selected.has(order.id)) continue;

        const expired = (currentTime - order.created) > TIME_THRESHOLD;
        if (!expired) continue;

        ordersToDelete.push(order.id);
        selected.add(order.id);
        expiredCount++;
        if (needReduce > 0) needReduce--;
    }

    if (needReduce > 0 && ordersToDelete.length < CANCEL_LIMIT) {
        const sortedOrders = orders
            .filter((o) => !selected.has(o.id))
            .sort((a, b) => a.created - b.created);
        for (const order of sortedOrders) {
            if (ordersToDelete.length >= CANCEL_LIMIT) break;
            if (needReduce <= 0) break;

            ordersToDelete.push(order.id);
            selected.add(order.id);
            needReduce--;
            reduceCount++;
        }
    }

    if (ordersToDelete.length <= 0) return;

    for (const orderId of ordersToDelete) {
        // 经命令边界同步执行 (api/17 market 管线): 原生调用权收编进 broker
        sharedBrokerForDirectCommands().executeNow({
            id: `order-clear:${orderId}:${Game.time}`,
            tick: Game.time,
            actorName: "market-clear",
            kind: "cancelMarketOrder",
            pipeline: "market",
            priority: 30,
            payload: { orderId },
            dedupeKey: `order-clear:${orderId}:${Game.time}`,
        });
    }
    console.log(`已清理 ${ordersToDelete.length} 个订单（完成 ${completedCount}，超时 ${expiredCount}，压缩 ${reduceCount}）`);
}
