
import { parseShardRoomName } from '@/utils/shardRoom';
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker';

/** 房间导航移动统一经 broker move 管线提交 (原生调用收编, api/17) */
const submitNavMove = (
    creep: Creep,
    target: { x: number; y: number; roomName: string },
    moveOpts: Record<string, any>
): ScreepsReturnCode => {
    const result = sharedBrokerForDirectCommands().executeNow({
        id: `nav-move:${creep.name}:${Game.time}:${Math.floor(creep.pos.x * 50 + creep.pos.y)}`,
        tick: Game.time,
        actorName: creep.name,
        kind: 'move',
        pipeline: 'move',
        priority: 40,
        targetPos: { x: target.x, y: target.y, roomName: target.roomName },
        payload: { moveOpts },
        dedupeKey: `nav-move:${creep.name}:${Game.time}`,
    });
    return (result.nativeReturnCode ?? (result.accepted ? OK : ERR_INVALID_ARGS)) as ScreepsReturnCode;
};

/** 单步方向移动经 broker 提交 (combatStep 执行器方向语义等价) */
const submitNavStep = (creep: Creep, direction: DirectionConstant): ScreepsReturnCode => {
    const result = sharedBrokerForDirectCommands().executeNow({
        id: `nav-step:${creep.name}:${Game.time}`,
        tick: Game.time,
        actorName: creep.name,
        kind: 'combatStep',
        pipeline: 'move',
        priority: 40,
        payload: { direction },
        dedupeKey: `nav-step:${creep.name}:${Game.time}`,
    });
    return (result.nativeReturnCode ?? (result.accepted ? OK : ERR_INVALID_ARGS)) as ScreepsReturnCode;
};

const isRoomEdgePosition = (pos: { x: number; y: number }): boolean => (
    pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
);

const toExitDirection = (exitDir: number): DirectionConstant | null => {
    switch (exitDir) {
        case FIND_EXIT_TOP:
            return TOP;
        case FIND_EXIT_RIGHT:
            return RIGHT;
        case FIND_EXIT_BOTTOM:
            return BOTTOM;
        case FIND_EXIT_LEFT:
            return LEFT;
        default:
            return null;
    }
};

const isOnExitEdge = (pos: { x: number; y: number }, direction: DirectionConstant): boolean => {
    switch (direction) {
        case TOP:
            return pos.y === 0;
        case RIGHT:
            return pos.x === 49;
        case BOTTOM:
            return pos.y === 49;
        case LEFT:
            return pos.x === 0;
        default:
            return false;
    }
};

