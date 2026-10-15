/**
 * 主状态面板 (左上角, 全仓两面板之一; 冲级面板在左下由 roomVisuals 渲染) 与领域查询入口。
 * Visuals 作为观测/呈现模块, 经各域公共出口读取快照 (呈现依赖领域, 内核不反向依赖模块)。
 * 版式: 姿态色侧边条 + 品牌头部行 + 细分隔线 + 两字标签对齐的正文行;
 * 威胁/异常行仅在有事时出现; 全量模块明细只在控制台 Nexus.metrics()。
 */
import type { TickContext } from "@/core";
import type { Telemetry } from "@/core/metrics";
import { unitCode } from "@/constant/UnitConstant";
import type { Posture } from "@/core/store/memorySchema";
import { economyIndicators, type EconomyIndicators } from "@/modules/economy";
import { strategySnapshot, roomModeFor, type StrategySnapshot } from "@/modules/strategy";
import { clusterSnapshot, type ClusterSnapshot } from "@/modules/cluster";
import { defenseSnapshot, type DefenseSnapshot } from "@/modules/defense";
import { HUD_BODY_FONT, HUD_THEME, type HudLine } from "@/modules/visuals/roomVisuals";

/** 最近一 Tick 的领域快照 (控制台查询入口用; global 重置后首 Tick 重建) */
let lastEconomy: EconomyIndicators | null = null;
let lastStrategy: StrategySnapshot | null = null;
let lastCluster: ClusterSnapshot | null = null;
let lastDefense: DefenseSnapshot | null = null;
let lastModes: Record<string, string> = {};

const HUD_X = 0.5,
	HUD_TOP = 0.55,
	HUD_W = 15.5,
	HUD_LH = 0.75;

const POSTURE_COLOR: Record<Posture, string> = {
	survive: HUD_THEME.warn,
	develop: HUD_THEME.good,
	expand: HUD_THEME.info,
	war: HUD_THEME.bad,
};

function shortModuleName(name: string): string {
	return name
		.replace(/-planners$/, "")
		.replace(/-director$/, "")
		.replace("action-", "");
}

function drawPanel(ctx: TickContext, telemetry: Telemetry): void {
	if (typeof Game === "undefined") return;
	const room = Object.values(Game.rooms).find((candidate) => candidate.controller?.my);
	if (!room) return;

	const s = telemetry.summary();
	const posture = ctx.memory.global.posture;

	// 正文行: 运行状态 + 条件行 (威胁/异常)
	const rows = worldHudLines(ctx, room);
	const abnormal = s.modules.filter((mod) => mod.errors > 0 || mod.skips > 0);
	if (abnormal.length > 0) {
		const detail = abnormal
			.map(
				(mod) =>
					`${shortModuleName(mod.name)}${mod.errors > 0 ? ` ✗${mod.errors}` : ` ·${mod.skips}`}`,
			)
			.join("  ");
		const hasErrors = abnormal.some((mod) => mod.errors > 0);
		rows.push({ text: `异常  ${detail}`, color: hasErrors ? HUD_THEME.bad : HUD_THEME.warn });
	}

	// 几何: 侧边条 + 底板 + 头部 + 分隔线 + 正文 (分隔线紧贴头部, 正文行距均匀)
	const headerY = HUD_TOP + 0.55;
	const dividerY = headerY + 0.3;
	const firstRowY = dividerY + 0.75;
	const panelH = firstRowY - HUD_TOP + rows.length * HUD_LH + 0.3;
	room.visual.rect(0.1, HUD_TOP, HUD_W, panelH, {
		fill: "#0A0E18",
		opacity: 0.78,
		stroke: "#1E2A44",
		strokeWidth: 0.05,
	});
	// 姿态色侧边条: 面板主视觉, 常态绿 / 存续黄 / 扩张蓝 / 战争红
	room.visual.rect(0.1, HUD_TOP, 0.16, panelH, {
		fill: POSTURE_COLOR[posture],
		opacity: 0.95,
	});
	room.visual.text(`Nexus CPU ${s.cpuUsed.toFixed(2)}`, HUD_X, headerY, {
		color: HUD_THEME.header,
		font: "bold 0.62 Consolas",
		align: "left",
	});
	// 分隔线: 与底板同缩进 (两侧各 0.3), 横贯面板
	room.visual.line(0.4, dividerY, 0.1 + HUD_W - 0.3, dividerY, { color: "#2A3A55", width: 0.04 });
	rows.forEach((row, i) => {
		room.visual.text(row.text, HUD_X, firstRowY + i * HUD_LH, {
			align: "left",
			color: row.color,
			font: HUD_BODY_FONT,
			opacity: 0.95,
		});
	});
}

