import type { TickModule } from "@/core";
import { getBotMemory, getTeamData, getTeamPendingSpawns } from "@/core/store/accessor";
import { getTeamConfig } from "@/modules/teams/config/TeamConfig";
import { expandBodyParts } from "@/modules/teams/runtime/TeamSpawner";
import { STRONGHOLD_BLITZ } from "../config";

/**
 * 闪电战调度器: 盾队 + 蓝球波次自动展开。
 *
 * @remarks
 * 玩家只插一面 BLITZ 旗在要塞房, 调度器自动维护两类兵力:
 * - 盾队 (guardConfig): 2x2 抗伤阵顶塔开路, 数量 = guardTeamCap;
 * - 蓝球 (rangedConfig): 散装远程爬, 盾队满员且延迟窗口后逐波补齐至 rangedCap。
 * 全部经 ATK 旗协议走 TeamSpawner 标准孵化管线, 不自建孵化逻辑;
 * ATK 旗 N 次数派满自动拆旗, 重建即重置计数 → 伤亡自动补兵。
 */
export const StrongholdBlitz: TickModule = {
    name: "stronghold-blitz",
    phase: "commit",
    band: "P0",
    run(): void {
        runBlitz();
    },
};

/** BLITZ 指令旗名 (插在要塞房即启动闪电战) */
const BLITZ_FLAG = "BLITZ";
/** 盾队 ATK 旗名 (N = guardTeamCap) */
const GUARD_FLAG = `ATK/${STRONGHOLD_BLITZ.guardConfig}/N${STRONGHOLD_BLITZ.guardTeamCap}`;
/** 蓝球 ATK 旗名 (N = rangedCap) */
const RANGED_FLAG = `ATK/${STRONGHOLD_BLITZ.rangedConfig}/N${STRONGHOLD_BLITZ.rangedCap}`;

function getBlitzState(): NonNullable<BotMemory['BlitzState']> {
    const mem = getBotMemory() as any;
    return (mem.BlitzState ??= {}) as NonNullable<BotMemory['BlitzState']>;
}

function runBlitz(): void {
    if (Game.time % STRONGHOLD_BLITZ.spotScanInterval !== 0) return;

    const commandFlag = Game.flags[BLITZ_FLAG];
    if (!commandFlag) return;
    const targetRoom = commandFlag.pos.roomName;

    const state = getBlitzState();
    const teamData = getTeamData();

    // 统计场上存活的盾队/蓝球数 (按建队配置键, 不含孵化队列);
    // 盾队减员走补孵缺员 (活爬继续战斗, 缺的名额进 TeamPendingSpawns
    // 由 retryPendingSpawns 逐名补齐), 不解散不自杀——解散重建 = 全队
    // 回孵化房重走 600+ tick, 减员循环导致永远推不到核心
    let guardTeams = 0;
    let guardFullTeams = 0;
    let rangedTeams = 0;
    for (const teamID in teamData) {
        const team: any = teamData[teamID];
        if (!team?.configKey) continue;
        // 计数按配置键全局统计: 旗一旦跨房, 球队 targetRoom 会被改写成老家,
        // 按 targetRoom 过滤会漏数 → 上限失效 → 无限补队堆积 (实测堆到 9 队)
        if (team.configKey === STRONGHOLD_BLITZ.guardConfig) {
            // 存活数按 Game.creeps 实计: team.creeps 是 rejoin 后的登记表,
            // 新孵出的爬在归队前不计, 会让补孵误判缺员 → 超编
            const full = teamAliveCount(teamID) >= (team.num ?? 0);
            // 减员补孵不看状态: ready 期丢员同样补, 否则队伍永远集不齐
            if (!full) {
                reinforceTeam(teamID, team, teamData);
            }
            guardTeams += 1;
            if (full) guardFullTeams += 1;
        } else if (team.configKey === STRONGHOLD_BLITZ.rangedConfig) {
            rangedTeams += 1;
        }
    }

    // 盾队未满: 只保盾队旗, 蓝球旗不立
    const guardSatisfied = guardTeams >= STRONGHOLD_BLITZ.guardTeamCap;
    if (!guardSatisfied) {
        ensureAtkFlag(GUARD_FLAG, targetRoom, COLOR_RED);
        removeFlagIfExists(RANGED_FLAG);
        state.guardReadyTick = undefined;
        return;
    }

    // 一个满员盾队都没有 = 耗能位没人挡, 此时出生的球会被塔按"最近目标"逐个点掉,
    // 先停蓝球 (已出生的球由 anchor 撤回孵化房门口)
    if (guardFullTeams === 0) {
        removeFlagIfExists(RANGED_FLAG);
        state.guardReadyTick = undefined;
        state.blitzPhase = 'gather';
        return;
    }
    // 盾队各队满员 + 延迟窗口后才出蓝球;
    // 盾队减员不关波次 (reinforce 自动补), 蓝球断供 = 塔回能 = 前功尽弃
    if (guardFullTeams < STRONGHOLD_BLITZ.guardTeamCap && state.blitzPhase !== 'waves') {
        removeFlagIfExists(RANGED_FLAG);
        state.guardReadyTick = undefined;
        return;
    }
    state.blitzPhase = 'waves';

    // 盾队满员: 记录时刻; 延迟窗口后开蓝球波次
    state.guardReadyTick ??= Game.time;
    if (Game.time - state.guardReadyTick < STRONGHOLD_BLITZ.rangedDelayTicks) return;

    // 盾队数已达 cap 不再立盾队旗: N 拆旗后无条件重建 = 无限派新盾队堆积
    if (guardTeams < STRONGHOLD_BLITZ.guardTeamCap) {
        ensureAtkFlag(GUARD_FLAG, targetRoom, COLOR_RED);
    }
    if (rangedTeams < STRONGHOLD_BLITZ.rangedCap) {
        // 蓝球同用 rush: 无奶单体受伤必判 flee, 撤了就永远没输出
        ensureAtkFlag(RANGED_FLAG, targetRoom, COLOR_PURPLE);
    } else {
        removeFlagIfExists(RANGED_FLAG);
    }
}

