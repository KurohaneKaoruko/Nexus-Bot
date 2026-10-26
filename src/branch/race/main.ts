/**
 * race 变体入口: 冲级服 Nexus 主线 (roomMode=rush 固定档, speedrun 榜口径)。
 * 构建开关 SPEEDRUN_MODE=1 时 rolldown 改用 ./speedrunEntry (冲级赛直通)。
 * 私服环境垫片保持首个 import (缺 Power 类/市场 API 时补桩降级)。
 */
import "../compat";
import { RACE_PROFILE } from "./profile";
import { configureServerCaps } from "@/config/capabilities";
import { createNexus } from "@/core/nexus";
import { Perception } from "@/modules/world";
import { ActorOwnershipSweep, ActorOwnershipPersist } from "@/runtime/actorOwnershipModule";
import { Defense } from "@/modules/defense";
import { StrategyCore } from "@/modules/strategy";
import { Economy } from "@/modules/economy";
import { Cluster } from "@/modules/cluster";
import { Tasks } from "@/modules/tasks";
import { Spawning } from "@/modules/spawning";
import { Agents, Broker } from "@/modules/agents";
import { Planner } from "@/modules/planner";
import { RoomFeatures } from "@/proto/features";
import { Teams } from "@/modules/teams";
import { Industry } from "@/modules/industry";
import { PowerCreeps } from "@/proto/PowerCreep";
import { EventBus } from "@/core/event";
import { Nukes } from "@/modules/industry";
import { InterShard } from "@/modules/intershard";
import { Expansion } from "@/modules/external";
import { Comms } from "@/modules/comms";
import { FunnelEnd, InterShardEnd, ClearEnd, StatisticsEnd } from "@/core/endPhase";
import { EventBusEnd } from "@/core/event";
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
	ActorOwnershipSweep,
	Defense,
	StrategyCore,
	Economy,

	Cluster,
	Tasks,
	Spawning,
	Agents,
	Planner,
	Broker,
	RoomFeatures,
	Industry,
	Teams,
	PowerCreeps,
	EventBus,
	Nukes,
	InterShard,
	Expansion,
	Comms,
	EventBusEnd,
	FunnelEnd,
	InterShardEnd,
	ClearEnd,
	StatisticsEnd,
	ActorOwnershipPersist,
	Visuals,
	Pixel,
);

export const loop = nexus.loop();
