/**
 * AgentSystem 快递族 (specs/rush-courier): 无任务租约的 rush-courier 驱动与提交封装。
 */
import type { TickContext } from "@/core";
import type { CreepSummary, RoomObservation } from "@/core/world";
import type { ActionBroker } from "@/modules/agents/actionBroker";
import { COURIER_CONFIG } from "@/config/economy";
import { dist } from "@/modules/agents/agentLogistics";

/** 快递计划无任务租约 (broker 校验 getTask(taskId) 会判 lease-lost),
 *  直接经 broker.submit 提交, 只带执行所需字段 */
export function submitCourierAction(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	kind: "withdraw" | "move",
	target?: { id: string; x: number; y: number },
): void {
	broker.submit({
		id: `${creep.name}-${kind}-${ctx.tick}`,
		tick: ctx.tick,
		actorName: creep.name,
		kind,
		...(target?.id !== undefined ? { targetId: target.id } : {}),
		...(target !== undefined
			? { targetPos: { x: target.x, y: target.y, roomName: creep.roomName } }
			: {}),
		resourceType: RESOURCE_ENERGY,
		priority: COURIER_CONFIG.priority,
		pipeline: "carry",
		dedupeKey: `${creep.name}:carry:${kind}`,
	});
}

/** 快递爬逐 tick 驱动 (specs/rush-courier, 无任务租约): 取满向 cc/控制器方向自爆交付;
 *  断供带货就地自爆 (半载也值回票价); 空载限时等待后放弃 */
export function runCourierCreep(
	ctx: TickContext,
	broker: ActionBroker,
	room: RoomObservation,
	creep: CreepSummary,
): void {
	const target = room.controllerBuffer ?? room.controller;
	if (!target) {
		return;
	}
	const submitSuicide = (): void => {
		broker.submit({
			id: `${creep.name}-suicide-${ctx.tick}`,
			tick: ctx.tick,
			actorName: creep.name,
			kind: "suicide",
			pipeline: "carry",
			priority: COURIER_CONFIG.priority,
			dedupeKey: `${creep.name}:carry:suicide`,
		});
	};
	if (creep.freeCapacity > 0) {
		// 取能: 只抽底仓之上的 spawn 存量
		const spawn = room.energyStructures.find(
			(structure) =>
				structure.structureType === "spawn" &&
				structure.energy > COURIER_CONFIG.reserveFloor,
		);
		if (spawn) {
			submitCourierAction(ctx, broker, creep, "withdraw", spawn);
			return;
		}
		// spawn 断供: 带货就地交付, 空载限时等待再放弃
		if (creep.carryEnergy > 0) {
			submitSuicide();
			return;
		}
		const record = Game.creeps[creep.name];
		const memory = record?.memory as { waitStart?: number } | undefined;
		if (memory && memory.waitStart !== undefined) {
			if (ctx.tick - memory.waitStart > COURIER_CONFIG.idleGiveUpTicks) {
				submitSuicide();
			}
			return;
		}
		if (memory) {
			memory.waitStart = ctx.tick;
		}
		return;
	}
	// 满载: direct 模式 transfer 入 cc 后复跑 (spawn→cc 短腿专运);
	// tombstone 模式或无 cc 就近自爆, 墓碑能量落升级圈
	const buffer = room.controllerBuffer;
	if (buffer && COURIER_CONFIG.deliveryMode === "direct") {
		if (dist(creep.x, creep.y, buffer.x, buffer.y) <= 1) {
			submitCourierTransfer(ctx, broker, creep, buffer.id);
			return;
		}
		submitCourierAction(ctx, broker, creep, "move", buffer);
		return;
	}
	if (dist(creep.x, creep.y, target.x, target.y) <= (buffer ? 1 : 2)) {
		submitSuicide();
		return;
	}
	submitCourierAction(ctx, broker, creep, "move", target);
}

/** 快递直投: transfer 入 cc (满载交付后回 spawn 复跑) */
function submitCourierTransfer(
	ctx: TickContext,
	broker: ActionBroker,
	creep: CreepSummary,
	ccId: string,
): void {
	broker.submit({
		id: `${creep.name}-transfer-${ctx.tick}`,
		tick: ctx.tick,
		actorName: creep.name,
		kind: "transfer",
		targetId: ccId,
		resourceType: RESOURCE_ENERGY,
		priority: COURIER_CONFIG.priority,
		pipeline: "carry",
		dedupeKey: `${creep.name}:carry:transfer`,
	});
}

/** agent 系统直接驱动的角色代号集 (有对应任务 kind 分支); 其余走原型执行 */
/**
 * 外矿同名-unit 采集: 目标在远程房 → 走到目标房 source → harvest → 满载走回本矿 spawn 卸货。
 * 跨房能量流: 远程 harvester 满载回本矿, 交付到 spawn/ext (carrier 接力可选)。
 */
