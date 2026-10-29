/**
 * broker creep 行动管线执行器 (api/06): move/harvest/pickup/withdraw/transfer/build/
 * upgradeController/drop/attack/rangedAttack/heal/repair/renew/suicide/combat 族 case 表。
 * 从 actionBroker 闭包原样提升 (拆分任务 3.4), 零逻辑改动; actor 存在与租约校验留在 execute() 主体。
 */
import type { ActionPlan, ActionResult, BrokerDeps } from "@/modules/agents/brokerTypes";
import { type ExecutorBase, type InvalidFn, resolveTarget, triageCode } from "@/modules/agents/brokerExecutorsShared";

export function executeCreepAction(
	creep: Creep,
	plan: ActionPlan,
	base: ExecutorBase,
	deps: BrokerDeps,
	invalid: InvalidFn,
): ActionResult {
	switch (plan.kind) {
		case "move": {
			const payload = plan.payload ?? {};
			if (!plan.targetPos) {
				return invalid("move-without-position");
			}
			const position = new RoomPosition(
				plan.targetPos.x,
				plan.targetPos.y,
				plan.targetPos.roomName,
			);
			// 同房目标禁出房寻路: 墙多地形上跨房捷径会把 creep 甩出视野, 在无人区耗死;
			// 跨房目标 (如归位) 保持默认跨房路由
			const opts: MoveToOpts = {};
			if (payload.moveOpts) {
				const m = payload.moveOpts;
				if (m.range !== undefined) opts.range = m.range;
				if (m.visualizePathStyle) opts.visualizePathStyle = m.visualizePathStyle;
				if (m.ignoreCreeps !== undefined) opts.ignoreCreeps = m.ignoreCreeps;
				if (m.maxRooms !== undefined) opts.maxRooms = m.maxRooms;
				if (m.reusePath !== undefined) opts.reusePath = m.reusePath;
				if (m.plainCost !== undefined) (opts as any).plainCost = m.plainCost;
				if (m.swampCost !== undefined) (opts as any).swampCost = m.swampCost;
			}
			const code = creep.moveTo(position, {
				maxRooms: position.roomName === creep.pos.roomName ? 1 : 16,
				...opts,
			});
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "harvest": {
			const source = resolveTarget<Source>(plan.targetId);
			if (!source) {
				const r: ActionResult = {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
				return r;
			}
			const code: number = creep.harvest(source);
			// 满载等待卸货不是任务失败 (无 carry 矿工落地采集 / 携带者等容器腾位): 重试不进失败计数
			if (code === ERR_FULL) {
				return {
					...base,
					accepted: false,
					nativeReturnCode: code,
					category: "retryable",
					reason: "carry-full",
				};
			}
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "pickup": {
			const pile = resolveTarget<Resource>(plan.targetId);
			if (!pile) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = creep.pickup(pile);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "withdraw": {
			const target = resolveTarget<AnyStoreStructure>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			if ((target.store[plan.resourceType ?? RESOURCE_ENERGY] ?? 0) <= 0) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "store-empty",
				};
			}
			const code = creep.withdraw(target, plan.resourceType ?? RESOURCE_ENERGY);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "transfer": {
			const target = resolveTarget<AnyStoreStructure>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			if (creep.store[plan.resourceType ?? RESOURCE_ENERGY] <= 0) {
				// 快照与实际负载出现偏差: 交回分配环重推导, 不作为无效告警刷屏
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "carry-empty",
				};
			}
			const before = creep.store[plan.resourceType ?? RESOURCE_ENERGY];
			const code = creep.transfer(target, plan.resourceType ?? RESOURCE_ENERGY);
			const t = triageCode(code);
			// 实际转移量按引擎应用口径折算: min(携带量, 目标空余)。
			// intent 在引擎相统一应用, JS 相内 store 不变, 差分法恒 0
			const free = target.store.getFreeCapacity(plan.resourceType ?? RESOURCE_ENERGY) ?? 0;
			const moved =
				code === OK ? Math.min(before, Math.max(0, free)) : 0;
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category, movedEnergy: moved };
		}
		case "build": {
			const site = resolveTarget<ConstructionSite>(plan.targetId);
			if (!site) {
				// 工地建成/消失: replan 且视为成功路径 (任务完成由对账确认)
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "site-gone",
				};
			}
			const code = creep.build(site);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "upgradeController": {
			const controller = resolveTarget<StructureController>(plan.targetId);
			if (!controller) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = creep.upgradeController(controller);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "drop": {
			// 驻点矿工的卸货兜底: 落地成堆由 carrier 认领 (无目标结构)
			if (creep.store[plan.resourceType ?? RESOURCE_ENERGY] <= 0) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "carry-empty",
				};
			}
			const code = creep.drop(plan.resourceType ?? RESOURCE_ENERGY);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
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
			const code = creep.attack(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "rangedAttack": {
			const target = resolveTarget<Creep>(plan.targetId);
			if (!target) {
				return {
					...base,
					accepted: false,
					category: "replan",
					reason: "target-gone",
				};
			}
			const code = creep.rangedAttack(target);
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
			const code = creep.heal(target);
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
			const code = creep.repair(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "renew": {
			// PowerCreep 续命 (power 管线): 目标 powerSpawn/powerBank
			const spawn = resolveTarget<StructurePowerSpawn>(plan.targetId);
			if (!spawn) {
				return { ...base, accepted: false, category: "replan", reason: "target-gone" };
			}
			const pc = Game.powerCreeps[plan.actorName];
			if (!pc) {
				return invalid("power-creep-gone");
			}
			const code = pc.renew(spawn);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "suicide": {
			// 快递交付: 墓碑能量落在升级消费圈 (specs/rush-courier); 无失败分支
			const code = creep.suicide();
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "combatMove": {
			const payload = plan.payload ?? {};
			if (!plan.targetPos) {
				return invalid("combatMove-missing-position");
			}
			const position = new RoomPosition(
				plan.targetPos.x,
				plan.targetPos.y,
				plan.targetPos.roomName,
			);
			const opts: MoveToOpts = {};
			if (payload.moveOpts) {
				const m = payload.moveOpts;
				if (m.range !== undefined) opts.range = m.range;
				if (m.visualizePathStyle) opts.visualizePathStyle = m.visualizePathStyle;
				if (m.ignoreCreeps !== undefined) opts.ignoreCreeps = m.ignoreCreeps;
				if (m.maxRooms !== undefined) opts.maxRooms = m.maxRooms;
				if (m.reusePath !== undefined) opts.reusePath = m.reusePath;
				if (m.costCallback) opts.costCallback = m.costCallback;
			}
			const code = creep.moveTo(position, opts);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "combatStep": {
			const payload = plan.payload ?? {};
			const direction = payload.direction;
			if (!direction || direction < 1 || direction > 8) {
				return invalid("combatStep-bad-direction");
			}
			const code = creep.move(direction as DirectionConstant);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "combatStrike": {
			const payload = plan.payload ?? {};
			const strike = payload.strike;
			if (strike === "rangedMassAttack") {
				const code = creep.rangedMassAttack();
				const t = triageCode(code);
				return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
			}
			if (!plan.targetId || (strike !== "attack" && strike !== "rangedAttack")) {
				return invalid("combatStrike-bad-args");
			}
			const target =
				payload.strikeTarget === "structure"
					? resolveTarget<Structure>(plan.targetId)
					: resolveTarget<AnyCreep>(plan.targetId);
			if (!target) {
				return { ...base, accepted: false, category: "replan", reason: "target-gone" };
			}
			const code =
				strike === "attack" ? creep.attack(target) : creep.rangedAttack(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "combatHealAction": {
			const payload = plan.payload ?? {};
			const target = resolveTarget<Creep>(plan.targetId);
			if (!target) {
				return { ...base, accepted: false, category: "replan", reason: "target-gone" };
			}
			const code =
				payload.healMode === "rangedHeal" ? creep.rangedHeal(target) : creep.heal(target);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		case "combatMoveByPath": {
			const payload = plan.payload ?? {};
			if (!payload.path?.length) {
				return invalid("combatMoveByPath-missing-path");
			}
			const path = payload.path.map((p) => new RoomPosition(p.x, p.y, p.roomName));
			const code = creep.moveByPath(path);
			const t = triageCode(code);
			return { ...base, accepted: t.accepted, nativeReturnCode: code, category: t.category };
		}
		default:
			return invalid("unknown-kind");
	}
}
