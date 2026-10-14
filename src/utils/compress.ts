/**
 * 布局坐标位压缩: 纯算法, 零依赖。
 * (x<<6)|y 单数编码, 房间内数千坐标点持久化时显著省 Memory。
 */
export type CompressedPoint = number;

/** 房间内坐标对 */
export type XY = [number, number];

/** 坐标对压缩为单数 */
export function compress(x: number, y: number): CompressedPoint {
	return (x << 6) | y;
}

/** 单数解压为坐标对 */
export function decompress(value: CompressedPoint): XY {
	return [value >> 6, value & 0x3f];
}

/** 坐标对数组批量压缩 */
export function compressBatch(points: readonly XY[]): CompressedPoint[] {
	const result: CompressedPoint[] = [];
	for (const [x, y] of points) {
		result.push((x << 6) | y);
	}
	return result;
}

/** 压缩数组批量解压 */
export function decompressBatch(values: readonly CompressedPoint[]): XY[] {
	const result: XY[] = [];
	for (const value of values) {
		result.push([value >> 6, value & 0x3f]);
	}
	return result;
}

// ============================================================
// utf15 位流编解码 (Memory 通用持久化)
// ============================================================

/** utf15 编解码配置 */
export interface Utf15CodecConfig {
	/** 头部自描述: decode 时从串头恢复 array/depth 配置 */
	meta?: boolean;
	/** 数组模式: 打包整数数组 (默认单值模式) */
	array?: boolean;
	/** 每值位宽 (1-53); array 模式可传逐元素位宽数组 */
	depth?: number | number[];
}

/** utf15 可接受的整数数组 (含 TypedArray) */
export type Utf15IntArray =
	| number[]
	| Int8Array
	| Uint8Array
	| Int16Array
	| Uint16Array
	| Int32Array
	| Uint32Array;

const UTF15_MAX_DEPTH = 53; // Number.MAX_SAFE_INTEGER === 2^53 - 1
const UTF15_BITS_PER_CHAR = 15; // 每字符 15 位 (16 位减去代理对区)
const UTF15_OFFSET = 48; // 数值 0 映射到 ASCII '0', 避开控制字符
const UTF15_UPPER_BOUND = 0xffff;
// 2 的幂表 (2^0 … 2^53), 位拆装查表用
const UTF15_POWERS: readonly number[] = [
	1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072,
	262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864, 134217728,
	268435456, 536870912, 1073741824, 2147483648, 4294967296, 8589934592, 17179869184,
	34359738368, 68719476736, 137438953472, 274877906944, 549755813888, 1099511627776,
	2199023255552, 4398046511104, 8796093022208, 17592186044416, 35184372088832,
	70368744177664, 140737488355328, 281474976710656, 562949953421312, 1125899906842624,
	2251799813685248, 4503599627370496, 9007199254740992,
];
const UTF15_UPPER_LIMIT = UTF15_POWERS[UTF15_BITS_PER_CHAR] ?? 32768; // 15 位可表示上限

class Utf15Error extends Error {
	constructor(kind: "Range" | "Type", msg: string) {
		super(`[utf15][${kind}Error]: ${msg}`);
	}
}

const utf15Assert = (condition: unknown, kind: "Range" | "Type", msg: string): void => {
	if (!condition) throw new Utf15Error(kind, msg);
};

/** codePointAt 的越界安全封装 (越界按 0) */
const cpAt = (str: string, index: number): number => str.codePointAt(index) ?? 0;

/** 数值 → 编码字符 (+48 偏移; 要求 value < 32768) */
const utf15NumToChar = (value: number): string => {
	utf15Assert(value >= 0 && value < UTF15_UPPER_LIMIT, "Range", `x out of bounds: ${value}`);
	return String.fromCodePoint(value + UTF15_OFFSET);
};

/** 编码字符 → 数值 */
const utf15CharToNum = (char: number): number => {
	utf15Assert(char >= 0 && char <= UTF15_UPPER_BOUND, "Range", `x out of bounds: ${char}`);
	return char - UTF15_OFFSET;
};

