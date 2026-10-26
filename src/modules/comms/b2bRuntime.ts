/**
 * b2b 游戏侧运行时: 密钥管理 (Memory.b2b.key, 控制台设置) + RawMemory 适配 +
 * TickModule 挂载 + 控制台命令注册 (global.b2b)。
 * race 私服 compat 会把 RawMemory 占位成空 class——defaultB2BIo 检测 API 缺失
 * 时返回 undefined, 整模块静默禁用, 不影响主循环。
 */
import type { TickContext, TickModule } from "@/core";
import {
	createB2BChannel,
	freshB2BState,
	type B2BChannel,
	type B2BIo,
	type B2BState,
} from "./channel";
import { deriveKeys } from "./wire";

const SEGMENT = 98;
const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/** RawMemory segment API 缺失 (私服占位) → undefined, 调用方静默禁用 */
function defaultB2BIo(): B2BIo | undefined {
	const raw = typeof RawMemory !== "undefined" ? RawMemory : undefined;
	if (
		!raw ||
		typeof raw.setActiveForeignSegment !== "function" ||
		typeof raw.setPublicSegments !== "function" ||
		!raw.segments
	) {
		return undefined;
	}
	return {
		requestForeign: (user, id) => RawMemory.setActiveForeignSegment(user, id),
		readForeign: () => {
			const f = RawMemory.foreignSegment;
			return f && typeof f.data === "string"
				? { username: f.username, id: f.id, data: f.data }
				: undefined;
		},
		publish: (id, rawStr) => {
			RawMemory.segments[id] = rawStr;
			RawMemory.setPublicSegments([SEGMENT]);
		},
	};
}

function selfName(): string {
	for (const n in Game.spawns) return (Game.spawns[n] as StructureSpawn).owner.username;
	for (const n in Game.creeps) return (Game.creeps[n] as Creep).owner.username;
	return "";
}

function readState(): B2BState {
	if (!Memory.b2b) Memory.b2b = freshB2BState(Game.time);
	return Memory.b2b;
}

let channel: B2BChannel | undefined;
let channelKey: string | undefined;

/** 通道惰性构建: 密钥有效 + IO 可用才建; key 变更自动重建 (状态不丢, 只换密钥派生) */
function ensureChannel(): B2BChannel | undefined {
	const io = defaultB2BIo();
	if (!io) return undefined;
	const keyHex = readState().key;
	if (!keyHex || !KEY_PATTERN.test(keyHex)) return undefined;
	if (channel && channelKey === keyHex) return channel;
	try {
		deriveKeys(keyHex);
	} catch {
		return undefined;
	}
	channel = createB2BChannel({
		key: keyHex,
		io,
		segment: SEGMENT,
		now: () => Game.time,
		shard: () => Game.shard?.name ?? "",
		me: selfName,
		memory: () => readState(),
		onMessage: (m) => {
			const text = typeof m.body === "string" ? m.body : JSON.stringify(m.body);
			console.log(`[b2b] ${m.from}：${text}`);
		},
	});
	channelKey = keyHex;
	return channel;
}

let lastWarn = -100;
const warnEvery = (msg: string): void => {
	if (Game.time - lastWarn >= 50) {
		lastWarn = Game.time;
		console.log(msg);
	}
};

/** b2b 每 tick 入口 (TickModule.run); 未激活静默跳过, 运行错只限频告警 */
export function b2bTick(): void {
	const ch = ensureChannel();
	if (!ch) return;
	try {
		ch.tick();
	} catch (err) {
		warnEvery(`[b2b] 出错：${String(err)}`);
	}
}

/** 保存密钥到 Memory.b2b.key (控制台手动设置; 不入库不入仓) */
export function setB2BKey(hex?: string): string {
	const state = readState();
	if (hex === undefined) return state.key ? `当前密钥已设置 (${state.key.slice(0, 8)}…)` : "未设置";
	if (!KEY_PATTERN.test(hex)) return "密钥必须是 64 位十六进制";
	state.key = hex;
	channelKey = undefined; // 触发下 tick 重建通道
	return defaultB2BIo() ? "已保存密钥" : "已保存密钥（RawMemory segment API 不可用，等待环境就绪）";
}

// ── 控制台命令 (global.b2b.*): 挂载由 ConsoleExtension 统一 assign ──

const text = (body: unknown): string => (typeof body === "string" ? body : JSON.stringify(body));

export const b2b = {
	/** b2b.key('64位十六进制') 设置组密钥; 无参查看状态 */
	key: (hex?: string): string => setB2BKey(hex),
	/** b2b.add('名字') 加人; 对方也 add 你才算握手成功 */
	add: (name: string): string => {
		const ch = ensureChannel();
		if (!ch) return "先设置组密钥: b2b.key('64位十六进制')";
		const r = ch.add(name);
		if (r === "added") console.log(`[b2b] 已添加 ${name}，等待对方 add 你完成握手`);
		else if (r === "already") console.log(`[b2b] ${name} 已在名单中`);
		else if (r === "self") console.log("[b2b] 不能添加自己");
		else if (r === "invalid") console.log("[b2b] 无效名字");
		return r;
	},
	/** b2b.members() 成员与待握手名单 */
	members: (): string => {
		const ch = ensureChannel();
		if (!ch) return "先设置组密钥: b2b.key('64位十六进制')";
		return (
			ch
				.members()
				.map(
					(m) =>
						`${m.name} ${m.state === "member" ? "成员" : "待握手"}${m.lastSeen ? ` (最近活跃 ${m.lastSeen})` : ""}`,
				)
				.join("\n") || "名单是空的"
		);
	},
	/** b2b.send('消息') 发给全组 */
	send: (msg: unknown): string => {
		const ch = ensureChannel();
		if (!ch) return "先设置组密钥: b2b.key('64位十六进制')";
		try {
			return `已发（#${ch.sendMessage(msg)}）`;
		} catch (e) {
			return `发送失败：${(e as Error).message}`;
		}
	},
	/** b2b.inbox(20) 最近收到的消息 */
	inbox: (n = 20): string => {
		const ch = ensureChannel();
		if (!ch) return "先设置组密钥: b2b.key('64位十六进制')";
		return (
			ch
				.inbox(n)
				.map((m) => `[${m.at}] ${m.from}：${text(m.body)}`)
				.join("\n") || "还没收到消息"
		);
	},
};

/** b2b 域模块: commit 段末尾驱动 segment 读写 (P2, 非关键带, 可被预算跳过) */
export const Comms: TickModule = {
	name: "comms",
	phase: "commit",
	band: "P2",
	run(_ctx: TickContext): void {
		b2bTick();
	},
};
