/**
 * 工业命令适配层 (openspec nexus-architecture-refactor 8.4 轨道 F):
 * industry 子系统 (lab/factory/powerSpawn/autoMarket) 的直连动作统一经本层
 * 向 ActionBroker 提交, 原生调用权收编进 broker —— 工业域不再直接触碰游戏突变 API。
 *
 * 语义契约:
 * - 同步窗口: 调用即经 executeNow 执行并返回原生返回码, 控制链按返回码
 *   分支的逻辑与直连时代完全一致;
 * - 所有权: 工业 actor 为房间结构 (无租约语义), owner 候选仅登记供
 *   冲突聚合观测, 不参与任务租约拦截。
 */
import { INDUSTRY_ADAPTER_CONFIG } from "@/config/industry";
import { registerOwnerCandidate } from "@/runtime/actorOwnership";
import {
	sharedBrokerForDirectCommands,
	type ActionPayload,
} from "@/modules/agents/actionBroker";

const OWNER = INDUSTRY_ADAPTER_CONFIG.ownerName;
const STRUCTURE_PRIORITY = INDUSTRY_ADAPTER_CONFIG.structureActionPriority;
const MARKET_PRIORITY = INDUSTRY_ADAPTER_CONFIG.marketActionPriority;

/** owner 候选登记 (幂等): 模块加载时执行一次 */
let candidateRegistered = false;
function ensureCandidate(): void {
	if (!candidateRegistered) {
		registerOwnerCandidate(OWNER, INDUSTRY_ADAPTER_CONFIG.ownerPriority);
		candidateRegistered = true;
	}
}

/** 计划序号 (同 Tick 内保证计划 id/dedupeKey 唯一) */
let seq = 0;
function nextId(): number {
	if (seq >= Number.MAX_SAFE_INTEGER) {
		seq = 0;
	}
	return ++seq;
}

// ── 结构命令 (结构 actor: actorName = 结构 id, 无租约语义) ──────────

/** Lab 反应 (产物 lab 消耗 A/B 底物) */
export function industryRunReaction(
	lab: StructureLab,
	lab1: StructureLab,
	lab2: StructureLab,
): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-runReaction-${lab.id}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: lab.id,
		kind: "runLabReaction",
		pipeline: "work",
		priority: STRUCTURE_PRIORITY,
		payload: { lab1Id: lab1.id, lab2Id: lab2.id } satisfies ActionPayload,
		dedupeKey: `industry:runReaction:${lab.id}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

/** 工厂生产 */
export function industryProduce(factory: StructureFactory, product: CommodityConstant): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-produce-${factory.id}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: factory.id,
		kind: "factoryProduce",
		pipeline: "work",
		priority: STRUCTURE_PRIORITY,
		resourceType: product,
		dedupeKey: `industry:produce:${factory.id}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

/** PowerSpawn 烧电 */
export function industryProcessPower(powerSpawn: StructurePowerSpawn): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-processPower-${powerSpawn.id}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: powerSpawn.id,
		kind: "processPowerSpawn",
		pipeline: "work",
		priority: STRUCTURE_PRIORITY,
		dedupeKey: `industry:processPower:${powerSpawn.id}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

// ── 市场订单命令 (房间 actor: actorName = 房名, 与既有 market 管线一致) ──

/** 创建挂单 (订单方向/价格/总量经 payload 承载) */
export function industryCreateOrder(roomName: string, params: {
	type: "buy" | "sell";
	resourceType: ResourceConstant;
	price: number;
	totalAmount: number;
}): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-createOrder-${roomName}-${params.type}-${params.resourceType}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: roomName,
		kind: "createMarketOrder",
		pipeline: "market",
		priority: MARKET_PRIORITY,
		resourceType: params.resourceType,
		payload: {
			orderType: params.type,
			price: params.price,
			totalAmount: params.totalAmount,
		} satisfies ActionPayload,
		dedupeKey: `industry:createOrder:${roomName}:${params.type}:${params.resourceType}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

/** 订单调价 */
export function industryChangeOrderPrice(orderId: string, price: number): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-changeOrderPrice-${orderId}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: "market",
		kind: "changeMarketOrderPrice",
		pipeline: "market",
		priority: MARKET_PRIORITY,
		payload: { orderId, price } satisfies ActionPayload,
		dedupeKey: `industry:changeOrderPrice:${orderId}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}

/** 订单扩单 */
export function industryExtendOrder(orderId: string, addAmount: number): number {
	ensureCandidate();
	const result = sharedBrokerForDirectCommands().executeNow({
		id: `industry-extendOrder-${orderId}-${Game.time}-${nextId()}`,
		tick: Game.time,
		actorName: "market",
		kind: "extendMarketOrder",
		pipeline: "market",
		priority: MARKET_PRIORITY,
		amount: addAmount,
		payload: { orderId } satisfies ActionPayload,
		dedupeKey: `industry:extendOrder:${orderId}:${Game.time}:${nextId()}`,
	});
	return result.nativeReturnCode ?? ERR_INVALID_ARGS;
}
