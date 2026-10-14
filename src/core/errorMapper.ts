/**
 * 线上堆栈还原 (build-deploy: sourcemap 随包上传)。
 * 读取随包上传的 main.js.map 模块, 用内置 VLQ 解码把打包后位置还原为源码位置;
 * 无第三方依赖, 不做完整 consumer, 只按需解析目标行。
 */

interface RawSourceMap {
	version: number;
	sources: string[];
	mappings: string;
	names?: string[];
}

export interface MappedPosition {
	source: string;
	line: number;
	column: number;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlqSegment(segment: string): number[] {
	const values: number[] = [];
	let shift = 0;
	let value = 0;
	for (const char of segment) {
		const digit = BASE64_CHARS.indexOf(char);
		if (digit < 0) {
			throw new Error(`sourcemap 含非法字符: ${char}`);
		}
		const hasContinuation = (digit & 32) !== 0;
		value += (digit & 31) << shift;
		if (hasContinuation) {
			shift += 5;
		} else {
			const negative = (value & 1) === 1;
			value >>= 1;
			values.push(negative ? -value : value);
			shift = 0;
			value = 0;
		}
	}
	return values;
}

/** 解析完整 mappings: 生成列按行重置, 源索引/源行/源列增量跨行持续 (sourcemap 规范) */
function decodeAllLines(mappings: string): number[][][] {
	let sourceIndex = 0;
	let sourceLine = 0;
	let sourceColumn = 0;
	return mappings.split(";").map((line) => {
		let generatedColumn = 0;
		const segments: number[][] = [];
		for (const raw of line.split(",")) {
			if (raw === "") {
				continue;
			}
			const fields = decodeVlqSegment(raw);
			if (fields.length < 4) {
				continue;
			}
			generatedColumn += fields[0] ?? 0;
			sourceIndex += fields[1] ?? 0;
			sourceLine += fields[2] ?? 0;
			sourceColumn += fields[3] ?? 0;
			segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn]);
		}
		return segments;
	});
}

/** 把打包后的 1-based line / 0-based column 映射回源码位置; 找不到精确段时返回 null */
export function mapPosition(
	map: RawSourceMap,
	line: number,
	column: number,
): MappedPosition | null {
	const allLines = decodeAllLines(map.mappings);
	const segments = allLines[line - 1];
	if (!segments || segments.length === 0) {
		return null;
	}
	let best: number[] | null = null;
	for (const segment of segments) {
		const generatedColumn = segment[0];
		if (generatedColumn === undefined || generatedColumn > column) {
			break;
		}
		best = segment;
	}
	if (!best) {
		return null;
	}
	const sourceIndex = best[1];
	const sourceLine = best[2];
	const sourceColumn = best[3];
	if (sourceIndex === undefined || sourceLine === undefined || sourceColumn === undefined) {
		return null;
	}
	const source = map.sources[sourceIndex];
	if (source === undefined) {
		return null;
	}
	return { source, line: sourceLine + 1, column: sourceColumn };
}

/** 从游戏模块系统读取随包 sourcemap; 不可用时返回 null */
function loadSourceMap(): RawSourceMap | null {
	try {
		// 上传时 sourcemap 被整理为 main.js.map 模块 (见 plugins/upload.js prepareSourceMap)
		const raw: unknown = require("main.js.map");
		const map = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
		if (
			typeof map === "object" &&
			map !== null &&
			Array.isArray((map as RawSourceMap).sources) &&
			typeof (map as RawSourceMap).mappings === "string"
		) {
			return map as RawSourceMap;
		}
		return null;
	} catch {
		return null;
	}
}

const STACK_FRAME = /\(?(?:[\w$./\\-]*?main\.js):(\d+):(\d+)\)?/;

/**
 * 低桶/CPU 紧张时跳过堆栈映射
 * 映射只在报错时发生, 但首帧解码也有成本, 资源紧张时保运行优先。
 */
function shouldSkipSourceMap(): boolean {
	if (typeof Game === "undefined" || !Game.cpu) {
		return false;
	}
	const bucket = Game.cpu.bucket || 0;
	if (bucket > 0 && bucket < 2000) {
		return true;
	}
	const limit = Game.cpu.limit || 0;
	if (limit > 0 && Game.cpu.getUsed() > limit * 0.8) {
		return true;
	}
	return false;
}

/** 同一堆栈只映射一次; 有界缓存, 防长期运行无界增长 */
const stackCache = new Map<string, string>();
const STACK_CACHE_MAX = 50;

/** 把错误堆栈中的 main.js 位置还原为源码位置; sourcemap 不可用时原样返回 */
export function formatError(err: unknown): string {
	const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	if (!stack) {
		return message;
	}
	const cached = stackCache.get(stack);
	if (cached !== undefined) {
		return cached;
	}
	const formatted = `${message}\n${mapStackFrames(stack)}`;
	if (stackCache.size >= STACK_CACHE_MAX) {
		const oldest = stackCache.keys().next();
		if (!oldest.done) {
			stackCache.delete(oldest.value);
		}
	}
	stackCache.set(stack, formatted);
	return formatted;
}

function mapStackFrames(stack: string): string {
	if (shouldSkipSourceMap()) {
		return stack;
	}
	const map = loadSourceMap();
	if (!map) {
		return stack;
	}
	return stack
		.split("\n")
		.map((frameLine) => {
			const match = STACK_FRAME.exec(frameLine);
			if (!match) {
				return frameLine;
			}
			const line = Number(match[1]);
			const column = Number(match[2]);
			const position = mapPosition(map, line, column);
			if (!position) {
				return frameLine;
			}
			const prefix = frameLine.slice(0, match.index);
			return `${prefix}${position.source}:${position.line}:${position.column}`;
		})
		.join("\n");
}
