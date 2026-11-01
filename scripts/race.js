// 私服冲级运维统一入口 (race 服务器专用工具, 复用 ./secret.js 账号生态)。
//
// 子命令:
//   land [服务器[@账号]] [--room W5N8] [--x 17] [--y 31]   落地放 spawn (world-status=empty 时)
//   status [服务器[@账号]] [房间]                            当前 run 快照 (相对轴/RCL/三档门)
//   board [bracket]                                          排行榜 (20000|40000, 缺省 40000)
//   watch [服务器[@账号]] [房间] [--room R] [--interval 120] [--runs 路径] [--timeout 秒]
//                                                           守榜: 重开自动落地 + 门追踪插值 +
//                                                           成绩落盘 (JSONL) + token 重登录
//
// 端点契约: place-spawn POST {room,shard,x,y,name} (官方客户端 build.min.js 逆向);
// 门计时用 Memory.boot.t 相对轴 (服务器绝对 tick 无意义)。
// 用法示例: node scripts/race.js watch 47.100.24.220@Nexus --room W5N8 --timeout 172800
import path from 'path';
import fs from 'fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'url';
import { loadSecret, getServers, getServerAccounts, resolveTarget, matchName } from './secret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GATES = [
	[4, 10000],
	[5, 20000],
	[6, 40000],
];

function usage(exitCode = 1) {
	console.log(
		[
			'用法: node scripts/race.js <子命令> [选项]',
			'  land   [服务器[@账号]] [--room W5N8] [--x 17] [--y 31]   落地放 spawn',
			'  status [服务器[@账号]] [房间]                            当前 run 快照',
			'  board  [20000|40000]                                    排行榜',
			'  board  records [用户名]                                  全部 run 正式成绩 (缺省 Nexus)',
			'  watch  [服务器[@账号]] [房间] [--interval 秒] [--timeout 秒] [--runs 路径]',
			'                                                          守榜 (重开自动落地+门追踪)',
			'缺省目标: 47.100.24.220@Nexus, 房间 W5N8 (spawn 17,31 引擎标准锚点)',
		].join('\n'),
	);
	process.exit(exitCode);
}

// ── 目标解析 ──────────────────────────────────────────────
function resolveCtx(posArgs) {
	const secret = loadSecret();
	if (!secret) {
		console.error('配置文件 .secret.json 未找到');
		process.exit(1);
	}
	const servers = getServers(secret);
	const input = posArgs.find((a) => !a.startsWith('-') && /@|\.|\d/.test(a)) ?? '47.100.24.220@Nexus';
	const [serverInput, accountInput] = input.includes('@') ? input.split('@') : [input, undefined];
	const serverName = matchName(Object.keys(servers), serverInput)[0];
	if (!serverName) {
		console.error(`[race] 服务器 ${serverInput} 无法匹配 (${Object.keys(servers).join(' / ')})`);
		process.exit(1);
	}
	const accounts = Object.keys(getServerAccounts(servers[serverName]));
	const accountName = accountInput ?? (accounts.includes('Nexus') ? 'Nexus' : accounts[0]);
	const target = resolveTarget(secret, serverName, accountName);
	if (!target) {
		console.error(`[race] 账号 ${accountName} 不存在 (可选 ${accounts.join(' / ')})`);
		process.exit(1);
	}
	const port = target.port && target.port !== 21025 ? `:${target.port}` : '';
	return {
		base: `${target.protocol || 'http'}://${target.hostname}${port}`,
		email: target.email,
		password: target.password,
		accountName,
	};
}

// ── HTTP 会话 (token 过期重登录) ─────────────────────────
function session(ctx) {
	let token = null;
	const signin = async () => {
		const r = await fetch(`${ctx.base}/api/auth/signin`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: ctx.email, password: ctx.password }),
		}).then((x) => x.json());
		if (r.ok !== 1) throw new Error(`登录失败: ${JSON.stringify(r).slice(0, 120)}`);
		token = r.token;
	};
	return {
		call: async (ep, data) => {
			if (!token) await signin();
			const res = await fetch(`${ctx.base}/${ep}`, {
				method: data ? 'POST' : 'GET',
				headers: { 'Content-Type': 'application/json', 'X-Token': token, 'X-Username': ctx.email },
				body: data ? JSON.stringify(data) : undefined,
			});
			if (res.status === 401) {
				await signin();
				return session(ctx).call(ep, data);
			}
			return res.json();
		},
	};
}

