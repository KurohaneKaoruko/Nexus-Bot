import type { TickModule } from "@/core";
import { getTeamData } from "@/core/store/accessor";
import { STRONGHOLD_ANCHOR } from "../config";

/**
 * 指挥旗自动落位: 队伍进入目标房后, 把 `Team-xxxx` 旗移到建筑群外沿的开阔安全点。
 *
 * @remarks
 * 安全点 = 阻挡建筑外沿 1 格内、自身无阻挡、正交方向阻挡数 < 2 的格子。\n
 * 多队锚点保持最小间距, 已有安全旗位不动; 建筑群被拆后自动向更深处重选。
 */
export const StrongholdAnchor: TickModule = {
    name: "stronghold-anchor",
    phase: "commit",
    band: "P3",
    run(): void {
        runAnchor();
    },
};

/** 同 tick 安全点缓存 (key = roomName) */
let spotCacheTick = -1;
const spotCache: Record<string, Set<number>> = {};

function isBlockingStructure(structure: Structure): boolean {
    if (structure.structureType === STRUCTURE_ROAD) return false;
    if (structure.structureType === STRUCTURE_RAMPART) {
        return !(structure as StructureRampart).my;
    }
    return true;
}

function indexOf(x: number, y: number): number {
    return y * STRONGHOLD_ANCHOR.roomSize + x;
}

/** 计算房间建筑群外沿的安全点集合 (坐标按 y * roomSize + x 编码) */
function collectSpots(room: Room): Set<number> {
    const size = STRONGHOLD_ANCHOR.roomSize;
    const margin = STRONGHOLD_ANCHOR.edgeMargin;
    const blocked = new Uint8Array(size * size);
    const near = new Uint8Array(size * size);

    for (const structure of room.find(FIND_STRUCTURES)) {
        if (!isBlockingStructure(structure)) continue;
        blocked[indexOf(structure.pos.x, structure.pos.y)] = 1;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const x = structure.pos.x + dx;
                const y = structure.pos.y + dy;
                if (x < margin || x > size - 1 - margin || y < margin || y > size - 1 - margin) continue;
                near[indexOf(x, y)]! += 1;
            }
        }
    }

    const spots = new Set<number>();
    for (let y = margin; y <= size - 1 - margin; y += 1) {
        for (let x = margin; x <= size - 1 - margin; x += 1) {
            const index = indexOf(x, y);
            if (blocked[index] || !near[index]) continue;
            const orthogonal =
                blocked[index - size]! +
                blocked[index + size]! +
                blocked[index - 1]! +
                blocked[index + 1]!;
            if (orthogonal >= 2) continue;
            spots.add(index);
        }
    }

    return spots;
}

function getSpots(room: Room): Set<number> {
    if (spotCacheTick !== Game.time) {
        spotCacheTick = Game.time;
        for (const key in spotCache) delete spotCache[key];
    }
    return (spotCache[room.name] ??= collectSpots(room));
}

/** 在互斥约束下选离参照点最近的安全点 */
function pickSpot(
    spots: Set<number>,
    taken: ReadonlyArray<{ x: number; y: number }>,
    from: RoomPosition,
): { x: number; y: number } | undefined {
    const size = STRONGHOLD_ANCHOR.roomSize;
    const minSpacing = STRONGHOLD_ANCHOR.minSpacing;
    let best: { x: number; y: number } | undefined;
    let bestDistance = Infinity;

    for (const index of spots) {
        const x = index % size;
        const y = Math.floor(index / size);
        if (
            taken.some(
                (spot) =>
                    Math.max(Math.abs(spot.x - x), Math.abs(spot.y - y)) < minSpacing,
            )
        ) {
            continue;
        }
        const distance = Math.max(Math.abs(from.x - x), Math.abs(from.y - y));
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { x, y };
        }
    }

    return best;
}

function runAnchor(): void {
    if (Game.time % STRONGHOLD_ANCHOR.interval) return;

    const teams = getTeamData();
    if (!teams) return;

    const taken: { x: number; y: number }[] = [];
    const pending: { flag: Flag; room: Room }[] = [];

    for (const teamID in teams) {
        const team = teams[teamID];
        if (!team?.targetRoom || team.status === "ready") continue;
        if (team.roomName !== team.targetRoom) continue;

        const flag = Game.flags[`Team-${teamID}`];
        if (!flag || flag.pos.roomName !== team.targetRoom) continue;

        const room = Game.rooms[team.targetRoom];
        if (!room) continue;

        if (getSpots(room).has(indexOf(flag.pos.x, flag.pos.y))) {
            taken.push({ x: flag.pos.x, y: flag.pos.y });
            continue;
        }
        pending.push({ flag, room });
    }

    for (const { flag, room } of pending) {
        const spot = pickSpot(getSpots(room), taken, flag.pos);
        if (!spot) continue;
        flag.setPosition(new RoomPosition(spot.x, spot.y, room.name));
        taken.push(spot);
    }
}
