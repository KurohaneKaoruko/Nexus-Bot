/**
 * b2b 线上格式 (wire): 封套 seal/open、nonce 构造、明文解析与限额。
 * 协议口径: PROTOCOL.md —— t=HMAC(nonce‖c) 前 16 字节; nonce 首四位是身份摘要;
 * 一切记入受 {e,seq,at,exp} 有限数字与数组形状约束, 超限丢弃不抛错。
 */
import {
	chacha20,
	concat,
	fromBase64,
	fromHex,
	hmacSha256,
	sha256,
	toBase64,
	utf8Decode,
	utf8Encode,
} from "./crypto";

/** 线上/明文共用限额 (协议常量, 与参考实现一致) */
export const LIMITS = { raw: 1e5, names: 50, name: 40, msgs: 100, body: 2e3, outbox: 2e4 } as const;

/** 加密/校验密钥对: Ke = SHA-256(K‖"enc"), Km = SHA-256(K‖"mac") */
export interface B2BKeys {
	enc: Uint8Array;
	mac: Uint8Array;
}

export function deriveKeys(keyHex: string): B2BKeys {
	if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("b2b 组密钥必须是 64 位十六进制");
	const key = fromHex(keyHex);
	return {
		enc: sha256(concat(key, utf8Encode("enc"))),
		mac: sha256(concat(key, utf8Encode("mac"))),
	};
}

function u32(n: number): Uint8Array {
	return Uint8Array.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

/** nonce = SHA-256(身份)[0..4] ‖ time(4B 大端) ‖ counter(4B 大端); 身份 = 名字@shard */
export function makeNonce(me: string, time: number, counter: number): Uint8Array {
	return concat(sha256(utf8Encode(me)).slice(0, 4), u32(time), u32(counter));
}

function tag(keys: B2BKeys, nonce: Uint8Array, c: Uint8Array): Uint8Array {
	return hmacSha256(keys.mac, concat(nonce, c)).slice(0, 16);
}

/** 明文 → 线上封套 {"b2b":1,n,c,t} */
export function seal(keys: B2BKeys, nonce: Uint8Array, plaintext: string): string {
	const c = chacha20(keys.enc, nonce, 1, utf8Encode(plaintext));
	return JSON.stringify({
		b2b: 1,
		n: toBase64(nonce),
		c: toBase64(c),
		t: toBase64(tag(keys, nonce, c)),
	});
}

export interface Opened {
	text: string;
	nonce: Uint8Array;
}

/** 线上封套 → 明文 (校验失败/形状不符返回 undefined, 不抛错) */
export function openWithNonce(keys: B2BKeys, raw: string): Opened | undefined {
	let w: unknown;
	try {
		w = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof w !== "object" || w === null) return undefined;
	const o = w as { b2b?: unknown; n?: unknown; c?: unknown; t?: unknown };
	if (o.b2b !== 1 || typeof o.n !== "string" || typeof o.c !== "string" || typeof o.t !== "string")
		return undefined;
	const n = fromBase64(o.n);
	const c = fromBase64(o.c);
	const t = fromBase64(o.t);
	if (!n || !c || !t || n.length !== 12 || t.length !== 16) return undefined;
	const want = tag(keys, n, c);
	for (let i = 0; i < 16; i++) {
		if (want[i] !== t[i]) return undefined;
	}
	return { text: utf8Decode(chacha20(keys.enc, n, 1, c)), nonce: n };
}

// ── 明文形状 ──────────────────────────────────────────────

/** 合法单条消息 (有限数字字段 + body 可序列化且 ≤2000 字) */
export interface PlainMsg {
	seq: number;
	body: unknown;
	at: number;
	exp: number;
}

/** 解析后的明文 */
export interface Plain {
	e: number;
	known: string[];
	added: string[];
	msgs: PlainMsg[];
}

export function validName(n: unknown): n is string {
	return typeof n === "string" && n.length >= 1 && n.length <= LIMITS.name && n !== "__proto__";
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function names(v: unknown[]): string[] {
	return v.filter(validName).slice(0, LIMITS.names);
}

function msg(v: unknown): PlainMsg | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const m = v as { seq?: unknown; at?: unknown; exp?: unknown; body?: unknown };
	if (!num(m.seq) || !num(m.at) || !num(m.exp)) return undefined;
	let body: string;
	try {
		body = JSON.stringify(m.body);
	} catch {
		return undefined;
	}
	if (body === undefined || body.length > LIMITS.body) return undefined;
	return { seq: m.seq, body: m.body, at: m.at, exp: m.exp };
}

/** 解析明文 JSON (超限/形状不符整体丢弃, 返回 undefined) */
export function parsePlain(text: string): Plain | undefined {
	if (text.length > LIMITS.raw) return undefined;
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof v !== "object" || v === null) return undefined;
	const o = v as { e?: unknown; known?: unknown; added?: unknown; msgs?: unknown };
	if (!num(o.e) || !Array.isArray(o.known) || !Array.isArray(o.added) || !Array.isArray(o.msgs))
		return undefined;
	const msgs: PlainMsg[] = [];
	for (const m of o.msgs) {
		const ok = msg(m);
		if (ok) msgs.push(ok);
		if (msgs.length >= LIMITS.msgs) break;
	}
	return { e: o.e, known: names(o.known), added: names(o.added), msgs };
}
