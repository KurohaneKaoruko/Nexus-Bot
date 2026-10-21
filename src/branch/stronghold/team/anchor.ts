import type { TickModule } from "@/core";
import { getBotMemory, getTeamData } from "@/core/store/accessor";
import { STRONGHOLD_ANCHOR, STRONGHOLD_BLITZ } from "../config";

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
            for (let dx = -1; dx <= 2; dx += 1) {
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

    const blitzState = ((getBotMemory() as any).BlitzState ??= {});

    // 按配置分桶 (排序保证每 tick 索引稳定, 站位不会来回跳)
    let rangedCount = 0;   // 集结区就位数 (开波判定)
    let rangedInRoom = 0;  // 已在目标房的球 (收束判定)
    const guardIDs: string[] = [];
    const rangedIDs: string[] = [];
    // 目标房只认 BLITZ 旗: 队伍旗在集结期会被挪回孵化房门口 (否则没盾队时球在塔火里等死),
    // 那会把 team.targetRoom 改写成孵化房, 用队伍数据反查目标房会把整盘算错
    const targetRoom = Game.flags.BLITZ?.pos.roomName;
    if (!targetRoom) return;
    for (const teamID in teams) {
        const team = teams[teamID];
        if (!team?.targetRoom) continue;
        if (team.configKey === STRONGHOLD_BLITZ.guardConfig) {
            guardIDs.push(teamID);
        } else if (team.configKey === STRONGHOLD_BLITZ.rangedConfig) {
            rangedIDs.push(teamID);
            // 只数"能按时到场"的球: 已在目标房集结区, 或已到家房出口 8 格内
            const scout = firstCreep(team);
            if (scout && scout.pos.roomName === targetRoom) rangedInRoom += 1;
            if (rangedInPosition(team, targetRoom)) rangedCount += team.creeps?.length ?? 0;
        }
    }
    guardIDs.sort();
    rangedIDs.sort();

    const liveRoom = targetRoom ? Game.rooms[targetRoom] : undefined;
    const box = liveRoom ? hostileBox(liveRoom) : undefined;
    // 塔清完 → 进"打核心"阶段: 塔没了不用盾队占角吸火, 四个角位让给球
    // (核心只有这四个角落在射程 3 内, 是拆核心的唯一落脚点)
    const corePhase = !!liveRoom && hostileTowers(liveRoom).length === 0;

    // 总攻锁带收束: 球够数才开, 掉到收束阈值以下关锁回集结
    // (否则新球一出生就单只裸冲, 塔一轮齐射就没了)。
    // 塔已清完 = 进入拆核心阶段, 不再收束 (退了就白送, 剩下的球够磨核心)
    // 收束只看"目标房里还有多少球在打": 推进中的球会离开集结区 (不能用集结区计数),
    // 而在门口等下一轮的球也不算 (否则它们撑住计数, 总攻永不结束, 房内只剩空转)
    if (!corePhase && blitzState.waveOpen && rangedInRoom < STRONGHOLD_BLITZ.rangedRetreatCount) {
        blitzState.waveOpen = false;
    }
    if (!blitzState.waveOpen && rangedCount >= STRONGHOLD_BLITZ.rangedPushCount) {
        blitzState.waveOpen = true;
    }

    // 盾队: 集结期钉耗能位抽能量; 总攻期占建筑群四角 (离塔 2 格, 比任何球都近,
    // 塔的"打最近"选择会把火全压在盾队身上, 球才能在环外安全输出)
    // 盾队未满员: 旗钉孵化房靠目标房的出口侧, 聚齐了再顶上去。
    // 逐只到场 = 每只独自吃满塔火+守军, 实测两只先到就再也没回来
    const tankOnPost = guardIDs.some((id) => {
        const t = teams[id];
        return !!t && (t.creeps?.length ?? 0) >= (t.num ?? 0) && t.roomName === targetRoom;
    });

    for (let index = 0; index < guardIDs.length; index += 1) {
        const team = teams[guardIDs[index]!];
        const flag = Game.flags[`Team-${guardIDs[index]}`];
        if (!team?.targetRoom || !flag || !targetRoom) continue;
        // 缺员: 退回 ready 让框架把 (含补孵在途的) 成员收拢到家房门口,
        // 齐了再整队上。不这样, 补孵的新成员会单只横穿要塞房被塔按"最近目标"点杀
        if ((team.creeps?.length ?? 0) < (team.num ?? 0)) {
            // 缺员 = 没有奶量支撑, 绝不能站在目标房里等补孵:
            // 塔按"最近目标"单发点名, 半队成员会在补孵到位前被一只只点掉
            team.status = 'ready';
            setFlagRush(flag, false);
            const door = gatherPoint(team.homeRoom, targetRoom);
            if (door && !flag.pos.isEqualTo(door)) flag.setPosition(door);
            continue;
        }
        if (blitzState.waveOpen && liveRoom && box) {
            // 总攻: rush 模式 (残血也不退)
            setFlagRush(flag, true);
            if (corePhase) {
                // 塔清完: 退到包围环外挡守军, 四角让给球打核心
                pinGuardPost(flag, liveRoom, box, index);
            } else {
                // 塔还在: 盾队继续守耗能位。占角只有 2 格近塔位, 塔+守军一轮就清光,
                // 盾队死了蓝球集结区立刻暴露, 变成"送光-重建-再送"的死循环
                pinGuardTank(flag, targetRoom, team.homeRoom, false, index);
            }
            continue;
        }
        setFlagRush(flag, false);
        pinGuardTank(flag, targetRoom, team.homeRoom, false, index);
    }

    // 蓝球: 集结期钉靠家侧远围 (盾队在耗能位挡着, 塔打最近够不到这里);
    // 总攻期按扇区轮转铺到包围环, 四面的塔各自被就近的球咬住
    const assault: { flag: Flag; team: any }[] = [];
    const staging: { flag: Flag; team: any }[] = [];
    const retreat: { flag: Flag; team: any }[] = [];
    for (const teamID of rangedIDs) {
        const team = teams[teamID];
        const flag = Game.flags[`Team-${teamID}`];
        if (!flag || !team?.targetRoom) continue;
        if (!blitzState.waveOpen || !liveRoom || !box) {
            // 集结期: 禁火 + 钉集结点。不禁火的话索敌会把推进点拉到最近的塔上,
            // 球会一只只提前走进塔火 (实测 18 格外的球被勾到 9 格打死)
            team.holdFire = true;
            team.anchorLock = false;
            team.structurePriority = undefined;
            (team.cache ??= {}).forceStructure = false;
            setFlagRush(flag, false);
            if (tankOnPost || !targetRoom) {
                staging.push({ flag, team });
            } else {
                // 盾队不在耗能位: 塔会把远围的球当最近目标点掉, 先撤回孵化房门口等。
                // (旗跨房会改写球队 targetRoom, 所以只在这种"反正打不了"的时候用)
                retreat.push({ flag, team });
            }
            continue;
        }
        const mover = firstCreep(team);
        if (mover && mover.pos.roomName !== targetRoom) {
            // 总攻期间才孵化出来的球: 留在门口等下一轮, 跟着冲只会多送一只
            team.holdFire = true;
            team.anchorLock = false;
            retreat.push({ flag, team });
            continue;
        }
        // 总攻期: 推进点锚定扇区旗位 (不追目标), 火力优先拆塔;
        // forceStructure: 塔在射程内就不打守军——守军 25k 血会吃掉整轮输出窗口
        team.holdFire = false;
        team.anchorLock = true;
        team.structurePriority = STRUCTURE_TOWER;
        (team.cache ??= {}).forceStructure = !corePhase;
        // 总攻期死战不退: 残血球一 flee 就白送整轮输出窗口 (塔 3 格内每发 600)
        setFlagRush(flag, true);
        assault.push({ flag, team });
    }
    if (assault.length && liveRoom && box) pinRangedAssault(assault, liveRoom, box, corePhase);
    if (retreat.length) {
        // 撤退也要分格: 全挤在一格会互相顶位, 一半卡在门口进不去/出不来
        const door = gatherPoint(retreat[0]!.team.homeRoom ?? "", targetRoom);
        if (door) pinStagingSlots(retreat, { x: door.x, y: door.y }, door.roomName);
    }
    if (staging.length && targetRoom) {
        // 集结位 = 目标房靠家侧边缘内 2 格 (与 pinRangedStaging 同口径), 再铺成网格
        const theory = staging[0]!.flag.pos;
        const here = parseRoomXY(targetRoom);
        const home = parseRoomXY(staging[0]!.team.homeRoom ?? "");
        let bx = theory.x;
        let by = theory.y;
        if (here && home) {
            bx = here.x > home.x ? 2 : here.x < home.x ? 47 : 25;
            by = here.y > home.y ? 2 : here.y < home.y ? 47 : 25;
        }
        pinStagingSlots(staging, { x: bx, y: by }, targetRoom);
    }

    // 其它配置的建队走通用落位 (安全点相邻阻挡 < 2)
    const taken: { x: number; y: number }[] = [];
    const pending: { flag: Flag; room: Room }[] = [];
    for (const teamID in teams) {
        const team = teams[teamID];
        if (!team?.targetRoom) continue;
        if (team.configKey === STRONGHOLD_BLITZ.guardConfig) continue;
        if (team.configKey === STRONGHOLD_BLITZ.rangedConfig) continue;
        if (team.status === "ready") continue;
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

/** 总攻包围环站位: 建筑群外沿一圈, 按"西→北→南→东"轮转交织输出,
 * 保证前几只球就散到四面 —— 全挤在朝家一侧会被 6 塔集火点杀。 */
function attackSlots(room: Room, box: { minX: number; maxX: number; minY: number; maxY: number }): RoomPosition[] {
    const west: { x: number; y: number }[] = [];
    const north: { x: number; y: number }[] = [];
    const south: { x: number; y: number }[] = [];
    const east: { x: number; y: number }[] = [];
    const x0 = box.minX - 1;
    const x1 = box.maxX + 1;
    const y0 = box.minY - 1;
    const y1 = box.maxY + 1;
    // 西侧两排: 守军 (5 只 44r) 全在西沿, 只靠一排 7 格铺不开火力
    for (let y = box.minY; y <= box.maxY; y += 1) {
        west.push({ x: x0, y });
        west.push({ x: x0 - 1, y });
        east.push({ x: x1, y });
    }
    for (let x = box.minX; x <= box.maxX; x += 1) {
        north.push({ x, y: y0 });
        south.push({ x, y: y1 });
    }

    // 轮转顺序: 西 → 北 → 西 → 南 → 北 → 南 (西/北/南各 1/3 火力)
    // 东侧排在最后: 从孵化房方向走到东环要 27 tick, 到位时塔早把队伍清完了;
    // 北/南环本身就能覆盖 (26,24)/(26,26), 东环只当溢出位
    const lists = [west, north, south];
    const pattern = [0, 1, 0, 2, 1, 2];
    const cursor = [0, 0, 0, 0];
    const result: RoomPosition[] = [];
    for (;;) {
        let placed = false;
        for (const sector of pattern) {
            const point = lists[sector]![cursor[sector]!];
            cursor[sector]! += 1;
            if (!point) continue;
            placed = true;
            if (!isOpenTile(room, point.x, point.y)) continue;
            result.push(new RoomPosition(point.x, point.y, room.name));
        }
        if (!placed) break;
    }
    for (const point of east) {
        if (isOpenTile(room, point.x, point.y)) result.push(new RoomPosition(point.x, point.y, room.name));
    }
    return result;
}

/** 总攻时把蓝球旗铺到包围环: 已在合法站位的旗不动 (换位 = 白走 20+ 格) */
function pinRangedAssault(
    items: { flag: Flag; team: any }[],
    room: Room,
    box: { minX: number; maxX: number; minY: number; maxY: number },
    corePhase: boolean,
): void {
    const slots = corePhase ? coreCorners(room, box) : attackSlots(room, box);
    if (!slots.length) return;
    const used = new Set<string>();
    const pending: { flag: Flag }[] = [];
    for (const item of items) {
        const { x, y } = item.flag.pos;
        const key = `${x},${y}`;
        if (!used.has(key) && slots.some((s) => s.x === x && s.y === y)) {
            used.add(key);
            continue;
        }
        pending.push(item);
    }
    for (const item of pending) {
        const slot = slots.find((s) => !used.has(`${s.x},${s.y}`));
        if (!slot) break;
        used.add(`${slot.x},${slot.y}`);
        item.flag.setPosition(slot);
    }
}

/** 建筑群四个空角: 角落无 rampart, 是离塔最近、且唯一能打到核心的落脚点 */
function coreCorners(
    room: Room,
    box: { minX: number; maxX: number; minY: number; maxY: number },
): RoomPosition[] {
    const points = [
        { x: box.minX, y: box.minY },
        { x: box.minX, y: box.maxY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
    ];
    const out: RoomPosition[] = [];
    for (const point of points) {
        if (!isOpenTile(room, point.x, point.y)) continue;
        out.push(new RoomPosition(point.x, point.y, room.name));
    }
    return out;
}

/** 塔清完后的盾队站位: 退到包围环外一格, 继续把守军火力吸在身上 */
function pinGuardPost(
    flag: Flag,
    room: Room,
    box: { minX: number; maxX: number; minY: number; maxY: number },
    index: number,
): void {
    const midY = Math.round((box.minY + box.maxY) / 2);
    const y = midY + (index % 2 === 0 ? -2 : 2);
    const x = box.minX - 2;
    const target = isOpenTile(room, x, y)
        ? new RoomPosition(x, y, room.name)
        : openTileNear(room, x, y);
    if (!target) return;
    if (!flag.pos.isEqualTo(target)) flag.setPosition(target);
}

/** 可站立格: 非墙、无阻挡建筑 (road/container 不算阻挡) */
function isOpenTile(room: Room, x: number, y: number): boolean {
    const size = STRONGHOLD_ANCHOR.roomSize;
    if (x < 1 || x > size - 2 || y < 1 || y > size - 2) return false;
    if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
    for (const structure of room.lookForAt(LOOK_STRUCTURES, x, y)) {
        if (structure.structureType === STRUCTURE_ROAD) continue;
        if (structure.structureType === STRUCTURE_CONTAINER) continue;
        return false;
    }
    return true;
}

/** 盾队站桩点: 敌建筑群包围盒外沿、朝孵化房一侧的中点。
 * 两段式: 敌塔还有存量时先钉耗能位 (距最近塔 18 格, 吃最低档塔伤并把能量抽干),
 * 塔耗空后才顶到 rampart 环边抗伤/拉守军。
 * 无视野时退回靠家侧边缘待命, 有视野后下一轮自动顶上去。 */
function pinGuardTank(
    flag: Flag,
    roomName: string,
    homeRoom: string | undefined,
    waveOpen: boolean,
    index = 0,
): void {
    const live = Game.rooms[roomName];
    const home = parseRoomXY(homeRoom ?? "");
    const here = parseRoomXY(roomName);
    if (!home || !here) return;

    // 耗能位: 塔 6 座齐射 600/发奶量盖不住; 18 格外单发 210, 三奶 1440 稳得住,
    // 且每 tick 抽 60 能量 (回充只有 ~11/tick), 很快抽干。
    // 总攻锁一开就不再回耗能位——推进途中回撤 = 塔立刻回能, 前功尽弃。
    if (live && !waveOpen) {
        // 只要没开总攻就永远守耗能位: 塔被抽干时"提前顶到外沿"= 单队裸冲,
        // 实测盾队会在总攻前被打光, 蓝球随即被塔按最近目标清空
        const towers = hostileTowers(live);
        if (towers.length) {
            const anchor = drainAnchor(towers, home, here);
            // 每队占不同耗能位: 全钉同一点会让 3 队 12 只抢 2x2 队形位, 队形压不进去,
            // 治疗位被顶到前排, 塔按"最近目标"先点死奶妈
            const spread = (index % 3) * 2 - 2;
            const point = anchor ? openTileNear(live, anchor.x, anchor.y + spread) : undefined;
            if (point && !flag.pos.isEqualTo(point)) flag.setPosition(point);
            return;
        }
    }

    const box = live ? hostileBox(live) : undefined;
    if (!box) {
        pinRangedStaging(flag, roomName, homeRoom);
        return;
    }

    const gap = STRONGHOLD_BLITZ.guardTankGap;
    const dx = Math.sign(home.x - here.x);   // 家在目标房西侧 → -1
    const dy = Math.sign(home.y - here.y);   // 家在目标房南侧 → +1
    let x = Math.round((box.minX + box.maxX) / 2);
    let y = Math.round((box.minY + box.maxY) / 2);
    if (dx !== 0) x = dx > 0 ? box.maxX + gap : box.minX - gap;
    if (dy !== 0) y = dy > 0 ? box.maxY + gap : box.minY - gap;

    const target = openTileNear(live!, x, y);
    if (!target) return;
    if (!flag.pos.isEqualTo(target)) {
        flag.setPosition(target);
    }
}

/** 敌方塔 (stronghold 塔 my === false) */
function hostileTowers(room: Room): StructureTower[] {
    const towers: StructureTower[] = [];
    for (const structure of room.find(FIND_STRUCTURES)) {
        if (structure.structureType !== STRUCTURE_TOWER) continue;
        if ((structure as OwnedStructure).my === true) continue;
        towers.push(structure as StructureTower);
    }
    return towers;
}

/** 耗能位: 从朝家侧最外的塔沿"塔群→家"方向退 guardDrainRange 格 */
function drainAnchor(
    towers: StructureTower[],
    home: { x: number; y: number },
    here: { x: number; y: number },
): { x: number; y: number } | undefined {
    const dx = Math.sign(home.x - here.x);
    const dy = Math.sign(home.y - here.y);
    if (dx === 0 && dy === 0) return undefined;

    let outer = towers[0]!;
    let bestKey = -Infinity;
    for (const tower of towers) {
        const key = dx !== 0 ? dx * tower.pos.x : dy * tower.pos.y;
        if (key > bestKey) {
            bestKey = key;
            outer = tower;
        }
    }

    const range = STRONGHOLD_BLITZ.guardDrainRange;
    return {
        x: outer.pos.x + (dx !== 0 ? dx * range : 0),
        y: outer.pos.y + (dy !== 0 ? dy * range : 0),
    };
}

/** 敌建筑群包围盒 (跳过 road/container 等可走建筑) */
function hostileBox(room: Room): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
    let minX: number = STRONGHOLD_ANCHOR.roomSize, maxX = -1;
    let minY: number = STRONGHOLD_ANCHOR.roomSize, maxY = -1;
    for (const structure of room.find(FIND_STRUCTURES)) {
        if (structure.structureType === STRUCTURE_ROAD) continue;
        if (structure.structureType === STRUCTURE_CONTAINER) continue;
        if ((structure as OwnedStructure).my === true) continue;
        const { x, y } = structure.pos;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (maxX < 0 || maxY < 0) return undefined;
    return { minX, maxX, minY, maxY };
}

/** 找 (x,y) 附近最近的可站立格 (非墙、无建筑) */
function openTileNear(room: Room, x: number, y: number): RoomPosition | undefined {
    const size = STRONGHOLD_ANCHOR.roomSize;
    const terrain = room.getTerrain();
    const blocked = new Set<string>();
    for (const structure of room.find(FIND_STRUCTURES)) {
        if (structure.structureType === STRUCTURE_ROAD) continue;
        if (structure.structureType === STRUCTURE_CONTAINER) continue;
        blocked.add(`${structure.pos.x},${structure.pos.y}`);
    }
    for (let ring = 0; ring <= 4; ring += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
            for (let dx = -ring; dx <= ring; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 1 || nx > size - 2 || ny < 1 || ny > size - 2) continue;
                if (terrain.get(nx, ny) === TERRAIN_MASK_WALL) continue;
                if (blocked.has(`${nx},${ny}`)) continue;
                return new RoomPosition(nx, ny, room.name);
            }
        }
    }
    return undefined;
}

/** 蓝球集结期落点: 目标房靠孵化房一侧的边缘中线 (塔射程外的远围)。
 * 无视野时 flag.setPosition 仍可用 (引擎按名字寻址, 不需要房间对象)。 */
function pinRangedStaging(flag: Flag, roomName: string, homeRoom: string | undefined): void {
    const offset = STRONGHOLD_BLITZ.guardPostOffset;
    const home = parseRoomXY(homeRoom ?? "");
    const here = parseRoomXY(roomName);
    if (!home || !here) return;
    const dx = Math.sign(home.x - here.x);   // 家在目标房东侧 → +1
    const dy = Math.sign(home.y - here.y);   // 家在目标房南侧 → +1
    const cx = Math.floor(STRONGHOLD_ANCHOR.roomSize / 2);
    let x = cx, y = cx;
    if (dx !== 0) x = dx > 0 ? STRONGHOLD_ANCHOR.roomSize - 1 - offset : offset;
    if (dy !== 0) y = dy > 0 ? STRONGHOLD_ANCHOR.roomSize - 1 - offset : offset;
    const target = new RoomPosition(x, y, roomName);
    if (!flag.pos.isEqualTo(target)) {
        flag.setPosition(target);
    }
}

/** 队伍首个存活成员 (TeamData.creeps 只存 ID) */
function firstCreep(team: any): Creep | undefined {
    for (const id of (team?.creeps ?? [])) {
        const creep = Game.getObjectById(id) as Creep | undefined;
        if (creep) return creep;
    }
    return undefined;
}

/** 球是否"按时到场": 已在目标房的集结区, 或已在孵化房靠目标房出口 8 格内 (约 8 tick) */
function rangedInPosition(team: any, roomName: string): boolean {
    const creep = firstCreep(team);
    if (!creep) return false;
    if (creep.pos.roomName === roomName) {
        // 必须在靠家侧的集结区: 半路/交战区的残兵不算 (否则总攻会在队伍散开时开波)
        const home = parseRoomXY(team.homeRoom ?? "");
        const here = parseRoomXY(roomName);
        if (!home || !here) return true;
        if (here.x > home.x) return creep.pos.x <= 6;
        if (here.x < home.x) return creep.pos.x >= 43;
        if (here.y > home.y) return creep.pos.y <= 6;
        return creep.pos.y >= 43;
    }
    return false;
}

/** 蓝球集结槽位: 以集结点为基准向家侧铺 3 列 × 7 行。
 * 全挤在同一个旗位会把队形顶到盾队身侧, 塔打"最近目标"就会点球而不是点盾。*/
function stagingGrid(base: { x: number; y: number }): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    // x = base.x-1 .. base.x+1: 最靠边那一列留空, 否则集结的球会堵死房间出口
    // (实测 6 只球卡在 W6N7 的 x=48/49 进不来, 房内的球又占着出口格)
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let y = base.y - 3; y <= base.y + 3; y += 1) {
            if (y < 0 || y > 49) continue;
            out.push({ x: base.x + dx, y });
        }
    }
    return out;
}

