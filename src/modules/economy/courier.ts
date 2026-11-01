/**
 * 拉能快递发车闸门 (specs/rush-courier / bugs P1-14 升级直供):
 * 冲级特化下把 spawn 盈余能量自爆转运到升级圈——纯 CARRY 快递爬取满后向 cc/控制器
 * 方向自爆, 墓碑能量由升级工就近拾取。五闸门全部满足才发车:
 * ① 非防御应急态; ② spawn 空闲; ③ 升级圈有快断能的升级工 (墓碑要有紧急消费者);
 * ④ spawn 满仓 (真盈余); ⑤ 总能量在运作线之上 (基础孵化永不断档)。
 * 特化子模式: 冲级档 + RCL ≤ maxRcl + spawn 贴控制器 + 房内无 link。
 */
import { COURIER_CONFIG } from "@/config/economy";
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import { roomModeProfileFor } from "@/modules/strategy";
import { maxThreatScore, threatTierOf } from "@/modules/defense";
import { UNIT_CODES } from "@/constant/UnitConstant";
import { requestCourier } from "@/core/store/runtime";
import { createLedger } from "@/modules/economy/ledger";

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
	return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 特化子模式判定: 冲级档 + 低 RCL + spawn 贴控制器 + 无 link (正规供能链接接管即退位) */
export function specialRushActive(
	ctx: TickContext,
	room: RoomObservation,
	spawn?: { x: number; y: number },
): boolean {
	const profile = roomModeProfileFor(ctx, room.roomName);
	if (!profile.courierEnabled) {
		return false;
	}
	if (room.rcl > COURIER_CONFIG.maxRcl) {
		return false;
	}
	if (room.linkCount > 0) {
		return false;
	}
	const controller = room.controller;
	if (!spawn || !controller) {
		return false;
	}
	return chebyshev(spawn.x, spawn.y, controller.x, controller.y) <= COURIER_CONFIG.spawnRange;
}

/** 升级圈内快断能的升级工: 存量按 WORK 吞吐折算低于饥饿线 */
export function hasHungryUpgrader(room: RoomObservation): boolean {
	const controller = room.controller;
	if (!controller) {
		return false;
	}
	return room.creeps.some((creep) => {
		if (creep.unitCode !== UNIT_CODES.upgrader || creep.bodyWork <= 0) {
			return false;
		}
		if (chebyshev(creep.x, creep.y, controller.x, controller.y) > COURIER_CONFIG.controllerRange) {
			return false;
		}
		return creep.carryEnergy / creep.bodyWork < COURIER_CONFIG.hungryTicks;
	});
}

/**
 * 发车判定 (Economy planning 阶段逐房调用): 过五闸门后按「spawn 存量与运作线之上的
 * 较小盈余」产出孵化预算登记运行时队列, 由孵化阶段消费。
 */
export function planCourierRequests(ctx: TickContext): void {
	const world = ctx.world.current;
	if (!world) {
		return;
	}
	for (const room of Object.values(world.rooms)) {
		const spawn = room.energyStructures.find((structure) => structure.structureType === "spawn");
		if (!spawn || !room.controller) {
			continue;
		}
		// 闸门①: 防御应急态不发车 (能量留给防御)
		if (threatTierOf(maxThreatScore(ctx.memory)) !== "peace") {
			continue;
		}
		// 特化子模式总闸
		if (!specialRushActive(ctx, room, spawn)) {
			continue;
		}
		// 闸门②: spawn 忙碌不发车——快递绝不挤占基础孵化
		if (room.spawnBusy) {
			continue;
		}
		// 闸门③: 升级圈有快断能的升级工才发车
		if (!hasHungryUpgrader(room)) {
			continue;
		}
		// 闸门④: spawn 满仓 (真盈余) 才发车
		if (spawn.energy < spawn.energyCapacity) {
			continue;
		}
		// 闸门⑤: 总能量运作线——抽完后基础孵化存量仍有保障
		// Available 口径 (specs/resource-ledger): 已发出的 fill_spawn 在途承诺
		// 是孵化线的既定供给, 不得被快递预算重复花销
		const ledger = createLedger(ctx);
		let committedToSpawns = 0;
		for (const structure of room.energyStructures) {
			committedToSpawns += ledger.committedTo(room.roomName, structure.id);
		}
		const capacity = room.energyStructures.reduce((sum, s) => sum + s.energyCapacity, 0);
		const energy = room.energyStructures.reduce((sum, s) => sum + s.energy, 0);
		const opFloor = capacity * COURIER_CONFIG.opFloorRatio;
		if (energy <= opFloor + committedToSpawns) {
			continue;
		}
		const budget = Math.min(
			spawn.energy - COURIER_CONFIG.reserveFloor,
			energy - opFloor - committedToSpawns,
		);
		if (budget < BODYPART_COST[CARRY]) {
			continue;
		}
		requestCourier({
			roomName: room.roomName,
			budget,
			priority: COURIER_CONFIG.priority,
			reason: "rush-courier",
		});
	}
}
