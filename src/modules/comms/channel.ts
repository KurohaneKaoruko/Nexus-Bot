/**
 * b2b 通道核心: 名单握手/收发件/segment 轮询的状态机。
 * 协议语义与参考实现逐 tick 对齐 (见 docs/bugs 或 tests/b2b-protocol.test.ts 对拍):
 * 每 tick 读上一 tick 申请的外部 segment → 校验解密 → 握手/收消息 → 按需发布 → 轮转申请下一人。
 * 纯逻辑零游戏依赖 (io/时钟/身份/存储全部注入), 游戏侧适配在 b2bRuntime.ts。
 */
import {
	deriveKeys,
	makeNonce,
	openWithNonce,
	parsePlain,
	seal,
	validName,
	type B2BKeys,
	type Plain,
} from "./wire";

/** segment 重发布的最大间隔 (tick) */
const REFRESH = 100;
/** 收件箱留存条数 */
const INBOX_MAX = 50;
/** 明文发件箱条数上限 (协议 LIMITS.msgs) */
const OUTBOX_MAX = 100;

/** b2b 持久状态; 组密钥为本地扩展字段 (协议明文不序列化它) */
export interface B2BState {
	e: number;
	seq: number;
	known: string[];
	added: string[];
	cursor: number;
	from: Record<string, { e: number; seq: number }>;
	outbox: { seq: number; body: unknown; at: number; exp: number }[];
	inbox: { from: string; body: unknown; at: number }[];
	lastSeen: Record<string, number>;
	pub: number;
	key?: string;
}

export interface B2BMember {
	name: string;
	state: "member" | "pending";
	lastSeen?: number;
}

export interface ReceivedMessage {
	from: string;
	body: unknown;
	at: number;
}

export interface B2BIo {
	requestForeign(user: string, id: number): void;
	readForeign(): { username: string; id: number; data: string } | undefined;
	publish(id: number, raw: string): void;
}

export interface ChannelOptions {
	/** 64 位十六进制组密钥 */
	key: string;
	io: B2BIo;
	/** 申请外部 segment 的编号 (协议默认 98) */
	segment?: number;
	now(): number;
	shard(): string;
	me(): string;
	/** 状态存取 (游戏侧挂 Memory.b2b, 测试挂本地对象) */
	memory(): B2BState;
	onMessage?: (m: ReceivedMessage) => void;
}

export interface B2BChannel {
	tick(): void;
	add(name: string): "added" | "already" | "self" | "invalid";
	members(): B2BMember[];
	sendMessage(body: unknown): number;
	inbox(n?: number): ReceivedMessage[];
}

function fresh(now: number): B2BState {
	return {
		e: now,
		seq: 0,
		known: [],
		added: [],
		cursor: 0,
		from: {},
		outbox: [],
		inbox: [],
		lastSeen: {},
		pub: now,
	};
}

const own = (o: Record<string, unknown>, k: string): unknown =>
	Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const has = (list: string[], n: string): boolean => list.some((x) => same(x, n));
const find = (list: string[], n: string): number => list.findIndex((x) => same(x, n));

