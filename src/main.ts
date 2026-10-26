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
import { InvariantWatch } from "@/core/invariantWatch";
import { Visuals } from "@/modules/visuals";
import { Pixel } from "@/modules/economy";
import { ActorOwnershipSweep, ActorOwnershipPersist } from "@/runtime/actorOwnershipModule";

const nexus = createNexus(DEFAULT_PROFILE);

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
	InvariantWatch,
	Visuals,
	Pixel,
);

export const loop = nexus.loop();
