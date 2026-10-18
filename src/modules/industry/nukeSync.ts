
import { qos } from '@/core/qos';
import { getNukerData } from "@/core/store/accessor";
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';

/**
 * 核弹请求同步模块。
 *
 * @remarks
 * 本模块不直接发射核弹，而是把内存中的请求转换为旗帜任务：
 * - 处理过期请求；
 * - 创建/更新目标旗帜；
 * - 清理无法追踪的失效请求。
 */
export const NukeModule = {
    /**
     * 轮询并同步核弹请求。
     */
    tick: function () {
        // 仅在资源允许时执行，避免在低 bucket 下影响主循环。
        if (!qos.shouldRun({ every: 10, minBucket: 2000, allowLevels: ['normal', 'constrained'] })) return;

        const nukerData = getNukerData();
        if ((nukerData.requests ?? []).length === 0) return;

        const now = Game.time;
        // 清理 TTL 过期请求。
        nukerData.requests = nukerData.requests!.filter! (req => now - req.createdTick <= req.ttl);
        if (nukerData.requests.length === 0) return;

        for (const req of nukerData.requests) {
            // 旗帜名用于承载请求信息，缺失时生成稳定默认名。
            const flagName = req.flagName || `nuke-${Math.max(1, req.amount || 1)}-${req.id}`;
            req.flagName = flagName;

            const existing = Game.flags[flagName];
            if (existing) {
                // 已存在旗帜时只做内容更新，避免重复创建。
                existing.memory['amount'] = Math.max(1, req.amount || 1);
                if (Array.isArray(req.rooms) && req.rooms.length > 0) existing.memory['rooms'] = req.rooms;
                existing.memory['requestId'] = req.id;
                continue;
            }

            const room = Game.rooms[req.roomName];
            if (!room) continue;

            // 经命令边界同步执行 (flag 管线): 原生调用权收编进 broker
            const createdResult = sharedBrokerForDirectCommands().executeNow({
                id: `nuke-flag:${flagName}:${now}`,
                tick: now,
                actorName: req.roomName,
                kind: "createFlag",
                pipeline: "flag",
                priority: 50,
                targetPos: { x: req.x, y: req.y, roomName: req.roomName },
                payload: { flagName },
                dedupeKey: `nuke-flag:${flagName}:${now}`,
            });
            if (createdResult.accepted) {
                const flag = Game.flags[flagName];
                if (!flag) continue;
                flag.memory['amount'] = Math.max(1, req.amount || 1);
                if (Array.isArray(req.rooms) && req.rooms.length > 0) flag.memory['rooms'] = req.rooms;
                flag.memory['requestId'] = req.id;
            } else {
                // 记录最近一次失败码，供上层可观测。
                const created = createdResult.nativeReturnCode ?? ERR_INVALID_ARGS;
                req.lastError = created;
                req.lastErrorTick = now;
            }
        }

        // 清理指向不存在旗帜的请求，避免内存堆积。
        nukerData.requests = nukerData.requests.filter(req => {
            if (!req.flagName) return true;
            return !!Game.flags[req.flagName];
        });
    }
};