export function createB2BChannel(opts: ChannelOptions): B2BChannel {
	const segment = opts.segment ?? 98;
	const keys: B2BKeys = deriveKeys(opts.key);
	const ident = (name: string): string => `${name}@${opts.shard()}`;
	let pending: string | undefined;
	let dirty = true;
	let ctrTime = -1;
	let ctr = 0;
	/** 同名 segment 原文缓存: 内容未变则跳过解密 (省 CPU), 容量随名单自然有界 */
	const lastRaw = new Map<string, string>();

	function st(): B2BState {
		const s = opts.memory();
		if (typeof s.e !== "number") Object.assign(s, fresh(opts.now()));
		if (!Number.isInteger(s.seq) || s.seq < 0)
			Object.assign(s, { seq: 0, e: opts.now(), outbox: [] });
		return s;
	}

	/** 握手: 待定名单对向确认后转正; 成员只增不减; 新名字经成员背书自动扩充 */
	function handle(s: B2BState, x: string, plain: Plain, self: string): void {
		const inAdded = find(s.added, x);
		if (inAdded >= 0 && (has(plain.known, self) || has(plain.added, self))) {
			s.added.splice(inAdded, 1);
			s.known.push(x);
			dirty = true;
		}
		if (!has(s.known, x)) return;
		for (const n of plain.known) {
			if (same(n, self) || has(s.known, n)) continue;
			const i = find(s.added, n);
			if (i >= 0) s.added.splice(i, 1);
			s.known.push(n);
			dirty = true;
		}
		receive(s, x, plain);
	}

	/** 按 (e, seq) 去重收件; 过期/纪元前消息丢弃 */
	function receive(s: B2BState, x: string, plain: Plain): void {
		const t = opts.now();
		let rec = own(s.from, x) as { e: number; seq: number } | undefined;
		if (!rec || rec.e !== plain.e) rec = s.from[x] = { e: plain.e, seq: 0 };
		for (const m of [...plain.msgs].sort((a, b) => a.seq - b.seq)) {
			if (m.seq <= rec.seq) continue;
			rec.seq = m.seq;
			if (m.exp < t || m.at < s.e) continue;
			const r = { from: x, body: m.body, at: m.at };
			s.inbox.push(r);
			if (s.inbox.length > INBOX_MAX) s.inbox.splice(0, s.inbox.length - INBOX_MAX);
			try {
				opts.onMessage?.(r);
			} catch (err) {
				console.log(`b2b onMessage 出错：${String(err)}`);
			}
		}
	}

	function publish(s: B2BState, self: string, t: number): void {
		const before = s.outbox.length;
		s.outbox = s.outbox.filter((m) => m.exp >= t).slice(-OUTBOX_MAX);
		if (!dirty && s.outbox.length === before && t - s.pub < REFRESH) return;
		let text = JSON.stringify({ e: s.e, known: s.known, added: s.added, msgs: s.outbox });
		while (text.length > 2e4 && s.outbox.length > 0) {
			s.outbox.shift();
			text = JSON.stringify({ e: s.e, known: s.known, added: s.added, msgs: s.outbox });
		}
		if (ctrTime !== t) {
			ctrTime = t;
			ctr = 0;
		}
		opts.io.publish(segment, seal(keys, makeNonce(ident(self), t, ctr++), text));
		s.pub = t;
		dirty = false;
	}

	return {
		tick() {
			const self = opts.me();
			if (!self) return;
			const s = st();
			const t = opts.now();
			const f = opts.io.readForeign();
			const x = pending;
			if (f && x !== undefined && same(f.username, x) && f.id === segment) {
				pending = undefined;
				const name = f.username;
				for (const list of [s.known, s.added]) {
					const i = find(list, name);
					if (i >= 0) list[i] = name;
				}
				const inList = has(s.known, name) || has(s.added, name);
				const raw = `${s.e}|${f.data}`;
				if (inList && lastRaw.get(name) === raw) {
					s.lastSeen[name] = t;
				} else if (inList && f.data.length <= 1e5) {
					const got = openWithNonce(keys, f.data);
					const want = got && makeNonce(ident(name), 0, 0);
					const fromX = got && want && [0, 1, 2, 3].every((i) => got.nonce[i] === want[i]);
					const plain = got && fromX ? parsePlain(got.text) : undefined;
					if (plain) {
						lastRaw.set(name, raw);
						s.lastSeen[name] = t;
						handle(s, name, plain, self);
					}
				}
			}
			publish(s, self, t);
			const list = [...s.known, ...s.added];
			if (list.length === 0) return;
			const i = s.cursor % list.length;
			s.cursor = i + 1;
			pending = list[i] as string;
			opts.io.requestForeign(pending, segment);
		},
		add(name) {
			const s = st();
			if (!validName(name)) return "invalid";
			if (same(name, opts.me())) return "self";
			if (has(s.known, name) || has(s.added, name)) return "already";
			s.added.push(name);
			dirty = true;
			return "added";
		},
		members() {
			const s = st();
			const m = (name: string, state: "member" | "pending"): B2BMember =>
				own(s.lastSeen, name) === undefined
					? { name, state }
					: { name, state, lastSeen: own(s.lastSeen, name) as number };
			return [...s.known.map((n) => m(n, "member")), ...s.added.map((n) => m(n, "pending"))];
		},
		sendMessage(body) {
			const json = JSON.stringify(body);
			if (json === undefined || json.length > 2e3)
				throw new Error("b2b 消息 body 必须是 JSON，且不超过 2000 字符");
			const s = st();
			const at = opts.now();
			const n = s.known.length + s.added.length;
			s.outbox.push({ seq: ++s.seq, body, at, exp: at + Math.max(200, 20 * n) });
			dirty = true;
			return s.seq;
		},
		inbox(n = 20) {
			return st().inbox.slice(-n);
		},
	};
}

export { fresh as freshB2BState };
