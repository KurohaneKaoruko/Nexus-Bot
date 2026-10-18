/**
 * SpawnArbiter (任务 6.1, docs/Nexus-Bot-架构设计与重构指导 §16 / BUG-011):
 * spawnDirector 的每 spawn 裁决侧职责收编——产出就绪闸、采集让位、归零自举、
 * urgent 门、攒能等待 (idleSince 窗口)、体型定档 hints。输入请求池与 spawn 快照,
 * 输出选中的请求与体型 (或 undefined = 本 tick 不产)。
 * 本文件不触孵化 API, 不做需求聚合 (归 demandSources)。
 */
import type { TickContext } from "@/core";
import type { RoomObservation } from "@/core/world";
import type { TaskBoard } from "@/modules/tasks";
import { PRODUCTION_GATE_CONFIG, RELAY_CONFIG, SPAWN_CONFIG } from "@/config/economy";
import { UNITS } from "@/constant/CreepConstant";
import { bodyCost, buildBody, type SpawnUnit } from "@/modules/spawning/bodyFactory";
import { harvestIncomeOf, isProductionSecured, harvesterTargetTotal } from "@/modules/economy";
import { isSlowTerrain, terrainProfileFor } from "@/modules/spawning/terrainProfile";
import type { SpawnRequest } from "@/modules/spawning/demandSources";

/** 体型定档语境 (per-spawn 快照推导, BodyFactory 纯函数的输入) */
export interface BodyHints {
	slowTerrain: boolean;
	relayCarrier: boolean;
	directCarrier: boolean;
	noCarrierOnSite: boolean;
}

export interface ArbitrationResult {
	request: SpawnRequest;
	body: BodyPartConstant[];
}

export interface ArbiterDeps {
	staffed: (unit: string) => number;
	/** 攒能等待窗口起点 (spawn.id → tick, 跨 Tick 持久化) */
	idleSince: Record<string, number>;
	/** downgrade 紧急 (自举豁免判据) */
	downgradeActive: boolean;
	/** 拒绝原因上报 (任务 6.4 遥测): gate=产出就绪闸, yield=采集让位 */
	onDeny?: (reason: "gate" | "yield") => void;
}

/**
 * 每 spawn 仲裁: 从已排序请求池选出本 tick 可产的一个请求与体型。
 * 返回 undefined 时调用方记 idle (等待), 不提交命令。
 */
