// @ts-nocheck
import { ROLE_CODES } from '@/constant/RoleConstant';
import { RUSH_CONFIG } from '@/config/race';

type RoleId = keyof typeof ROLE_CODES;
const isRoleId = (role?: string): role is RoleId => !!role && role in ROLE_CODES;
const ROLES = { carrier: 'carrier', upgrader: 'upgrader' } as const;

// ── 分段目标 (RosmarinBot Thresholds.RUSH 同款): 双线制, 相对 lv1 基线 tick ──
const SEGMENTS = Object.entries(RUSH_CONFIG.segmentTargets)
    .map(([level, spec]) => {
        const s = spec as { achieve: number; pass?: number };
        return { level: Number(level), target: s.achieve, pass: s.pass ?? s.achieve };
    })
    .sort((a, b) => a.level - b.level);
const RUSH_SEGMENT_LEVELS: number[] = SEGMENTS.map((s) => s.level);

interface SegmentStatus {
    level: number;
    /** 达成线 (相对基线 tick) */
    target: number;
    /** 合格线 (相对基线 tick) */
    pass: number;
    /** 达成耗时；未达成为 undefined */
    achievedAt?: number;
    /** 已流逝耗时；未达成为当前值 */
    elapsed?: number;
    /** 预计达成耗时；速率>0 且进度点已知才有值 */
    eta?: number;
    /** 落后：实际/预计耗时超达成线（但未超合格线 → 合格档） */
    behind: boolean;
    /** 判废：耗时超合格线 */
    failed: boolean;
}

interface SegmentEvalInput {
    baseline: number;
    now: number;
    level: number;
    rate: number;
    pointsToReach: Record<number, number>;
}

/** 评估全部分段状态 (相对基线, 绝不显示绝对 tick); 未达成段已流逝超合格线同样判废 */
const evaluateRaceSegments = (input: SegmentEvalInput): SegmentStatus[] => {
    const { baseline, now, rate, levels, pointsToReach } = input;
    const elapsed = now - baseline;
    return SEGMENTS.map(({ level, target, pass }) => {
        const achievedTick = levels[level];
        if (achievedTick) {
            const achievedAt = Math.max(0, achievedTick - baseline);
            return { level, target, pass, achievedAt, behind: achievedAt > target, failed: achievedAt > pass };
        }
        const remaining = pointsToReach[level];
        const eta = rate > 0 && remaining !== undefined
            ? elapsed + Math.ceil(remaining / rate)
            : undefined;
        const failed = elapsed > pass;
        const behind = failed || (eta !== undefined && eta > target);
        return { level, target, pass, elapsed, eta, behind, failed };
    });
};

/**
 * 建筑可视化：孵化中 spawn 的数据标注
 */

/** 孵化中 spawn：角色代号 + 剩余 tick；记忆缺角色或角色未注册时取消孵化 */
export function drawSpawnInfo(spawns: StructureSpawn[]): void {
    for (const spawn of spawns) {
        if (!spawn.spawning) continue;

        const creepMemory = Memory.creeps[spawn.spawning.name];
        const role = creepMemory?.role;
        if (!isRoleId(role)) {
            spawn.spawning.cancel();
            continue;
        }

        const code = ROLE_CODES[role] ?? role.toUpperCase();
        spawn.room.visual.text(
            `${code} 🕒${spawn.spawning.remainingTime}`,
            spawn.pos.x,
            spawn.pos.y,
            {
                align: 'center',
                color: 'red',
                stroke: '#ffffff',
                strokeWidth: 0.05,
                font: 'bold 0.32 inter',
            },
        );
    }
}

// ── 冲级面板 ─────────────────────────────────────────────

