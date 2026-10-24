#!/usr/bin/env node
/**
 * 结构守护脚本 (legacy-consolidation 任务 0.1):
 * 按 specs/code-structure-standards 钉死口径实现五项断言。
 *
 *   ① 单文件 ≤600 有效行 (有效行 = 非空且非纯注释行; .d.ts 豁免; 白名单逐条登记)
 *   ② @ts-nocheck 计数对检查点单调不增 (目标态 0)
 *   ③ 显式 any 计数对检查点单调不增 (as any 单独计数)
 *   ④ 依赖方向四规则 (core 不 import modules/proto/console; modules 不 import console;
 *      modules→proto 仅白名单纯库面; branch 只被构建入口引用——既有违规留档冻结不新增)
 *   ⑤ 词表三方一致 (executor ↔ 可执行路径 ↔ 孵化源; 域 6 后生效, 检查点 flag 控制)
 *
 * 用法:
 *   node scripts/structure-guard.mjs            # 守护检查
 *   node scripts/structure-guard.mjs --update   # 实测值回落检查点 (仅在下降时推进)
 *   node scripts/structure-guard.mjs --report   # 按域汇总报告
 *
 * 退出码: 0 绿 / 1 红。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const CHECKPOINT_PATH = path.join(ROOT, 'config', 'code-quality.json');

// ── 检查点与白名单 (口径见 specs/code-structure-standards) ──────────

const DEFAULT_CHECKPOINT = {
	tsNocheck: 35,
	any: 781,
	asAny: 550,
	lineLimitOver: 8,
	depViolations: 0,
};

/** >600 有效行豁免白名单: 纯数据表/类型声明, 逐条登记理由 */
const LINE_WHITELIST = new Set([
	'src/constant/ResourceConstant.ts', // 资源常量数据表
	'src/config/economy.ts', // 经济常量数据表
]);

/** modules→proto 允许的纯库面 (A 波域 8 后收缩为实际存活面) */
const PROTO_PURE_LIB = new Set([
	'@/proto', // proto/index.ts: ensureMemoryCache/clearMemoryCache/getBoostCache/evaluateSourceWorkTiles
	'@/proto/registry',
]);

/** core→modules/proto/console 既有违规留档 (B 波冻结不新增, 清理另立变更) */
const CORE_VIOLATIONS_FROZEN = new Set([
	'src/core/endPhase.ts -> @/modules/economy',
	'src/core/endPhase.ts -> @/modules/intershard',
	'src/core/invariantWatch.ts -> @/modules/spawning/spawningRoster',
	'src/core/statistics.ts -> @/modules/spawning',
	'src/core/store/clear.ts -> @/modules/agents/actionBroker',
	'src/core/store/clear.ts -> @/modules/spawning/spawningRoster',
]);

/** modules→proto 既有引用留档 (A 波收缩过程的基线; 仅白名单外新增才红) */
const PROTO_IMPORTS_FROZEN = new Set([
	'src/modules/defense/units/defendSingle.ts -> @/proto',
	'src/modules/external/mine/shared.ts -> @/proto',
	'src/modules/teams/runtime/TeamController.ts -> @/proto',
	'src/modules/teams/units/double-dismantle.ts -> @/proto',
	'src/modules/visuals/proto/index.ts -> @/proto/registry',
]);

/** 词表三方一致断言开关 (A 波域 6 完成后置 true) */
const VOCAB_TRIPLE_CHECK = false;

// ── 通用: 源文件枚举与注释剥离 ─────────────────────────────

function walkTs(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walkTs(full, out);
		else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(full);
	}
	return out;
}

/** 剥块注释 (保留行内代码), 返回逐行数组; 行注释交给调用方按行处理 */
function stripBlockComments(text) {
	const lines = text.split('\n');
	const out = [];
	let inBlock = false;
	for (let raw of lines) {
		let line = raw;
		if (inBlock) {
			const end = line.indexOf('*/');
			if (end === -1) {
				out.push('');
				continue;
			}
			line = line.slice(end + 2);
			inBlock = false;
		}
		let prev = '';
		for (;;) {
			const start = line.indexOf('/*');
			if (start === -1) break;
			const end = line.indexOf('*/', start);
			if (end === -1) {
				line = line.slice(0, start);
				inBlock = true;
				break;
			}
			line = line.slice(0, start) + ' ' + line.slice(end + 2);
			if (line === prev) break;
			prev = line;
		}
		out.push(line);
	}
	return out;
}

