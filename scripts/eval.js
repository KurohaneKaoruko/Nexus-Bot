// 一次性控制台表达式求值 (非交互): node ./scripts/eval.js [服务器[@账号]] -- "<表达式>"
// 与 console.js 同协议 (SockJS WebSocket), 用于脚本化实服取证; 结果剥离 HTML 标记。
// 一次性控制台表达式求值 (非交互): node ./scripts/eval.js [服务器[@账号]] -- "<表达式>"
// 与 console.js 同协议 (SockJS WebSocket), 用于脚本化实服取证; 结果剥离 HTML 标记。
import { loadSecret, getServers, getServerAccounts, resolveTarget, matchName } from './secret.js';
import WebSocket from 'ws';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const expr = dash >= 0 ? argv.slice(dash + 1).join(' ') : 'JSON.stringify(Game.time)';
const posTarget = (dash >= 0 ? argv.slice(0, dash) : []).find((a) => !a.startsWith('-')) ?? '47.100.24.220';
const [serverInput, accountInput] = posTarget.split('@');

const secret = loadSecret();
const servers = getServers(secret);
const serverName = matchName(Object.keys(servers), serverInput)[0];
if (!serverName) {
	console.error(`服务器 ${serverInput} 无法匹配 (${Object.keys(servers).join(' / ')})`);
	process.exit(1);
}
const accounts = Object.keys(getServerAccounts(servers[serverName]));
const accountWanted = accountInput ?? (accounts.includes('Nexus') ? 'Nexus' : accounts[0]);
const target = resolveTarget(secret, serverName, accountWanted);
const port = target.port && target.port !== 21025 ? `:${target.port}` : '';
const base = `${target.protocol || 'http'}://${target.hostname}${port}`;
const wsBase = `${(target.protocol || 'http') === 'https' ? 'wss' : 'ws'}://${target.hostname}${port}`;

const signin = await fetch(`${base}/api/auth/signin`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email: target.email, password: target.password }),
}).then((r) => r.json());
const headers = { 'Content-Type': 'application/json', 'X-Token': signin.token, 'X-Username': target.email };
const me = await fetch(`${base}/api/auth/me`, { headers }).then((r) => r.json());

const serverId = Math.floor(Math.random() * 1000);
const sessionId = Math.random().toString(36).substring(2, 10);
const ws = new WebSocket(`${wsBase}/socket/${serverId}/${sessionId}/websocket`);

const result = await new Promise((resolve, reject) => {
	const timer = setTimeout(() => { ws.close(); reject(new Error('ws 超时')); }, 20000);
	ws.on('open', () => {
		ws.send(JSON.stringify([`auth ${signin.token}`]));
		ws.send(JSON.stringify([`subscribe user:${me._id}/console`]));
		fetch(`${base}/api/user/console`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ expression: expr }),
		}).catch(() => {});
	});
	ws.on('message', (raw) => {
		const text = raw.toString();
		if (process.env.EVAL_DEBUG) console.error('[frame]', text.slice(0, 200));
		if (!text.startsWith('a')) return;
		try {
			const arr = JSON.parse(text.slice(1));
			for (const item of arr) {
				const msg = JSON.parse(item);
				const payload = Array.isArray(msg) ? msg[1] : undefined;
				const lines = payload?.messages?.results;
				if (Array.isArray(lines) && lines.length > 0) {
					clearTimeout(timer);
					ws.close();
					resolve(lines.map((t) => t.replace(/<[^>]+>/g, '')).join('\n'));
				}
			}
		} catch { /* 忽略非 JSON 帧 */ }
	});
	ws.on('error', (e) => { clearTimeout(timer); reject(e); });
});
console.log(result);
