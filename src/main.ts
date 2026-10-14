/**
 * main 变体入口: 官服部署口径 (纯 Nexus 模块清单)。
 */
import { DEFAULT_PROFILE } from "@/config/profile";
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
import { RoomFeatures } from "@/modules/agents/prototype/features";
import { Teams } from "@/modules/teams";
import { Industry } from "@/modules/industry";
import { PowerCreeps } from "@/modules/industry/powerCreep";
import { EventBus } from "@/core/event";
import { Nukes } from "@/modules/teams";
import { InterShard } from "@/modules/intershard";
import { Expansion } from "@/modules/external/expand";
import { EndPhase } from "@/core/endPhase";
import { Visuals } from "@/modules/visuals";
import { Pixel } from "@/modules/economy/pixel";

const nexus = createNexus(DEFAULT_PROFILE);

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