export default class MoveFunction extends Creep {
    /**
     * 跨房移动到指定房间。
     * @param roomName 目标房间名，支持带 shard 前缀的房间名。
     * @param options 传给 `moveTo` 的移动参数。
     * @returns 移动结果；疲劳时返回 `ERR_TIRED`。
     */
    override moveToRoom(roomName: string, options: MoveToOpts & { bypassRange?: number } = {}): ScreepsReturnCode {
        if (this.fatigue > 0) return ERR_TIRED;

        const { full: fullRoomName, roomName: localRoomName, shard } = parseShardRoomName(roomName);
        const sameShard = !shard || shard === Game.shard.name;

        const DETOUR_WINDOW = 20;
        const COOLDOWN_TTL = 15;
        const currentRoom = this.pos.roomName;
        const exitDir = sameShard && currentRoom !== localRoomName
            ? this.room.findExitTo(localRoomName)
            : null;
        const exitDirection = exitDir === null ? null : toExitDirection(exitDir);

        const opts: any = options || {};
        if (opts.range === undefined) opts.range = 3;

        if (sameShard && this.room.name === localRoomName && this.handleRoomEdge()) {
            return OK;
        }

        if (sameShard && currentRoom !== localRoomName && isRoomEdgePosition(this.pos)) {
            if (exitDirection && isOnExitEdge(this.pos, exitDirection)) {
                return submitNavStep(this, exitDirection);
            }
            if (this.handleRoomEdge()) {
                return OK;
            }
        }

        let state = this.memory._moveToRoomState;
        if (!state || state.targetRoom !== fullRoomName) {
            state = this.memory._moveToRoomState = {
                targetRoom: fullRoomName,
                targetPos: null,
                lastRoom: currentRoom,
                leftTargetTick: 0,
                cooldownUntil: 0
            };
        }

        if (sameShard) {
            const lastRoom = state.lastRoom || currentRoom;
            if (lastRoom !== currentRoom) {
                if (lastRoom === localRoomName && currentRoom !== localRoomName) {
                    state.leftTargetTick = Game.time;
                }
                if (currentRoom === localRoomName && lastRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
                    state.cooldownUntil = Game.time + COOLDOWN_TTL;
                }
                state.lastRoom = currentRoom;
            }
        }

        let targetPos = state.targetPos as { x: number; y: number; roomName?: string } | null;
        if (sameShard) {
            const targetRoom = Game.rooms[localRoomName];
            const targetController = targetRoom?.controller;
            if (targetController) {
                const p = targetController.pos;
                if (!targetPos || targetPos.x !== p.x || targetPos.y !== p.y) {
                    targetPos = { x: p.x, y: p.y };
                    state.targetPos = targetPos;
                }
            }
        }
        if (!targetPos) {
            let seed = 0;
            const s = `${this.name}|${fullRoomName}`;
            for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
            const centerX = 25;
            const centerY = 25;
            const range = 10;
            const span = range * 2 + 1;
            const x = (seed % span) + (centerX - range);
            const y = (((seed >>> 8) % span) + (centerY - range));
            targetPos = { x, y };
            state.targetPos = targetPos;
        }

        if (sameShard && currentRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
            let exitPos = null;
            const bm: any = (globalThis as any).BetterMove;
            if (bm && typeof bm.getClosestExitPos === 'function') {
                exitPos = bm.getClosestExitPos(this.pos, localRoomName);
            } else {
                const dir = this.room.findExitTo(localRoomName);
                if (dir === FIND_EXIT_TOP || dir === FIND_EXIT_RIGHT || dir === FIND_EXIT_BOTTOM || dir === FIND_EXIT_LEFT) {
                    const exits = this.room.find(dir);
                    exitPos = exits.length ? this.pos.findClosestByRange(exits) : null;
                }
            }
            if (exitPos) {
                if (opts.maxRooms === undefined) opts.maxRooms = 1;
                return submitNavMove(this, exitPos, Object.assign({}, opts, { maxRooms: 1, range: 0 }));
            }
        }

        if (sameShard && currentRoom === localRoomName && state.cooldownUntil && Game.time < state.cooldownUntil && opts.maxRooms === undefined) {
            opts.maxRooms = 1;
        }

        if (sameShard) {
            const tarPos = new RoomPosition(targetPos.x, targetPos.y, localRoomName);
            return submitNavMove(this, tarPos, opts);
        }
        return submitNavMove(this, { x: targetPos.x, y: targetPos.y, roomName: fullRoomName }, opts);
    }

    /**
     * 移动到 `memory.home` 指定的固定工作房。
     * @returns `true` 表示已经到达，`false` 表示仍在路上。
     */
    override moveHomeRoom(): boolean {
        if(!this.memory.home) { return true; }
        const { roomName: localHome, shard } = parseShardRoomName(this.memory.home);
        if ((!shard || shard === Game.shard.name) && this.room.name === localHome) { return true; }
        this.moveToRoom(this.memory.home, { visualizePathStyle: { stroke: '#ff0000' } });
        return false;
    }


    /**
     * 处理房间边缘卡位，避免跨房移动时停在 0/49 边界。
     * @returns `true` 表示当前在边缘并已尝试挪开，`false` 表示不在边缘。
     */
    override handleRoomEdge(): boolean {
        const x = this.pos.x;
        const y = this.pos.y;
        // Screeps 在边界会把 creep 卡在 0/49，需要先向房间内部挪一步。
        if (x === 0 || x === 49 || y === 0 || y === 49) {
            let direction: DirectionConstant | undefined;
            
            if (x === 0) direction = RIGHT;
            else if (x === 49) direction = LEFT;
            else if (y === 0) direction = BOTTOM;
            else if (y === 49) direction = TOP;
            
            if (direction) {
                const code = submitNavStep(this as unknown as Creep, direction);
                if (code !== OK && code !== ERR_TIRED) {
                    submitNavMove(this, { x: 25, y: 25, roomName: this.room.name }, { maxRooms: 1, range: 20 });
                }
            }
            return true;
        }
        
        return false;
    }
}