/** 校验配置 (depth ∈ (0, 53]; 逐元素 depth 数组需 array 模式) */
const utf15CheckConfig = (depth: number | number[]): void => {
	if (Array.isArray(depth)) {
		const bad = depth.some((d) => Number.isNaN(d) || d <= 0 || d > UTF15_MAX_DEPTH);
		utf15Assert(!bad, "Type", "Codec config is invalid: depth 数组含越界位宽");
		return;
	}
	utf15Assert(
		!Number.isNaN(depth) && depth > 0 && depth <= UTF15_MAX_DEPTH,
		"Type",
		`Codec config is invalid: depth = ${depth}`,
	);
};

/** 数组位流打包: 逐值按 depth 拆位, 拼满 15 位输出一个字符; 数组长度作头部字符 */
const utf15PackBits = (res: string, values: Utf15IntArray, depth: number | number[]): string => {
	const depthIsArray = Array.isArray(depth);
	const fixedDepth = depthIsArray ? 0 : depth;
	const depths = depthIsArray ? depth : [];

	utf15Assert(
		fixedDepth > 0 || depths.length === values.length,
		"Type",
		`Wrong depths array length: ${depths.length} vs ${values.length}`,
	);

	if (!depthIsArray) res += utf15NumToChar(values.length); // 数组长度作头部

	let symbolDone = 0; // 当前字符已填充位数
	let symbolAcc = 0; // 当前字符累积值

	for (let i = 0, len = values.length; i < len; i += 1) {
		const value = values[i] ?? 0;
		const depthN = fixedDepth > 0 ? fixedDepth : (depths[i] ?? 0);

		// 按位写入: 值切段填入字符的剩余空间
		for (let valueDone = 0; valueDone < depthN; ) {
			const symbolLeft = UTF15_BITS_PER_CHAR - symbolDone;
			const valueLeft = depthN - valueDone;
			const bitsToWrite = Math.min(symbolLeft, valueLeft);

			let mask = Math.floor(value / (UTF15_POWERS[valueDone] ?? 1));
			mask %= UTF15_POWERS[bitsToWrite] ?? 1;
			mask *= UTF15_POWERS[symbolDone] ?? 1;

			symbolAcc += mask;
			valueDone += bitsToWrite;
			symbolDone += bitsToWrite;

			// 字符填满 15 位, 输出
			if (symbolDone === UTF15_BITS_PER_CHAR) {
				res += utf15NumToChar(symbolAcc);
				symbolDone = 0;
				symbolAcc = 0;
			}
		}
	}

	if (symbolDone !== 0) res += utf15NumToChar(symbolAcc); // 末尾残余位

	return res;
};

/** 数组位流解包; 返回 [数值数组, 消耗字符数] */
const utf15UnpackBits = (str: string, depth: number | number[]): [number[], number] => {
	const depthIsArray = Array.isArray(depth);
	const fixedDepth = depthIsArray ? 0 : depth;
	const depths = depthIsArray ? depth : [];

	let it = 0;
	let i = 0;
	const length = depthIsArray ? depths.length : utf15CharToNum(cpAt(str, it++));
	const values: number[] = Array.from({ length }, () => 0);

	let symbolDone = 0;
	if (length === 0) return [values, it];
	let chunk = utf15CharToNum(cpAt(str, it++));

	while (i < length) {
		const depthN = fixedDepth > 0 ? fixedDepth : (depths[i] ?? 0);
		let valueAcc = 0;
		let valueDone = 0;

		// 按位读取: 字符切段拼出原值
		while (valueDone < depthN) {
			const symbolLeft = UTF15_BITS_PER_CHAR - symbolDone;
			const valueLeft = depthN - valueDone;
			const bitsToRead = Math.min(symbolLeft, valueLeft);

			let data = Math.floor(chunk / (UTF15_POWERS[symbolDone] ?? 1));
			data %= UTF15_POWERS[bitsToRead] ?? 1;
			data *= UTF15_POWERS[valueDone] ?? 1;

			valueAcc += data;
			valueDone += bitsToRead;
			symbolDone += bitsToRead;

			// 当前字符读完, 取下一个 (最后一个值读完时不前进)
			if (symbolDone === UTF15_BITS_PER_CHAR) {
				if (i + 1 === length && valueDone === depthN) break;
				chunk = utf15CharToNum(cpAt(str, it++));
				symbolDone = 0;
			}
		}

		if (valueDone > 0) {
			values[i] = valueAcc;
			i += 1;
		}
	}

	return [values, it];
};

