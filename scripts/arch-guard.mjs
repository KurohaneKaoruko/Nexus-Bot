#!/usr/bin/env node
/**
 * 架构守护脚本 (nexus-architecture-refactor Phase 0 / 任务 1.2):
 * 扫描 src/ 中动作类原生调用 (改变游戏状态的 API), 与豁免清单比对。
 *
 * 规则 (豁免清单收敛制):
 *   - 有调用无清单条目 → 红 (新增直连必须先登记或走命令管线)
 *   - 有清单条目无调用 → 红 (调用已收编/删除, 条目必须同步移除)
 *   - 清单本身可声明 "plannedRemoval: true" 的条目在截止期后仍存在 → 红
 *
 * 用法:
 *   node scripts/arch-guard.mjs                 # 守护检查 (CI/预提交口径)
 *   node scripts/arch-guard.mjs --update        # 用实测调用刷新清单的 calls 计数 (不增删条目)
 *   node scripts/arch-guard.mjs --report        # 按域汇总输出 (进度度量)
 *   node scripts/arch-guard.mjs --help
 *
 * 退出码: 0 绿 / 1 红 (可直接接入 CI 与 pre-push)。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const ALLOWLIST_PATH = path.join(ROOT, 'config', 'arch-allowlist.json');
/** 单调收缩检查点 (任务 9.3): 历史最小条目数, 回涨需显式 --allow-growth */
const MONOTONIC_PATH = path.join(ROOT, 'config', 'arch-allowlist.min.json');

// ── 动作类原生调用清单 ──────────────────────────────────────
// 只收"改变游戏状态"的动作方法; 感知/查询类 (find/getObjectById/store 等) 不在此列。
// 匹配的是"方法调用形态" (xxx.spawnCreep(...)), 定义处/类型引用不计。
const MUTATION_METHODS = [
	// Creep / PowerCreep
	'attack', 'attackController', 'build', 'claimController', 'drop',
	'generateSafeMode', 'harvest', 'heal', 'move', 'moveTo', 'pickup',
	'pull', 'rangedAttack', 'rangedHeal', 'repair', 'reserveController',
	'signController', 'suicide', 'transfer', 'upgradeController', 'withdraw',
	'usePower', 'enableRoom', 'renew', 'cancelOrder',
	// StructureSpawn
	'spawnCreep',
	// Room
	'createConstructionSite', 'createFlag', 'removeFlag', 'setPublicAvailable',
	// StructureTerminal / Market
	'send', 'deal',
	// Market 订单 (8.4 收编后 scanner 可见性补齐: 这些调用现在只该出现在
	// actionBroker 执行层本体与 console 人操, 散落即未收编)
	'createOrder', 'changeOrderPrice', 'extendOrder',
	// StructureLab / StructureFactory / StructurePowerSpawn (8.4 收编可见性)
	'runReaction', 'produce', 'processPower',
	// Structure / ConstructionSite
	'activateSafeMode', 'destroy', 'remove', 'setDisplayOverrides',
	// Nuker
	'launchNuke',
];

