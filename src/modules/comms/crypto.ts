/**
 * b2b 密码学原语 (协议保真移植): SHA-256 / HMAC-SHA256 / ChaCha20 (RFC 8439) / Base64。
 * 纯函数无游戏依赖; 与参考实现逐字节一致, 由 tests/b2b-protocol.test.ts 互发验证。
 * 下标访问均为算法内已知边界 (长度参数前置校验), 用非空断言保持数学原貌。
 */

/** SHA-256 轮常数 K[0..63] */
const K = new Uint32Array([
	1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
	3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
	3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
	2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
	666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
	2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
	430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
	1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

export function utf8Encode(s: string): Uint8Array {
	const out: number[] = [];
	for (let i = 0; i < s.length; i++) {
		let c = s.charCodeAt(i);
		if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
			const d = s.charCodeAt(i + 1);
			if (d >= 56320 && d <= 57343) {
				c = 65536 + ((c - 55296) << 10) + (d - 56320);
				i++;
			}
		}
		if (c >= 55296 && c <= 57343) c = 65533;
		if (c < 128) out.push(c);
		else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
		else if (c < 65536) out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
		else out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
	}
	return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
	let s = "";
	for (let i = 0; i < b.length;) {
		const c = b[i++]!;
		let cp = 65533;
		const n = c >= 240 && c < 248 ? 3 : c >= 224 && c < 240 ? 2 : c >= 192 && c < 224 ? 1 : 0;
		if (n === 0) {
			if (c < 128) cp = c;
		} else {
			let v = c & (63 >> n);
			let ok = i + n <= b.length;
			for (let k = 0; ok && k < n; k++) {
				const x = b[i + k]!;
				if ((x & 192) !== 128) ok = false;
				else v = (v << 6) | (x & 63);
			}
			if (ok) {
				i += n;
				const min = n === 1 ? 128 : n === 2 ? 2048 : 65536;
				if (v >= min && v <= 1114111 && !(v >= 55296 && v <= 57343)) cp = v;
			}
		}
		s += String.fromCodePoint(cp);
	}
	return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(b: Uint8Array): string {
	let s = "";
	for (let i = 0; i < b.length; i += 3) {
		const b1 = b[i + 1];
		const b2 = b[i + 2];
		const n = ((b[i]! << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)) >>> 0;
		s +=
			B64.charAt(n >> 18) +
			B64.charAt((n >> 12) & 63) +
			(i + 1 < b.length ? B64.charAt((n >> 6) & 63) : "=") +
			(i + 2 < b.length ? B64.charAt(n & 63) : "=");
	}
	return s;
}

export function fromBase64(s: string): Uint8Array | undefined {
	if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*(={0,2})$/.test(s)) return undefined;
	const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
	const out = new Uint8Array((s.length / 4) * 3 - pad);
	let o = 0;
	for (let i = 0; i < s.length; i += 4) {
		let n = 0;
		for (let k = 0; k < 4; k++) {
			const ch = s.charAt(i + k);
			n = (n << 6) | (ch === "=" ? 0 : B64.indexOf(ch));
		}
		if (o < out.length) out[o++] = (n >> 16) & 255;
		if (o < out.length) out[o++] = (n >> 8) & 255;
		if (o < out.length) out[o++] = n & 255;
	}
	return out;
}

export function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length >> 1);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
	return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

