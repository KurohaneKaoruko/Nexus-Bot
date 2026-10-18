#!/usr/bin/env node
/**
 * 全场景门回归线一键化 (任务 9.4 / 6.7 共用)。
 *
 * 串行跑 sim 全场景, 与参考快照 (sim-matrix-reference.json) 对照, 输出逐门红绿:
 * - 行为红线: 参考为 ✓ 的场景转 ✗, 或其 RCL 时间线漂移 (确定性引擎, 绿门必须 bit 一致)
 * - 性能红线: cpu p95 较参考劣化 > 2ms
 * - 冲级分段门 (参考即 ✗ 的场景): 时间线漂移仅告警不阻断 (趋势观察项)
 *
 * 用法:
 *   node scripts/sim-matrix.mjs                 # 跑全场景 + 对照
 *   node scripts/sim-matrix.mjs --update        # 跑完后把本次读数写回参考快照
 *   node scripts/sim-matrix.mjs --build         # 先重建 bundle 再跑
 *   node scripts/sim-matrix.mjs --only=race     # 只跑指定场景 (逗号分隔)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REF_PATH = join(ROOT, 'openspec/changes/nexus-architecture-refactor/baseline/sim-matrix-reference.json');

const args = process.argv.slice(2);
const doUpdate = args.includes('--update');
const doBuild = args.includes('--build');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').filter(Boolean) : null;

const ref = JSON.parse(readFileSync(REF_PATH, 'utf8'));
const scenarios = only ? Object.keys(ref).filter((k) => only.includes(k)) : Object.keys(ref);

if (doBuild) {
	console.log('▶ 重建 bundle (SOURCE_MAP=0 NO_UPLOAD=1)...');
	execFileSync('npx', ['rolldown', '-c'], {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, SOURCE_MAP: '0', NO_UPLOAD: '1' },
	});
}

const LINE_RE = /^([✓✗])\s+(\S+)\s+(\d+)\s+ticks\s+·\s+([\d.]+)s\s+·\s+(\d+)\s+t\/s\s+·\s+RCL\s+(.*?)\s*·\s+cpu p95\s+([\d.]+)ms/;

const parseRcl = (s) => {
	const levels = {};
	for (const m of s.matchAll(/L(\d)@(\d+)/g)) levels[`L${m[1]}`] = Number(m[2]);
	return levels;
};

const sameTimeline = (a, b) => {
	const ka = Object.keys(a), kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => a[k] === b[k]);
};

const fmtTimeline = (t) => Object.keys(t).sort().map((k) => `${k}@${t[k]}`).join(' ');

const results = [];
let red = false;

for (const name of scenarios) {
	const r = ref[name];
	if (!r) continue;
	console.log(`▶ ${name} (参考: ${r.green ? '✓' : '✗'} ${fmtTimeline(r.rcl)} p95 ${r.cpuP95}ms)`);
	let raw;
	try {
		raw = execFileSync(
			'npx',
			['screeps-sim', 'test', `sim/${name}.sim.ts`, '--no-bundle-check'],
			{ cwd: ROOT, encoding: 'utf8', timeout: 20 * 60_000 },
		);
	} catch (e) {
		raw = typeof e.stdout === 'string' ? e.stdout : '';
		if (!raw) {
			console.log(`  ✗ 运行失败: ${e.message.split('\n')[0]}`);
			results.push({ name, verdict: 'RED', note: '运行失败' });
			red = true;
			continue;
		}
	}
	const line = raw.split('\n').find((l) => LINE_RE.test(l.trim()));
	if (!line) {
		console.log('  ✗ 无法解析结果行');
		results.push({ name, verdict: 'RED', note: '结果行缺失' });
		red = true;
		continue;
	}
	const m = line.trim().match(LINE_RE);
	const [, mark, , ticks, secs, tps, rclStr, p95] = m;
	const green = mark === '✓';
	const now = { green, ticks: Number(ticks), secs: Number(secs), tps: Number(tps), rcl: parseRcl(rclStr), cpuP95: Number(p95) };

	// 判定
	const notes = [];
	let verdict = 'GREEN';
	if (r.green && !now.green) {
		verdict = 'RED';
		notes.push(`绿门转红 (${fmtTimeline(r.rcl)} → ${fmtTimeline(now.rcl)})`);
	}
	if (r.green && now.green && !sameTimeline(r.rcl, now.rcl)) {
		verdict = 'RED';
		notes.push(`绿门时间线漂移 (${fmtTimeline(r.rcl)} → ${fmtTimeline(now.rcl)})`);
	}
	if (!r.green && !sameTimeline(r.rcl, now.rcl)) {
		verdict = verdict === 'RED' ? verdict : 'WARN';
		notes.push(`分段门场景时间线漂移 (${fmtTimeline(r.rcl)} → ${fmtTimeline(now.rcl)}) — 趋势观察项`);
	}
	if (now.cpuP95 > r.cpuP95 + 2) {
		verdict = 'RED';
		notes.push(`cpu p95 劣化 ${now.cpuP95}ms (参考 ${r.cpuP95}ms, +${(now.cpuP95 - r.cpuP95).toFixed(1)}ms)`);
	}
	results.push({ name, verdict, note: notes.join('; '), now });
	console.log(`  ${mark} ${name}  ${now.ticks} ticks · ${now.secs}s · ${now.tps} t/s · RCL ${rclStr} · cpu p95 ${p95}ms`);
	if (notes.length) console.log(`  → ${verdict}: ${notes.join('; ')}`);
	if (verdict === 'RED') red = true;
}

console.log('\n════════ 汇总 ════════');
for (const r of results) {
	console.log(`  ${r.verdict.padEnd(5)} ${r.name}${r.note ? `  (${r.note})` : ''}`);
}
console.log(red ? '\n✗ 存在行为/性能红线' : '\n✓ 全场景门通过');

if (doUpdate) {
	const next = {};
	for (const r of results) {
		if (!r.now) continue;
		next[r.name] = { green: r.now.green, ticks: r.now.ticks, rcl: r.now.rcl, cpuP95: r.now.cpuP95 };
	}
	for (const k of Object.keys(ref)) if (!next[k]) next[k] = ref[k];
	writeFileSync(REF_PATH, JSON.stringify(next, null, '\t') + '\n');
	console.log(`📝 参考快照已更新: ${REF_PATH}`);
}

process.exit(red ? 1 : 0);
