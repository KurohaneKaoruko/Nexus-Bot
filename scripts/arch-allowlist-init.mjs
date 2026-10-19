#!/usr/bin/env node
/**
 * 豁免清单引导脚本 (一次性 / 清单结构变更时用):
 * 以当前实测扫描生成 config/arch-allowlist.json 的 entries 骨架,
 * 收编轨道 (track) 与期限 (due) 人工补注 —— 守护脚本只认清单文件本身。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'config', 'arch-allowlist.json');

// 域 → 收编轨道映射 (design.md 的 Phase 编排; 未能归域的标 TBD)
const TRACK_RULES = [
	{ prefix: 'src/proto/', track: 'P6 legacy-removal (prototype 角色库收编)', due: null },
	{ prefix: 'src/modules/teams/', track: 'P5 combat-adapter (Teams → adapter)', due: null },
	{ prefix: 'src/modules/economy/units/', track: 'P7 industry-adapter (economy/units adapter 化)', due: null },
	{ prefix: 'src/modules/industry/', track: 'P7 industry-adapter', due: null },
	{ prefix: 'src/modules/planner/', track: 'P3 construction-intents (planner → intent)', due: null },
	{ prefix: 'src/modules/spawning/', track: 'P8 spawn-arbiter', due: null },
	{ prefix: 'src/console/', track: '人操豁免 (console 永久豁免, 登记不收编)', due: null },
	{ prefix: 'src/modules/visuals/', track: 'P3 可观测层去突变', due: null },
	{ prefix: 'src/modules/agents/', track: 'P2 command-boundary (agentSystem 直连收编)', due: null },
	{ prefix: 'src/modules/external/', track: 'P7 industry-adapter (外矿/道路)', due: null },
	{ prefix: 'src/modules/movement/', track: 'P4 movement-adapter (移动执行层, 永久豁免主体)', due: null },
	{ prefix: 'src/modules/defense/', track: 'P5 combat-adapter (防务需求化)', due: null },
	{ prefix: 'src/modules/cluster/', track: 'P5 combat-adapter', due: null },
];

function trackFor(file) {
	for (const r of TRACK_RULES) {
		if (file.startsWith(r.prefix)) return { track: r.track, due: r.due };
	}
	return { track: 'TBD (未归域, 需人工标注)', due: null };
}

// 复用守护脚本的扫描逻辑: 直接 import 其内部不可行 (无导出), 此处内联同款实现
const MUTATION_METHODS = [
	'attack', 'attackController', 'build', 'claimController', 'drop',
	'generateSafeMode', 'harvest', 'heal', 'move', 'moveTo', 'pickup',
	'pull', 'rangedAttack', 'rangedHeal', 'repair', 'reserveController',
	'signController', 'suicide', 'transfer', 'upgradeController', 'withdraw',
	'usePower', 'enableRoom', 'renew', 'cancelOrder',
	'spawnCreep', 'createConstructionSite', 'createFlag', 'removeFlag',
	'setPublicAvailable', 'send', 'deal', 'activateSafeMode', 'destroy',
	'remove', 'setDisplayOverrides', 'launchNuke',
];

function scanFile(filePath) {
	const rel = path.relative(ROOT, filePath).split(path.sep).join('/');
	const lines = fs.readFileSync(filePath, 'utf8').split('\n');
	const hits = [];
	for (let i = 0; i < lines.length; i++) {
		const stripped = lines[i].replace(/\/\/.*$/, '');
		for (const method of MUTATION_METHODS) {
			const re = new RegExp(`\\.${method}\\s*\\(`, 'g');
			let m;
			while ((m = re.exec(stripped)) !== null) {
				const before = stripped.slice(0, m.index);
				if (/(?:function\s+[\w$]*)$/.test(before)) continue;
				if (/:\s*$/.test(before.trimEnd())) continue;
				hits.push({ file: rel, method });
				break;
			}
		}
	}
	return hits;
}

function scanDir(dir) {
	const hits = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) hits.push(...scanDir(full));
		else if ((e.name.endsWith('.ts') || e.name.endsWith('.js')) && !e.name.endsWith('.d.ts')) hits.push(...scanFile(full));
	}
	return hits;
}

const hits = scanDir(path.join(ROOT, 'src'));
const entries = {};
for (const h of hits) {
	const key = `${h.file}::${h.method}`;
	if (!entries[key]) {
		const { track, due } = trackFor(h.file);
		entries[key] = { track, ...(due ? { plannedRemoval: { track, due } } : {}), calls: 0 };
	}
	entries[key].calls++;
}

const out = {
	$schema: './arch-allowlist.schema.json',
	version: 1,
	entries,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, '\t') + '\n');
console.log(`生成 ${Object.keys(entries).length} 条 → ${path.relative(ROOT, OUT)}`);