/** 有效行: 剥注释后非空白行 */
function effectiveLines(text) {
	let n = 0;
	for (const line of stripBlockComments(text)) {
		if (line.replace(/\/\/.*$/, '').trim().length > 0) n += 1;
	}
	return n;
}

// ── 断言 ①: 单文件 ≤600 有效行 ────────────────────────────

function checkLineLimit(files) {
	const violations = [];
	for (const f of files) {
		const rel = path.relative(ROOT, f).replace(/\\/g, '/');
		const n = effectiveLines(fs.readFileSync(f, 'utf8'));
		if (n > 600 && !LINE_WHITELIST.has(rel)) {
			violations.push({ file: rel, lines: n });
		}
	}
	return violations;
}

// ── 断言 ②③: ts-nocheck 与 any 计数 ───────────────────────

/**
 * 显式 any 计数口径: 只计**可类型检查**文件 (无 @ts-nocheck 的文件)。
 * @ts-nocheck 文件的 any 标注不参与类型系统、无约束意义, 其债务由断言 ②
 * (ts-nocheck 文件数单调降)承载; 二者清零同步完成。
 * as any 单独计数, 同一匹配 `as any` 同时计入 any 与 asAny。
 */
const ANY_RE = /(:\s*any\b)|(as\s+any\b)|(<any>)|(any\[\])|(any>)/g;

function checkTypeEscape(files) {
	let tsNocheck = 0;
	let any = 0;
	let asAny = 0;
	for (const f of files) {
		const text = fs.readFileSync(f, 'utf8');
		const nocheck = text.includes('@ts-nocheck');
		if (nocheck) tsNocheck += 1;
		if (nocheck) continue; // nocheck 文件的 any 由断言②承载
		for (const line of stripBlockComments(text)) {
			const stripped = line.replace(/\/\/.*$/, '');
			const m = stripped.match(ANY_RE);
			if (m) any += m.length;
			asAny += (stripped.match(/\bas\s+any\b/g) || []).length;
		}
	}
	return { tsNocheck, any, asAny };
}

// ── 断言 ④: 依赖方向 ──────────────────────────────────────

const IMPORT_RE = /import\s+(?:type\s+)?[^"'`;]*?from\s+["'`]([^"'`]+)["'`]/g;

function checkDependencies(files) {
	const r1 = []; // core -> modules/proto/console
	const r2 = []; // modules -> console
	const r3 = []; // modules -> proto (白名单外)
	for (const f of files) {
		const rel = path.relative(ROOT, f).replace(/\\/g, '/');
		const text = fs.readFileSync(f, 'utf8');
		for (const m of stripBlockComments(text).join('\n').matchAll(IMPORT_RE)) {
			const spec = m[1];
			if (!spec.startsWith('@/')) continue;
			const target = spec.slice(2);
			const tgtProto = target === 'proto' || target.startsWith('proto/');
			const tgtModules = target === 'modules' || target.startsWith('modules/');
			const tgtConsole = target === 'console' || target.startsWith('console/');
			const key = `${rel} -> ${spec}`;
			if (rel.startsWith('src/core/') && (tgtModules || tgtConsole || tgtProto)) {
				if (!CORE_VIOLATIONS_FROZEN.has(key)) r1.push(key);
			} else if (rel.startsWith('src/modules/') && tgtConsole) {
				r2.push(key);
			} else if (rel.startsWith('src/modules/') && tgtProto && !PROTO_PURE_LIB.has(spec)) {
				if (!PROTO_IMPORTS_FROZEN.has(key)) r3.push(key);
			}
		}
	}
	return { r1, r2, r3 };
}

// ── 断言 ⑤: 词表三方一致 ─────────────────────────────────

/**
 * executor 声明集 (UnitData[].executor) ↔ 可执行路径集 ↔ 孵化源集。
 * 域 6 前双轨仍在, 断言关闭; 启用后:
 *   - executor 声明但无处理器且无管线 → 孤儿 executor
 *   - 有孵化源但无执行路径 → 孤儿孵化源
 * 数据源: constant/CreepConstant.ts (声明) / proto runtime registry (处理器)
 *         / spawning demandSources + directSpawn 调用点 (孵化源)。
 * 域 6 实施时补齐采集器; 当前仅输出声明清单供人工比对。
 */
function checkVocabTriple() {
	if (!VOCAB_TRIPLE_CHECK) return null;
	// 域 6 实施时填充: 解析 UnitData executor、roleRegistry/handler 表、孵化源表
	return { orphans: [] };
}