/** 按 ID 顺序给集结期蓝球分配独立槽位 (保持已在槽位的不动, 减少来回挪) */
function pinStagingSlots(items: { flag: Flag }[], base: { x: number; y: number }, roomName: string): void {
    const slots = stagingGrid(base)
        .filter((s) => s.x >= 0 && s.x <= 49)
        .map((s) => new RoomPosition(s.x, s.y, roomName));
    if (!slots.length) return;
    const used = new Set<string>();
    const pending: { flag: Flag }[] = [];
    for (const item of items) {
        const key = `${item.flag.pos.x},${item.flag.pos.y}`;
        if (!used.has(key) && slots.some((s) => s.x === item.flag.pos.x && s.y === item.flag.pos.y)) {
            used.add(key);
            continue;
        }
        pending.push(item);
    }
    for (const item of pending) {
        const slot = slots.find((s) => !used.has(`${s.x},${s.y}`));
        if (!slot) break;
        used.add(`${slot.x},${slot.y}`);
        item.flag.setPosition(slot);
    }
}

/** 盾队旗副色: rush 总攻 / normal 站桩 (normal 下打不动会 flee, 只用于集结与消耗位) */
function setFlagRush(flag: Flag, rush: boolean): void {
    const want = rush ? COLOR_PURPLE : COLOR_RED;
    if (flag.secondaryColor === want) return;
    flag.setColor(flag.color, want);
}

/** 孵化房靠目标房一侧的门口集结位 (未满员的队伍先在门口聚齐) */
function gatherPoint(homeRoom: string, targetRoom: string): RoomPosition | undefined {
    const home = parseRoomXY(homeRoom);
    const here = parseRoomXY(targetRoom);
    if (!home || !here) return undefined;
    const cx = Math.floor(STRONGHOLD_ANCHOR.roomSize / 2);
    const dx = Math.sign(here.x - home.x);
    const dy = Math.sign(here.y - home.y);
    const x = dx !== 0 ? (dx > 0 ? STRONGHOLD_ANCHOR.roomSize - 3 : 2) : cx;
    const y = dy !== 0 ? (dy > 0 ? STRONGHOLD_ANCHOR.roomSize - 3 : 2) : cx;
    return new RoomPosition(x, y, homeRoom);
}

/** 解析房间名坐标 (W/S 为负): "W5N7" → {x:5, y:-7} */
function parseRoomXY(name: string): { x: number; y: number } | undefined {
    const m = name.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!m) return undefined;
    const x = m[1] === "W" ? -Number(m[2]) : Number(m[2]);
    const y = m[3] === "N" ? Number(m[4]) : -Number(m[4]);
    return { x, y };
}
