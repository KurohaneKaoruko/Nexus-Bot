/**
 * race 变体入口: 冲级服主线 (roomMode=rush 固定档, speedrun 榜口径)。
 *
 * 结构 = 主代码内核 (装配/调度/校准/遥测/错误边界) + RaceSpeedrun 单模块。
 * 模块清单差异不是随意的裁剪, 是冲级口径的硬约束:
 *  - 不挂 Agents/Broker: betterMove 原型覆写在 Broker 结算, 与 speedrun
 *    引擎的裸 move/moveTo 语义互斥; 且 Planner 等系统的意图队列以 Broker
 *    为唯一消费方, 缺席时意图滞留 (无 Broker 的链上不能挂提交意图的模块);
 *  - 不挂主链行为模块 (Spawning/Planner/Economy 等): sim 冲级场景把全 9 房
 *    controller 报 my=true (8 个 rcl=0 幽灵房), 主链模块会把幽灵房当己房
 *    处理 (布局记录/孵化/工地配额全被污染); 且与引擎的孵化/放量节奏互抢;
 *  - 挂 RaceSpeedrun (commit P0) 承担全部冲级行为。
 * 变体差异收敛在两处标准机制: use 清单 / profile 固定档。
 * (caps 能力声明的消费方 Planner/Spawning 等不在本链上, 不再声明)
 * 私服环境垫片保持首个 import (缺 Power 类/市场 API 时补桩降级)。
 */
import "../compat";
import { RACE_PROFILE } from "./profile";
import { RaceSpeedrun } from "./speedrunModule";
import { createNexus } from "@/core/nexus";
import { ActorOwnershipSweep, ActorOwnershipPersist } from "@/runtime/actorOwnershipModule";

const nexus = createNexus(RACE_PROFILE);

nexus.use(
	ActorOwnershipSweep,
	ActorOwnershipPersist,
	RaceSpeedrun,
);

export const loop = nexus.loop();
