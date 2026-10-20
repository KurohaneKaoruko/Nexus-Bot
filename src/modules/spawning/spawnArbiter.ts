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
import { RUSH_WORKER_MIN_BUDGET } from "@/utils/rush";
import { harvestIncomeOf, isProductionSecured, harvesterTargetTotal } from "@/modules/economy";
import { isSlowTerrain, terrainProfileFor } from "@/modules/spawning/terrainProfile";
import type { SpawnRequest } from "@/modules/spawning/demandSources";

/** 体型定档语境 (per-spawn 快照推导, BodyFactory 纯函数的输入) */
export interface BodyHints {
	slowTerrain: boolean;
	relayCarrier: boolean;
	directCarrier: boolean;
	noCarrierOnSite: boolean;
	/** 外矿采集件 (自回运): 必带 CARRY, 满载跨房回本矿卸货 */
	remoteHarvester: boolean;
}

/** 请求池里是否存在指定用途前缀的请求 (外矿采集件体型判据) */
function requestStartsWith(pool: readonly SpawnRequest[], prefix: string): boolean {
	return pool.some((r) => r.purpose.startsWith(prefix));
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
	// 开局序列实验记录 (race-speedrun 任务5.1, 2026-10-18): rush 档收紧
	// (首采集体前 carrier 恒不放行) 实测 L3 12977→13824 回退——ext 填充
	// 延迟 (carrier 是孵化能量通道) 比升级早启 400t 更值钱, carrier 前置
	// 是容量复利的一部分, 维持现行序列 (universal→carrier→harvester 交替)。
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
	// 建造紧急豁免: critical worker (priority 2, 容器 decay 维修/重建) 不随采集
	// 让位出局——维修窗口错过 = 容器死亡 = 升级链断供数千 tick (sim 实证 cc 容器
	// decay 死后 8.9k tick 断供, 损失 ~35k 进度), 比采集面晚饱和几百 tick 更贵
	const criticalWorker = (r: { unit: string; priority: number }): boolean =>
		r.unit === "worker" && r.priority <= 2;
	const rawPool = harvesterShort
		? gated.filter(
				(r) =>
					r.unit === "harvester" ||
					r.unit === "defender" ||
					r.unit === "scout" ||
					criticalWorker(r) ||
					// 升级体恒随行 (E18 实现修正, race-speedrun 6.1 第五轮): 原实现
					// 只把 upgrader 从拒绝计数里排除, 并未加回仲裁池——采集让位窗口内
					// 升级请求实际被丢弃, 与下方注释语义相反。RCL1 首 300t 恒让位,
					// 首只 upgrader 拖到 t1215 (本可 t~100 上岗), 前 850t 升级进度 0。
					// 升级体与采集体消耗不同预算档, 不构成能量挤占。
					(r.unit === "upgrader" && (spawn.room.controller?.level ?? 0) <= 1) ||
					// 采集未满编期间 carrier 不超过在岗矿工数 (1 采 1 搬交替孵化)
					(r.unit === "carrier" &&
						((spawn.room.controller?.level ?? 0) > 1 || staffed("harvester") > 0) &&
						staffed("carrier") < Math.max(1, staffed("harvester"))),
			)
		: gated;
	if (harvesterShort) {
		const kept = new Set(rawPool.map((r) => r.unit));
		// 让位窗口内仍放行升级体 (E18): race 本体升级请求虽垫底 (UPGRADE prio 42)
		// 但从不被闸拦——采集面铺满前压制升级会让开局升级链停摆数千 tick
		// (sim 实证 upgrade 任务 available 4600t 无人租, L2 拖到 5900+,
		// race 参照 676); 升级体与采集体消耗不同预算档, 不构成能量挤占。
		kept.add("upgrader");
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
	// 远程采集件是自回运 (满载跨房走回本矿卸 cc), 无 CARRY 则永远驻源 drop——
	// 由「请求用途」驱动 (remote:harvest 前缀), 不再用 remoteHarvestActive 全局
	// 污染本地矿工 (批次 H 环 2: 恒真 flag 让本地 RCL2 期全部带上 CARRY,
	// 纯泵纪元终结, 250 直供泵断供——同因引发的本地塌方)。
	const hints: BodyHints = {
		slowTerrain: isSlowTerrain(terrainProfileFor(spawn.room.name, ctx.tick)),
		// 接力期档 (specs/relay-hauling): RCL < 等级门用微型接力件, 达门大件直运
		relayCarrier: (spawn.room.controller?.level ?? 0) < RELAY_CONFIG.maxRcl,
		directCarrier: (spawn.room.controller?.level ?? 0) >= RELAY_CONFIG.maxRcl,
		remoteHarvester: requestStartsWith(pool, "remote:harvest:"),
		noCarrierOnSite:
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
				staffed(r.unit) <= bootstrapFloorOf(r.unit) ||
				// RCL1 升级面优先铺满 (race-speedrun 6.1 第六轮): 首 200 进度
				// 只需升级体, 而 carrier L3 常驻池会把每只 upgrader 压到换代
				// 才上槽 (实测第二只拖到 t461); 请求在池 = 定编有缺口, 放行
				(r.unit === "upgrader" && (spawn.room.controller?.level ?? 0) <= 1)) &&
			// 首只矿工前不放行载体 (race-speedrun 6.1 第六轮): 无矿工在场时
			// 载体无货可拉, 只吃掉开局唯一的百点能量与孵化槽 (实测 t9 孵出后
			// ~290t 才有第一桶可搬能量, 同期升级链停摆)
			!(r.unit === "carrier" &&
				(spawn.room.controller?.level ?? 0) <= 1 &&
				staffed("harvester") === 0) &&
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
		// 执行与判定同口径 (bugs 开局断链·续): 判定预算 max(available, starter)
		// 是「体型目标」而非「可支付能量」——spawnCreep 按真实存量扣费, 虚预算
		// 产出 250e 体型在 avail 150 时恒 -6 (ERR_NOT_ENOUGH_ENERGY), 开局
		// 1500t 孵化槽静默的根因 (sim 探针实锤)。攒不够起步预算就等真攒够,
		// 不用假设性能量下单。
		const bootstrapBudget = Math.max(available, SPAWN_CONFIG.harvesterStarterBudget);
		body =
			available >= SPAWN_CONFIG.harvesterStarterBudget ||
			available >= bodyCost(buildBody(request.unit, bootstrapBudget, hints) ?? [])
				? buildBody(request.unit, bootstrapBudget, hints)
				: null;
	} else if (bootstrapUpgrade) {
		request = bootstrapUpgrade;
		body = buildBody(request.unit, request.budget ?? available, hints);
	} else if (urgent) {
		request = urgent;
		body = buildBody(urgent.unit, urgent.budget ?? available, hints);
	} else {
		// 建造紧急等待窗 (decay 维修): critical worker (L2) 在队但当前能量孵不出
		// 最低预算 (RUSH_WORKER_MIN_BUDGET) 时, 本 tick 不孵低优先小体——能量让给
		// 下一波峰 (~50t 内), 否则 fill_spawn/carrier 小体恒把 critical worker 顶掉,
		// 维修窗口恒错过 (sim 实证 45k 零 worker, cc 容器 decay 死升级链断 8.9k tick)
		const criticalWorkerWaiting = pool.find(
			(r) =>
				r.unit === "worker" &&
				r.priority <= 2 &&
				available < RUSH_WORKER_MIN_BUDGET,
		);
		// 等待窗上限 (c16-c18 死锁实证): 采集面崩溃后 eAvail 恒 < 200, 无限等待
		// 吞掉整条孵化线 → 能量面更瘫 → 恶性循环 (creeps 冻结 6 只 10k tick)。
		// 超窗即放行低优先小体——恢复能量面 (fill_spawn/harvester) 比无限干等强
		const waitExpired =
			criticalWorkerWaiting !== undefined &&
			ctx.tick - idle >= SPAWN_CONFIG.capacityWaitTicks;
		if (criticalWorkerWaiting && !waitExpired) {
			idleSince[spawn.id] = idle;
			ctx.cpu.recordSkip("spawn-director", "critical-worker-wait");
			return undefined;
		}
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
		if (ctx.tick < 1600 && ctx.tick % 50 === 0) {
			ctx.logger?.warn?.(
				"probe-arb",
				`t${ctx.tick} avail=${available} urgent=${urgent?.unit ?? "-"} bootH=${bootstrapHarvest ? "y" : "n"} bootU=${bootstrapUpgrade ? "y" : "n"} req=${request?.unit ?? "-"} booted=${request ? "y" : "n"}`,
			);
		}
		// 能量不足以生产任何请求: 等待积累, 计入跳过指标
		idleSince[spawn.id] = idle;
		ctx.cpu.recordSkip("spawn-director", "budget");
		return undefined;
	}
	delete idleSince[spawn.id];
	return { request, body };
}