// 类型定义/接口声明中的方法名 (非调用) 与之混淆度低, 但 move/heal/remove 等常见词
// 需要更保守: 仅当形如 `.method(` 且不是 `function method(` / `method: (` / `method (` 定义。
const DEFINITION_RES = [
	/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+$/,
	/:\s*\(/,            // 对象字面量方法 / 箭头属性
	/^\s*\w+\s*\(\s*$/,  // 独立函数声明行 (跨行参数)
];

const HELPERS_RES = [
	/^\s*(?:export\s+)?(?:function|const|let|var)\s+[\w$]*move[\w$]*\s*[=(]/i,
];

/** 非游戏突变的方法名同名误报: 面板/HTML 字符串里的 DOM 调用 (tip.remove 等) */
const DOM_ONLY_FILES = new Set([
	'src/utils/roomResource.ts', // 生成浏览器面板的内嵌 <script>, 其 .remove() 是 DOM 操作
]);

/**
 * 模块级命名空间转发调用误报: `TeamAction.move(team, d)` 这类对象方法转发,
 * 接收者是模块命名空间而非游戏对象, 且转发目标已收编命令管线。
 */
const NAMESPACE_FORWARD_EXACT = [
	/TeamAction\.move\s*\(/,
];

/** 同上, 但仅限特定文件内生效的转发形态 (如 teamActionMove.ts 内部 this.move(team, ...));
 *  TeamAction 拆分 (legacy-consolidation-b 3.3) 后 this 转发随 move 域落位新文件 */
const NAMESPACE_FORWARD_BY_FILE = new Map([
	['src/modules/teams/core/teamActionMove.ts', [/this\.move\s*\(/, /this\.QuadMoveTo\s*\(/]],
]);

function scanFile(filePath) {
	const rel = path.relative(ROOT, filePath).split(path.sep).join('/');
	const text = fs.readFileSync(filePath, 'utf8');
	const lines = text.split('\n');
	const hits = [];
	if (DOM_ONLY_FILES.has(rel)) return hits; // DOM 误报文件整体跳过 (见 DOM_ONLY_FILES 注释)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
		if (NAMESPACE_FORWARD_EXACT.some((re) => re.test(stripped))) continue;
		const fileForwards = NAMESPACE_FORWARD_BY_FILE.get(rel);
		if (fileForwards?.some((re) => re.test(stripped))) continue;
		for (const method of MUTATION_METHODS) {
			// 匹配 `.method(` 形态; 链式调用一行可能命中多个同类, 计一次即可
			const re = new RegExp(`\\.${method}\\s*\\(`, 'g');
			let m;
			while ((m = re.exec(stripped)) !== null) {
				// 排除类型/定义形态: `method(` 前是 `function ` 或属性行首定义
				const before = stripped.slice(0, m.index);
				if (/(?:function\s+[\w$]*)$/.test(before)) continue;
				if (/:\s*$/.test(before.trimEnd())) continue;
				hits.push({ file: rel, line: i + 1, method });
				break; // 同行同类只计一次
			}
		}
	}
	return hits;
}

function scanDir(dir) {
	const hits = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			hits.push(...scanDir(full));
		} else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
			if (entry.name.endsWith('.d.ts')) continue;
			hits.push(...scanFile(full));
		}
	}
	return hits;
}

/** 实测调用 → 按文件聚合 { "src/...": { "transfer": 3 } } */
function aggregate(hits) {
	const byFile = new Map();
	for (const h of hits) {
		if (!byFile.has(h.file)) byFile.set(h.file, {});
		const methods = byFile.get(h.file);
		methods[h.method] = (methods[h.method] ?? 0) + 1;
	}
	return Object.fromEntries([...byFile.entries()].sort().map(([f, m]) => [f, m]));
}

function keyFor(file, method) { return `${file}::${method}`; }

function loadAllowlist() {
	if (!fs.existsSync(ALLOWLIST_PATH)) {
		console.error(`✗ 未找到豁免清单 ${path.relative(ROOT, ALLOWLIST_PATH)}`);
		process.exit(1);
	}
	return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function saveAllowlist(list) {
	fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, '\t') + '\n');
}

function verify(list, actual) {
	const errors = [];
	const actualKeys = new Set();
	for (const [file, methods] of Object.entries(actual)) {
		for (const [method, count] of Object.entries(methods)) {
			actualKeys.add(keyFor(file, method));
			const entry = list.entries[keyFor(file, method)];
			if (!entry) {
				errors.push(`有调用无条目: ${file} 使用 .${method}() ×${count} —— 需登记豁免或改走命令管线`);
			}
		}
	}
	for (const [key, entry] of Object.entries(list.entries ?? {})) {
		if (!actualKeys.has(key)) {
			errors.push(`有条目无调用: ${key} —— 调用已收编/删除, 请移除该条目 (清单单调收缩)`);
		}
		if (entry?.plannedRemoval?.due && Date.now() > Date.parse(entry.plannedRemoval.due)) {
			errors.push(`条目超期: ${key} 计划收编于 ${entry.plannedRemoval.due} (轨道 ${entry.plannedRemoval.track ?? '?'})`);
		}
	}
	return errors;
}

function cmdReport(list, actual) {
	const byTrack = {};
	const byDomain = {};
	let total = 0, remaining = 0;
	for (const [key, entry] of Object.entries(list.entries ?? {})) {
		total++;
		if (actual !== null && !actualHas(actual, key)) continue; // 已收编
		remaining++;
		const track = entry?.track ?? '(未标注)';
		byTrack[track] = (byTrack[track] ?? 0) + 1;
		const domain = domainOf(key);
		byDomain[domain] = (byDomain[domain] ?? 0) + 1;
	}
	console.log(`豁免清单: 共 ${total} 条, 在-call ${remaining} 条 (已收编 ${total - remaining})`);
	console.log(`\n按豁免口径:`);
	for (const [track, n] of Object.entries(byTrack).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${track}: ${n}`);
	}
	// 任务 9.3 按域收敛度量: 人操豁免 (console) 是合法终态, 其余趋零
	console.log(`\n按域收敛 (在-call):`);
	const consoleCount = byDomain['console'] ?? 0;
	for (const [domain, n] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${domain}: ${n}`);
	}
	const nonConsole = remaining - consoleCount;
	const base = total - (total - remaining); // 收敛百分比以非人操条目为分母
	console.log(
		`\n非人操在-call ${nonConsole} 条 / 全量 ${remaining} 条` +
			`(console 人操豁免 ${consoleCount} 条为合法终态; 非人操条目趋零为完成度量)`,
	);
	void base;
}

