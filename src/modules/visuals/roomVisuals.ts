// @ts-nocheck
/*
 * 冲级行数据 + spawn 标注: 只产出 HudLine[], 面板渲染统一在 core/boot drawHud。
 * 分段评估消费 utils/raceSegments (与主线单源), 判废快照仅最新单条入 Memory。
 */
import { UNIT_CODES, unitCode } from "@/constant/UnitConstant";
import { CONTROLLER_BUFFER_CONFIG } from "@/config/economy";
import { evaluateRaceSegments, applySegmentVerdicts, RUSH_SEGMENT_LEVELS } from "@/utils/raceSegments";
import { CompoundColor } from "@/constant/ResourceConstant";
import { getLabAB } from "@/modules/industry/labReservations";
import { decompressBatch } from "@/utils/compress";
import LayoutVisual from "@/modules/planner/layoutVisual";

type UnitId = keyof typeof UNIT_CODES;
const isUnitId = (unit?: string): unit is UnitId => !!unit && unit in UNIT_CODES;
const UNITS = { carrier: "carrier", upgrader: "upgrader" } as const;

/**
 * 建筑可视化：孵化中 spawn 的数据标注 + lab 产物标注 + 布局规划图。
 */

/** 孵化中 spawn：角色代号 + 剩余 tick；记忆缺角色或角色未注册时取消孵化 */
export function drawSpawnInfo(spawns: StructureSpawn[]): void {
	for (const spawn of spawns) {
		if (!spawn.spawning) continue;

		const creepMemory = Memory.creeps[spawn.spawning.name];
		const unit = creepMemory?.unit;
		if (!isUnitId(unit)) {
			spawn.spawning.cancel();
			continue;
		}

		const code = unitCode(unit);
		spawn.room.visual.text(`${code} 🕒${spawn.spawning.remainingTime}`, spawn.pos.x, spawn.pos.y, {
			align: "center",
			color: "red",
			stroke: "#ffffff",
			strokeWidth: 0.05,
			font: "bold 0.32 inter",
		});
	}
}

/** lab：产物矿物文本 + A/B 源 lab 圈标记（A 粉圈 / B 蓝圈）；bucket < 1000 跳过 */
export function drawLabInfo(labs: StructureLab[], room: Room): void {
	if (Game.cpu.bucket < 1000) return;
	const { labA, labB } = getLabAB(room.name, room);

	for (const lab of labs ?? []) {
		if (!lab.mineralType) continue;
		room.visual.text(lab.mineralType, lab.pos.x, lab.pos.y, {
			align: "center",
			color: (CompoundColor as any) [lab.mineralType],
			stroke: "#2a2a2a",
			strokeWidth: 0.05,
			font: "0.24 inter",
		});
	}

	if (labA) {
		room.visual.circle(labA.pos, {
			radius: 0.42,
			fill: "transparent",
			stroke: "#ff4fd8",
			opacity: 0.7,
			strokeWidth: 0.08,
		});
	}
	if (labB) {
		room.visual.circle(labB.pos, {
			radius: 0.42,
			fill: "transparent",
			stroke: "#4fd8ff",
			opacity: 0.7,
			strokeWidth: 0.08,
		});
	}
}

// ── 冲级面板 ─────────────────────────────────────────────

/** 各等级 → 下一级所需进度点兜底表（实测条优先，缺采样时使用） */
const RCL_BAR_FALLBACK: Record<number, number> = {
	1: 200,
	2: 45000,
	3: 135000,
	4: 405000,
	5: 1215000,
	6: 3645000,
	7: 10935000,
};

type RaceSample = { t: number; p: number };
type RaceMemory = {
	/** 基线 tick（lv1 达成时刻），显示均取相对值 */
	baseline?: number;
	/** 各等级达成 tick（绝对值） */
	levels: Record<number, number>;
	/** 各等级达成时的段速（点/tick） */
	levelRates: Record<number, number>;
	/** 各等级进度条实测值（progressMax 采样） */
	bars: Record<number, number>;
	/** 速率采样环 {tick, 累计进度点} */
	samples: RaceSample[];
	/** 各分段评估状态（逐 tick 刷新） */
	segments?: SegmentStatus[];
};