/** 各等级 → 下一级所需进度点兜底表（实测条优先，缺采样时使用） */
const RCL_BAR_FALLBACK: Record<number, number> = {
    1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000,
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

const C = {
    header: '#FFE66D',
    good: '#7CFC00',
    info: '#4CC9F0',
    warn: '#FFC300',
    bad: '#FF6B6B',
    section: '#5A5E66',
    text: '#E8E8E8',
} as const;

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
const bar = (ratio: number, width = 10): string => {
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
};
const rateColor = (rate: number): string => (rate >= 10 ? C.good : rate >= 5 ? C.info : rate >= 1 ? C.warn : C.good);

/** 冲级面板：左下角逐 tick 渲染。进度/速率/分段目标/孵化状态 */
export function raceVisual(room: Room): void {
    const controller = room.controller;
    if (!controller?.my) return;

    const mem = getRaceMem(room.name);
    const level = controller.level;
    const now = Game.time;

    // ── 达成记录：本级首观测即达成时刻。中途接入（部署晚于落地）时历史等级
    // 无法回溯，不补盖假戳——缺的就地隐藏；段速只对「上一级达成时刻已知」的段结算
    // 清号检测：等级低于历史最高＝账号被清重开，旧里程碑整体作废重记
    const maxSeen = Object.keys(mem.levels).map(Number).reduce((m, v) => Math.max(m, v), 0);
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
    if (samples.length === 0 || now - samples[samples.length - 1].t >= SAMPLE_STEP) {
        samples.push({ t: now, p: cumulative });
        while (samples.length > SAMPLE_KEEP) samples.shift();
    }
    let winRate = 0;
    if (samples.length >= 2) {
        const s0 = samples[0];
        const s1 = samples[samples.length - 1];
        winRate = (s1.p - s0.p) / Math.max(1, s1.t - s0.t);
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

    // ── 冲级状态采集（读本方 role 字段） ──
    let ocTotal = 0;
    let uWork = 0;
    for (const creep of Object.values(Game.creeps)) {
        const role = creep.memory?.role;
        if (role === ROLES.carrier) ocTotal++;
        else if (role === ROLES.upgrader) uWork += creep.getActiveBodyparts(WORK);
    }

    // ── 渲染 ──
    type Line = { text: string; color: string };
    const rows: Line[] = [];
    const push = (text: string, color: string) => rows.push({ text, color });

    const maxed = level >= 8;
    push(maxed ? `冲级 RCL8 满级` : `冲级 RCL${level} → RCL${level + 1}`, C.header);
    if (maxed) {
        push(`${bar(1)} 满级`, C.good);
    } else {
        push(`${bar(progress / barPts)} ${(progress / barPts * 100).toFixed(0)}% ${fmtTick(progress)}/${fmtTick(barPts)}`, C.info);
        push(`速率 ${winRate.toFixed(1)}/t (全程均 ${totalRate.toFixed(1)})`, rateColor(winRate));
        push(`预计 RCL${level + 1} 还需 ${isFinite(etaTicks) ? fmtTick(etaTicks) + 't' : '?'}`, C.warn);
    }
    push(`── 分段目标 ─────────`, C.section);
    push(`Tick：${fmtTick(Math.max(0, now - (mem.baseline ?? now)))}`, C.text);
    for (const seg of mem.segments ?? []) {
        const limit = seg.pass !== seg.target
            ? `≤${fmtTick(seg.target)}/${fmtTick(seg.pass)}`
            : `≤${fmtTick(seg.target)}`;
        if (seg.achievedAt !== undefined) {
            const grade = seg.failed ? '判废' : (seg.behind ? '合格' : '达成');
            push(`RCL${seg.level} ${limit} ${grade} ${fmtTick(seg.achievedAt)}`, seg.failed ? C.bad : seg.behind ? C.warn : C.good);
        } else if (seg.failed) {
            push(`RCL${seg.level} ${limit} 判废`, C.bad);
        } else {
            const etaText = seg.eta !== undefined ? fmtTick(seg.eta) : '?';
            push(`RCL${seg.level} ${limit} ETA ${etaText}${seg.behind ? ' 落后' : ''}`, seg.behind ? C.warn : C.info);
        }
    }
    push(`── 能量/孵化 ────────`, C.section);
    push(`孵化能量 ${bar(room.energyAvailable / Math.max(1, room.energyCapacityAvailable), 6)} ${room.energyAvailable}/${room.energyCapacityAvailable}`, C.text);
    push(`升级火力 ${uWork}W  搬运工 ${ocTotal}`, C.text);
    // 孵化状态直读 spawn 结构体（room.spunning 等临时属性不可靠）
    const spawnStructures = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
    const spawningInfo = spawnStructures.map(s => s.spawning).find(Boolean) || null;
    push(spawningInfo
        ? `孵化中 ${spawningInfo.name} 剩${spawningInfo.remainingTime}t`
        : `孵化空闲`,
        spawningInfo ? C.info : C.warn);

    const visual = room.visual;
    const rowH = 0.78;
    const top = 49.7 - rows.length * rowH;
    rows.forEach((row, i) => {
        visual.text(row.text, 0.5, top + i * rowH, { color: row.color, font: '0.68 Consolas', align: 'left' });
    });
}