/** 条目键 → 域 (src/modules/x/y → x/y; src/console/** → console; 其余取首段) */
function domainOf(key) {
	const file = key.split('::')[0];
	const parts = file.split('/');
	if (parts[0] !== 'src') return file;
	if (parts[1] === 'console') return 'console';
	if (parts[1] === 'modules' && parts.length > 3) return `${parts[1]}/${parts[2]}`;
	return parts.slice(0, 2).join('/');
}

function actualHas(actual, key) {
	const [file, method] = key.split('::');
	return Boolean(actual?.[file]?.[method]);
}

// ── CLI ────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
	console.log('用法: node scripts/arch-guard.mjs [--update|--report]');
	process.exit(0);
}

const list = loadAllowlist();
const hits = scanDir(SRC_DIR);
const actual = aggregate(hits);

if (args.includes('--update')) {
	// 刷新计数, 不增删条目 (新增条目必须显式编辑登记, 体现"谁引入谁登记")
	let changed = 0;
	for (const [file, methods] of Object.entries(actual)) {
		for (const [method, count] of Object.entries(methods)) {
			const key = keyFor(file, method);
			if (list.entries[key] && list.entries[key].calls !== count) {
				list.entries[key].calls = count;
				changed++;
			}
		}
	}
	saveAllowlist(list);
	console.log(`已刷新 ${changed} 条计数 → ${path.relative(ROOT, ALLOWLIST_PATH)}`);
}

if (args.includes('--report')) {
	cmdReport(list, actual);
	process.exit(0);
}

const errors = verify(list, actual);
if (errors.length) {
	console.error(`✗ 架构守护红 (${errors.length} 项):`);
	for (const e of errors) console.error(`  · ${e}`);
	process.exit(1);
}
const nFiles = Object.keys(actual).length;
const nCalls = hits.length;

// 单调收缩断言 (任务 9.3, specs/legacy-removal-gate): 豁免清单只减不增。
// checkpoint 记历史最小值; 回涨即红, 除非显式 --allow-growth (须在 PR 说明理由)。
const entryCount = Object.keys(list.entries).length;
const allowGrowth = args.includes('--allow-growth');
let min = null;
if (fs.existsSync(MONOTONIC_PATH)) {
	try {
		min = JSON.parse(fs.readFileSync(MONOTONIC_PATH, 'utf8'));
	} catch {
		min = null;
	}
}
if (min && typeof min.entries === 'number' && entryCount > min.entries && !allowGrowth) {
	console.error(
		`✗ 架构守护红: 豁免清单回涨 (${min.entries} → ${entryCount} 条)。` +
			`只减不增 (specs/legacy-removal-gate); 确属新增须 --allow-growth 并记录决策。`,
	);
	process.exit(1);
}
// checkpoint 推进: 收缩时记新低; --allow-growth 显式接受新高 (须在 PR 说明理由)
if (!min || entryCount < min.entries || (allowGrowth && entryCount > (min.entries ?? 0))) {
	fs.writeFileSync(
		MONOTONIC_PATH,
		JSON.stringify({ entries: entryCount, date: new Date().toISOString().slice(0, 10) }, null, '\t') + '\n',
	);
}
console.log(
	`✓ 架构守护绿: ${nCalls} 处直连调用 / ${nFiles} 文件, 全部在豁免清单内` +
		`(清单 ${entryCount} 条, 历史最小 ${Math.min(entryCount, min?.entries ?? entryCount)})`,
);