export function sha256(data: Uint8Array): Uint8Array {
	const h = new Uint32Array([
		1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225,
	]);
	const total = (data.length + 9 + 63) & ~63;
	const m = new Uint8Array(total);
	m.set(data);
	m[data.length] = 128;
	const bits = data.length * 8;
	m[total - 4] = (bits >>> 24) & 255;
	m[total - 3] = (bits >>> 16) & 255;
	m[total - 2] = (bits >>> 8) & 255;
	m[total - 1] = bits & 255;
	m[total - 5] = Math.floor(bits / 4294967296) & 255;
	const w = new Uint32Array(64);
	for (let off = 0; off < total; off += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] =
				((m[off + 4 * i]! << 24) |
					(m[off + 4 * i + 1]! << 16) |
					(m[off + 4 * i + 2]! << 8) |
					m[off + 4 * i + 3]!) >>>
				0;
		}
		for (let i = 16; i < 64; i++) {
			const a2 = w[i - 15]!;
			const b2 = w[i - 2]!;
			const s0 = rotr(a2, 7) ^ rotr(a2, 18) ^ (a2 >>> 3);
			const s1 = rotr(b2, 17) ^ rotr(b2, 19) ^ (b2 >>> 10);
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
		}
		let a = h[0]!;
		let b = h[1]!;
		let c = h[2]!;
		let d = h[3]!;
		let e = h[4]!;
		let f = h[5]!;
		let g = h[6]!;
		let hh = h[7]!;
		for (let i = 0; i < 64; i++) {
			const t1 =
				(hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>>
				0;
			const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}
		h[0] = (h[0]! + a) >>> 0;
		h[1] = (h[1]! + b) >>> 0;
		h[2] = (h[2]! + c) >>> 0;
		h[3] = (h[3]! + d) >>> 0;
		h[4] = (h[4]! + e) >>> 0;
		h[5] = (h[5]! + f) >>> 0;
		h[6] = (h[6]! + g) >>> 0;
		h[7] = (h[7]! + hh) >>> 0;
	}
	const out = new Uint8Array(32);
	for (let i = 0; i < 8; i++) {
		out[4 * i] = (h[i]! >>> 24) & 255;
		out[4 * i + 1] = (h[i]! >>> 16) & 255;
		out[4 * i + 2] = (h[i]! >>> 8) & 255;
		out[4 * i + 3] = h[i]! & 255;
	}
	return out;
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
	const k = new Uint8Array(64);
	k.set(key.length > 64 ? sha256(key) : key);
	const ipad = k.map((x) => x ^ 54);
	const opad = k.map((x) => x ^ 92);
	return sha256(concat(opad, sha256(concat(ipad, data))));
}

/** ChaCha20 流密码 (counter=1 起算, RFC 8439 §2.4 口径与参考实现一致) */
export function chacha20(
	key: Uint8Array,
	nonce: Uint8Array,
	counter: number,
	data: Uint8Array,
): Uint8Array {
	const le = (b: Uint8Array, o: number): number =>
		(b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
	const st = new Uint32Array(16);
	st.set([1634760805, 857760878, 2036477234, 1797285236]);
	for (let i = 0; i < 8; i++) st[4 + i] = le(key, 4 * i);
	for (let i = 0; i < 3; i++) st[13 + i] = le(nonce, 4 * i);
	const x = new Uint32Array(16);
	const qr = (a: number, b: number, c: number, d: number): void => {
		x[a] = (x[a]! + x[b]!) >>> 0;
		x[d] = rotl(x[d]! ^ x[a]!, 16);
		x[c] = (x[c]! + x[d]!) >>> 0;
		x[b] = rotl(x[b]! ^ x[c]!, 12);
		x[a] = (x[a]! + x[b]!) >>> 0;
		x[d] = rotl(x[d]! ^ x[a]!, 8);
		x[c] = (x[c]! + x[d]!) >>> 0;
		x[b] = rotl(x[b]! ^ x[c]!, 7);
	};
	const out = new Uint8Array(data.length);
	for (let off = 0, ctr = counter; off < data.length; off += 64, ctr++) {
		st[12] = ctr >>> 0;
		x.set(st);
		for (let r = 0; r < 10; r++) {
			qr(0, 4, 8, 12);
			qr(1, 5, 9, 13);
			qr(2, 6, 10, 14);
			qr(3, 7, 11, 15);
			qr(0, 5, 10, 15);
			qr(1, 6, 11, 12);
			qr(2, 7, 8, 13);
			qr(3, 4, 9, 14);
		}
		for (let i = 0; i < 64 && off + i < data.length; i++) {
			const word = (x[i >> 2]! + st[i >> 2]!) >>> 0;
			out[off + i] = data[off + i]! ^ ((word >>> (8 * (i & 3))) & 255);
		}
	}
	return out;
}
