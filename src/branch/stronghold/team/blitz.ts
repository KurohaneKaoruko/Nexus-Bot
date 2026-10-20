import type { TickModule } from "@/core";
import { getBotMemory, getTeamData } from "@/core/store/accessor";
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
    // 盾队减员即残阵 (quad 破碎战力骤降), 解散残队交由调度器重建满编
    let guardTeams = 0;
    let rangedTeams = 0;
    for (const teamID in teamData) {
        const team: any = teamData[teamID];
        if (team?.targetRoom !== targetRoom) continue;
        if (team?.configKey === STRONGHOLD_BLITZ.guardConfig) {
            if (team.status === 'attack' && (team.creeps?.length ?? 0) < (team.num ?? 0)) {
                dissolveTeam(teamID, team.creeps ?? []);
                continue;
            }
            guardTeams += 1;
        } else if (team?.configKey === STRONGHOLD_BLITZ.rangedConfig) {
            rangedTeams += 1;
        }
    }

    // 盾队未满: 只保盾队旗, 蓝球旗不立
    const guardSatisfied = guardTeams >= STRONGHOLD_BLITZ.guardTeamCap;
    if (!guardSatisfied) {
        ensureAtkFlag(GUARD_FLAG, targetRoom);
        removeFlagIfExists(RANGED_FLAG);
        state.guardReadyTick = undefined;
        return;
    }

    // 盾队满员: 记录时刻; 延迟窗口后开蓝球波次
    state.guardReadyTick ??= Game.time;
    if (Game.time - state.guardReadyTick < STRONGHOLD_BLITZ.rangedDelayTicks) return;

    ensureAtkFlag(GUARD_FLAG, targetRoom);
    if (rangedTeams < STRONGHOLD_BLITZ.rangedCap) {
        ensureAtkFlag(RANGED_FLAG, targetRoom);
    } else {
        removeFlagIfExists(RANGED_FLAG);
    }
}

/** 解散残阵盾队: 自杀存活成员, 清队伍数据与指挥旗 (与全灭同口径) */
function dissolveTeam(teamID: string, creepIds: string[]): void {
    for (const id of creepIds) {
        const creep = Game.getObjectById(id) as Creep | null;
        if (creep) creep.suicide();
    }
    delete getTeamData()[teamID];
    Game.flags[`Team-${teamID}`]?.remove();
    console.log(`[Blitz] 盾队 ${teamID} 减员解散, 待重建`);
}

/** 在目标房建 ATK 旗 (已存在不动; 失败下个窗口重试) */
function ensureAtkFlag(flagName: string, targetRoom: string): void {
    if (Game.flags[flagName]) return;
    try {
        new RoomPosition(25, 25, targetRoom).createFlag(flagName, COLOR_RED, COLOR_RED) as number;
    } catch {
        // 无视野等建旗失败: 静默重试
    }
}

function removeFlagIfExists(flagName: string): void {
    Game.flags[flagName]?.remove();
}