// gz: base64 gzip 的 Memory 值解包 (私服 Memory API 压缩格式)
function ungz(raw) {
	if (typeof raw !== 'string' || !raw.startsWith('gz:')) return raw;
	return zlib.gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString();
}

// ── land ─────────────────────────────────────────────────
async function cmdLand(posArgs, flags) {
	const ctx = resolveCtx(posArgs);
	const api = session(ctx);
	const status = await api.call('api/user/world-status');
	if (status.status !== 'empty') {
		console.log(`[land] world-status=${status.status}, 无需落地`);
		return;
	}
	let room = flags.room;
	if (!room) {
		const start = await api.call('api/user/world-start-room');
		room = start?.room?.[0];
	}
	if (!room) {
		console.error('[land] 未指定 --room 且 world-start-room 无返回');
		process.exit(1);
	}
	const x = Number(flags.x ?? 17);
	const y = Number(flags.y ?? 31);
	const place = await api.call('api/game/place-spawn', {
		room,
		shard: 'shard0',
		x,
		y,
		name: 'Spawn1',
	});
	console.log(`[land] place-spawn ${room} (${x},${y}) -> ${JSON.stringify(place).slice(0, 120)}`);
}

// ── status ───────────────────────────────────────────────
async function cmdStatus(posArgs) {
	const ctx = resolveCtx(posArgs);
	const api = session(ctx);
	const room = posArgs.find((a) => /^[WEN]\d+[NS]\d+$/.test(a)) ?? 'W5N8';
	const t = (await api.call('api/game/time')).time;
	let boot = {};
	try {
		boot = JSON.parse(ungz((await api.call('api/user/memory?path=')).data))?.boot ?? {};
	} catch {
		/* Memory 未初始化 (刚重开未落地) */
	}
	const rel = t - (boot.t ?? t);
	const ms = await api.call('api/game/map-stats', { rooms: [room], statName: 'owner0' });
	const own = ms.stats?.[room]?.own;
	if (!own) {
		console.log(`Game.time=${t}  ${room} 无主 (需 land)`);
		return;
	}
	console.log(`Game.time=${t}  run相对tick=${rel}  RCL=${own.level}`);
	for (const [lv, gate] of GATES) {
		console.log(`  L${lv} 门: ${own.level >= lv ? `已达 (RCL${own.level})` : `tick ${rel}/${gate} (${rel < gate ? 'on-track' : 'OVERDUE'})`}`);
	}
}