/** 正文行: 两字标签列对齐 (能量/孵化/任务/编制/经济, 条件行: 威胁) */
function worldHudLines(ctx: TickContext, room: Room): HudLine[] {
	const lines: HudLine[] = [];
	const T = HUD_THEME;

	// 能量/孵化不在此显示——左下冲级面板的「能量/孵化」段已承载, 不重复
	// 模式: 本房运行档位 (specs/room-mode-profiles), 冲级档高亮
	const mode = roomModeFor(ctx, room.name);
	lines.push({
		text: `模式  ${mode}`,
		color: mode === "rush" ? T.info : mode === "low" ? T.dim : T.text,
	});

	// 任务
	let avail = 0,
		active = 0;
	for (const t of Object.values(ctx.memory.tasks)) {
		if (t.status === "available") avail++;
		else if (t.status === "leased" || t.status === "in_progress") active++;
	}
	lines.push({ text: `任务  活 ${active} · 待 ${avail}`, color: T.text });

	// 编制: 全名经 UNIT_CODES 折叠为代号 (H/C/U/W...), 未收录回退大写
	const units = new Map<string, number>();
	for (const u of Object.values(ctx.memory.units)) {
		const code = unitCode(u.unitCode);
		units.set(code, (units.get(code) ?? 0) + 1);
	}
	const roster = [...units]
		.sort()
		.map(([code, n]) => `${code}×${n}`)
		.join(" ");
	lines.push({ text: `编制  ${roster}`, color: T.text });

	// 经济: 产/运效率, 异常时附瓶颈与缺货
	const indicators = economyIndicators(ctx);
	const diagnosis = ctx.memory.economy.diagnosis;
	const utilization =
		indicators.haulUtilization >= 0 ? Math.round(indicators.haulUtilization * 100) : 0;
	const harvest =
		indicators.sourceHarvestEfficiency >= 0
			? Math.round(indicators.sourceHarvestEfficiency * 100)
			: 0;
	const starve =
		indicators.criticalStructureStarvation > 0
			? ` ⚠缺货${indicators.criticalStructureStarvation}`
			: "";
	const bottleneck = diagnosis.bottleneck === "none" ? "" : ` · ${diagnosis.bottleneck}`;
	lines.push({
		text: `经济  产 ${harvest}% · 运 ${utilization}%${starve}${bottleneck}`,
		color: diagnosis.bottleneck === "none" && !starve ? T.dim : T.warn,
	});

	// 威胁/编队: 仅有威胁或编队时显示
	const defense = defenseSnapshot(ctx);
	const cluster = clusterSnapshot(ctx);
	if (defense.maxScore > 0 || cluster.squadCount > 0) {
		const squads = cluster.rosters
			.map((unit) => `${unit.taskKind} ${unit.members}/${unit.slots}`)
			.join(" ");
		lines.push({
			text: `威胁  ${defense.tier}${defense.maxScore > 0 ? ` ${Math.round(defense.maxScore)}` : ""}${squads ? ` · ${squads}` : ""}`,
			color: defense.tier === "peace" ? T.dim : T.bad,
		});
	}
	return lines;
}

/** 领域查询入口注册 (与内核的 metrics/modules 合并于同一控制台对象) */
function registerQueries(): void {
	const query = (globalThis as unknown as { Nexus?: Record<string, unknown> }).Nexus ?? {};
	query.economy = () => lastEconomy;
	query.strategy = () => lastStrategy;
	query.defense = () => lastDefense;
	query.cluster = () => lastCluster;
	query.modes = () => lastModes;
	(globalThis as unknown as Record<string, unknown>).Nexus = query;
}
registerQueries();

/** 每 Tick 面板刷新 + 快照缓存更新 (Visuals.run 调用) */
export function drawStatusPanel(ctx: TickContext): void {
	drawPanel(ctx, ctx.telemetry);
	lastEconomy = economyIndicators(ctx);
	lastStrategy = strategySnapshot(ctx);
	lastDefense = defenseSnapshot(ctx);
	lastCluster = clusterSnapshot(ctx);
	const modes: Record<string, string> = {};
	for (const room of Object.values(Game.rooms)) {
		if (room.controller?.my) {
			modes[room.name] = roomModeFor(ctx, room.name);
		}
	}
	lastModes = modes;
}
