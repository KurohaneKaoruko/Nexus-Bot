// @ts-nocheck

/**
 * TeamAction 域模块: 队形集结: Gather 族/变阵/阵位交换/朝向微调。
 * 从 this.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */

import TeamUtils from '@/modules/teams/core/TeamUtils';
import { formationTemplate, sectorToward, type TowardName } from '@/modules/teams/core/FormationTables';
import { combatMove, combatMoveTo } from '@/modules/combat';
import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const QUAD_ASSIGN_PATTERNS_4 = TeamUtils.kPermutations([0, 1, 2, 3], 4)
const QUAD_ASSIGN_PATTERNS_3 = TeamUtils.kPermutations([0, 1, 2, 3], 3)

const teamActionObjGather: Pick<
    TeamActionApi,
    | 'AdjustToward'
    | 'Gather'
    | 'GatherLine'
    | 'GatherQuad'
    | 'formLineToQuad'
    | 'GatherByTemplate'
    | 'switchFormationPos'
    | 'switchTeam4Pos'
> & ThisType<TeamActionApi> = {


    // 调整朝向
    /**
     * 根据 team.toward 对四角位做“微调归位”。
     *
     * @param team 队伍实例
     * @returns 是否尝试执行了调整（满足前置才会返回 true）
     *
     * @remarks
     * - 该方法依赖 TeamUtils.isQuad 与 TeamUtils.inSameRoom，要求队伍已经是可行动矩阵。\n
     * - 仅做角位的微调（move 1 步），不负责集结成矩阵；队形打散时应由 Gather 负责重组。\n
     * - 返回值用于 TeamClass.moved 标记：避免在不满足条件时“空转占用本 tick 的移动机会”。
     */
    AdjustToward(team: Team): boolean {
        if (team.creeps.length < 3) return false;
        if (!TeamUtils.isQuad(team)) return false;
        if (!TeamUtils.inSameRoom(team)) return false;

        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        team.cache.lastMoveDirection = undefined
        team.cache.lastMoveHold = false
        team.cache.lastCreepMoveDirections = {}

        const { minX, maxX, minY, maxY } = TeamUtils.getPosRange(team);
        let [ A1, A2, B1, B2 ] = team.creeps;

        let LT = new RoomPosition(minX, minY, A1!.room.name);
        let RT = new RoomPosition(maxX, minY, A1!.room.name);
        let LB = new RoomPosition(minX, maxY, A1!.room.name);
        let RB = new RoomPosition(maxX, maxY, A1!.room.name);

        const setMove = (creep: Creep | undefined, target: RoomPosition) => {
            if (!creep) return
            if (creep.pos.isEqual(target)) return
            const dir = creep.pos.getDirection(target) as DirectionConstant
            if (dir) {
                team.cache.lastCreepMoveDirections[creep.id] = dir
                combatMove(creep, dir)
            }
        }

        switch (team.toward) {
            case '↑':
                setMove(A1, LT)
                setMove(A2, RT)
                setMove(B1, LB)
                setMove(B2, RB)
                break;
            case '↓':
                setMove(A1, RB)
                setMove(A2, LB)
                setMove(B1, RT)
                setMove(B2, LT)
                break;
            case '←':
                setMove(A1, LB)
                setMove(A2, LT)
                setMove(B1, RB)
                setMove(B2, RT)
                break;
            case '→':
                setMove(A1, RT)
                setMove(A2, RB)
                setMove(B1, LT)
                setMove(B2, LB)
                break;
        }
        // 这里不需要精确判断每个 creep 是否真的动了：只要满足前置，说明本 tick 尝试纠偏
        return true;
    },


    // 成员集结
    /**
     * 队伍集结/归位（line/quad 通用）。
     *
     * @param team 队伍实例
     * @returns 是否发出了移动指令（true 表示本 tick 做了集结行为）
     *
     * @remarks
     * - line：队首先走，其余成员跟随前一个成员，必要时可朝目标点集合。\n
     * - quad：计算左上角集结点，检查 2x2 周围地形/建筑/creep，满足条件则各自 moveTo 对应角位。\n
     * - 靠边/空间不足时会返回 false，避免硬集结导致堵边或撞墙。
     */
    Gather(team: Team): boolean {
        // 0/1 人队伍不需要集结
        if (team.creeps.length <= 1) return false
        // 线性队形（或人数不足以构成 quad）走 line 集结逻辑
        if (team.formation == 'line') return this.GatherLine(team);
        // 矩阵队形走 quad 集结逻辑
        if (team.formation == 'quad') return this.GatherQuad(team);

        // 其他队形不处理
        return false;
    },


    /**
     * line 队形集结/归位（包含 2/3/4 人“跟随队首”的统一处理）。
     *
     * @remarks
     * - 优先响应 TeamGater 旗帜（用于调试/集结点）。\n
     * - 在 homeRoom 内会尝试向旗帜/目标房/出口方向收敛，以便从安全区出发。\n
     * - 其余情况：队首不动/由外层驱动，后续成员跟随前一名成员归位。\n
     */
    GatherLine(team: Team): boolean {
        // 3/4 人队伍内部顺序重排：保证“队首→队尾”的跟随链更稳定
        let creeps: Creep[] = []
        if (team.creeps.length === 4) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
        } else if (team.creeps.length === 3) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
        } else {
            creeps = team.creeps
        }

        // 优先按 TeamGater 旗帜集结（仅在 homeRoom 生效）
        let GaterFlag = Game.flags['TeamGater']?.pos.roomName === team.homeRoom ? Game.flags['TeamGater'] : null;
        if (GaterFlag) {
            const pos = GaterFlag.pos;
            if (!creeps[0].pos.isEqual! (pos))
                combatMoveTo(creeps[0], pos);
            for (let i = 1; i < creeps.length; i++) {
                if (creeps[i].pos.isNearTo! (creeps[i - 1].pos!)) continue;
                combatMoveTo(creeps[i], creeps[i - 1]);
            }
            return true;
        }

        // 队首的“自驱动”：到目标房后靠旗帜收敛；在 homeRoom 时往目标房中心/出口靠拢
        let head = creeps[0];
        if (head!.room.name == team.targetRoom) {
            // 已在目标房：有旗收敛到旗，无旗按数据目标房中心推进
            combatMoveTo(head!, team.flag ? team.flag : new RoomPosition(25, 25, team.targetRoom));
        } else if (head!.room.name == team.homeRoom) {
            let tarPos = team.flag ? team.flag.pos :
                        team.targetRoom ?
                        new RoomPosition(25, 25, team.targetRoom) :
                        head!.room.find(FIND_EXIT)[0];
            // 跨房目标不受边界带限制（边界带会把队伍永久冻在出口前）
            const crossRoom = tarPos!.roomName !== team.homeRoom;
            const inBand = !(head!.pos.x > 4 && head!.pos.y > 4 && head!.pos.x < 45 && head!.pos.y < 45);
            if (inBand && !crossRoom) return true;
            combatMoveTo(head!, tarPos);
            for (let i = 1; i < creeps.length; i++) {
                if (creeps[i].pos.inRangeTo! (tarPos, 2)) continue;
                combatMoveTo(creeps[i], tarPos);
            }
            return true;
        }

        // 通用跟随：后续成员尽量贴近前一名成员
        for (let i = 1; i < creeps.length; i++) {
            if (creeps[i].pos.isNearTo! (creeps[i - 1].pos!)) continue;
            combatMoveTo(creeps[i], creeps[i - 1]);
        }
        return true;
    },

    /**
     * quad 队形集结/归位：优先保证“能 1 tick 恢复就 1 tick 恢复”，避免高 CPU 的全量搜索。
     *
     * @remarks
     * - 先在少量高价值候选点中检查：是否存在 1 tick 以内即可恢复 quad 的方案。\n
     * - 若存在：优先精确占位（与 toward 一致），否则选择任意占位先恢复 quad（占位由 AdjustToward 纠偏）。\n
     * - 若不存在：退化为在最近可用 2x2 点上做一次“精确 vs 任意”的步数比较（仅对单个点），避免全局最优搜索。\n
     */
    GatherQuad(team: Team): boolean {
        let [ A1, A2, B1, B2 ] = team.creeps;
        // 根据 team.toward 推导“精确占位”时每个角位应该由哪个 creep 承担（不改变 creeps 数组顺序）
        let LT = A1, RT = A2,
            LB = B1, RB = B2;
        switch (team.toward) {
        case '←':
            LT = A2; RT = B2;
            LB = A1; RB = B1;
            break;
        case '→':
            LT = B1; RT = A1;
            LB = B2; RB = A2;
            break;
        case '↓':
            LT = B2; RT = B1;
            LB = A2; RB = A1;
            break;
        }
        // 选一个锚点：优先用推导出的 LT 成员位置；缺失时用 RT 往左一格作为近似锚点
        const pos = LT ? LT.pos : new RoomPosition(RT!.pos.x - 1, RT!.pos.y, RT!.pos.roomName);
        const room = Game.rooms[pos.roomName];
        const terrain = room!.getTerrain();

        // 2x2 合法性判定：墙/阻挡建筑/其他 creep/PC 视为不可用
        let structCheck = (s: LookAtResultWithPos) =>
            s.structure!.structureType !== STRUCTURE_ROAD &&
            s.structure!.structureType !== STRUCTURE_CONTAINER &&
            s.structure!.structureType !== STRUCTURE_RAMPART;
        let creepCheck = (c: LookAtResultWithPos) =>
            team.creeps.every(creep => creep.id !== c.creep!.id);
        const isValidQuadArea = (p: RoomPosition) => {
            if (p.x < 2 || p.y < 2 || p.x > 47 || p.y > 47) return false;
            if (terrain.get(p.x, p.y) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x, p.y + 1) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x + 1, p.y) == TERRAIN_MASK_WALL) return false;
            if (terrain.get(p.x + 1, p.y + 1) == TERRAIN_MASK_WALL) return false;
            const area = [p.y, p.x, p.y + 1, p.x + 1]
            if (room!.lookForAtArea(LOOK_STRUCTURES, area[0], area[1], area[2], area[3], true).filter(structCheck).length) return false;
            if (room!.lookForAtArea(LOOK_CREEPS, area[0], area[1], area[2], area[3], true).filter(creepCheck).length) return false;
            if (room!.lookForAtArea(LOOK_POWER_CREEPS, area[0], area[1], area[2], area[3], true).length) return false;
            return true;
        }

        // 锚点贴边时向内收敛到 [2..47]，保证候选 top-left 不会越界
        const clamp = (v: number) => Math.min(47, Math.max(2, v));
        const basePos = (pos.x < 2 || pos.y < 2 || pos.x > 47 || pos.y > 47)
            ? new RoomPosition(clamp(pos.x), clamp(pos.y), pos.roomName)
            : pos;

        // Chebyshev 距离：用于估算 “恢复到目标阵形所需 tick（最大者）”
        const getRange = (a: RoomPosition, b: RoomPosition) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

        // 有效成员集合（3/4 人）
        const allCreeps = team.creeps.filter(Boolean) as Creep[]

        // 给定 top-left，生成对应 2x2 的四个角位坐标（TL/TR/BL/BR）
        const quadTargets = (p: RoomPosition) => [
            p,
            new RoomPosition(p.x + 1, p.y, p.roomName),
            new RoomPosition(p.x, p.y + 1, p.roomName),
            new RoomPosition(p.x + 1, p.y + 1, p.roomName),
        ]

        const moveToTarget = (creep: Creep, target: RoomPosition) => {
            if (creep.pos.isEqualTo(target)) return
            if (typeof (creep as any).move === 'function' && typeof creep.pos.getDirectionTo === 'function') {
                const dir = creep.pos.getDirectionTo(target) as DirectionConstant | 0
                if (dir) {
                    combatMove(creep, dir)
                    return
                }
            }
            combatMoveTo(creep, target)
        }

        const moveExact = (p: RoomPosition) => {
            const [tl, tr, bl, br] = quadTargets(p)
            if (LT) moveToTarget(LT, tl)
            if (RT) moveToTarget(RT, tr)
            if (LB) moveToTarget(LB, bl)
            if (RB) moveToTarget(RB, br)
        }

        const computeStepsExact = (p: RoomPosition) => {
            const [tl, tr, bl, br] = quadTargets(p)
            let steps = 0
            if (LT) steps = Math.max(steps, getRange(LT.pos, tl))
            if (RT) steps = Math.max(steps, getRange(RT.pos, tr))
            if (LB) steps = Math.max(steps, getRange(LB.pos, bl))
            if (RB) steps = Math.max(steps, getRange(RB.pos, br))
            return steps
        }

        const computeStepsQuadAndAssign = (p: RoomPosition) => {
            const targets = quadTargets(p)
            const n = allCreeps.length
            let bestSteps = Infinity
            let bestAssign: Array<[Creep, RoomPosition]> = []

            const patterns = n === 4 ? QUAD_ASSIGN_PATTERNS_4 : QUAD_ASSIGN_PATTERNS_3
            for (let pi = 0; pi < patterns.length; pi++) {
                const pattern = patterns[pi]
                let steps = 0
                for (let i = 0; i < n; i++) {
                    steps = Math.max(steps, getRange(allCreeps[i].pos!, targets[pattern! [i]!]))
                    if (steps >= bestSteps) break
                }
                if (steps >= bestSteps) continue
                bestSteps = steps
                bestAssign = allCreeps.map((c, i) => [c, targets[pattern! [i]!]])
                if (bestSteps <= 1) break
            }

            return { steps: bestSteps, assign: bestAssign }
        }

        // 在锚点附近收集所有可用 2x2 区域作为候选集结点（top-left）
        const searchRadius = 4
        const candidates: RoomPosition[] = []
        const candidateSet = new Set<number>()
        const pushCandidateIfValid = (x: number, y: number) => {
            const nx = clamp(x)
            const ny = clamp(y)
            const p = new RoomPosition(nx, ny, basePos.roomName)
            const h = nx * 50 + ny
            if (candidateSet.has(h)) return
            candidateSet.add(h)
            if (!isValidQuadArea(p)) return
            candidates.push(p)
        }

        pushCandidateIfValid(basePos.x, basePos.y)
        allCreeps.forEach((c) => {
            const cx = c.pos.x
            const cy = c.pos.y
            pushCandidateIfValid(cx, cy)
            pushCandidateIfValid(cx - 1, cy)
            pushCandidateIfValid(cx, cy - 1)
            pushCandidateIfValid(cx - 1, cy - 1)
        })

        if (!candidates.length) {
            for (let r = 1; r <= searchRadius; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        pushCandidateIfValid(basePos.x + dx, basePos.y + dy)
                    }
                }
                if (candidates.length) break
            }
        }
        if (!candidates.length) return false

        // 优先：能 1 tick 精确占位就直接精确占位
        for (let i = 0; i < candidates.length; i++) {
            const p = candidates[i]
            if (computeStepsExact(p) <= 1) {
                moveExact(p)
                return true
            }
        }

        // 次优：能 1 tick 恢复 quad（任意占位）就直接恢复 quad
        for (let i = 0; i < candidates.length; i++) {
            const p = candidates[i]
            const quad = computeStepsQuadAndAssign(p)
            if (quad.steps <= 1) {
                quad.assign.forEach(([creep, target]) => moveToTarget(creep, target))
                return true
            }
        }

        // 兜底：在有限候选点内做一次“近似最优”选择，避免全量最优搜索
        // - 只评估少量 topK（按离 basePos 的 Chebyshev 距离排序）
        // - 仍保留“步数相同优先精确占位”的偏好
        const topK = Math.min(6, candidates.length)
        candidates.sort((a, b) => getRange(a, basePos) - getRange(b, basePos))

        let bestPos: RoomPosition | null = null
        let bestUseExact = true
        let bestSteps = Infinity
        let bestAssign: Array<[Creep, RoomPosition]> = []

        for (let i = 0; i < topK; i++) {
            const p = candidates[i]
            const exactSteps = computeStepsExact(p)
            const quad = computeStepsQuadAndAssign(p)
            const useExact = exactSteps <= quad.steps
            const chosenSteps = useExact ? exactSteps : quad.steps

            if (chosenSteps > bestSteps) continue
            if (chosenSteps === bestSteps && bestUseExact && !useExact) continue

            bestPos = p
            bestSteps = chosenSteps
            bestUseExact = useExact
            bestAssign = quad.assign
        }

        if (!bestPos) bestPos = candidates[0]
        if (bestUseExact) {
            moveExact(bestPos)
            return true
        }
        bestAssign.forEach(([creep, target]) => moveToTarget(creep, target))
        return true;
    },


    /**
     * 线性队形组成连结队形
     */
    formLineToQuad(team: Team) {
        if (team.creeps.length < 3) return false;
        if (!TeamUtils.isLinear(team)) return false;
        let creeps = team.creeps;
        // 获取中间两个爬，即：有两个相邻爬的爬
        // o-o-o-o or o-o-o
        const middleCreeps = creeps.filter((creep) => {
            const nearCreeps = creeps.filter((other) => creep !== other && creep.pos.isNearTo(other))
            return nearCreeps.length === 2
        })

        // 3 个爬时可能小于 2，这时候把队首加进去
        if (middleCreeps.length < 2) {
            middleCreeps.push(creeps[0])
        }
        const [middlePos1, middlePos2] = middleCreeps.map((creep) => creep.pos)
        const creepPosHashSet = new Set(creeps.map((creep) => creep.pos.hashCode()))

        // 中间的两个爬只有 6 种姿势，设 o 为爬，- 为空位
        // 1. o-   2. -o   3. oo  4. --  5. o-   6. -o
        //    -o      o-      --     oo     o-      -o
        // 我们要做的就是判断是哪种情况，然后把其他的爬填入空位（使用二分匹配）

        // 生成四个坐标
        const genRoomPositions = (x1: number, y1: number, x2: number, y2: number) => {
            return [
                middlePos1,
                middlePos2,
                new RoomPosition(x1, y1, middlePos1!.roomName),
                new RoomPosition(x2, y2, middlePos2!.roomName),
            ]
        }

        // 二分匹配
        const bipartiteMatch = (members: Creep[], pos: RoomPosition[]) => {
            // 检查后两个位置是否有效
            if (pos.find((p) => !creepPosHashSet.has(p.hashCode()) && !p.walkable(true))) return {}
            return TeamUtils.creepPosBipartiteMatch(members, pos)
        }

        let result: Record<string, RoomPosition> = {}
        // 情况 5,6
        if (middlePos1!.x === middlePos2!.x) {
            const minY = Math.min(middlePos1!.y, middlePos2!.y)

            // 情况 5
            result = bipartiteMatch(creeps, genRoomPositions(middlePos1!.x + 1, minY, middlePos1!.x + 1, minY + 1))
            if (Object.keys(result).length !== creeps.length) {
                // 情况 6
                result = bipartiteMatch(creeps, genRoomPositions(middlePos1!.x - 1, minY, middlePos1!.x - 1, minY + 1))
            }
        }
        // 情况 3,4
        else if (middlePos1!.y === middlePos2!.y) {
            const minX = Math.min(middlePos1!.x, middlePos2!.x)

            // 情况 3
            result = bipartiteMatch(creeps, genRoomPositions(minX, middlePos1!.y + 1, minX + 1, middlePos1!.y + 1))
            if (Object.keys(result).length !== creeps.length) {
                // 情况 4
                result = bipartiteMatch(creeps, genRoomPositions(minX, middlePos1!.y - 1, minX + 1, middlePos1!.y - 1))
            }
        }
        // 情况 1,2
        else {
            const minX = Math.min(middlePos1!.x, middlePos2!.x)
            const minY = Math.min(middlePos1!.y, middlePos2!.y)
            const roomName = middlePos1!.roomName

            // 情况 3
            result = bipartiteMatch(creeps, [
                new RoomPosition(minX, minY, roomName),
                new RoomPosition(minX, minY + 1, roomName),
                new RoomPosition(minX + 1, minY, roomName),
                new RoomPosition(minX + 1, minY + 1, roomName),
            ])
        }

        if (Object.keys(result).length !== creeps.length) {
            return false
        }

        creeps.forEach((creep) => {
            const targetPos = result[creep.name]
            if (!creep.pos.isEqualTo(targetPos)) {
                combatMove(creep, creep.pos.getDirectionTo(targetPos))
            }
        })
        return true
    },


    GatherByTemplate(team: Team, shape: 'cross' | 'square3'): boolean {
        if (team.creeps.length === 0) return false;
        const slots = formationTemplate(shape, team.toward as TowardName);
        const clamp = (v: number) => Math.max(1, Math.min(48, v));
        const anchor = this.stagingAnchorOf(team.name, team.creeps, team.targetRoom);
        let cx = clamp(anchor.x), cy = clamp(anchor.y);
        const roomName = team.creeps[0].room.name!;

        // 锚点贴墙/贴建筑时模板槽位会被钳进不可走格 (成员追一个到不了的槽位 = 卡角落):
        // 沿朝房间中心方向逐格试, 找到全部槽位可走的锚点; 找不到维持原锚点 (散装推进兜底)
        const shapeFits = (x: number, y: number) => {
            for (const s of slots) {
                const pos = new RoomPosition(clamp(x + s.x), clamp(y + s.y), roomName);
                if (!pos.walkable()) return false;
            }
            return true;
        };
        if (!shapeFits(cx, cy)) {
            const dx = Math.sign(25 - cx), dy = Math.sign(25 - cy);
            for (let step = 1; ; step += 1) {
                const nx = clamp(cx + dx * step), ny = clamp(cy + dy * step);
                if (nx === cx && ny === cy) break; // 贴住房间边界仍无解, 放弃 (散装推进兜底)
                if (shapeFits(nx, ny)) { cx = nx; cy = ny; break; }
            }
        }

        const remaining = [...team.creeps];
        const heals = remaining.filter(c => c.getActiveBodyparts(HEAL) > 0);
        const attackers = remaining.filter(c => c.getActiveBodyparts(HEAL) === 0);
        // 治疗槽优先给治疗成员，其余槽位攻击/远攻优先（就近贪心入位）
        const ordered = [...slots].sort((a, b) => Number(b.heal) - Number(a.heal));
        for (const slot of ordered) {
            const target = new RoomPosition(clamp(cx + slot.x), clamp(cy + slot.y), roomName);
            const pool = slot.heal && heals.length ? heals : (attackers.length ? attackers : heals);
            let best: Creep | undefined;
            let bestD = Infinity;
            for (const c of pool) {
                const d = c.pos.getRangeTo(target);
                if (d < bestD) { bestD = d; best = c; }
            }
            if (!best) continue;
            if (heals.indexOf(best) >= 0) heals.splice(heals.indexOf(best), 1);
            if (attackers.indexOf(best) >= 0) attackers.splice(attackers.indexOf(best), 1);
            remaining.splice(remaining.indexOf(best), 1);
            if (!best.pos.isEqualTo(target)) combatMoveTo(best, target);
        }
        // 剩余成员（槽位已满）：就近跟随
        for (const c of remaining) {
            combatMoveTo(c, new RoomPosition(clamp(cx), clamp(cy), roomName));
        }
        return true;
    },


    /**
     * 扩展队形朝向旋转：按攻击目标相对队伍中心的八向扇区解析新朝向。
     */
    switchFormationPos(team: Team, targetPos: RoomPosition): boolean {
        const center = TeamUtils.getTeamPos(team);
        if (!center) return false;
        const toward = sectorToward(targetPos.x - center.x, targetPos.y - center.y);
        if (team.toward === toward) return false;
        team.toward = toward;
        return true;
    },


     /**
     * 四人小队变换队形，使得攻击力最大的两个爬朝向目标
     *
     * @returns 是否变换过队形
     */
     switchTeam4Pos(team: Team) {
        if (team.status === 'flee') return false

        const creeps = team.creeps
        if (creeps.length <= 2) return false

        const originPos = TeamUtils.getTeamPos(team)!
        const cachedTargetPos = TeamUtils.getCachePos(team, 'targetPos')
        const targetPos = cachedTargetPos || this.focusTarget(team, originPos)?.pos || team.flag?.pos
            || (team.targetRoom ? new RoomPosition(25, 25, team.targetRoom) : undefined)

        if (!targetPos) return false

        // 目标位置相对于左上角的坐标
        const { x, y } = targetPos.crossRoomSubPos(originPos)
        // 目标位置相对于四人小队中心的坐标
        const dx = x - 0.5
        const dy = y - 0.5
        // 绝对值
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)

        // 过远不管
        if (adx >= 5 || ady >= 5) return false

        // 是否交换了位置
        let switched = false

        // 小队在右边，攻击爬调到左边
        if (dx < 0 && adx > ady) {
            switched = team.toward != '←'
            team.toward = '←';

        }
        // 小队在左边，攻击爬调到右边
        else if (dx > 0 && adx > ady) {
            switched = team.toward != '→'
            team.toward = '→';
        }
        // 小队在下边，攻击爬调到上边
        else if (dy < 0 && adx < ady) {
            switched = team.toward != '↑'
            team.toward = '↑';
        }
        // 小队在上边，攻击爬调到下边
        else if (dy > 0 && adx < ady) {
            switched = team.toward != '↓'
            team.toward = '↓';
        }

        if (switched) {
            if (!team.cache) team.cache = {}
            team.cache.lastTowardSwitchTick = Game.time
        }
        return switched
    },
};

export default teamActionObjGather;
