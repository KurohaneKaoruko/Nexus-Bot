/**
 * local 变体入口: 本地客户端 / 私服环境 (模块清单与 main 一致, 走 local 开关表)。
 */
import "../compat";
import { LOCAL_PROFILE } from "./profile";
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
import { FunnelEnd, InterShardEnd, ClearEnd, StatisticsEnd } from "@/core/endPhase";
import { EventBusEnd } from "@/core/event";
import { Visuals } from "@/modules/visuals";
import { Pixel } from "@/modules/economy";

const nexus = createNexus(LOCAL_PROFILE);

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
