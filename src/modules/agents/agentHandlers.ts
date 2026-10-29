/**
 * AgentSystem 任务执行器 (api/06 §6.1): runCreep 按 task kind 的 11 路分派
 * (scout/harvest/carry+fill_spawn/upgrade/build/defend/claim/reserve/retreat/repair)。
 * 纯决策层, 提交走 ActionBroker。
 */
import type { TickContext } from "@/core";
import type { CreepSummary, RoomObservation } from "@/core/world";
import type { ActionBroker } from "@/modules/agents/actionBroker";
import type { NexusTask } from "@/core/store/taskSchema";
import type { TaskBoard } from "@/modules/tasks";
import { atWorksite } from "@/modules/world";
import { recordTravelSample, registerUpgraderStarve } from "@/modules/economy";
import { roomModeProfileFor } from "@/modules/strategy";
import { WORKFORCE_CONFIG } from "@/config/economy";
import { COMBAT_CONFIG, RETREAT_CONFIG } from "@/config/defense";
import { rankHostiles } from "@/modules/defense";
import { dist, RANGE_ADJACENT, RANGE_RANGED, RANGE_REPAIR, RANGE_UPGRADE, submitAction, submitAdjacentExtensionFill, submitDrop, submitMoveOrAction, submitMoveTo, fetchEnergy, deliverEnergy, hasFetchTarget, nearestPile } from "@/modules/agents/agentLogistics";
import { runRemoteCarry, runRemoteHarvest } from "@/modules/agents/agentRemote";

