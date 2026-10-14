// 落地: 账号被 40wt 自动重置后, 主动放 spawn 让代码恢复运行
// 用法: node ./scripts/land.js [服务器[@账号]] [--room W5N8] [--x 25] [--y 25]
// 服务器无 spawn (world-status=empty) 时代码不会执行——必须先落 spawn。
// 端点契约: POST /api/game/place-spawn { room, name, x, y, shard }
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSecret, getServers, getServerAccounts, resolveTarget, matchName } from './secret.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
	console.log([
		'用法: node ./scripts/land.js [服务器[@账号]] [--room 房名] [--x N] [--y N]',
		'  默认房间坐标取 world-start-room 返回的出生房中心 (25,25)',
		'  已有 spawn 时安全退出 (world-status=normal)',
	].join('\n'));
	process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) usage();
const flag = (name) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const posArg = argv.find((a) => !a.startsWith('-'));

async function main() {
	const secret = loadSecret();
	if (!secret) {
		console.error('配置文件 .secret.json 未找到');
		process.exit(1);
	}
	const servers = getServers(secret);
	let serverName;
	let accountName;
	if (posArg) {
		[serverName, accountName] = posArg.split('@');
	} else {
		serverName = Object.keys(servers)[0];
	}
	const candidates = matchName(Object.keys(servers), serverName);
	if (candidates.length !== 1) {
		console.error(`[land] 服务器 ${serverName} 匹配 ${candidates.length} 个候选, 请写全名`);
		process.exit(1);
	}
	serverName = candidates[0];
	const accounts = Object.keys(getServerAccounts(servers[serverName]));
	if (!accountName && accounts.length === 1) {
		accountName = accounts[0];
	}
	if (!accountName || !getServerAccounts(servers[serverName])[accountName]) {
		console.error(`[land] 需要账号: 服务器 ${serverName} 下可选 ${accounts.join(' / ')}`);
		process.exit(1);
	}
	const target = resolveTarget(secret, serverName, accountName);
	if (!target) {
		console.error('无法解析目标服务器/账号');
		process.exit(1);
	}
	const account = { email: target.email, password: target.password };
	const server = target;
	const port = server.port && server.port !== 21025 ? `:${server.port}` : '';
	const base = `${server.protocol || 'http'}://${server.hostname}${port}${(server.path || '/').replace(/\/+$/, '')}`;
	const authHeaders = { 'Content-Type': 'application/json' };

	const signin = await fetch(`${base}/api/auth/signin`, {
		method: 'POST',
		headers: authHeaders,
		body: JSON.stringify({ email: account.email, password: account.password }),
	}).then((r) => r.json());
	if (signin.ok !== 1) {
		console.error('[land] 登录失败:', JSON.stringify(signin).slice(0, 120));
		process.exit(1);
	}
	const headers = { 'Content-Type': 'application/json', 'X-Token': signin.token, 'X-Username': account.email };

	const status = await fetch(`${base}/api/user/world-status`, { headers }).then((r) => r.json());
	if (status.status !== 'empty') {
		console.log(`[land] world-status=${status.status}, 无需落地`);
		return;
	}
	let room = flag('room');
	if (!room) {
		const start = await fetch(`${base}/api/user/world-start-room`, { headers }).then((r) => r.json());
		room = start?.room?.[0];
	}
	if (!room) {
		console.error('[land] 未指定 --room 且 world-start-room 无返回');
		process.exit(1);
	}
	const x = Number(flag('x') ?? 25);
	const y = Number(flag('y') ?? 25);
	const place = await fetch(`${base}/api/game/place-spawn`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ room, name: 'Spawn1', x, y, shard: 'shard0' }),
	});
	const text = await place.text();
	console.log(`[land] place-spawn ${room} (${x},${y}) -> ${place.status} ${text.slice(0, 120)}`);
	if (place.ok) {
		console.log('[land] 落地完成, 下一 tick 起恢复执行分支代码');
	}
}

main();