const SAMPLE_STEP = 10;
const SAMPLE_KEEP = 51;

const raceMemStore = new Map<string, RaceMemory>();
const getRaceMem = (roomName: string): RaceMemory => {
	let mem = raceMemStore.get(roomName);
	if (!mem) {
		mem = { levels: {}, levelRates: {}, bars: {}, samples: [] };
		raceMemStore.set(roomName, mem);
	}
	mem.levels ??= {};
	mem.levelRates ??= {};
	mem.bars ??= {};
	mem.samples ??= [];
	return mem;
};

const fmtTick = (n: number): string => {
	if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 1e5 || n % 1000 === 0 ? 0 : 1)}k`;
	return `${Math.round(n)}`;
};
/** HUD 进度条 (boot 主面板与冲级行共用) */
export const hudBar = (ratio: number, width = 12): string => {
	const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
	return "█".repeat(filled) + "░".repeat(width - filled);
};

/** HUD 统一主题 (主面板与冲级行共用; 色值保持冲级面板原版) */
export const HUD_THEME = {
	header: "#FFE66D",
	good: "#7CFC00",
	info: "#4CC9F0",
	warn: "#FFC300",
	bad: "#FF6B6B",
	section: "#5A5E66",
	text: "#E8E8E8",
	dim: "#8892A6",
} as const;

/** HUD 正文统一字体 */
export const HUD_BODY_FONT = "0.62 Consolas";

/** HUD 行数据: boot 主面板与各模块行生成的交换格式 */
export interface HudLine {
	text: string;
	color: string;
}

const rateColor = (rate: number): string =>
	rate >= 10
		? HUD_THEME.good
		: rate >= 5
			? HUD_THEME.info
			: rate >= 1
				? HUD_THEME.warn
				: HUD_THEME.good;

/**
 * 冲级行数据：先更新采集（达成记录/速率采样/分段评估），再产出主面板行。
 * 渲染由 boot HUD 统一完成，本函数不自绘。
 */
export function raceHudLines(room: Room): HudLine[] {
	const controller = room.controller;
	if (!controller?.my) return;

	const mem = getRaceMem(room.name);
	const level = controller.level;
	const now = Game.time;

	// ── 达成记录：本级首观测即达成时刻。中途接入（部署晚于落地）时历史等级
	// 无法回溯，不补盖假戳——缺的就地隐藏；段速只对「上一级达成时刻已知」的段结算
	// 清号检测：等级低于历史最高＝账号被清重开，旧里程碑整体作废重记
	const maxSeen = Object.keys(mem.levels)
		.map(Number)
		.reduce((m, v) => Math.max(m, v), 0);
	if (level < maxSeen) {
		mem.levels = {};
		mem.levelRates = {};
		mem.bars = {};
		mem.samples = [];
		mem.segments = undefined;
		mem.baseline = now;
	}
	if (!mem.levels[level]) {
		mem.levels[level] = now;
		const prev = level - 1;
		if (prev >= 1 && mem.levels[prev]) {
			const span = mem.levels[level] - mem.levels[prev];
			const barPrev = mem.bars[prev] || RCL_BAR_FALLBACK[prev] || 0;
			mem.levelRates[level] = span > 0 ? barPrev / span : 0;
		}
		mem.baseline ??= now;
	}
	mem.baseline ??= now;
	// 部分运行时未实现 progressMax: 缺失时走静态条表兜底
	const progressMax = (controller as any).progressMax as number | undefined;
	if (progressMax) mem.bars[level] = progressMax;

	const progress = controller.progress || 0;
	const barPts = mem.bars[level] || RCL_BAR_FALLBACK[level] || progressMax || 1;

	// ── 升级速率采样 ──
	let cumulative = 0;
	for (let l = 1; l < level; l++) cumulative += mem.bars[l] || RCL_BAR_FALLBACK[l] || 0;
	cumulative += progress;

	const samples = mem.samples;
	if (samples.length === 0 || now - samples[samples.length - 1].t! >= SAMPLE_STEP) {
		samples.push({ t: now, p: cumulative });
		while (samples.length > SAMPLE_KEEP) samples.shift();
	}
	let winRate = 0;
	if (samples.length >= 2) {
		const s0 = samples[0];
		const s1 = samples[samples.length - 1];
		winRate = (s1!.p! - s0!.p!) / Math.max(1, s1!.t! - s0!.t!);
	}
	const totalRate = cumulative / Math.max(1, now - mem.baseline);
	const rate = winRate > 0 ? winRate : totalRate;

	const remaining = Math.max(0, barPts - progress);
	const etaTicks = rate > 0 ? Math.ceil(remaining / rate) : Infinity;

	// ── 分段评估：逐 tick 刷新 ──
	const pointsToReach: Record<number, number> = {};
	for (const segLevel of RUSH_SEGMENT_LEVELS) {
		if (segLevel <= level) continue;
		let pts = Math.max(0, barPts - progress);
		for (let l = level + 1; l < segLevel; l++) pts += mem.bars[l] || RCL_BAR_FALLBACK[l] || 0;
		pointsToReach[segLevel] = pts;
	}
	mem.segments = evaluateRaceSegments({
		baseline: mem.baseline!,
		now,
		level,
		rate,
		levels: mem.levels,
		pointsToReach,
	});

	// ── 冲级状态采集（读本方 unit 字段） ──
	let ocTotal = 0;
	let uWork = 0;
	const census: Record<string, number> = {};
	for (const creep of Object.values(Game.creeps)) {
		const unit = creep.memory?.unit ?? "?";
		census[unit] = (census[unit] ?? 0) + 1;
		if (unit === UNITS.carrier) ocTotal++;
		else if (unit === UNITS.upgrader) uWork += creep.getActiveBodyparts(WORK);
	}
	// cc 存量 (判废归因: 升级直供链路是否断货)
	const ccStructure = room.find(FIND_STRUCTURES, {
		filter: (s) =>
			s.structureType === STRUCTURE_CONTAINER &&
			s.pos.inRangeTo(controller.pos, CONTROLLER_BUFFER_CONFIG.adoptRange),
	})[0];
	const ccEnergy = ccStructure ? ccStructure.store.energy : -1;

	// ── 判废落账: 仅首次判废或判废段变化时写快照 (单条覆盖有界, specs 判废快照) ──
	if (mem.segments.some((s) => s.failed)) {
		const nexusMemory = Memory.Nexus ?? (Memory.Nexus = {});
		const roomTable = nexusMemory.rooms ?? (nexusMemory.rooms = {});
		const intel = roomTable[room.name] ?? (roomTable[room.name] = {});
		const verdict = intel.raceVerdict ?? (intel.raceVerdict = {});
		const isNew = applySegmentVerdicts(verdict, mem.segments, (segment) => ({
			time: now,
			level,
			segment: segment.level,
			target: segment.target,
			elapsed: segment.elapsed ?? segment.achievedAt,
			upgradeWork: uWork,
			controllerBuffer: ccEnergy,
			energyState: `${room.energyAvailable}/${room.energyCapacityAvailable}`,
			census,
		}));
		if (isNew) {
			console.log(
				`[nexus] 冲级分段判废 ${room.name} RCL${verdict.failedSegment} @+${now - (mem.baseline ?? now)}t`,
			);
		}
	}

	// ── 行生成（版式保持原版, 分段行做列对齐）──
	const rows: HudLine[] = [];
	const push = (text: string, color: string): void => {
		rows.push({ text, color });
	};
	const T = HUD_THEME;

	const maxed = level >= 8;
	push(maxed ? `冲级 RCL8 满级` : `冲级 RCL${level} → RCL${level + 1}`, T.header);
	if (maxed) {
		push(`${hudBar(1)} 满级`, T.good);
	} else {
		push(
			`${hudBar(progress / barPts, 10)} ${Math.round((progress / barPts) * 100)}% ${fmtTick(progress)}/${fmtTick(barPts)}`,
			T.info,
		);
		push(`速率 ${winRate.toFixed(1)}/t (全程均 ${totalRate.toFixed(1)})`, rateColor(winRate));
		push(`预计 RCL${level + 1} 还需 ${isFinite(etaTicks) ? fmtTick(etaTicks) + "t" : "?"}`, T.warn);
	}
	push(`── 分段目标 ─────────`, T.section);
	push(`Tick：${fmtTick(Math.max(0, now - (mem.baseline ?? now)))}`, T.text);
	for (const seg of mem.segments ?? []) {
		// 三列对齐: 等级 | 双线目标 | 状态 (ASCII 等宽字体下 padEnd 对齐)
		const label = `RCL${seg.level}`.padEnd(5);
		const limit = (
			seg.pass !== seg.target
				? `≤${fmtTick(seg.target)}/${fmtTick(seg.pass)}`
				: `≤${fmtTick(seg.target)}`
		).padEnd(11);
		if (seg.achievedAt !== undefined) {
			const grade = seg.failed ? "判废" : seg.behind ? "合格" : "达成";
			push(
				`${label}${limit}${grade} ${fmtTick(seg.achievedAt)}`,
				seg.failed ? T.bad : seg.behind ? T.warn : T.good,
			);
		} else if (seg.failed) {
			push(`${label}${limit}判废`, T.bad);
		} else {
			const etaText = seg.eta !== undefined ? fmtTick(seg.eta) : "?";
			push(
				`${label}${limit}ETA ${etaText}${seg.behind ? " 落后" : ""}`,
				seg.behind ? T.warn : T.info,
			);
		}
	}
	push(`── 能量/孵化 ────────`, T.section);
	push(
		`孵化能量 ${hudBar(room.energyAvailable / Math.max(1, room.energyCapacityAvailable), 6)} ${room.energyAvailable}/${room.energyCapacityAvailable}`,
		T.text,
	);
	push(`升级火力 ${uWork}W  搬运工 ${ocTotal}`, T.text);
	// 孵化状态直读 spawn 结构体（room.spunning 等临时属性不可靠）
	const spawnStructures = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
	const spawningInfo = spawnStructures.map((s) => s.spawning).find(Boolean) || null;
	push(
		spawningInfo ? `孵化中 ${spawningInfo.name} 剩${spawningInfo.remainingTime}t` : `孵化空闲`,
		spawningInfo ? T.info : T.warn,
	);
	return rows;
}

/**
 * 冲级面板：左下角独立渲染（原版版式, 仅分段行增加列对齐）。
 * 行数据来自 raceHudLines。
 */
export function raceVisual(room: Room): void {
	const rows = raceHudLines(room);
	if (rows.length === 0) return;
	const visual = room.visual;
	// 原版渲染: 左下角、无衬底、0.68 等宽字体 (仅分段行内容做列对齐)
	const rowH = 0.78;
	const top = 49.7 - rows.length * rowH;
	rows.forEach((row, i) => {
		visual.text(row.text, 0.5, top + i * rowH, {
			color: row.color,
			font: "0.68 Consolas",
			align: "left",
		});
	});
}

/** 布局规划图（旗标触发, ~1 CPU）: `layoutVisual` 旗标存在时渲染本房布局记录 */
export function drawLayoutVisual(room: Room): void {
	const flag = Game.flags["layoutVisual"] ?? Game.flags[`${room.name}/layoutVisual`];
	if (!flag) return;
	const record = Memory.Nexus?.layout?.rooms?.[room.name];
	if (!record?.data) return;
	const structMap: Record<string, Array<[number, number]>> = {};
	for (const [type, compressed] of Object.entries(record.data)) {
		structMap[type] = decompressBatch(compressed as number[]);
	}
	LayoutVisual.showRoomStructures(room.name, structMap);
}
