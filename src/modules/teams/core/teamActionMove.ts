// @ts-nocheck

/**
 * TeamAction 域模块: 移动执行: 直线/四足推进/聚焦/松动推进/推进目标更新。
 * 从 this.ts 拆出 (legacy-consolidation-b 3.3), 方法体零改动;
 * this 互调经装配层合并对象绑定, 语义不变。
 */

import TeamUtils from '@/modules/teams/core/TeamUtils';
import TeamCache from '@/modules/teams/core/TeamCache';
import { shapeOfCount } from '@/modules/teams/core/FormationTables';
import { combatMove, combatMoveTo } from '@/modules/combat';
import { TEAM_MOVE_CONFIG } from '@/config/combat';
import type { TeamActionApi } from '@/modules/teams/core/teamActionTypes';

const emptyCostMatrix = new PathFinder.CostMatrix()

const teamActionObjMoveExec: Pick<
    TeamActionApi,
    | 'LinearMove'
    | 'move'
    | 'QuadMoveTo'
    | 'touchableNTickInRange'
    | 'focusTarget'
    | 'looseAdvance'
    | 'noteStuck'
    | 'execMoveExtended'
    | 'stagingAnchorOf'
    | 'updateTargetPos'
> & ThisType<TeamActionApi> = {

    // 线性队形移动到目标
    /**
     * 线性队形推进（队首 moveTo，队尾跟随）。
     *
     * @param team 队伍实例
     * @param pos 目标位置（默认队伍指挥旗）
     * @param reverse 是否反向（用于特殊场景：以队尾为“头”推进）
     *
     * @remarks
     * - 当队形已线性相连时，后续成员用 move(directionTo(prev)) 追随，降低 moveTo 的 CPU。\n
     * - 队首处于边界时允许直接 moveTo 目标，用于跨房/出入口通过。\n
     * - 内部会在同房且已到达/疲劳时早退，避免无意义移动。
     */
    LinearMove(team: Team, pos: RoomPosition = team.flag?.pos, reverse = false): void {
        if (team.creeps.length == 0) return;
        if (!pos) pos = team.flag?.pos;
        if (!pos) return;

        // 单个creep直接移动
        if (team.creeps.length == 1) {
            if (!team.cache) team.cache = {}
            team.cache.lastMoveTick = Game.time
            team.cache.lastMoveHold = false
            delete team.cache.lastCreepMoveDirections

            const creep = team.creeps[0];
            if (creep!.pos.isEqualTo(pos)) {
                team.cache.lastMoveDirection = undefined
                return;
            }
            const dir = creep!.pos.getDirectionTo(pos) as DirectionConstant | 0
            team.cache.lastMoveDirection = dir ? dir : undefined
            if (dir) team.cache.lastCreepMoveDirections = { [creep!.id]: dir }
            combatMoveTo(creep!, pos);
            return;
        }

        let creeps: Creep[] = []
        if (team.creeps.length === 4) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1], team.creeps[3]]
        } else if (team.creeps.length === 3) {
            creeps = [team.creeps[0], team.creeps[2], team.creeps[1]]
        } else {
            creeps = team.creeps
        }

        if (reverse) creeps.reverse();

        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        const headDirection = creeps[0]?.pos?.getDirectionTo(pos) as DirectionConstant | 0
        team.cache.lastMoveDirection = headDirection ? headDirection : undefined
        team.cache.lastMoveHold = false
        delete team.cache.lastCreepMoveDirections
        const creepDirections: Record<string, DirectionConstant> = {}

        // 队伍是否保持直形
        const isLine = TeamUtils.isLinear(team);
        // 到达目标或有creep疲劳则停止
        if (TeamUtils.inSameRoom(team) && isLine &&
            creeps.some(c => c.pos.isEqualTo(pos) || c.fatigue > 0)) {
            return;
        }

        let headMove = isLine || creeps[0].pos.isRoomEdge! ();
        for (let i = 1; !headMove && (i < creeps.length); i++) {
            if (creeps[i].pos.isNearTo! (creeps[i-1])) {
                headMove = creeps[i].pos.isRoomEdge! ();
            } else break;
        }

        let moved = [false, false, false, false];
        if (headMove) {
            if (headDirection) creepDirections[creeps[0].id!] = headDirection
            combatMoveTo(creeps[0], pos, { ignoreCreeps: false });
            moved[0] = true;
        }

        for (let i = 1; i < creeps.length; i++) {
            let creep = creeps[i];
            let prevCreep = creeps[i - 1];

            if (isLine) {
                const dir = creep!.pos.getDirectionTo(prevCreep) as DirectionConstant | 0
                if (dir) {
                    creepDirections[creep!.id] = dir
                    combatMove(creep!, dir);
                }
                continue;
            }

            if (!creep!.pos.isNearTo(prevCreep)) {
                const dir = creep!.pos.getDirectionTo(prevCreep) as DirectionConstant | 0
                if (dir) creepDirections[creep!.id] = dir
                combatMoveTo(creep!, prevCreep, { ignoreCreeps: false });
                moved[i] = true;
            } else if (moved[i - 1]) {
                const dir = creep!.pos.getDirectionTo(prevCreep) as DirectionConstant | 0
                if (dir) {
                    creepDirections[creep!.id] = dir
                    combatMove(creep!, dir);
                }
                moved[i] = true;
            }
        }

        if (Object.keys(creepDirections).length > 0) {
            team.cache.lastCreepMoveDirections = creepDirections
        }
    },




    // 方阵移动
    /**
     * 矩阵队形推进（按方向整体移动）。
     *
     * @remarks
     * - 多人队伍（>=3）跨房穿边时优先保持同向同步移动，以保证治疗覆盖与承伤分摊。\n
     * - 但当“移动会导致下一 tick 阵型打散，而停 1 tick 可以保持 quad”时，会选择停 1 tick 等待边界传送完成。\n
     * - 2 人队伍在无方向时会尝试把边界上的成员挪到内侧空位，减少“贴边抖动”。\n
     * - 有 fatigue 时直接停止，避免队形撕裂。
     */
    move(team: Team, direction: DirectionConstant): void {
        // 存在疲劳的creep则停止
        if (TeamUtils.hasCreepFatigue(team)) return;

        /**
         * 运行期调试字段：记录队伍在本 tick 的“移动决策”，供可视化模块读取。
         * - lastMoveTick：写入的 tick（仅当等于 Game.time 时可视化才会绘制）
         * - lastMoveDirection：本 tick 计算出的方向（可能为 undefined，表示无方向）
         * - lastMoveHold：是否决定“停 1 tick 等待边界传送”，用于跨房穿边过渡态保持阵型
         */
        if (!team.cache) team.cache = {}
        team.cache.lastMoveTick = Game.time
        team.cache.lastMoveDirection = direction
        team.cache.lastMoveHold = false
        delete team.cache.lastCreepMoveDirections

        const creeps = team.creeps;
        // 没有方向
        if (!direction) {
            if (creeps.length !== 2) return
            // 2 人小队看一下第二个爬是否在边界，如果是就移动到周围不是边界的空位
            if (creeps[0].pos.isNearTo! (creeps[1]) && creeps[1].pos.isRoomEdge! ()) {
                this.moveOuterBorder(creeps[1], creeps[0])
            }
            return
        }

        // 多人小队穿边：保持同步同向移动。仅 quad 做穿边保形驻留——
        // cross/square3/line 不做 quad 判定驻留（3×3 全对相邻恒 false 会永久卡门）
        if (creeps.length >= 3) {
            if (
                creeps.some(
                    (creep) => creep.pos.isRoomEdge() && creep.pos.getDirectPos(direction).roomName != creep.pos.roomName,
                )
            ) {
                if (team.formation === 'quad') {
                    // 穿边时可能出现“队伍被拆成两房”的过渡态：如果继续移动会打散 quad，而站桩 1 tick 能保持 quad，
                    // 则本 tick 不下发 move，等待边界传送把队伍合回同一侧后再继续推进。
                    const holdQuad = TeamUtils.willTeamBeQuadNextTick(team, undefined)
                    const moveQuad = TeamUtils.willTeamBeQuadNextTick(team, direction)
                    if (holdQuad && !moveQuad) {
                        // 保形驻留最多持续 holdLimitTicks: 超时说明对岸格被占/不可达,
                        // 放弃保形强制下发移动 (否则门口永久站桩)
                        team.cache.holdTicks = (team.cache.holdTicks ?? 0) + 1
                        if (team.cache.holdTicks < TEAM_MOVE_CONFIG.quadHoldLimitTicks) {
                            team.cache.lastMoveHold = true
                            return
                        }
                    }
                }
                team.cache.holdTicks = 0
                // 出口格上的成员不指令 (发过指令会被引擎取消边界自动传送),
                // tick 结束自动传送到对岸; 其余成员照常同向移动, 鱼贯而过。
                // 出口格外向房内一步的成员若前方是待传送成员, 本 tick 让行。
                const occupied = new Set(
                    creeps
                        .filter((c) => c.pos.isRoomEdge() && c.pos.getDirectPos(direction).roomName != c.pos.roomName)
                        .map((c) => `${c.pos.x},${c.pos.y},${c.pos.roomName}`),
                )
                creeps.forEach((creep) => {
                    if (
                        creep.pos.isRoomEdge() &&
                        creep.pos.getDirectPos(direction).roomName != creep.pos.roomName
                    ) return // 站在出口: 等待自动传送
                    const next = creep.pos.getDirectPos(direction)
                    if (occupied.has(`${next.x},${next.y},${next.roomName}`)) return // 前方是待传送成员: 让行
                    combatMove(creep, direction)
                })
                return
            }
        }

        if (creeps.length >= 3) {
            creeps.forEach((creep) => combatMove(creep, direction))
        } else if (creeps.length === 1) {
            combatMove(creeps[0], direction)
        } else {
            // 二人小队，如果是躲避或者逃跑，反过来移动
            if (team.status === 'avoid' || team.status === 'flee') {
                combatMove(creeps[1], direction)
                if (creeps[0]) {
                    combatMove(creeps[0], creeps[0].pos.getDirectionTo(creeps[1]))
                }
            } else {
                combatMove(creeps[0], direction)
                if (creeps[1]) {
                    combatMove(creeps[1], creeps[1].pos.getDirectionTo(creeps[0]))
                }
            }
        }
        return;
    },



    // 方阵移动到目标
    /**
     * quad 队形朝目标点移动（内部先算方向再调用 move）。
     *
     * @param team 队伍实例
     * @param targetPos 目标位置
     */
    QuadMoveTo(team: Team, targetPos: RoomPosition): void {
        // 获取移动方向
        let d = this.getTeamMoveDirection(team, [{pos:targetPos}]);
        return this.move(team, d);
    },




    /**
     * 计算 tick 步内能否走到目标指定范围内
     * 用于 tick 较小的场景
     */
    touchableNTickInRange(
        creep: Creep,
        targetPos: RoomPosition,
        tick: number,
        range: number,
        plainCost = 1,
    ) {
        if (tick > 100) throw new Error(`tick 数量过大，可能会导致性能问题`)
        if (tick === 0) return creep.pos.inRangeTo(targetPos, range)

        const username = creep.owner.username
        const goal = { pos: targetPos, range }
        const result = PathFinder.search(creep.pos, [goal], {
            maxCost: tick,
            plainCost,
            swampCost: plainCost * 5,
            roomCallback: (roomName) => {
                const room = Game.rooms[roomName]
                if (!room) return emptyCostMatrix

                if (!(Game as any) ['_username_costs']) (Game as any) ['_username_costs'] = {}
                const id = roomName + username

                if (!((Game as any) ['_username_costs'] as any) [id]) {
                    const costs = new PathFinder.CostMatrix()

                    const structures = TeamCache.getStructures(roomName);
                    structures.forEach((struct) => {
                        if (struct.structureType === STRUCTURE_ROAD) {
                            const cost = Math.max(1, costs.get(struct.pos.x, struct.pos.y));
                            costs.set(struct.pos.x, struct.pos.y, cost)
                        } else if (struct.structureType !== STRUCTURE_RAMPART || !struct.my) {
                            costs.set(struct.pos.x, struct.pos.y, 255)
                        }
                    })


                    ;((Game as any) ['_username_costs'] as any) [id] = costs
                }

                return ((Game as any) ['_username_costs'] as any) [id]
            },
        })

        return !result.incomplete
    },



    /**
     * 锁定目标位置
     */
    focusTarget(team: Team, originPos: RoomPosition) {
        let targets: (Creep | Structure)[] = []
        if (team['_attackTargets']?.length) {
            targets = (team as any) ['_attackTargets']
        } else if (team['_targets']?.length) {
            targets = team['_targets'].filter((s) => 'hits' in s) as (Creep | Structure)[]
        }
        return originPos.findClosestByRange(targets)
    },



    /**
     * 扩展队形（cross/square3）移动入口：同房散队模板集结；成阵后按索敌目标/锚点八向群移。
     */
    /**
     * 散装推进: 成员各自向目标步进 (动态组合降级态)。
     *
     * @remarks
     * 同房 combatMoveTo 贴近 (range 2); 跨房按 findRoute 出口方向步进
     * (moveTo 系不支持跨房目标)。已就位/疲劳/站出口格待传送的成员跳过——
     * 站上出口格不发指令, tick 结束引擎自动传送到对岸。
     */
    looseAdvance(team: Team, looseGoal: RoomPosition): void {
        let progressing = false;
        for (const c of team.creeps) {
            if (c.fatigue > 0) continue;
            if (c.room.name === looseGoal.roomName) {
                // 同房照常走 (刚传送到对岸站在边缘的成员向房内推进合法且必要)
                if (!c.pos.inRangeTo(looseGoal, 2)) {
                    combatMoveTo(c, looseGoal, { range: 2 });
                    progressing = true;
                }
            } else {
                // 跨房出口步进: 站在出口格待传送的情形由 combatMove 内部拦 (方向指向房外才等),
                // 这里照常下发
                const dir = TeamUtils.routeExitDir(c.room.name, looseGoal.roomName);
                if (dir) { combatMove(c, dir); progressing = true; }
            }
        }
        // 有成员仍在推进则续期散装窗口: 门口长队列没穿完时不强制回阵型 (回阵型 = 再卡一次)
        if (progressing) team.cache.looseUntilTick = Math.max(team.cache.looseUntilTick ?? 0, Game.time + TEAM_MOVE_CONFIG.looseDurationTicks);
    },



    /**
     * 卡死计数: 阵型受卡 (无方向/破阵/集结失败) 逐 tick 累计,
     * 达阈值切散装窗口; 任何一次整阵成功推进都会清零。
     */
    noteStuck(team: Team): void {
        // 散装窗口内仍在推进 (有成员未到位且在动) 则续期, 防止长门口
        // 队列没穿完就被强制拉回阵型再卡一次
        team.cache.stuckTicks = (team.cache.stuckTicks ?? 0) + 1;
        if ((team.cache.stuckTicks ?? 0) >= TEAM_MOVE_CONFIG.stuckTriggerTicks) {
            team.cache.looseUntilTick = Game.time + TEAM_MOVE_CONFIG.looseDurationTicks;
            team.cache.stuckTicks = 0;
        }
    },



    execMoveExtended(team: Team, anchor: RoomPosition | undefined): boolean {
        const shape = shapeOfCount(team.creeps.length);
        if (!shape) return false;
        const goal = team['_targets']?.[0]?.pos ?? anchor;

        // ── 动态组合 (窄门/墙角防卡死): 严格阵型受卡累计到阈值后, 切散装推进
        // (成员各自寻路, 单爬可穿窄门/绕角); 窗口到期自动重试阵型, 有空间即恢复 ──
        const isLoose = (team.cache.looseUntilTick ?? 0) > Game.time;
        const noteStuck = () => this.noteStuck(team);
        const clearStuck = () => { team.cache.stuckTicks = 0; };
        const tryEnterLoose = () => {
            if ((team.cache.stuckTicks ?? 0) < TEAM_MOVE_CONFIG.stuckTriggerTicks) return false;
            team.cache.looseUntilTick = Game.time + TEAM_MOVE_CONFIG.looseDurationTicks;
            team.cache.stuckTicks = 0;
            return true;
        };
        const looseAdvance = (looseGoal: RoomPosition) => this.looseAdvance(team, looseGoal);

        const inTargetCount = team.creeps.filter(c => c.room.name === team.targetRoom).length;

        // ── 分裂态（部分成员已过门）：向已过门的队首成员集结凑齐，不逐个送 ──
        if (inTargetCount > 0 && inTargetCount < team.creeps.length) {
            const leader = team.creeps.find(c => c.room.name === team.targetRoom)!;
            for (const c of team.creeps) {
                if (c.room.name === team.targetRoom) continue;  // 已过门的就位（execAttack 自动开火）
                if (c.fatigue > 0) continue;                    // 疲劳自然滞留
                // 跨房出口步进: 出口格待传送的拦截在 combatMove 内部 (方向指向房外才等)
                if (c.room.name === leader.room.name) {
                    if (!c.pos.inRangeTo(leader.pos, 2)) combatMoveTo(c, leader.pos, { range: 2 });
                } else {
                    const dir = TeamUtils.routeExitDir(c.room.name, leader.room.name);
                    if (dir) combatMove(c, dir);
                }
            }
            return true;
        }

        // ── 全员同房 ──
        if (TeamUtils.inSameRoom(team)) {
            const inTargetRoom = team.creeps[0].room.name === team.targetRoom;

            // 目标房内：成阵 → 集火整队推进（execAttack 同步开火）
            if (inTargetRoom) {
                if (!TeamUtils.isExtendedShape(team)) {
                    // 散装窗口内不强制成阵, 直接散装推进; 受卡累计到阈值也切散装
                    noteStuck();
                    const looseGoal = goal ?? TeamUtils.getTeamPos(team);
                    if ((isLoose || tryEnterLoose()) && looseGoal) { looseAdvance(looseGoal); return true; }
                    return this.GatherByTemplate(team, shape);
                }
                if (team.creeps.some(c => c.fatigue > 0)) return true;
                const focus = this.focusTarget(team, TeamUtils.getTeamPos(team));
                const goalPos = (focus ? focus.pos : null) ?? goal;
                if (!goalPos) return false;
                const direction = this.getTeamMoveDirection(team, [{ pos: goalPos }]);
                if (direction) {
                    clearStuck();
                    this.move(team, direction);
                    return true;
                }
                // 阵型整体无路 (窄门/墙角): 切散装逐个穿行
                noteStuck();
                if (tryEnterLoose()) { looseAdvance(goalPos); return true; }
                return false;
            }

            // 孵化房：先成阵（锚点已离 spawn 群）；集结超时未成阵也整队向目标房推进
            if (!TeamUtils.isExtendedShape(team)) {
                if (!team.cache.gatherSince) team.cache.gatherSince = Game.time;
                if (Game.time - team.cache.gatherSince < TEAM_MOVE_CONFIG.gatherWindowTicks) {
                    return this.GatherByTemplate(team, shape);
                }
                delete team.cache.gatherSince;
            }
            const exitGoal = team.targetRoom ? new RoomPosition(25, 25, team.targetRoom) : goal;
            if (!exitGoal) return false;
            if (team.creeps.some(c => c.fatigue > 0)) return true;
            const direction = this.getTeamMoveDirection(team, [{ pos: exitGoal }]);
            if (direction) {
                clearStuck();
                this.move(team, direction);
                return true;
            }
            // 阵型无路: 切散装逐个穿行
            noteStuck();
            if (isLoose || tryEnterLoose()) { looseAdvance(exitGoal); return true; }
            return false;
        }

        // ── 全员在第三房（路过的过渡态）：整队向目标房推进 ──
        const exitGoal = team.targetRoom ? new RoomPosition(25, 25, team.targetRoom) : goal;
        if (!exitGoal) return false;
        if (team.creeps.some(c => c.fatigue > 0)) return true;
        const direction = this.getTeamMoveDirection(team, [{ pos: exitGoal }]);
        if (direction) {
            clearStuck();
            this.move(team, direction);
            return true;
        }
        noteStuck();
        if (isLoose || tryEnterLoose()) { looseAdvance(exitGoal); return true; }
        return false;
    },



    /**
     * 扩展队形模板集结：成员按角色分配到当前朝向的旋转模板占位
     * （治疗成员优先中心/后排槽位，攻击/远攻成员就近入前沿臂位）。
     */
    /**
     * 集结锚点：成员质心；压 spawn 群时沿目标房方向推到 ≥4 格外，
     * 并按 teamID 散列沿推进方向垂直向错开多队集结点（±6 格内）。
     */
    stagingAnchorOf(teamName: string, creeps: Creep[], targetRoom: string | undefined): RoomPosition {
        const roomName = creeps[0].room.name!;
        const clamp = (v: number) => Math.max(1, Math.min(48, v));
        const xs = creeps.map(c => c.pos.x), ys = creeps.map(c => c.pos.y);
        let cx = clamp(Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));
        let cy = clamp(Math.round(ys.reduce((a, b) => a + b, 0) / ys.length));
        const spawns = Game.rooms[roomName] ? Game.rooms[roomName].find(FIND_MY_SPAWNS) : [];
        const clearOfSpawns = (x: number, y: number): boolean =>
            spawns.every(s => Math.max(Math.abs(x - s.pos.x), Math.abs(y - s.pos.y)) >= 4);
        if (spawns.length && !clearOfSpawns(cx, cy)) {
            const nearest = spawns.reduce((a, b) =>
                (Math.abs(cx - a.pos.x) + Math.abs(cy - a.pos.y) <= Math.abs(cx - b.pos.x) + Math.abs(cy - b.pos.y)) ? a : b);
            const dir = nearest.pos.getDirectionTo(targetRoom ? new RoomPosition(25, 25, targetRoom) : nearest.pos);
            const DXY: Record<DirectionConstant, [number, number]> = {
                [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
                [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
            };
            const [ddx, ddy] = DXY[dir] ?? [1, 0];
            cx = clamp(nearest.pos.x + ddx * 5);
            cy = clamp(nearest.pos.y + ddy * 5);
            let guard = 0;
            while (!clearOfSpawns(cx, cy) && guard++ < 5) {
                cx = clamp(cx + ddx);
                cy = clamp(cy + ddy);
            }
        }
        if (targetRoom) {
            const dirToTarget = new RoomPosition(cx, cy, roomName).getDirectionTo(new RoomPosition(25, 25, targetRoom));
            const [fdx, fdy] = ({
                [TOP]: [0, -1], [TOP_RIGHT]: [1, -1], [RIGHT]: [1, 0], [BOTTOM_RIGHT]: [1, 1],
                [BOTTOM]: [0, 1], [BOTTOM_LEFT]: [-1, 1], [LEFT]: [-1, 0], [TOP_LEFT]: [-1, -1],
            } as Record<DirectionConstant, [number, number]>)[dirToTarget] ?? [1, 0];
            const hash = [...teamName].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7);
            const lateral = ((hash % 5) - 2) * 3;
            if (lateral) {
                cx = clamp(cx + -fdy * lateral);
                cy = clamp(cy + fdx * lateral);
            }
        }
        return new RoomPosition(cx, cy, roomName);
    },



    /**
     * 更新队伍推进目标点（targetPos）：
     * - 有可攻击目标时，锁定当前焦点目标位置，减少目标频繁切换导致的来回抖动
     * - 到点但本 tick 没有可攻击目标时，尝试在当前 targets 列表里自动换点推进
     */
    updateTargetPos(team: Team) {
        if (!team.creeps?.length) return
        if (!team.flag) return

        // 推进点锚定指挥旗: 只走到旗位, 目标只用于就地开火。
        // 否则队伍会追着最近的塔/守军往火圈里钻, 扇区包围站位就散了
        if (team.anchorLock) {
            const locked = TeamUtils.getCachePos(team, 'targetPos')
            if (!locked || !locked.isEqualTo(team.flag.pos)) {
                TeamUtils.setCachePos(team, 'targetPos', team.flag.pos)
                delete team.cache.targetPosIndex
            }
            return
        }

        const originPos = TeamUtils.getTeamPos(team)
        const focusTarget = TeamUtils.focusTarget(team, originPos)
        const focusPos = focusTarget?.pos || team.flag.pos

        const currentTargetPos = TeamUtils.getCachePos(team, 'targetPos')
        const hasAttackTargets = !!team['_attackTargets']?.length

        const lockTicks = 3
        const lockedUntil = team.cache?.focusTargetLockUntil || 0
        const lockedId = team.cache?.focusTargetId as Id<any> | undefined
        let lockedPos: RoomPosition | undefined
        if (hasAttackTargets && lockedId && Game.time < lockedUntil) {
            const lockedObj = Game.getObjectById(lockedId)
            if (lockedObj?.pos) lockedPos = lockedObj.pos
            else {
                delete team.cache.focusTargetId
                delete team.cache.focusTargetLockUntil
            }
        }
        let desiredPos = lockedPos || focusPos
        if (hasAttackTargets && desiredPos.isRoomEdge()) desiredPos = TeamUtils.pushInsideRoomPos(desiredPos, 1)
        const desiredId = lockedPos ? lockedId : ((focusTarget as any)?.id as Id<any> | undefined)

        // candidates：当前 tick 可推进/可攻击的有效目标（排除 flag），用于判断当前 targetPos 是否仍有效
        const candidates = (((team as any) ['_targets'] || []) as any[]).filter((t) => t && 'hits' in t && t.pos) as {
            pos: RoomPosition
        }[]
        const candidatePosSet = new Set<number>(candidates.map((t) => t.pos?.hashCode()).filter((v) => v !== undefined) as number[])

        if (!currentTargetPos) {
            TeamUtils.setCachePos(team, 'targetPos', desiredPos)
            if (hasAttackTargets && desiredId) {
                team.cache.focusTargetId = desiredId
                team.cache.focusTargetLockUntil = Game.time + lockTicks
            }
            delete team.cache.targetPosIndex
            return
        }

        if (hasAttackTargets && !currentTargetPos.isEqualTo(desiredPos)) {
            TeamUtils.setCachePos(team, 'targetPos', desiredPos)
            if (desiredId) {
                team.cache.focusTargetId = desiredId
                team.cache.focusTargetLockUntil = Game.time + lockTicks
            }
            delete team.cache.targetPosIndex
            return
        }

        if (!hasAttackTargets) {
            // 当 _targets 退化为 [flag] 或无可攻击目标时，强制回退到旗帜，避免追着历史 targetPos 跑
            if (!candidates.length) {
                if (!currentTargetPos.isEqualTo(team.flag.pos)) {
                    TeamUtils.setCachePos(team, 'targetPos', team.flag.pos)
                    delete team.cache.targetPosIndex
                }
                return
            }

            const currentInCandidates = candidatePosSet.has(currentTargetPos.hashCode())
            // 当前缓存不在候选集合内，说明目标已拆/切换或不可达，及时纠正到当前焦点，避免锁死到无效点
            if (currentTargetPos.isRoomEdge() || !currentInCandidates) {
                TeamUtils.setCachePos(team, 'targetPos', focusPos)
                delete team.cache.targetPosIndex
                return
            }
        }

        const reached =
            currentTargetPos.roomName === originPos.roomName &&
            originPos.getRangeTo(currentTargetPos) <= 1

        if (!reached || hasAttackTargets) return

        if (!candidates.length) {
            TeamUtils.setCachePos(team, 'targetPos', team.flag.pos)
            delete team.cache.targetPosIndex
            return
        }

        const posList = candidates.map((t) => t.pos).filter((p) => p && !p.isRoomEdge())
        const uniqPos: RoomPosition[] = []
        const visited = new Set<number>()
        posList.forEach((p) => {
            const h = p.hashCode()
            if (visited.has(h)) return
            visited.add(h)
            uniqPos.push(p)
        })

        if (!uniqPos.length) {
            // 目标都在房间边缘等场景会导致 uniqPos 为空，此时回退到焦点点，避免保留旧 targetPos 产生“锁死”
            TeamUtils.setCachePos(team, 'targetPos', focusPos)
            delete team.cache.targetPosIndex
            return
        }

        const nextIndex = ((team.cache.targetPosIndex || 0) + 1) % uniqPos.length
        team.cache.targetPosIndex = nextIndex
        TeamUtils.setCachePos(team, 'targetPos', uniqPos[nextIndex])
    },
};

export default teamActionObjMoveExec;
