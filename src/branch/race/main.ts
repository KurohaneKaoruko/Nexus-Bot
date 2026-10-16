/**
 * race 变体入口: 冲级服 (roomMode=rush 固定档, speedrun 榜口径)。
 * 私服环境垫片保持首个 import (缺 Power 类/市场 API 时补桩降级)。
 */
import "../compat";
import { RACE_PROFILE } from "./profile";
import { configureServerCaps } from "@/config/capabilities";
import { createNexus } from "@/core/nexus";
import { Perception } from "@/modules/world";
import { Defense } from "@/modules/defense";
import { StrategyCore } from "@/modules/strategy";
import { Economy } from "@/modules/economy";
import { Cluster } from "@/modules/cluster";
import { Tasks } from "@/modules/tasks";
import { Spawning } from "@/modules/spawning";
import { Agents, Broker } from "@/modules/agents";
import { Planner } from "@/modules/planner";
import { RoomFeatures } from "@/modules/prototype/features";
import { Teams } from "@/modules/teams";
import { Industry } from "@/modules/industry";
import { PowerCreeps } from "@/modules/prototype/PowerCreep";
import { EventBus } from "@/core/event";
import { Nukes } from "@/modules/industry";
import { InterShard } from "@/modules/intershard";
import { Expansion } from "@/modules/external";
import { EndPhase } from "@/core/endPhase";
import { Visuals } from "@/modules/visuals";
import { Pixel } from "@/modules/economy";

const nexus = createNexus(RACE_PROFILE);

// 冲级服能力声明 (对齐 Rosmarin race fork): 产业/防御建筑全禁——
// 冲级期能量全部投给 ext/仓库/孵化, terminal/lab/factory 等无冲级收益
// (speedrun 榜口径不产产业分), rampart/wall 不灌能量。
configureServerCaps({
	raceCompat: true,
	skipBuildTypes: [
		"factory",
		"nuker",
		"terminal",
		"lab",
		"powerSpawn",
		"observer",
		"extractor",
		"rampart",
		"wall",
	],
});

nexus.use(
	Perception,
	Defense,
	StrategyCore,
	Economy,

	Cluster,
	Tasks,
	Spawning,
	Agents,
	Broker,
	Planner,
	RoomFeatures,
	Industry,
	Teams,
	PowerCreeps,
	EventBus,
	Nukes,
	InterShard,
	Expansion,
	EndPhase,
	Visuals,
	Pixel,
);

export const loop = nexus.loop();