export function runCreep(
	ctx: TickContext,
	broker: ActionBroker,
	board: TaskBoard,
	room: RoomObservation,
	creep: CreepSummary,
	task: NexusTask,
): void {
	switch (task.kind) {
		case "scout": {
			// 侦查: 到达目标房即获视野 (下 tick planRemoteHarvest 产出采集任务接替);
			// 到达即 complete 终结任务——此前只删指针不终结, 任务靠 lease 过期回
			// available 又被认领, 且规划器每拍 upsert 续命成永生任务 (实服 4wt
			// 重开残留 6 条 scout 任务 + 视野口径漏计 → 无限补孵 20 只, bugs/实服)
			const target = task.targetPos?.roomName;
			if (!target) return;
			if (creep.roomName === target) {
				board.complete(task.id, creep.name, ctx.tick);
				const live = Game.creeps[creep.name];
				if (live) delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			broker.submit({
				id: `${creep.name}-sc-${ctx.tick}`,
				tick: ctx.tick,
				taskId: task.id,
				actorName: creep.name,
				kind: "move",
				targetPos: { x: 25, y: 25, roomName: target },
				priority: task.priority,
				pipeline: "move",
				reason: "scout-room",
				dedupeKey: `${creep.name}:move:${task.id}`,
			});
			return;
		}
		case "harvest": {
			// 外矿同名-unit: 目标房 ≠ 当前房间时, 走跨房采集
			if (task.targetPos?.roomName && task.targetPos.roomName !== room.roomName) {
				runRemoteHarvest(ctx, broker, creep, task);
				return;
			}
			const source = room.sources.find((s) => s.id === task.targetId);
			if (!source) {
				return;
			}
			// 钉位: 低容量多只期任务自带采集槽位坐标 (与 Source 相邻且非 Source 本格),
			// 每任务一槽避免多只互挤; 旧口径任务 (targetPos=Source 本格) 与远程任务
			// 回退 intel 主驻点 (单座语义)
			const intel = ctx.memory.rooms[room.roomName];
			const worksite = intel?.worksites?.[source.id];
			const taskSlot =
				task.targetPos &&
				task.targetPos.roomName === room.roomName &&
				!(task.targetPos.x === source.x && task.targetPos.y === source.y)
					? task.targetPos
					: worksite;
			if (taskSlot && !atWorksite(creep, taskSlot)) {
				// 驻点未到: 工作位必然与 Source 相邻, 先钉在固定驻点
				submitMoveTo(ctx, broker, creep, task, taskSlot, "harvest-worksite");
				return;
			}
			// 首次到岗采样: bornAt→firstArrivedAt 即实测路程 (替补窗口用);
			// 同拍写入 per-source 路程表 (specs/workforce-staffing 搬运运力定编的实测输入)
			const unit = ctx.memory.units[creep.name];
			if (worksite && unit && unit.firstArrivedAt === undefined) {
				unit.firstArrivedAt = ctx.tick;
				recordTravelSample(ctx, unit.unitCode, creep.roomName, ctx.tick - unit.bornAt);
				const roomIntel = ctx.memory.rooms[creep.roomName];
				if (roomIntel && task.targetId) {
					const clamp = WORKFORCE_CONFIG.sourceTiming;
					const pathTime = Math.max(
						clamp.clampMin,
						Math.min(clamp.clampMax, ctx.tick - unit.bornAt),
					);
					roomIntel.sourceTiming = { ...roomIntel.sourceTiming, [task.targetId]: pathTime };
				}
			}
			// 驻点稳定生产 (specs/harvest-worksite): 满载先卸货, 矿工绝不离开驻点——
			// 相邻容器有空间则卸入; 相邻有空位的源旁 ext 直填 (零腿补给);
			// 否则原地落地成堆由 carrier 认领;
			// 无 carry 部件的矿工 (落地采集) 恒不满足卸货条件, 持续采集即自动落地
			if (creep.freeCapacity === 0 && creep.carryEnergy > 0) {
				const spot = worksite?.containerSpot;
				const container = spot
					? room.stores.find(
							(store) =>
								store.structureType === "container" &&
								store.x === spot.x &&
								store.y === spot.y &&
								store.energy < store.energyCapacity,
						)
					: undefined;
				if (container && dist(creep.x, creep.y, container.x, container.y) <= RANGE_ADJACENT) {
					submitAction(ctx, broker, creep, task, "transfer", "carry", container.id);
					return;
				}
				if (submitAdjacentExtensionFill(ctx, broker, room, creep, task)) {
					return;
				}
				submitDrop(ctx, broker, creep, task);
				return;
			}
			submitMoveOrAction(ctx, broker, creep, task, "harvest", "work", source, RANGE_ADJACENT);
			// 直供泵: 采集态顺手把身上的能量填进相邻 ext——与 harvest 跨管线同 tick 并行,
			// 源旁 ext 空间就是 source → spawn 的零腿通道 (无 carry 部件时恒为空转)
			if (creep.carryEnergy > 0) {
				submitAdjacentExtensionFill(ctx, broker, room, creep, task);
			}
			return;
		}
		case "fill_spawn":
		case "carry": {
			// 跨房 carry (W1-2 远程容器回运): 取料点在外矿房, 本矿分支的
			// room.piles/stores 是错房快照——走独立跨房状态机
			if (task.targetPos?.roomName && task.targetPos.roomName !== room.roomName) {
				runRemoteCarry(ctx, broker, creep, task);
				return;
			}
			// 满载迟滞: 拿满才交付; 源枯竭时带余量交付
			const live = Game.creeps[creep.name];
			const fromId = task.kind === "carry" ? task.targetId : undefined;
			if (live?.memory.mode === "deliver") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, fromId);
					return;
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			if (creep.carryEnergy > 0 && creep.freeCapacity === 0) {
				if (live) {
					live.memory.mode = "deliver";
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			if (creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, fromId)) {
				// 源枯竭: 无货可拿, 带余量交付 (唯一例外出口)
				if (live) {
					live.memory.mode = "deliver";
				}
				deliverEnergy(ctx, broker, room, creep, task);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task, fromId);
			return;
		}
		case "upgrade": {
			const controller = room.controller;
			if (!controller) {
				return;
			}
			// 控制器缓冲存在 → 就位直供 (specs/controller-upgrade-buffer):
			// 持有者驻所分配工位 (任务 targetPos = 工位), withdraw cc + upgrade 原地完成零往返;
			// cc 空则拾取工位旁落地/墓碑 (快递能量), 都没有原地待命保租约
			const buffer = room.controllerBuffer;
			if (buffer) {
				const slot = task.targetPos;
				if (slot && (creep.x !== slot.x || creep.y !== slot.y)) {
					submitMoveTo(ctx, broker, creep, task, slot, "upgrade-slot");
					return;
				}
				if (creep.carryEnergy > 0) {
					submitMoveOrAction(
						ctx,
						broker,
						creep,
						task,
						"upgradeController",
						"controller",
						controller,
						RANGE_UPGRADE,
					);
					return;
				}
				const ccStore = room.stores.find((store) => store.id === buffer.id);
				if (ccStore && ccStore.energy > 0) {
					submitAction(ctx, broker, creep, task, "withdraw", "carry", buffer.id);
					return;
				}
				const pile = nearestPile(room, creep.x, creep.y, slot);
				if (pile) {
					submitMoveOrAction(ctx, broker, creep, task, "pickup", "carry", pile, RANGE_ADJACENT);
					return;
				}
				// 取能落空且缓冲全空: 饥饿记账 (specs/workforce-staffing 负反馈,
				// 保级窗口由 registerUpgraderStarve 内部豁免), 原地待命保租约。
				// 分档直采 (bugs/P1-14 cc 断粮, (十) 方向2): 无 courier 投喂经济的
				// 档位退化为长腿自取 (fetchEnergy 最近货源), cc 有货自动回归直供;
				// rush/mini 靠墓碑投喂闭环, 保持钉工位。
				// 无 cc 期豁免 (race-speedrun 6.1 第五轮, RCL2 提速): 直供链的
				// 前提物是 cc, cc 未成/未建 (含 RCL1, cc 规划 RCL2 起) 时钉工位
				// 没有任何投喂来源——开局首 200 进度全靠偶发顺路升级, 实测 t851
				// 才有点数; 自采自升是唯一闭环, cc 有货即回归既有直供语义。
				registerUpgraderStarve(ctx, room);
				if (
					roomModeProfileFor(ctx, room.roomName).upgraderForageOnStarve ||
					!room.controllerBuffer
				) {
					fetchEnergy(ctx, broker, room, creep, task, undefined, {
						x: buffer.x,
						y: buffer.y,
					});
				}
				return;
			}
			// 满载迟滞: 拿满才升级; 源枯竭时带余量升级
			const live = Game.creeps[creep.name];
			const ctrlAnchor = { x: controller.x, y: controller.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, ctrlAnchor);
					return;
				}
				submitMoveOrAction(
					ctx,
					broker,
					creep,
					task,
					"upgradeController",
					"controller",
					controller,
					RANGE_UPGRADE,
				);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(
					ctx,
					broker,
					creep,
					task,
					"upgradeController",
					"controller",
					controller,
					RANGE_UPGRADE,
				);
				return;
			}
			// 取离 controller 更近的货源: 缩短载货腿, 降低往返周期 (bugs/P1-4)
			fetchEnergy(ctx, broker, room, creep, task, undefined, ctrlAnchor);
			return;
		}
		case "build": {
			const site = room.sites.find((s) => s.id === task.targetId);
			if (!site) {
				return;
			}
			// 满载迟滞: 拿满才上工; 源枯竭时带余量上工
			const live = Game.creeps[creep.name];
			const siteAnchor = { x: site.x, y: site.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, siteAnchor);
					return;
				}
				submitMoveOrAction(ctx, broker, creep, task, "build", "work", site, RANGE_ADJACENT);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(ctx, broker, creep, task, "build", "work", site, RANGE_ADJACENT);
				return;
			}
			// 取料锚定工地: 空载+载货总路程选点, 工人不为取料横穿房间 (bugs/P1-14)
			fetchEnergy(ctx, broker, room, creep, task, undefined, siteAnchor);
			return;
		}
		case "defend": {
			// 目标每 Tick 从快照重选 (威胁动态变化, 任务 targetId 仅为创建期快照)
			const target = rankHostiles(room)[0];
			if (!target) {
				return;
			}
			// 治疗切换: 持治疗部件且友方 (含自己) 损血超阈且相邻 (docs/nexus-design/09 §9.3)
			if (creep.bodyHeal > 0) {
				const ally = room.creeps
					.filter(
						(candidate) =>
							candidate.hitsMax > 0 &&
							candidate.hits < candidate.hitsMax * COMBAT_CONFIG.healThreshold,
					)
					.sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)[0];
				if (ally && dist(creep.x, creep.y, ally.x, ally.y) <= RANGE_ADJACENT) {
					submitAction(ctx, broker, creep, task, "heal", "combat", ally.id);
					return;
				}
			}
			const ranged = creep.bodyRanged > 0;
			submitMoveOrAction(
				ctx,
				broker,
				creep,
				task,
				ranged ? "rangedAttack" : "attack",
				"combat",
				target,
				ranged ? RANGE_RANGED : RANGE_ADJACENT,
			);
			return;
		}
		case "claim": {
			// 扩张: 走到目标房控制器 → claim (目标房取任务侧, 不随 creep 当前房漂移)
			const targetRoom = task.targetPos?.roomName;
			if (!targetRoom) return;
			const live = Game.creeps[creep.name];
			if (creep.roomName !== targetRoom || !live) {
				broker.submit({
					id: `${creep.name}-go-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: {
						x: task.targetPos?.x ?? 25,
						y: task.targetPos?.y ?? 25,
						roomName: targetRoom,
					},
					priority: task.priority,
					pipeline: "move",
					reason: "claim-room",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			const ctrl = live.room.controller;
			if (!ctrl) return;
			if (ctrl.my) {
				// 已占有: 清任务指针停心跳, 任务由 lease 过期回收
				delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			const d = Math.max(Math.abs(creep.x - ctrl.pos.x), Math.abs(creep.y - ctrl.pos.y));
			if (d <= 1) {
				// claim 经命令边界提交 (api/17 claim 管线)
				broker.submit({
					id: `${creep.name}-claim-act-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "claimController",
					targetId: ctrl.id,
					priority: task.priority,
					pipeline: "claim",
					dedupeKey: `${creep.name}:claim:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-claim-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: { x: ctrl.pos.x, y: ctrl.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "claim-controller",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
			return;
		}
		case "reserve": {
			// 外矿预订 (对齐 Rosmarin race): 走到目标房控制器 → reserveController,
			// 未预订源容量 1500→3000。预订在身即停发任务, 续订由租约过期后重发接替
			const targetRoom = task.targetPos?.roomName;
			if (!targetRoom) return;
			const live = Game.creeps[creep.name];
			if (!live) return;
			const ctrl = live.room.controller;
			if (creep.roomName !== targetRoom || !ctrl) {
				broker.submit({
					id: `${creep.name}-rsv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: {
						x: task.targetPos?.x ?? 25,
						y: task.targetPos?.y ?? 25,
						roomName: targetRoom,
					},
					priority: task.priority,
					pipeline: "move",
					reason: "reserve-room",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
				return;
			}
			// 他人预订在身: 本件无法续订, 放弃任务 (生产端也不再对他订房发任务)
			if (ctrl.reservation && ctrl.reservation.username !== live.owner?.username) {
				delete (live.memory as Record<string, unknown>).taskId;
				return;
			}
			// 驻场终身制 (对齐 Rosmarin reserver): 到位后持续 reserveController
			// 续满, 预订不中断外矿恒满容量; 寿命耗尽由生产端在续订线下重发接替
			const d = Math.max(Math.abs(creep.x - ctrl.pos.x), Math.abs(creep.y - ctrl.pos.y));
			if (d <= 1) {
				// reserve 经命令边界提交 (api/17 claim 管线)
				broker.submit({
					id: `${creep.name}-rsv-act-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "reserveController",
					targetId: ctrl.id,
					priority: task.priority,
					pipeline: "claim",
					dedupeKey: `${creep.name}:reserve:${task.id}`,
				});
			} else {
				broker.submit({
					id: `${creep.name}-rsv-${ctx.tick}`,
					tick: ctx.tick,
					taskId: task.id,
					actorName: creep.name,
					kind: "move" as const,
					targetPos: { x: ctrl.pos.x, y: ctrl.pos.y, roomName: targetRoom },
					priority: task.priority,
					pipeline: "move",
					reason: "reserve-controller",
					dedupeKey: `${creep.name}:move:${task.id}`,
				});
			}
			return;
		}
		case "retreat": {
			// 撤退锚点保持: 距锚点超出半径持续移动, 到达后原地不动 (威胁解除由规划器 cancel)
			const anchor = task.targetPos;
			if (anchor && dist(creep.x, creep.y, anchor.x, anchor.y) > RETREAT_CONFIG.anchorRadius) {
				submitMoveTo(ctx, broker, creep, task, anchor);
			}
			return;
		}
		case "repair": {
			const target = room.damageables.find((structure) => structure.id === task.targetId);
			if (!target) {
				return; // 结构消失: 任务由规划器终结
			}
			// 满载迟滞: 拿满才修; 源枯竭时带余量修
			const live = Game.creeps[creep.name];
			const targetAnchor = { x: target.x, y: target.y };
			if (live?.memory.mode === "work") {
				if (creep.carryEnergy === 0) {
					live.memory.mode = "fetch";
					fetchEnergy(ctx, broker, room, creep, task, undefined, targetAnchor);
					return;
				}
				submitMoveOrAction(ctx, broker, creep, task, "repair", "work", target, RANGE_REPAIR);
				return;
			}
			if (
				(creep.carryEnergy > 0 && creep.freeCapacity === 0) ||
				(creep.carryEnergy > 0 && !hasFetchTarget(ctx, room, creep, undefined))
			) {
				if (live) {
					live.memory.mode = "work";
				}
				submitMoveOrAction(ctx, broker, creep, task, "repair", "work", target, RANGE_REPAIR);
				return;
			}
			fetchEnergy(ctx, broker, room, creep, task, undefined, targetAnchor);
			return;
		}
		default:
			return;
	}
}