/** utf15 位流编解码器: 无符号整数 (数组) ↔ 紧凑 UTF-16 字符串 (15 位/字符) */
export class Utf15Codec {
	private readonly meta: boolean;
	private readonly array: boolean;
	private readonly depth: number | number[];

	constructor(cfg: Utf15CodecConfig = {}) {
		this.meta = cfg.meta === true;
		this.array = cfg.array === true;
		this.depth = cfg.depth ?? UTF15_MAX_DEPTH;
		utf15CheckConfig(this.depth);
	}

	/** 编码。array 模式收整数数组/TypedArray, 单值模式收单值 */
	encode(arg: number | Utf15IntArray): string {
		const argIsArray =
			typeof arg === "number" ? false : Array.isArray(arg) || "BYTES_PER_ELEMENT" in arg;
		utf15Assert(
			argIsArray === this.array,
			"Type",
			"Incompatible codec (array <=> single value)",
		);

		let res = "";
		if (this.meta) {
			// 头部自描述: depth 记 0 表示逐元素位宽数组
			res += utf15NumToChar(1) + utf15NumToChar(Array.isArray(this.depth) ? 0 : this.depth);
		}

		if (this.array) {
			res = utf15PackBits(res, arg as Utf15IntArray, this.depth);
		} else {
			// 单值: 按 depth 拆成多个 15 位字符
			let x = (arg as number) % (UTF15_POWERS[this.depth as number] ?? 1);
			const len = Math.ceil((this.depth as number) / UTF15_BITS_PER_CHAR);
			for (let i = 0; i < len; i += 1) {
				res += utf15NumToChar(x % UTF15_UPPER_LIMIT);
				x = Math.floor(x / UTF15_UPPER_LIMIT);
			}
		}

		return res;
	}

	/** 数组模式解码 → 数值数组 */
	decodeArray(str: string): number[] {
		if (!this.array) throw new Utf15Error("Type", "Incompatible codec (array <=> single value)");
		let depth: number | number[] = this.depth;
		let body = str;
		if (this.meta) {
			const arrayFlag = utf15CharToNum(cpAt(str, 0));
			const depthFlag = utf15CharToNum(cpAt(str, 1));
			body = str.slice(2);
			utf15Assert(arrayFlag === 1, "Type", "Incompatible codec (array <=> single value)");
			depth = depthFlag > 0 ? depthFlag : this.depth;
		}
		const [values] = utf15UnpackBits(body, depth);
		return values;
	}

	/** 单值模式解码 → 数值 */
	decodeValue(str: string): number {
		if (this.array) throw new Utf15Error("Type", "Incompatible codec (array <=> single value)");
		let depth = typeof this.depth === "number" ? this.depth : UTF15_MAX_DEPTH;
		let body = str;
		if (this.meta) {
			const arrayFlag = utf15CharToNum(cpAt(str, 0));
			const depthFlag = utf15CharToNum(cpAt(str, 1));
			body = str.slice(2);
			utf15Assert(arrayFlag === 0, "Type", "Incompatible codec (array <=> single value)");
			if (depthFlag > 0) depth = depthFlag;
		}
		let acc = 0;
		let pow = 0;
		const len = Math.ceil(depth / UTF15_BITS_PER_CHAR);
		for (let i = 0; i < len; i += 1) {
			acc += utf15CharToNum(cpAt(body, i)) * (UTF15_POWERS[pow] ?? 1);
			pow += UTF15_BITS_PER_CHAR;
		}
		return acc;
	}
}

// ============================================================
// 路径增量方向编码 (Memory 路径持久化)
// ============================================================

