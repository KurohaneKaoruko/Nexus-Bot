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
	'src/modules/visuals/proto/index.ts -> @/proto/registry',
]);

/** 词表三方一致断言开关 (域 4.2/4.3 后启用: exec() 已退场, 角色驱动面收敛) */
const VOCAB_TRIPLE_CHECK = true;

/**
 * 角色驱动面登记表 (域 4.3 口径): 每个词表角色的可执行路径归因。
 * - task: 任务驱动 (agentSystem 认领租约)
 * - courier: rush-courier 无租约直驱
 * - team: TeamController 编队驱动 (team-* 前缀)
 * - powercreep: PowerCreep 链孵化/驱动
 * - dormant-spawn: 休眠孵化链 (external/mine spawner, 原型系 outMine 休眠中)
 * - manual: warSpawn 人操旗豁免链 (域 7 定性)
 * - algorithm: 算法资产待复用 (无孵化源, 仅词表登记)
 */
const UNIT_DRIVE_ATTRIBUTION = {
	task: ['harvester', 'carrier', 'transporter', 'manager', 'upgrader', 'worker', 'miner', 'universal', 'rush-courier', 'defender', 'scout', 'claimer', 'reserver'],
	courier: [],
	team: ['team-attack', 'team-dismantle', 'team-heal', 'team-ranged'],
	powercreep: ['pc-heal'],
	'dormant-spawn': ['out-build', 'out-defend', 'out-2attack', 'out-2heal', 'out-invader', 'out-attack', 'out-ranged', 'out-mineral', 'out-repair', 'deposit-harvest', 'deposit-transfer', 'deposit-attack', 'deposit-heal', 'deposit-ranged', 'power-attack', 'power-heal', 'power-carry', 'power-ranged'],
	manual: ['aio', 'cleaner', 'attack-claimer', 'dismantle', 'logistic'],
	algorithm: ['defend-2heal'],
};

/**
 * 六池退役符号扫描 (mission-pool-retirement spec: 池 API 与词表全仓清零,
 * spawn 池链豁免)。域 3.4 启用: 命中即红。
 * 豁免面: spawn 池基建 (MissionPools.ts/MissionSubmit.ts/spawnMission.ts/
 * MissionConstant.ts/accessor.ts 存储层 + docs/bugs 留档)。
 */
const RETIRED_POOL_SYMBOLS = [
	'MissionUpdate', 'UpdateTransportMission', 'UpdateManageMission',
	'UpdateBuildRepairMission', 'UpdateWallRepairMission', 'UpdateMineMission',
	'UpdateHighwayScan', 'UpdateEnergyMission', 'UpdateLabMission',
	'UpdateLabBoostMission', 'UpdatePowerMission', 'UpdateNukerMission',
	'TransportMissionCheck', 'BuildRepairMissionCheck',
	'getTransportMission', 'getBuildMission', 'getRepairMission', 'getWallMission',
	'getManageMission', 'getSendMission', 'getSendMissionTotalAmount',
	'TransportMissionAdd', 'addTransportMission', 'ManageMissionAdd',
	'BuildRepairMissionAdd', 'SendMissionAdd', 'SendMissionUpsertMax',
	'submitTransportMission', 'submitMineMission',
	'getMissionFromPool', 'getMissionFromPoolFirst', 'getMissionFromPoolRandom',
	'checkSameMissionInPool', 'checkMissionInPool', 'checkMissionPool',
	'lockMissionInPool', 'unlockMissionInPool', 'updateMissionPool',
	'initMissionPool',
	'TransportLevel', 'toPosNumber',
	'TransportTask', 'BuildTask', 'RepairTask', 'ManageTask', 'SendTask', 'BoostTask',
	'TransportMission', 'ManageMission', 'WorkMission', 'BoostMission', 'MineMission',
	'TransportTaskGetter', 'WorkTaskGetter', 'ManageTaskGetter',
];
const RETIRED_POOL_EXEMPT_FILES = new Set([
	'src/modules/spawning/mission/pool/MissionPools.ts', // spawn 池基建 (词表/存储面)
	'src/modules/spawning/mission/pool/MissionSubmit.ts', // spawn 提交面
	'src/modules/spawning/mission/updaters/spawnMission.ts', // spawn 池写入面
	'src/constant/MissionConstant.ts', // spawn 词表
	'src/core/store/accessor.ts', // spawn 池存储 accessor
]);

function checkRetiredPoolSymbols(files) {
	const hits = [];
	for (const file of files) {
		const rel = path.relative(ROOT, file);
		if (RETIRED_POOL_EXEMPT_FILES.has(rel)) continue;
		const text = stripBlockComments(fs.readFileSync(file, 'utf8'));
		for (const sym of RETIRED_POOL_SYMBOLS) {
			// 词边界匹配: 排除子串误报 (如 getXxxMission 不会匹配 xxxMission)
			const re = new RegExp(`\\b${sym}\\b`);
			if (re.test(text)) hits.push(`${rel} :: ${sym}`);
		}
	}
	return hits;
}

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
	// 词表三方一致 (域 4.3 口径): UnitData 键集 ↔ 驱动面登记表 双向差集为空
	const creepConst = files
		.filter((f) => f.endsWith('src/constant/CreepConstant.ts'))
		.map((f) => fs.readFileSync(f, 'utf8'))
		.join('');
	const unitMatch = creepConst.match(/export const UnitData = \{([\s\S]*?)\n\}(?: satisfies|;)/);
	if (!unitMatch) return { orphans: ['UnitData 解析失败'] };
	const unitKeys = new Set(
		[...unitMatch[1].matchAll(/\n\s+'?([a-zA-Z0-9-]+)'?: \{/g)].map((m) => m[1]).filter((k) => k !== 'boostmap'),
	);
	const attributed = new Set(Object.values(UNIT_DRIVE_ATTRIBUTION).flat());
	const orphans = [];
	for (const k of unitKeys) if (!attributed.has(k)) orphans.push(`词表孤儿 (无驱动面归因): ${k}`);
	for (const k of attributed) if (!unitKeys.has(k)) orphans.push(`登记面悬空 (词表已删): ${k}`);
	return { orphans };
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
const retiredPoolHits = checkRetiredPoolSymbols(files);

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

if (retiredPoolHits.length > 0) {
	failures.push(
		`⑥ 六池退役符号残留 ${retiredPoolHits.length} 处 (mission-pool-retirement; spawn 池链豁免):\n` +
			retiredPoolHits.map((v) => `   ${v}`).join('\n'),
	);
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
