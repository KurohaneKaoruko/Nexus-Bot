/**
 * broker 结构/房级/系统管线执行器 (api/06): 指挥旗、塔/SafeMode、工地/市场/孵化/占领/Power。
 * 从 actionBroker 闭包原样提升 (拆分任务 3.4), 零逻辑改动。
 */
import type { ActionPlan, ActionResult } from "@/modules/agents/brokerTypes";
import { type ExecutorBase, resolveTarget, triageCode } from "@/modules/agents/brokerExecutorsShared";

/** 旗标执行: 编队指挥旗创建/移除 (房级命令, 无租约语义) */
export function executeFlagAction(
	plan: ActionPlan,
	base: ExecutorBase,
	invalid: (reason: string) => ActionResult,
): ActionResult {
	const payload = plan.payload ?? {};
	switch (plan.kind) {
		case "createFlag": {
			if (!plan.targetPos || !payload.flagName) {
				return invalid("createFlag-missing-args");
			}
			// 无视野房借引擎原生实现 + 伪 room 接收者建旗 (与 RoomPosition.createFlag
			// 原型重写同口径); 编队指挥旗常落在尚无视野的目标房
			const visibleRoom = Game.rooms[plan.targetPos.roomName];
			const pos = new RoomPosition(plan.targetPos.x, plan.targetPos.y, plan.targetPos.roomName);
			// RoomPosition.createFlag 原型重写: 无视野房借原生实现 + 伪 room 建旗
			const code = visibleRoom
				? visibleRoom.createFlag(
						plan.targetPos.x,
						plan.targetPos.y,
						payload.flagName,
						payload.color,
						payload.secondaryColor,
					)
				: pos.createFlag(
						payload.flagName,
						payload.color ?? COLOR_WHITE,
						payload.secondaryColor ?? COLOR_WHITE,
					);
			// createFlag 成功返回旗标名 (字符串), 失败返回负数错误码
			if (typeof code === "string") {
				return { ...base, accepted: true, category: "accepted" };
			}
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "removeFlag": {
			if (!payload.flagName) {
				return invalid("removeFlag-missing-name");
			}
			const flag = Game.flags[payload.flagName];
			if (!flag) {
				return { ...base, accepted: false, category: "replan", reason: "flag-gone" };
			}
			const code = flag.remove();
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		default:
			return invalid("unknown-kind");
	}
}

/** 结构 actor 执行: 塔 (攻击/治疗/修缮) 与 controller (SafeMode), 无租约检查 */
export function executeStructureAction(
	plan: ActionPlan,
	base: ExecutorBase,
	invalid: (reason: string) => ActionResult,
): ActionResult {
	if (plan.kind === "activateSafeMode") {
		const controller = resolveTarget<StructureController>(plan.targetId ?? plan.actorName);
		if (!controller) {
			return invalid("controller-gone");
		}
		const code = controller.activateSafeMode();
		const t = triageCode(code);
		return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
	}
	const tower = resolveTarget<StructureTower>(plan.actorName);
	if (!tower) {
		return invalid("tower-gone");
	}
	switch (plan.kind) {
		case "attack": {
			const target = resolveTarget<Creep>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = tower.attack(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "heal": {
			const target = resolveTarget<Creep>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = tower.heal(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "repair": {
			const target = resolveTarget<Structure>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = tower.repair(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		default:
			return invalid("unknown-kind");
	}
}

/**
 * 新管线执行 (construction/spawn/market/claim/power, api/17 command-boundary):
 * 房间级命令, actorName 为发起房名或结构 ID; 无任务租约语义, 走独立路径。
 */
export function executeSystemAction(
	plan: ActionPlan,
	base: ExecutorBase,
	invalid: (reason: string) => ActionResult,
): ActionResult {
	const payload = plan.payload ?? {};
	switch (plan.kind) {
		case "createSite": {
			if (!plan.targetPos || !payload.structureType) {
				return invalid("createSite-missing-args");
			}
			const room = Game.rooms[plan.targetPos.roomName];
			if (!room) {
				return invalid("room-not-visible");
			}
			const code = room.createConstructionSite(
				plan.targetPos.x,
				plan.targetPos.y,
				payload.structureType,
			);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "removeSite": {
			const site = resolveTarget<ConstructionSite>(plan.targetId);
			if (!site) {
				return { ...base, accepted: false, category: "replan", reason: "site-gone" };
			}
			const code = site.remove();
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "destroyStructure": {
			const structure = resolveTarget<Structure>(plan.targetId);
			if (!structure) {
				return { ...base, accepted: false, category: "replan", reason: "structure-gone" };
			}
			const code = structure.destroy();
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "spawnCreep": {
			const spawn = resolveTarget<StructureSpawn>(plan.targetId ?? plan.actorName);
			if (!spawn) {
				return invalid("spawn-gone");
			}
			if (!payload.body || !payload.creepName) {
				return invalid("spawnCreep-missing-args");
			}
			const code = spawn.spawnCreep(
				payload.body,
				payload.creepName,
				payload.memory ? { memory: payload.memory as CreepMemory } : undefined,
			);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "cancelSpawn": {
			const spawn = resolveTarget<StructureSpawn>(plan.targetId ?? plan.actorName);
			if (!spawn) {
				return invalid("spawn-gone");
			}
			const code = spawn.spawning
				? spawn.spawning.cancel()
				: ERR_BUSY;
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "marketDeal": {
			if (!payload.orderId || !plan.resourceType || plan.amount === undefined) {
				return invalid("marketDeal-missing-args");
			}
			const room = Game.rooms[plan.actorName];
			if (!room?.terminal) {
				return invalid("no-terminal");
			}
			const order = Game.market.getAllOrders().find((o) => o.id === payload.orderId);
			if (!order) {
				return { ...base, accepted: false, category: "replan", reason: "order-gone" };
			}
			const code = Game.market.deal(order.id, plan.amount, plan.actorName);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "terminalSend": {
			const room = Game.rooms[plan.actorName];
			if (!room?.terminal) {
				return invalid("no-terminal");
			}
			if (!payload.destinationRoom || !plan.resourceType || plan.amount === undefined) {
				return invalid("terminalSend-missing-args");
			}
			const code = room.terminal.send(
				plan.resourceType,
				plan.amount,
				payload.destinationRoom,
			);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "cancelMarketOrder": {
			if (!payload.orderId) {
				return invalid("cancelMarketOrder-missing-args");
			}
			const code = Game.market.cancelOrder(payload.orderId);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "createMarketOrder": {
			if (!payload.orderType || !plan.resourceType || payload.price === undefined ||
				payload.totalAmount === undefined) {
				return invalid("createMarketOrder-missing-args");
			}
			const room = Game.rooms[plan.actorName];
			if (!room) {
				return invalid("room-not-visible");
			}
			const code = Game.market.createOrder({
				type: payload.orderType,
				resourceType: plan.resourceType,
				price: payload.price,
				totalAmount: payload.totalAmount,
				roomName: room.name,
			});
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "changeMarketOrderPrice": {
			if (!payload.orderId || payload.price === undefined) {
				return invalid("changeMarketOrderPrice-missing-args");
			}
			const code = Game.market.changeOrderPrice(payload.orderId, payload.price);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "extendMarketOrder": {
			if (!payload.orderId || plan.amount === undefined) {
				return invalid("extendMarketOrder-missing-args");
			}
			const code = Game.market.extendOrder(payload.orderId, plan.amount);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "runLabReaction": {
			if (!payload.lab1Id || !payload.lab2Id) {
				return invalid("runLabReaction-missing-args");
			}
			const lab = resolveTarget<StructureLab>(plan.actorName);
			if (!lab) {
				return invalid("lab-gone");
			}
			const lab1 = resolveTarget<StructureLab>(payload.lab1Id);
			const lab2 = resolveTarget<StructureLab>(payload.lab2Id);
			if (!lab1 || !lab2) {
				return { ...base, accepted: false, category: "replan", reason: "substrate-lab-gone" };
			}
			const code = lab.runReaction(lab1, lab2);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "factoryProduce": {
			if (!plan.resourceType) {
				return invalid("factoryProduce-missing-args");
			}
			const factory = resolveTarget<StructureFactory>(plan.actorName);
			if (!factory) {
				return invalid("factory-gone");
			}
			const code = factory.produce(plan.resourceType as CommodityConstant);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "processPowerSpawn": {
			const powerSpawn = resolveTarget<StructurePowerSpawn>(plan.actorName);
			if (!powerSpawn) {
				return invalid("powerSpawn-gone");
			}
			const code = powerSpawn.processPower();
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "claimController":
		case "reserveController": {
			const creep = Game.creeps[plan.actorName];
			if (!creep || creep.spawning) {
				return invalid("actor-missing-or-spawning");
			}
			const controller = resolveTarget<StructureController>(plan.targetId);
			if (!controller) {
				return { ...base, accepted: false, category: "replan", reason: "controller-gone" };
			}
			const code =
				plan.kind === "claimController"
					? creep.claimController(controller)
					: creep.reserveController(controller);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "usePower": {
			const powerCreep = Game.powerCreeps[plan.actorName as Id<PowerCreep>];
			if (!powerCreep || !powerCreep.room) {
				return invalid("powerCreep-not-in-world");
			}
			if (payload.power === undefined) {
				return invalid("usePower-missing-args");
			}
			const target = plan.targetId
				? (Game.getObjectById(plan.targetId as Id<RoomObject & _HasId>) ?? undefined)
				: undefined;
			const code = powerCreep.usePower(payload.power as PowerConstant, target as RoomObject | undefined);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "enableRoom": {
			const powerCreep = Game.powerCreeps[plan.actorName as Id<PowerCreep>];
			if (!powerCreep || !powerCreep.room) {
				return invalid("powerCreep-not-in-world");
			}
			const controller = resolveTarget<StructureController>(plan.targetId);
			if (!controller) {
				return { ...base, accepted: false, category: "replan", reason: "controller-gone" };
			}
			const code = powerCreep.enableRoom(controller);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		default:
			return invalid("unknown-kind");
	}
}