/** 盾队减员补孵: 按建队配置补齐缺的名额 (活爬继续战斗, 不解散不自杀)。
 * 缺员写入 TeamPendingSpawns, 与建队孵化同一管线逐名补齐;
 * 新成员孵化后经 rejoin 归队 (TeamController 标准流程)。 */
function reinforceTeam(teamID: string, team: any, teamData: Record<string, any>): void {
    const pending = getTeamPendingSpawns();
    if (pending[teamID]?.members?.length) return; // 已有补孵在途
    const room = Game.rooms[team.homeRoom];
    if (!room) return;
    const config = getTeamConfig(team.configKey);
    if (!config) return;
    // 在途成员必须计入已占坑: pending 队列孵完后条目即删, 但爬还在
    // spawn 里孵化 (rejoin 前不进 team.creeps), 不计则每 tick 重复补孵 → 超编
    const spawning = room.find(FIND_MY_SPAWNS).filter((s) => s.spawning)
        .filter((s) => (Memory.creeps?.[s.spawning!.name]?.teamID) === teamID).length;
    const alive = Math.max(team.creeps?.length ?? 0, teamAliveCount(teamID));
    const missing = (team.num ?? 0) - alive - spawning;
    if (missing <= 0) return;
    // 按存活成员的 unit 分布补缺口 (肉盾死则补肉盾, 奶死则补奶)
    const aliveUnits = (team.creeps ?? [])
        .map((id: string) => (Game.getObjectById(id) as Creep | null)?.memory?.unit)
        .filter(Boolean);
    const missingSpecs = [...config];
    for (const unit of aliveUnits) {
        const idx = missingSpecs.findIndex((c) => c.unit === unit);
        if (idx >= 0) missingSpecs.splice(idx, 1);
    }
    pending[teamID] = {
        roomName: team.homeRoom,
        members: missingSpecs.slice(0, missing).map((c) => ({
            unit: c.unit,
            memory: { teamID } as CreepMemory,
            body: expandBodyParts(c.bodypart),
        })),
    };
    console.log(`[Blitz] 盾队 ${teamID} 减员 (${alive}/${team.num}, 孵化中 ${spawning}), 补孵 ${Math.min(missing, missingSpecs.length)} 名`);
}

/** 场内实存活成员数 (按 creep 记忆里的 teamID 统计, 不依赖归队登记) */
function teamAliveCount(teamID: string): number {
    let count = 0;
    for (const name in Game.creeps) {
        if (Game.creeps[name]?.memory.teamID === teamID) count += 1;
    }
    return count;
}

/** 在目标房建 ATK 旗 (已存在不动; 失败下个窗口重试)。
 * 盾队旗副色 PURPLE → 建队指挥旗继承 rush 模式 (恒 attack 不 flee, 死战不退) */
function ensureAtkFlag(flagName: string, targetRoom: string, secondaryColor: ColorConstant = COLOR_RED): void {
    if (Game.flags[flagName]) return;
    // Memory.flags 残留 (旧簿记只剩计数、没有坐标) 会让 createFlag 返回 NAME_EXISTS
    // 但旗不落地, 整条出兵链静默停摆 —— 先清残留再建
    if (Memory.flags?.[flagName]) delete Memory.flags[flagName];
    try {
        const result = new RoomPosition(25, 25, targetRoom).createFlag(flagName, COLOR_RED, secondaryColor) as number;
        if (result !== OK) console.log(`[Blitz] 建旗 ${flagName} 失败: ${result}`);
    } catch {
        // 无视野等建旗失败: 静默重试
    }
}

function removeFlagIfExists(flagName: string): void {
    Game.flags[flagName]?.remove();
}
