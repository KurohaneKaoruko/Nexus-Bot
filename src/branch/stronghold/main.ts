/**
 * stronghold 变体入口: 要塞挑战服 (RCL8 锁定 / 无限能量 spawn / 无源房)。
 *
 * 只挂载孵化与战斗: 原型扩展 + BetterMove 钩子 + Teams + 指挥旗落位。
 * 经济/扩张/工业/战略/感知等模块不加载。
 */
import "../compat";
import { STRONGHOLD_PROFILE } from "./profile";
import { configureServerCaps } from "@/config/capabilities";
import { STRONGHOLD_SERVER_CAPS } from "./config";
import { createNexus } from "@/core/nexus";
import { mountStrongholdPrototypes } from "./prototypes";
import { StrongholdMoveStart, StrongholdMoveEnd } from "./movement";
import { Teams } from "@/modules/teams";
import { StrongholdAnchor } from "./team/anchor";
import { StrongholdBlitz } from "./team/blitz";
import "./team";

const nexus = createNexus(STRONGHOLD_PROFILE);

configureServerCaps(STRONGHOLD_SERVER_CAPS);
mountStrongholdPrototypes();

nexus.use(
	StrongholdMoveStart,
	Teams,
	StrongholdMoveEnd,
	StrongholdBlitz,
	StrongholdAnchor,
);

export const loop = nexus.loop();
