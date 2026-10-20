import {
    member,
    registerTeamConfig,
    type TeamMemberConfig,
} from "@/modules/teams/config/TeamConfig";
import { STRONGHOLD_TEAM, STRONGHOLD_TEAM_BODIES } from "../config";

/**
 * 要塞服一体机小队配置: 全员同规格 (远程+治疗一体), 任意存活子集仍是完整战力。
 *
 * @remarks
 * 体型顺序 T → R/H → M: 承伤部件在前, 治疗与机动力最后损失;
 * N 后缀表示无 boost——要塞服不跑强化链, 成员出生即战力。
 */
const bodies: Record<string, TeamMemberConfig> = {
    AIO: member(STRONGHOLD_TEAM_BODIES.AIO),
    AIOH: member(STRONGHOLD_TEAM_BODIES.AIOH),
    AIOD: member(STRONGHOLD_TEAM_BODIES.AIOD),
};

/**
 * 闪电战体型: 盾队 (SRG) 肉盾开路 + 蓝球 (SRD) 散爬输出。
 *
 * @remarks
 * - SRG 首员 T40M10 纯肉盾 (只扛伤不输出, unit 缺省 team-ranged),
 *   其余 M5H40M5 全奶 (显式 unit = team-heal);
 * - SRD 单爬 R40M10, 40 远程齐射拆 rampart/建筑。
 */
const blitzBodies: Record<string, TeamMemberConfig> = {
    SRG: member("T40M10N"),
    SRG_HEAL: { ...member("M5H40M5N"), unit: "team-heal" },
    SRD: member("R40M10N"),
};

const configs: Record<string, TeamMemberConfig[]> = {};

for (const name in bodies) {
    const body = bodies[name]!;
    for (const size of STRONGHOLD_TEAM.formations) {
        configs[`${name}/${size}`] = Array<TeamMemberConfig>(size).fill(body);
    }
}

// SRG/4: 盾队 = 1 肉盾队长 + 3 全奶 (quad 2x2)
configs["SRG/4"] = [
    blitzBodies.SRG!,
    blitzBodies.SRG_HEAL!,
    blitzBodies.SRG_HEAL!,
    blitzBodies.SRG_HEAL!,
];

// SRD/1: 蓝球散爬
configs["SRD/1"] = [blitzBodies.SRD!];

registerTeamConfig(configs);
