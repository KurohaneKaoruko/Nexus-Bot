/**
 * 编队收益对比 (specs/squad-coordination-metrics「编队收益指标入遥测」):
 * 记录编队建立前 (基线) 与建立后 (协同窗口) 的战损/击杀/存活时长, 作为
 * 「协同是否带来收益」的可取证判据 —— docs/nexus-design/02 原则 F 要求无证据的
 * 「智能」不上线, 故本模块是 C4/C5 开启门的数据来源。
 *
 * 有界性: 每房一条定长记录 (固定 8 个数), 不随 tick 或编队次数增长;
 * 房间消失即清理。纯函数 + 单调状态, 不调用游戏 API。
 */
import { CLUSTER_CONFIG } from "@/config/cluster";
import type { TickContext } from "@/core";
import type { SquadBenefitRecord } from "@/core/store/memorySchema";
import type { RoomObservation } from "@/core/world";

/** 一次采样窗口内的房间观测 (由调用方从世界快照与死亡集合提取) */
export interface SquadBenefitSample {
	room: RoomObservation;
	/** 该房全部编队成员名 (由 SquadRecord.members 反填) */
	squadMembers: ReadonlySet<string>;
	/** 本 Tick 死亡的编队成员名 (战损口径) */
	lostMembers: readonly string[];
	/** 本 Tick 从视野消失的敌对 creep 数 (击杀口径) */
	vanishedHostiles: number;
}

const emptyRecord = (window: number): SquadBenefitRecord => ({
	window,
	kills: 0,
	losses: 0,
	memberTicks: 0,
	baseKills: 0,
	baseLosses: 0,
	baseMemberTicks: 0,
	evaluatedAt: 0,
});

/** 窗口衰减: 累计值按 window 线性回退, 保证定长窗口语义且不随 tick 增长 */
const decay = (value: number, window: number): number =>
	window > 0 ? Math.max(0, value - value / window) : value;

/** 归一化净收益 (每千 tick): 正 = 协同带来收益, 负 = 协同劣化 */
export function normalizedBenefitOf(record: SquadBenefitRecord): number {
	const span = Math.max(1, record.kills + record.baseKills);
	if (span <= 1) {
		return 0;
	}
	// 战损与存活时长同向折算: 少死 (losses 下降) 记为正收益
	const lossGain = (record.baseLosses - record.losses) / Math.max(1, record.baseLosses);
	return ((record.kills - record.baseKills) / span + lossGain) * 1000;
}

/** 该房间协同窗口是否达到开启门 (specs「协同行为默认关闭并以指标为开启门」) */
export function benefitGatePassed(record: SquadBenefitRecord | undefined): boolean {
	if (!CLUSTER_CONFIG.benefit.enabled) {
		return false;
	}
	if (!record) {
		return false;
	}
	return normalizedBenefitOf(record) >= CLUSTER_CONFIG.benefit.enableThreshold;
}

/**
 * 逐房刷新编队收益记录:
 * - 无活跃编队 → 累计落入基线侧 (等长窗口的「编队前」对照);
 * - 编队新建 → 把当前累计快照为基线, 协同窗口归零重新累计;
 * - 编队活跃 → 累计落入协同侧, 并按窗口长度衰减保持定长语义。
 */
export function updateSquadBenefit(
	ctx: TickContext,
	samples: readonly SquadBenefitSample[],
	activeSquadRooms: ReadonlySet<string>,
): void {
	const window = CLUSTER_CONFIG.benefit.windowTicks;
	const store = (ctx.memory.metrics.squadBenefit ??= {});
	const live = new Set<string>();

	for (const sample of samples) {
		const roomName = sample.room.roomName;
		live.add(roomName);
		const prev = store[roomName] ?? emptyRecord(window);
		const record: SquadBenefitRecord = { ...prev, window, evaluatedAt: ctx.tick };

		// 存活时长口径: 本 Tick 仍在场的编队成员数 (成员名由槽位任务 assignedTo 反填)
		const memberCount = sample.room.creeps.filter(
			(creep) => !creep.spawning && sample.squadMembers.has(creep.name),
		).length;
		const wasActive = activeSquadRooms.has(roomName);

		// 编队本 Tick 刚建立 (此前无记录且本 Tick 活跃) → 基线快照后重新累计
		if (wasActive && prev.evaluatedAt === 0) {
			record.baseKills = prev.kills;
			record.baseLosses = prev.losses;
			record.baseMemberTicks = prev.memberTicks;
			record.kills = 0;
			record.losses = 0;
			record.memberTicks = 0;
		}

		if (wasActive) {
			record.kills += sample.vanishedHostiles;
			record.losses += sample.lostMembers.length;
			record.memberTicks += memberCount;
			record.kills = decay(record.kills, window);
			record.losses = decay(record.losses, window);
			record.memberTicks = decay(record.memberTicks, window);
		} else {
			record.baseKills += sample.vanishedHostiles;
			record.baseLosses += sample.lostMembers.length;
			record.baseMemberTicks += memberCount;
			record.baseKills = decay(record.baseKills, window);
			record.baseLosses = decay(record.baseLosses, window);
			record.baseMemberTicks = decay(record.baseMemberTicks, window);
		}
		store[roomName] = record;
	}

	// 房间消失即清理 (有界: 记录随房增减而非随 tick 增长)
	for (const roomName of Object.keys(store)) {
		if (!live.has(roomName)) {
			delete store[roomName];
		}
	}
}

/** 观测快照 (HUD/控制台): 房名 → 协同窗口/基线对比与归一化净收益 */
export function squadBenefitSnapshot(ctx: TickContext): Array<{
	roomName: string;
	kills: number;
	baseKills: number;
	losses: number;
	baseLosses: number;
	normalized: number;
	gatePassed: boolean;
}> {
	const store = ctx.memory.metrics.squadBenefit ?? {};
	return Object.entries(store).map(([roomName, record]) => ({
		roomName,
		kills: Math.round(record.kills),
		baseKills: Math.round(record.baseKills),
		losses: Math.round(record.losses),
		baseLosses: Math.round(record.baseLosses),
		normalized: Number(normalizedBenefitOf(record).toFixed(2)),
		gatePassed: benefitGatePassed(record),
	}));
}