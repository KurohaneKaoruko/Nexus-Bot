/**
 * 应用组装: profile → 调度器 → 每 Tick 循环 (docs/nexus-design/15.1 骨架的 Phase 0 裁剪)。
 * 依赖方向: Game snapshot → bootstrap → TickContext → 阶段调度 → 遥测。
 * Phase 0 无业务模块, 阶段链零模块空跑; bootstrap / 预算 / 遥测真实工作。
 */
import type { VariantProfile } from "@/config/profile";
import { createCpuBudget, type CpuAccess } from "@/core/cpuBudget";
import { createErrorBoundary } from "@/core/errorBoundary";
import { formatError } from "@/core/errorMapper";
import { createLogger, type LogSink } from "@/core/logger";
import { TICK_PHASES } from "@/core/phases";
import { createScheduler, type TickModule } from "@/core/scheduler";
import { createWorldHolder } from "@/core/world";
import { bootstrapNexus } from "@/store/bootstrap";
import { createTelemetry, type Telemetry } from "@/core/metrics";
import { createTickContext, type TickContext } from "@/core/tickContext";
import { economyIndicators, type EconomyIndicators } from "@/modules/economy/model";
import { strategyHudLine, strategySnapshot, type StrategySnapshot } from "@/modules/strategy/core";
import { deriveStrategyDirective } from "@/modules/strategy/directive";
import { clusterSnapshot, type ClusterSnapshot } from "@/modules/cluster/index";
import { defenseSnapshot, type DefenseSnapshot } from "@/modules/defense/index";

/** 单次 flush 的输出目的地, 游戏内为 console.log */
const sink: LogSink = (message) => console.log(message);/** 运行时共享状态: global 重置时随沙盒一起重建, 不需要持久化 */
let shared: {
	logger: ReturnType<typeof createLogger>;
	telemetry: ReturnType<typeof createTelemetry>;
} | null = null;

/** 最近一 Tick 的经济指标 (控制台查询入口用) */
let lastEconomy: EconomyIndicators | null = null;

/** 最近一 Tick 的战略快照 (控制台查询入口用) */
let lastStrategy: StrategySnapshot | null = null;

/** 最近一 Tick 的编队快照 (控制台查询入口用) */
let lastCluster: ClusterSnapshot | null = null;

/** 最近一 Tick 的防御快照 (控制台查询入口用) */
let lastDefense: DefenseSnapshot | null = null;

function getShared() {
	if (!shared) {
		shared = { logger: createLogger({ sink }), telemetry: createTelemetry() };
	}
	return shared;
}

export interface BootOptions {
	profile: VariantProfile;
	/** 游戏内取原生 Memory 根; 测试可注入 stand-in */
	memoryRoot?: () => Record<string, unknown>;
	cpuAccess?: CpuAccess;
	tickSource?: () => number;
	shardName?: () => string;
	modules?: readonly TickModule[];
}

/**
 * 遥测以 RoomVisual HUD 呈现：深色半透明面板 + 色彩分层。
 * 绿 = 正常 · 黄 = 有跳过 · 红 = 有错误。
 * 控制台只保留限频错误与按需查询。
 */
interface HudLine { text: string; color: string; font: string }

const HUD_X = 1.5, HUD_Y = 1.2, HUD_W = 17, HUD_LH = 0.82, HUD_PAD = 0.55;

function drawHud(ctx: TickContext, telemetry: Telemetry): void {
	if (typeof Game === "undefined") return;
	const room = Object.values(Game.rooms)[0];
	if (!room) return;

	const s = telemetry.summary();
	const lines: HudLine[] = [];

	// ── 标题 ──
	lines.push({ text: `⚡ tick ${s.tick}   cpu ${s.cpuUsed.toFixed(2)}`, color: "#7fdbca", font: "bold 0.75" });

	// ── 模块行 ──
	for (const mod of s.modules) {
		const color = mod.errors > 0 ? "#ff6b6b" : mod.skips > 0 ? "#ffd93d" : "#98d8c8";
		const flag = mod.errors > 0 ? ` ✗${mod.errors}` : mod.skips > 0 ? ` ·${mod.skips}` : "";
		const short = mod.name.replace(/-planners$/, "").replace(/-director$/, "").replace(/action-/, "");
		lines.push({ text: `${short.padEnd(12)} ${mod.cpuLast.toFixed(2)}${flag}`, color, font: "0.55" });
	}

	// ── 分隔线 ──
	lines.push({ text: "─".repeat(22), color: "#3a3a5a", font: "0.35" });

	// ── 世界状态 ──
	lines.push(...worldHudLines(ctx));

	// ── 渲染 ──
	const h = lines.length * HUD_LH + HUD_PAD * 2;
	room.visual.rect(HUD_X - 0.3, HUD_Y - 0.15, HUD_W, h, {
		fill: "#0d0d1a", opacity: 0.72, stroke: "#2a2a4a", strokeWidth: 0.06,
	});
	for (let i = 0; i < lines.length; i++) {
		const ln = lines[i];
		if (ln) room.visual.text(ln.text, HUD_X, HUD_Y + 0.35 + i * HUD_LH, {
			align: "left", color: ln.color, font: ln.font, opacity: 0.88,
		});
	}
}