// ── board ────────────────────────────────────────────────
// board            → 当前榜 (bracket 缺省 40000)
// board records [用户名] → 该玩家全部 run 正式成绩 (按 score 降序)
async function cmdBoard(posArgs) {
	const sub = posArgs[0];
	if (sub === 'records') {
		const name = posArgs[1] ?? 'Nexus';
		const lb = await fetch('http://47.100.24.220:21025/api/speedrun/leaderboard?bracket=40000').then((r) => r.json());
		let uid = null;
		for (const row of lb.list ?? []) if (row.record?.username === name) uid = row.record.user;
		if (!uid) {
			console.error(`[board] 榜上无 ${name} (40k 无成绩的玩家查不到 userId)`);
			process.exit(1);
		}
		const d = await fetch(`http://47.100.24.220:21025/api/speedrun/records/${uid}`).then((r) => r.json());
		const rows = (d.list ?? []).map((r) => r.record ?? r).sort((a, b) => b.score - a.score);
		console.log(`${name} 全部 run (${rows.length} 条, 按 score 降序)`);
		for (const r of rows) {
			const ts = new Date(r.at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
			console.log(`  run${r.run} b${r.bracket} score=${r.score} L${r.level}+${r.progress} ${r.room} ${ts}`);
		}
		return;
	}
	const bracket = posArgs.find((a) => /^\d+$/.test(a)) ?? '40000';
	const d = await fetch(`http://47.100.24.220:21025/api/speedrun/leaderboard?bracket=${bracket}`).then((r) => r.json());
	console.log(`speedrun 榜 bracket=${bracket} (计分=已过级全额+当前级进度)`);
	for (const row of d.list ?? []) {
		const r = row.record ?? {};
		console.log(`  #${row.rank ?? '?'} ${r.username ?? '?'} score=${row.score} L${r.level}+${r.progress} run=${r.run}`);
	}
}

// ── watch ────────────────────────────────────────────────
// 数据源全走官方 speedrun 端点 (无自造计时):
//   api/speedrun/racing  — 进行中 run 的 elapsed/level/progress/score
//   api/speedrun/records/<user> — 每个 run 的正式成绩 (bracket 到期记录)
// 达级时刻从 racing 轮询区间取中点 (过程指标, 粗略即可);
// 最终成绩以 records 为准 (榜单口径, 精确)。
async function cmdWatch(posArgs, flags) {
	const ctx = resolveCtx(posArgs);
	const room = flags.room ?? posArgs.find((a) => /^[WEN]\d+[NS]\d+$/.test(a)) ?? 'W5N8';
	const interval = Number(flags.interval ?? 60);
	const timeoutSec = Number(flags.timeout ?? 14400);
	const runsPath = flags.runs ?? path.join(ROOT, 'race-runs.jsonl');
	const deadline = Date.now() + timeoutSec * 1000;
	const api = session(ctx);
	const log = (msg) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);

	// records 端点要 userId: 从榜上按 username 定位
	async function myUserId() {
		const d = await api.call('api/speedrun/leaderboard?bracket=40000');
		for (const row of d.list ?? []) {
			if (row.record?.username === ctx.accountName) return row.record.user;
		}
		// 未上榜 (无 40k 成绩) 时试 racing
		const r = await api.call('api/speedrun/racing');
		for (const row of r.list ?? []) {
			if (row.username === ctx.accountName) return row.user;
		}
		return null;
	}

	let userId = null;
	let seen = {}; // 本 run 达级观测 (区间中点)
	let prev = null; // 上一观测 [elapsed, level]
	let lastRun = null;

	while (Date.now() < deadline) {
		try {
			userId ??= await myUserId();
			const racing = await api.call('api/speedrun/racing');
			const mine = (racing.list ?? []).find((r) => r.room === room || r.user === userId);
			if (mine) {
				for (const [lv, gate] of GATES) {
					if (mine.level >= lv && !(lv in seen)) {
						const hit =
							prev && prev[1] === lv - 1 && mine.elapsed > prev[0]
								? Math.floor((prev[0] + mine.elapsed) / 2)
								: mine.elapsed;
						seen[lv] = hit;
						log(`  *** L${lv}@~${hit} (${hit <= gate ? '✓' : '✗超'}, 门 ${gate}) ***`);
					}
				}
				prev = [mine.elapsed, mine.level];
				const pend = GATES.map(([lv]) => `L${lv}@${lv in seen ? seen[lv] : `>${mine.elapsed}`}`).join(', ');
				log(`run${mine.run} elapsed=${mine.elapsed} L${mine.level}+${mine.progress}/${mine.progressTotal} score=${mine.score}  ${pend}`);
				lastRun = mine.run;
				if (Object.keys(seen).length === GATES.length) log('三档全达成 ✓ (继续守榜)');
			} else {
				// run 结束 (bracket 到期或世界重开): 官方成绩落盘
				if (userId) {
					const d = await api.call(`api/speedrun/records/${userId}`);
					const recs = (d.list ?? []).map((r) => r.record ?? r).filter((r) => r.run === lastRun);
					if (recs.length) {
						const r = recs.sort((a, b) => b.bracket - a.bracket)[0];
						fs.appendFileSync(
							runsPath,
							`${JSON.stringify({ ts: Date.now(), run: r.run, bracket: r.bracket, score: r.score, level: r.level, progress: r.progress, room: r.room, gates: seen })}\n`,
						);
						log(`run${r.run} 官方成绩: score=${r.score} (bracket ${r.bracket}) -> ${path.basename(runsPath)}`);
					} else {
						log(`run${lastRun} 结束但 records 未收录 (中途被重开?)`);
					}
				}
				seen = {};
				prev = null;
				// 重开: 落地新 run
				const status = await api.call('api/user/world-status');
				if (status.status === 'empty') {
					log(`${room} 无主 → place-spawn`);
					const place = await api.call('api/game/place-spawn', {
						room,
						shard: 'shard0',
						x: 17,
						y: 31,
						name: 'Spawn1',
					});
					log(`place-spawn: ${JSON.stringify(place).slice(0, 120)}`);
				}
				await sleep(20);
			}
		} catch (e) {
			log(`err ${String(e).slice(0, 160)}`);
			await sleep(10);
		}
		await sleep(interval);
	}
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ── 入口 ─────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const posArgs = [];
for (let i = 0; i < rest.length; i++) {
	if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i];
	else posArgs.push(rest[i]);
}
if (!cmd || cmd === '--help' || cmd === '-h') usage(0);

const commands = { land: cmdLand, status: cmdStatus, board: cmdBoard, watch: cmdWatch };
if (!commands[cmd]) usage(1);
await commands[cmd](posArgs, flags);
