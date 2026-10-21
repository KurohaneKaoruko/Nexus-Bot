
import Team from "@/modules/teams/core/TeamClass";
import TeamCalc from "@/modules/teams/core/TeamCalc";
import TeamUtils from "@/modules/teams/core/TeamUtils";
import { getTeamData } from "@/core/store/accessor";
import { getTeamCreeps } from "@/utils/creepTickIndex";
import { isBoostResCheckEnabled } from "@/config/capabilities";
import { getBoostCache } from "@/proto";
import { combatMove, combatMoveTo, combatRemoveFlag, combatSuicide, holdActor, releaseTeamActors } from "@/modules/combat";
/**
 * Team 执行调度器（运行时）。
 *
 * @remarks
 * - 本模块是 Team 系统的执行端：驱动 Team creep 的 boost/归队，并驱动 Team 的状态机。\n
 * - 生成端（创建 TeamData、下发孵化）在 TeamSpawner。\n
 * - 数据源：Memory.Nexus.TeamData[teamID]（队伍状态与成员列表）。
 */
const TeamController = {
    /**
     * Team 主入口（每 tick 调用）。
     *
     * @remarks
     * 执行顺序：\n
     * 1) 处理 Team creep：boost、归队、异常清理\n
     * 2) 处理 Team：集结/移动/战斗/解散
     */
    run(): void {
        this.runCreeps();
        this.runTeams();
    },

    /**
     * 驱动 Team creep 行为（boost 与归队）。
     *
     * @remarks
     * - Team creep 判定：unit 以 `team` 开头。\n
     * - boost：若 creep.memory.boostmap 存在，则调用 creep.goBoost({ must: true })，直到完成。\n
     * - 归队：首次完成 boost 后，把 creep.id 推入 Memory.Nexus.TeamData[teamID].creeps。\n
     * - 若 TeamData 已被删除，则 creep 自杀，避免残留占用资源。
     */
    runCreeps(): void {
        // 小队成员的行为
        for (const creep of getTeamCreeps()) {
            if (!creep || creep.spawning) continue;
            // getTeamCreeps() 已筛选 team 角色，这里保留兜底判断避免脏内存导致异常
            const unit = creep.memory.unit || '';
            if (!unit.startsWith('team')) continue;
            holdActor(creep.name);

            // 关闭 notify（只设置一次）
            if (!creep.memory.notified) {
                creep.notifyWhenAttacked(false);
                creep.memory.notified = true;
            }

            // boost
            if (!getBoostCache(creep.memory).boosted) {
                const boostmap = creep.memory['boostmap'];
                if (boostmap && isBoostResCheckEnabled()) {
                    // Team Creep 必须完成 Boost (must: true)，任务配额扣减由 Boost 内部自动处理
                    const result = creep.goBoost(boostmap, { must: true });
                    if (result === OK) {
                        getBoostCache(creep.memory).boosted = true;
                        delete creep.memory['boostmap'];
                    }
                } else {
                    // 不做 boost 检查：孵化即满状态，直接视为已强化
                    getBoostCache(creep.memory).boosted = true;
                    delete creep.memory['boostmap'];
                }
                continue;
            }

            // 归队
            if (!creep.memory['rejoin']) {
                const teamID = creep.memory['teamID'];
                const team = getTeamData(teamID);
                if (!team) {
                    // 队伍已删 (减员解散/重建): 未归队成员成孤儿无人指挥, 自杀回收
                    combatSuicide(creep);
                    continue;
                }
                team.creeps.push(creep.id);
                creep.memory['rejoin'] = true;
            }
            const teamID = creep.memory['teamID'];
            if (!getTeamData(teamID)) combatSuicide(creep);
        }
    },

    /**
     * 驱动队伍状态机（TeamClass.exec）。
     *
     * @remarks
     * - status=ready：等待成员集齐；超时会解散并移除 Team-xxxx 标记旗。\n
     * - 成员齐全：按伤害排序，切换到 attack。\n
     * - 成员全部死亡：解散。\n
     * - 仅剩治疗者：把 healer 重新分配到未满员的队伍，尽量提高存活率。
     */
    runTeams(): void {
        // 独立的治疗者
        let soloHealers = [];
        // 未满的队伍
        let noFullTeams = [];

        // 小队管理
        const teamRoot = getTeamData();
        if (Object.keys(teamRoot).length === 0) return;

        for (const teamID in teamRoot) {
            let cpu = Game.cpu.getUsed();

            const teamData = teamRoot[teamID] as TeamMemory;
            if (teamData.name !== teamID) teamData.name = teamID;

            // 检查小队成员是否齐全
            if (teamData.status === 'ready') {
                // 清理无效 Creep ID
                teamData.creeps = teamData.creeps.filter((id: any) => Game.getObjectById(id));

                // 检查小队是否超时未集结
                // 1. 长期超时 (50000 tick)
                // 2. 空队超时 (5000 tick): 如果 creep 死光了还没组建好，说明失败
                if (Game.time - teamData['time'] > 50000 ||
                   (teamData.creeps.length === 0 && Game.time - teamData['time'] > 5000)) {
                    // 解散交接: 先归还成员控制权再清队伍数据, 无真空 (控制权立即可被再获取)
                    releaseTeamActors(teamData.creeps);
                    delete teamRoot[teamID];
                    console.log(`${teamID}小队因组建超时或失败已解散.`);
                    combatRemoveFlag(`Team-${teamID}`);
                    continue;
                }
                // 如果成员未齐: 有指挥旗走旗位集结；无旗（目标房无视野建不出）
                // 未进目标房的成员向目标房中心行进；已进目标房的在进门处原地待机（房间门口待机），
                // 聚齐后由 attack 状态整队推进
                if (teamData.creeps.length < teamData.num) {
                    let teamFlag = Game.flags[`Team-${teamID}`]
                    // 指挥旗自愈: 目标房中心补建 (pos.createFlag 原型重写, 无视野可用)。
                    // 不建在孵化房: 旗位置会牵引 targetRoom 回老家 (以旗为准口径)。
                    if (!teamFlag && teamData.targetRoom) {
                        try {
                            new RoomPosition(25, 25, teamData.targetRoom).createFlag(`Team-${teamID}`) as number;
                            teamFlag = Game.flags[`Team-${teamID}`];
                        } catch { /* 引擎拒绝时下 tick 重试 */ }
                    }
                    if (teamFlag) {
                        // 家房侧门口集结: 满员前绝不过房 (散队过房 = 被守军逐个吃掉)。
                        // 指挥旗在目标房深处, 朝旗直走会把单个成员牵出房缘送死
                        const doorPos = teamData.homeRoom && teamData.targetRoom
                            ? TeamUtils.doorGatherPos(teamData.homeRoom, teamData.targetRoom)
                            : undefined;
                        if (doorPos) {
                            teamData.creeps.forEach((creepID: any) => {
                                const creep = Game.getObjectById(creepID) as Creep;
                                if (!creep) return;
                                if (creep.room.name === teamData.homeRoom) {
                                    if (!creep.pos.inRangeTo(doorPos, 2)) {
                                        combatMoveTo(creep, doorPos, { range: 2 });
                                    }
                                } else if (creep.room.name === teamData.targetRoom) {
                                    // 已过房成员 (掉队/补孵迟到): 贴门内侧待命, 不深入
                                    const back = TeamUtils.routeExitDir(creep.room.name, teamData.homeRoom!);
                                    if (back) combatMove(creep, ((back + 3) % 8 + 1) as DirectionConstant);
                                }
                            });
                        } else {
                            teamData.creeps.forEach((creepID: any) => {
                                const creep = Game.getObjectById(creepID) as Creep;
                                if (!creep) return;
                                if (creep.room.name == teamData.homeRoom &&
                                    !creep.pos.isNearEdge(4) &&
                                    !creep.pos.inRangeTo(teamFlag, 3)
                                ) {
                                    combatMoveTo(creep, teamFlag, { range: 3 });
                                }
                            });
                        }
                    } else {
                        // 无指挥旗：目标房无视野时按兵不动（在孵化房待命）。
                        // 指挥旗落点通常在无视野的目标房, 建旗失败/延迟期间若按目标房推进,
                        // 未集齐的散队会被要塞火力逐个击杀。目标房有视野时仍向房门推进。
                        if (Game.rooms[teamData.targetRoom!]) {
                            for (const creep of teamData.creeps.map(Game.getObjectById).filter(Boolean) as Creep[]) {
                                if (creep.room.name === teamData.targetRoom) continue;
                                const dir = TeamUtils.routeExitDir(creep.room.name, teamData.targetRoom!);
                                if (dir) combatMove(creep, dir);
                            }
                        }
                    }
                    continue;
                }
                // 成员集齐则排序, 结束准备状态
                const creeps = teamData.creeps.map(Game.getObjectById).filter(Boolean) as Creep[];
                const creepDamageById: Record<string, number> = {};
                for (const creep of creeps) {
                    creepDamageById[creep.id] = TeamCalc.calcCreepDamage(creep);
                }
                creeps.sort((a, b) => creepDamageById[b.id]! - creepDamageById[a.id]!);
                teamData.creeps = creeps.map(creep => creep.id);
                teamData.status = 'attack';
                continue;
            }

            let team = new Team(teamData);

            // 检查小队是否全部死亡
            if (!team.creeps || team.creeps.length === 0) {
                // 解散交接: 先归还成员控制权 (空队为无操作) 再清队伍数据
                releaseTeamActors(teamData.creeps);
                delete teamRoot[teamID];
                console.log(`${teamID}小队因成员全部死亡已解散.`);
                combatRemoveFlag(`Team-${teamID}`);
                continue;
            }

            // 小队行动
            team.exec();
            // 保存队伍数据
            team.save(teamData);

            // 将剩余的heal分配到其他不满员的队伍中
            if (team.creeps.every(creep => creep.memory.unit === 'team-heal')) {
                // 如果一个队伍只剩heal, 标记为独立治疗者
                soloHealers.push(...team.creeps);
            } else if (team.creeps.length < teamData.num) {
                // 记录未满的队伍
                noFullTeams.push([teamID, teamData]);
            }

            if (Game.flags['Team-showCPU'])
                console.log(`${teamID}小队行动消耗: ${Game.cpu.getUsed() - cpu}`);
        }

        // 分配独立治疗者到未满的队伍中
        for (const [teamID, teamData] of noFullTeams) {
            if (soloHealers.length === 0) break;
            let healer = soloHealers.pop();
            // 从当前队伍列表中移除该 creep
            let creepTeamData = getTeamData(healer!.memory['teamID']!) as TeamMemory | undefined
            if (!creepTeamData) continue;
            let index = creepTeamData.creeps.indexOf(healer!.id!);
            creepTeamData.creeps.splice(index, 1);
            // 把creep加入新的队伍
            (teamData as TeamMemory).creeps.push(healer!.id!);
            healer!.memory['teamID'] = teamID;
        }
    },
};

export default TeamController;
