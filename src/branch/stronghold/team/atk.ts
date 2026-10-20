import { combatRemoveFlag } from "@/modules/combat";
import { getTeamConfig } from "@/modules/teams/config/TeamConfig";
import type {
    SpecProvider,
    TeamSpawnSpec,
} from "@/modules/teams/runtime/TeamSpawner";
import { STRONGHOLD_TEAM } from "../config";

/**
 * 解析 ATK 攻击旗。
 *
 * @remarks
 * 旗名协议: `ATK[/_孵化房][/_配置][/_N次数][/_T间隔]`。\n
 * - 目标房 = 旗所在房间; 孵化房缺省取离旗最近的己方房; \n
 * - 配置缺省 `AIO/9`; 不带编队后缀的短名自动补 `/4` 或 `/2`; \n
 * - 次数缺省无限 (N0 同义); 间隔缺省 0 = 孵化队列空闲即派。
 */
export const atkSpecProvider: SpecProvider = (
    flagName: string,
    flag: Flag,
): TeamSpawnSpec | undefined => {
    const prefix = STRONGHOLD_TEAM.flagPrefix;
    if (
        flagName !== prefix &&
        !flagName.startsWith(`${prefix}/`) &&
        !flagName.startsWith(`${prefix}_`)
    ) {
        return undefined;
    }

    let spawnRoomName: string | undefined;
    let maxCount: number | undefined;
    let interval: number | undefined;
    const configSegments: string[] = [];

    for (const segment of flagName.slice(prefix.length).split(STRONGHOLD_TEAM.segmentSeparator)) {
        if (!segment) continue;

        const count = segment.match(STRONGHOLD_TEAM.countSegment);
        if (count) {
            maxCount = parseInt(count[1]!, 10);
            continue;
        }

        const tick = segment.match(STRONGHOLD_TEAM.intervalSegment);
        if (tick) {
            interval = parseInt(tick[1]!, 10);
            continue;
        }

        if (STRONGHOLD_TEAM.roomNameSegment.test(segment)) {
            spawnRoomName ??= segment.toUpperCase();
            continue;
        }

        configSegments.push(segment);
    }

    const config = resolveConfig(configSegments.join("/"));
    if (!config) {
        console.log(
            `[ATK] ${flagName} 配置不存在 (可用: AIO/9、AIO/4、AIOH/9、AIOD/9 等)`,
        );
        combatRemoveFlag(flagName);
        if (Memory.flags) delete Memory.flags[flagName];
        return undefined;
    }

    spawnRoomName ??= findNearestOwnedRoom(flag.pos.roomName);

    return {
        kind: "ATK",
        config,
        spawnRoomName,
        targetRoom: flag.pos.roomName,
        maxCount,
        interval: interval ?? STRONGHOLD_TEAM.defaultInterval,
        noMaxIsInfinite: true,
        keepOnBoostShortage: true,
        keepOnMissingRoom: true,
        blockUnownedController: false,
        teamCap: STRONGHOLD_TEAM.teamCap,
    };
};

/** 解析配置键: 缺省配置、短名补编队后缀, 全 miss 返回 undefined */
function resolveConfig(raw: string): string | undefined {
    const config = raw || STRONGHOLD_TEAM.defaultConfig;
    if (getTeamConfig(config)) return config;
    if (config.includes("/")) return undefined;

    for (const size of STRONGHOLD_TEAM.shortNameFormations) {
        const candidate = `${config}/${size}`;
        if (getTeamConfig(candidate)) return candidate;
    }
    return undefined;
}

/** 取离目标房最近的己方房; 无己方视野返回 undefined (由 keepOnMissingRoom 等待) */
function findNearestOwnedRoom(targetRoom: string): string | undefined {
    let nearest: string | undefined;
    let nearestDistance = Infinity;

    for (const room of Object.values(Game.rooms)) {
        if (!room.my) continue;
        const distance = Game.map.getRoomLinearDistance(room.name, targetRoom);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = room.name;
        }
    }

    return nearest;
}