const PATH_COORD_CODEC = new Utf15Codec({ array: true, depth: 6 });
const PATH_DIR_CODEC = new Utf15Codec({ array: true, depth: 3 });
// TOP 起顺时针, 与游戏方向常量同序
const PATH_DELTAS: ReadonlyArray<readonly [number, number]> = [
	[0, -1], [1, -1], [1, 0], [1, 1],
	[0, 1], [-1, 1], [-1, 0], [-1, -1],
];
const PATH_DIR_LOOKUP: number[] = [];
PATH_DELTAS.forEach(([dx, dy], i) => {
	PATH_DIR_LOOKUP[(dx + 1) * 3 + (dy + 1)] = i;
});

/**
 * 路径编码: 相邻步进序列 → [起点串, 方向步进串] (约 0.4 字符/步)
 * @param pairs 同房间相邻步进坐标序列 [x, y][], 步进必须相邻 (dx/dy ∈ {-1,0,1})
 */
export function packPath(pairs: readonly XY[]): [string, string] {
	const first = pairs[0];
	if (!first) throw new Error("packPath: 空路径");
	const head = PATH_COORD_CODEC.encode([first[0], first[1]]);
	const dirs: number[] = [];
	for (let i = 1; i < pairs.length; i += 1) {
		const prev = pairs[i - 1];
		const cur = pairs[i];
		if (!prev || !cur) continue;
		const d = PATH_DIR_LOOKUP[(cur[0] - prev[0] + 1) * 3 + (cur[1] - prev[1] + 1)];
		if (d === undefined) throw new Error(`packPath: 非相邻步进 @${i}`);
		dirs.push(d);
	}
	return [head, dirs.length > 0 ? PATH_DIR_CODEC.encode(dirs) : ""];
}

/** 路径解码: 从起点沿方向表重放还原绝对坐标序列 */
export function unpackPath([head, steps]: readonly [string, string]): XY[] {
	const decoded = PATH_COORD_CODEC.decodeArray(head);
	const startX = decoded[0] ?? 0;
	const startY = decoded[1] ?? 0;
	const out: XY[] = [[startX, startY]];
	const dirs = steps ? PATH_DIR_CODEC.decodeArray(steps) : [];
	let x = startX;
	let y = startY;
	for (let i = 0; i < dirs.length; i += 1) {
		const delta = PATH_DELTAS[dirs[i] ?? 0];
		if (!delta) continue;
		x += delta[0];
		y += delta[1];
		out.push([x, y]);
	}
	return out;
}

// ============================================================
// bodyConfig 压缩
// ============================================================

/** bodyConfig 压缩为字符串: 每段 [部件代号, 数量], 如 "m3w5c1" */
export function compressBodyConfig(
	bodyConfig: ReadonlyArray<readonly (BodyPartConstant | number)[]>,
): string {
	const MAP: Record<string, string> = {
		[MOVE]: "m",
		[WORK]: "w",
		[CARRY]: "c",
		[ATTACK]: "a",
		[RANGED_ATTACK]: "r",
		[HEAL]: "h",
		[TOUGH]: "t",
		[CLAIM]: "cl",
	};
	let result = "";
	for (const part of bodyConfig) {
		const code = MAP[`${part[0]}`] ?? "";
		result += `${code}${part[1] ?? 0}`;
	}
	return result;
}

/** 压缩串解压回 bodyConfig */
export function decompressBodyConfig(compressed: string): Array<(BodyPartConstant | number)[]> {
	const REVERSE_MAP: Record<string, BodyPartConstant> = {
		m: MOVE,
		w: WORK,
		c: CARRY,
		a: ATTACK,
		r: RANGED_ATTACK,
		h: HEAL,
		t: TOUGH,
		cl: CLAIM,
	};
	if (!compressed) return [];

	const lower = compressed.toLowerCase();
	const regex = /(cl|m|w|c|a|r|h|t)(\d+)/g;
	const segments = lower.match(regex);
	if (!segments) return [];
	const result: Array<(BodyPartConstant | number)[]> = [];
	for (const segment of segments) {
		const decoded = /(cl|m|w|c|a|r|h|t)(\d+)/.exec(segment);
		if (!decoded || decoded[1] === undefined) continue;
		const part = REVERSE_MAP[decoded[1]];
		if (!part) continue;
		result.push([part, Number(decoded[2] ?? 0)]);
	}
	return result;
}