export function arbitrateForSpawn(
	ctx: TickContext,
	spawn: StructureSpawn,
	spawnRoom: RoomObservation | undefined,
	ordered: SpawnRequest[],
	board: TaskBoard,
	deps: ArbiterDeps,
): ArbitrationResult | undefined {
	const { staffed, idleSince, downgradeActive, onDeny } = deps;
	// 产出就绪闸 (specs/production-readiness-gate): 本房采集面未铺满时,
	// ① 起步序列闸——只受理采集面/生存角色; ② 搬运开局闸——在岗搬运体
	// 不得超过采集面规模 (防「3 搬运 : 1 矿工」倒挂吃光孵化槽)
	const secured = spawnRoom ? isProductionSecured(ctx, spawnRoom) : true;
	const gateAllows = (unit: SpawnUnit): boolean => {
		if (secured) {
			return true;
		}
		if (unit === "carrier") {
			return staffed("carrier") < Math.max(1, staffed("harvester"));
		}
		return PRODUCTION_GATE_CONFIG.unsecuredAllowedRoles.includes(unit);
	};
	const gated = ordered.filter((r) => {
		const allowed = gateAllows(r.unit);
		if (!allowed) {
			onDeny?.("gate");
		}
		return allowed;
	});
	// 采集让位 (源饱和口径): harvester 饱和定编未满足时, 非生存角色暂停孵化——
	// 能量集中攒给采集面。阻塞线取【饱和定编】harvesterTargetTotal (低容量期
	// 每源多只小体) 而非基础编制 sources.length——后者在双源房 @2 只即退出让位,
	// 采集面锁死 2W 小体 (sim 实证采集 5/t vs 旧体系 17/t, 差 3.5×)。
	// 阻塞线内仍允许 H→C 交替 (carrier 配比闸), 与 race 开局序列同源。
	const staffingFloor = spawnRoom ? Math.max(1, harvesterTargetTotal(spawnRoom)) : 0;
	const harvesterShort =
		gated.some((r) => r.unit === "harvester") &&
		staffed("harvester") < Math.max(1, staffingFloor);
	const rawPool = harvesterShort
		? gated.filter(
				(r) =>
					r.unit === "harvester" ||
					r.unit === "defender" ||
					r.unit === "scout" ||
					// 采集未满编期间 carrier 不超过在岗矿工数 (1 采 1 搬交替孵化)
					(r.unit === "carrier" && staffed("carrier") < Math.max(1, staffed("harvester"))),
			)
		: gated;
	if (harvesterShort) {
		const kept = new Set(rawPool.map((r) => r.unit));
		for (const r of gated) {
			if (!kept.has(r.unit)) {
				onDeny?.("yield");
			}
		}
	}
	const pool = rawPool;
	// 体型按容量定档 (energyCapacityAvailable), 攒能等待: 涓流经济下按瞬时存量定档
	// 会永远困在最小体型 (sim 实证: 5 万 tick 仍 3 部件);
	// 高优先请求 (bootstrap/应急) 例外——按现有能量立即生产, 保开局速度;
	// 等待超时兜底: 存量长期攒不满期望体型时退回按存量降档, 防编制空转。
	// 地形档 (specs/adaptive-body-factory): 本房沼泽密度高且路网未达标 → move 配比上调。
	// 注: 冲级窗口不强制 harvester 带 CARRY——sim 实证 RCL2 档 (550 容量) 强制 carry
	// 会 -1 WORK 且把源能量导向 ext/spawn 而非 cc 升级链, 升级总量 17658→4614 恶化;
	// 直供泵的 carry 前提由生成器的 1-CARRY 下限自然满足 (预算 ≥650 即 RCL3 起)
	// 开局无搬运工在场 → 采集体自带 CARRY (否则地面堆无人收, 控制器拿不到能量)。
	// 远程采集件另判: 本地矿工 0 CARRY 靠 carrier 回收 drop, 但远程件是自回运
	// (满载跨房走回本矿卸 cc), 无 CARRY 则永远驻源 drop, 能量全烂在外矿地板。
	const remoteHarvestActive = board
		.list({ kinds: ["harvest"] })
		.some(
			(t) =>
				(t.status === "available" || t.status === "leased" || t.status === "in_progress") &&
				t.targetPos?.roomName !== t.roomName,
		);
	const hints: BodyHints = {
		slowTerrain: isSlowTerrain(terrainProfileFor(spawn.room.name, ctx.tick)),
		// 接力期档 (specs/relay-hauling): RCL < 等级门用微型接力件, 达门大件直运
		relayCarrier: (spawn.room.controller?.level ?? 0) < RELAY_CONFIG.maxRcl,
		directCarrier: (spawn.room.controller?.level ?? 0) >= RELAY_CONFIG.maxRcl,
		noCarrierOnSite:
			remoteHarvestActive ||
			!Object.values(Game.creeps).some(
				(c) =>
					c.room.name === spawn.room.name &&
					!c.spawning &&
					c.memory?.unit === UNITS.carrier,
			),
	};
	const capacity = spawn.room.energyCapacityAvailable;
	const available = spawn.room.energyAvailable;
	const idle = idleSince[spawn.id] ?? ctx.tick;
	// 采集体收入感知定档 (specs harvest-supply-convergence「采集体型收入感知定档」):
	// 有在岗采集收入 → 按能量容量定档 (攒能升体型); 无在岗收入 → 按 max(存量, 起步预算)
	// 定档, 该预算对应 2-WORK 起步体。底线必须条件化于「无收入」——docs/bugs 2026-10-15
	// 校准实录记载 W2 硬底线一刀切为负 (涓流期换代断收入), 全局生效即重蹈。
	const harvestNoIncome = spawnRoom ? harvestIncomeOf(ctx, spawnRoom) <= 0 : true;
	const bodyBudget = (unit: string, fallback: number): number =>
		unit === "harvester" && SPAWN_CONFIG.harvestTierEnabled && harvestNoIncome
			? Math.max(available, SPAWN_CONFIG.harvesterStarterBudget)
			: fallback;
	// 归零立即复产的地板 (bugs/P1-19 断供环): 在岗低于地板即视为「职能断供」,
	// 攒能等待对该角色的请求失效 (立即按现有能量小体复产)。carrier 地板 = 让位
	// 搬运保底数——spawn 的能量流入全靠拉能, 单只往返速率撑不起孵化+换代并发,
	// 攒能大件在涓流期永远攒不齐 (sim 实锤 carrier 恒 1 断供 1500t)。
	const bootstrapFloorOf = (unit: string): number =>
		unit === "carrier" ? SPAWN_CONFIG.yieldCarrierFloor : 0;
	const urgent = pool.find(
		(r) =>
			r.priority <= SPAWN_CONFIG.immediatePriority &&
			(!SPAWN_CONFIG.capacityWaitRoles.includes(r.unit) ||
				// 归零角色立即小体复产 (自举通道): 攒能等待的前提是职能在岗——
				// 全灭后等待只会让能量链死锁 (50k 普查 harvester 0 存活实锤;
				// carrier 全灭则 spawn 永远等不到拉能, bugs/P1-19 断供环)
				staffed(r.unit) <= bootstrapFloorOf(r.unit)) &&
			buildBody(r.unit, r.budget ?? available, hints) !== null,
	);
	// 自举硬保障 (实服 4wt 重置路径, bugs (十七)): harvester 全灭时其请求恒过
	// urgent 门不受 priority 波动影响——任务被租走时 standing 55 < 70 进不了
	// urgent, 死锁窗口里 spawn 能量被 carrier 抽水长期 < 起步体型成本,
	// 采集面永不复活 (实服亡者构成 harvester 2 vs carrier 6 实锤)。
	const bootstrapHarvest =
		urgent === undefined &&
		staffed("harvester") === 0 &&
		pool.find(
			(r) =>
				r.unit === "harvester" &&
				buildBody(r.unit, r.budget ?? Math.max(available, SPAWN_CONFIG.harvesterStarterBudget), hints) !== null,
		);
	// 升级体归零自举 (bugs/P1-19): 在岗=0 时立即按存量复产, 不受攒能等待钳制——
	// 队头阻塞 (carrier 88 恒压 upgrade 请求 85) + 攒能窗口交错下, 升级体死亡后
	// 请求长期排不进孵化槽, 控制器进度停滞整千 tick (sim t2750-4250 断档实锤)。
	// 保级优先于攒体型: 归零窗口里任何等待都在放大降级风险。
	// 降级紧急时任务已提权进 urgent 段, 此处只管非紧急的断档预防。
	const bootstrapUpgrade =
		urgent === undefined &&
		bootstrapHarvest === undefined &&
		!downgradeActive &&
		staffed("upgrader") === 0 &&
		pool.find(
			(r) => r.unit === "upgrader" && buildBody(r.unit, r.budget ?? available, hints) !== null,
		);
	let body: BodyPartConstant[] | null = null;
	let request: SpawnRequest | undefined;
	if (bootstrapHarvest) {
		request = bootstrapHarvest;
		body = buildBody(request.unit, request.budget ?? available, hints);
	} else if (bootstrapUpgrade) {
		request = bootstrapUpgrade;
		body = buildBody(request.unit, request.budget ?? available, hints);
	} else if (urgent) {
		request = urgent;
		body = buildBody(urgent.unit, urgent.budget ?? available, hints);
	} else {
		// 涓流期体型钳 (race 微型件口径): 存量不足容量档的一半时, 攒能 desired
		// 钳到 1 段微型件——按容量定档在涓流期恒付不起, 每只都烧满等待窗后
		// 降档, 孵化节律 200t/只锁死小体 (sim 实证 main 档 30k 仅 6 只存活);
		// 微型件高频先建 ext 填充, 池回升后容量档自然恢复
		const trickleBudget = (unit: string, want: number): number =>
			available * 2 < capacity && unit === "carrier"
				? Math.min(want, Math.max(available, 250))
				: want;
		request = pool.find(
			(r) => buildBody(r.unit, r.budget ?? trickleBudget(r.unit, bodyBudget(r.unit, capacity)), hints) !== null,
		);
		if (request) {
			const desired = buildBody(request.unit, request.budget ?? bodyBudget(request.unit, capacity), hints);
			if (desired && bodyCost(desired) > available) {
				// 期望体型未攒够: 等待 (超时后退回按存量降档); 攒能角色用短窗——
				// replacement 提前量 (~200t) 撑不住长等待, 换代断采是净损失 (50k 实测);
				// 替补用途的等待另受换代窗口钳制 (提前量量级), 老单位死前必出新人。
				// 无收入期等的是 WORK 底线而非大体型, 长窗只会拖长断采 → 同样走短窗。
				// harvester 分档: 定编缺口 (采集面未铺满) 必须允许降档——缺编补位
				// 保覆盖, 否则 1 只小矿工 2/t 收入永填不满 550 池, 第二只永不出现,
				// 采集面锁死 (sim 实证 legacy 退役后 31k 仅 4 爬存活); 铺满后的
				// replacement 换代才永不降档——保体型演进, 避免小体 churn。
				const waitLimit = request.purpose.startsWith("replacement:")
					? Math.min(SPAWN_CONFIG.capacityWaitTicks, SPAWN_CONFIG.replacementWaitTicks)
					: SPAWN_CONFIG.capacityWaitRoles.includes(request.unit)
						? Math.min(SPAWN_CONFIG.capacityWaitTicks, SPAWN_CONFIG.capacityWaitTicksShort)
						: SPAWN_CONFIG.capacityWaitTicks;
				const harvesterNeverDownsize =
					request.unit === "harvester" &&
					request.purpose.startsWith("replacement:");
				if (ctx.tick - idle < waitLimit || harvesterNeverDownsize) {
					idleSince[spawn.id] = idle;
					ctx.cpu.recordSkip("spawn-director", "budget");
					return undefined;
				}
				body = buildBody(request.unit, request.budget ?? available, hints);
			} else {
				body = desired;
			}
		}
	}
	if (!request || !body) {
		// 能量不足以生产任何请求: 等待积累, 计入跳过指标
		idleSince[spawn.id] = idle;
		ctx.cpu.recordSkip("spawn-director", "budget");
		return undefined;
	}
	delete idleSince[spawn.id];
	return { request, body };
}
