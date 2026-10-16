/**
 * season 变体入口: 赛季服 (占位, 模块清单与 main 一致)。
 */
import "../compat";
import { SEASON_PROFILE } from "./profile";
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

const nexus = createNexus(SEASON_PROFILE);

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