/** 经济状态行 */
function worldHudLines(ctx: TickContext): HudLine[] {
	const lines: HudLine[] = [];

	// 战略态势行 (docs/nexus-design/02 原则 F): 姿态/储备下限/节流/转移计数
	const strategy = strategyHudLine(strategySnapshot(ctx));
	lines.push({ text: strategy.text, color: strategy.color, font: "0.55" });

	// 防御/编队行 (docs/nexus-design/20): 威胁分级 + 编队就位进度 (仅在有威胁或编队时显示)
	const defense = defenseSnapshot(ctx);
	const cluster = clusterSnapshot(ctx);
	if (defense.maxScore > 0 || cluster.squadCount > 0) {
		const rosters = cluster.rosters
			.map((roster) => `${roster.taskKind}${roster.members}/${roster.slots}`)
			.join(" ");
		const text = `⛨ ${defense.tier}${defense.maxScore > 0 ? ` ${Math.round(defense.maxScore)}` : ""}${
			rosters ? ` ▣${rosters}` : ""
		}`;
		lines.push({ text, color: defense.tier === "peace" ? "#98d8c8" : "#ff6b6b", font: "0.55" });
	}

	let avail = 0, active = 0;
	for (const t of Object.values(ctx.memory.tasks)) {
		if (t.status === "available") avail++;
		else if (t.status === "leased" || t.status === "in_progress") active++;
	}
	if (avail + active > 0)
		lines.push({ text: `▣ 任务 ${active} 活跃 · ${avail} 待分配`, color: "#b8b8d0", font: "0.55" });

	const roles = new Map<string, number>();
	for (const u of Object.values(ctx.memory.units)) roles.set(u.roleCode, (roles.get(u.roleCode) ?? 0) + 1);
	if (roles.size > 0)
		lines.push({ text: `♟ ${[...roles].map(([c, n]) => `${c}×${n}`).join("  ")}`, color: "#b8b8d0", font: "0.55" });

	if (typeof Game !== "undefined") {
		for (const sp of Object.values(Game.spawns)) {
			if (sp.spawning) {
				lines.push({ text: `◉ 孵化中 (${sp.spawning.remainingTime}t)`, color: "#ffd93d", font: "0.55" });
			} else {
				const pct = Math.round(sp.room.energyAvailable / Math.max(1, sp.room.energyCapacityAvailable) * 100);
				lines.push({ text: `○ Spawn ${pct}%`, color: pct >= 100 ? "#98d8c8" : "#b8b8d0", font: "0.55" });
			}
		}
	}

	// 经济指标行 (docs/nexus-design/06 §6.8): 产/运速率 · 缺货 · 瓶颈诊断
	const indicators = economyIndicators(ctx);
	const diagnosis = ctx.memory.economy.diagnosis;
	const utilization = indicators.haulUtilization >= 0 ? Math.round(indicators.haulUtilization * 100) : 0;
	const starve = indicators.criticalStructureStarvation > 0 ? ` ⚠缺${indicators.criticalStructureStarvation}` : "";
	lines.push({
		text: `ξ 产${indicators.sourceHarvestEfficiency >= 0 ? Math.round(indicators.sourceHarvestEfficiency * 100) : 0}% 运${utilization}%${starve} ${diagnosis.bottleneck}`,
		color: diagnosis.bottleneck === "none" ? "#98d8c8" : "#ffd93d",
		font: "0.55",
	});
	return lines;
}

export function bootNexus(options: BootOptions): () => void {
	const { logger, telemetry } = getShared();
	const memoryRoot = options.memoryRoot ?? (() => Memory as unknown as Record<string, unknown>);
	const cpuAccess =
		options.cpuAccess ??
		({
			getUsed: () => Game.cpu.getUsed(),
			getLimit: () => Game.cpu.tickLimit ?? Game.cpu.limit,
			getBucket: () => Game.cpu.bucket,
		} satisfies CpuAccess);
	const tickSource = options.tickSource ?? (() => Game.time);
	const shardName = options.shardName ?? (() => Game.shard?.name ?? "shard0");

	const errors = createErrorBoundary(logger, {
		onRecord: (err) => telemetry.onError(err.module),
	});
	const cpu = createCpuBudget(cpuAccess, {
		onMeasure: telemetry.onMeasure,
		onSkip: telemetry.onSkip,
	});
	const scheduler = createScheduler(options.profile);
	for (const module of options.modules ?? []) {
		scheduler.register(module);
	}
	const world = createWorldHolder();

	// 控制台查询入口: Nexus.metrics() / Nexus.economy() / Nexus.strategy() / Nexus.defense() / Nexus.cluster()
	(globalThis as unknown as Record<string, unknown>).Nexus = {
		metrics: () => telemetry.summary(),
		economy: () => lastEconomy,
		strategy: () => lastStrategy,
		defense: () => lastDefense,
		cluster: () => lastCluster,
		modules: () => ({
			enabled: scheduler.enabledModuleNames(),
			disabled: scheduler.disabledModuleNames(),
		}),
	};

	return function loop(): void {
		try {
			const tick = tickSource();
			logger.beginTick(tick);

			const nexus = bootstrapNexus({ memory: memoryRoot(), tick, logger });
			const ctx = createTickContext({
				tick,
				shardName: shardName(),
				cpu,
				logger,
				errors,
				world,
				memory: nexus,
				deriveDirective: deriveStrategyDirective,
			});

			for (const phase of TICK_PHASES) {
				scheduler.runPhase(phase, ctx);
			}

			telemetry.recordTick(tick, cpuAccess.getUsed());
			drawHud(ctx, telemetry);
			lastEconomy = economyIndicators(ctx);
			lastStrategy = strategySnapshot(ctx);
			lastDefense = defenseSnapshot(ctx);
			lastCluster = clusterSnapshot(ctx);
		} catch (err) {
			// 顶层兜底: 经 sourcemap 还原后输出, 不让未捕获异常污染 Screeps 自身的报错通道
			console.error(formatError(err));
		}
	};
}