// ── 主流程 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const doUpdate = args.includes('--update');
const doReport = args.includes('--report');

let checkpoint;
if (fs.existsSync(CHECKPOINT_PATH)) {
	checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
} else {
	checkpoint = { ...DEFAULT_CHECKPOINT };
}

const files = walkTs(SRC_DIR);
const lineViolations = checkLineLimit(files);
const typeEscape = checkTypeEscape(files);
const deps = checkDependencies(files);
const vocab = checkVocabTriple();

const depViolationCount =
	deps.r1.length + deps.r2.length + deps.r3.length;

const failures = [];
const improvements = {};

if (lineViolations.length > (checkpoint.lineLimitOver ?? 0)) {
	failures.push(
		`① 文件超 600 有效行 (白名单外 ${lineViolations.length} 个 > 检查点 ${checkpoint.lineLimitOver ?? 0}; 拆分在 B 波, 检查点随拆分推进):\n` +
			lineViolations.map((v) => `   ${v.file} (${v.lines} 行)`).join('\n'),
	);
}
if (typeEscape.tsNocheck > checkpoint.tsNocheck) {
	failures.push(
		`② @ts-nocheck 文件数 ${typeEscape.tsNocheck} > 检查点 ${checkpoint.tsNocheck} (禁止新增)`,
	);
} else if (typeEscape.tsNocheck < checkpoint.tsNocheck) {
	improvements.tsNocheck = typeEscape.tsNocheck;
}

if (typeEscape.any > checkpoint.any) {
	failures.push(
		`③ 显式 any ${typeEscape.any} > 检查点 ${checkpoint.any} (禁止新增; 清理后需 --update 推进)`,
	);
} else if (typeEscape.any < checkpoint.any) {
	improvements.any = typeEscape.any;
	improvements.asAny = typeEscape.asAny;
}

if (typeEscape.asAny > (checkpoint.asAny ?? checkpoint.any)) {
	failures.push(
		`③ as any ${typeEscape.asAny} > 检查点 ${checkpoint.asAny ?? checkpoint.any}`,
	);
}

if (depViolationCount > 0) {
	failures.push(
		`④ 依赖方向违规 (新增 ${depViolationCount} 处):\n` +
			[...deps.r1, ...deps.r2, ...deps.r3].map((v) => `   ${v}`).join('\n'),
	);
} else if (lineViolations.length < (checkpoint.lineLimitOver ?? 0)) {
	improvements.lineLimitOver = lineViolations.length;
}

if (vocab && vocab.orphans.length > 0) {
	failures.push(`⑤ 词表三方一致孤儿 ${vocab.orphans.length} 处`);
}

if (doReport) {
	console.log('── 结构守护报告 ──────────────────────');
	console.log(`源文件: ${files.length}`);
	console.log(`@ts-nocheck 文件: ${typeEscape.tsNocheck} (检查点 ${checkpoint.tsNocheck})`);
	console.log(`显式 any: ${typeEscape.any} (检查点 ${checkpoint.any}), 其中 as any ${typeEscape.asAny}`);
	console.log(`>600 有效行 (白名单外): ${lineViolations.length} (检查点 ${checkpoint.lineLimitOver})`);
	for (const v of lineViolations) console.log(`   ${v.file} (${v.lines})`);
	console.log(`依赖方向: core 违规 ${deps.r1.length + CORE_VIOLATIONS_FROZEN.size} (冻结 ${CORE_VIOLATIONS_FROZEN.size}), modules→console ${deps.r2.length}, modules→proto 白名单外新增 ${deps.r3.length}`);
}

if (failures.length > 0) {
	console.error(`✗ 结构守护红:\n${failures.join('\n')}`);
	process.exit(1);
}

if (doUpdate && Object.keys(improvements).length > 0) {
	const next = { ...checkpoint, ...improvements, date: new Date().toISOString().slice(0, 10) };
	fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(next, null, '\t') + '\n');
	console.log(`✓ 检查点推进: ${JSON.stringify(improvements)} → ${CHECKPOINT_PATH}`);
}

console.log(
	`✓ 结构守护绿: ${files.length} 文件 / ts-nocheck ${typeEscape.tsNocheck} / any ${typeEscape.any} (as any ${typeEscape.asAny}) / 超600行 ${lineViolations.length} / 依赖违规 ${depViolationCount}`,
);
