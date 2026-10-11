/**
 * 限频日志 (docs/nexus-design/03 §3.7 / docs/nexus-design/12 §12.4)。
 * 状态只存进程运行时内存, 不落 Memory; global 重置后自动重建。
 */
export type LogSink = (message: string) => void;

export interface LoggerOptions {
	/** 输出目的地, 缺省 console.log */
	sink?: LogSink;
	/** 同一 key 两次输出之间的最小 tick 间隔, 缺省 20 */
	minInterval?: number;
	/** 限频表 key 上限, 超出淘汰最旧, 缺省 200 */
	maxKeys?: number;
}

export interface Logger {
	/** 每 Tick 开头调用, 设定当前 tick */
	beginTick(tick: number): void;
	/** 不限频输出 (一次性/启动消息) */
	info(message: string): void;
	/** 限频输出: 同 key 在 minInterval 内只打一次; 返回本次是否实际输出 */
	warn(key: string, message: string): boolean;
	/** 限频错误输出, 语义同 warn */
	error(key: string, message: string): boolean;
}

export function createLogger(options: LoggerOptions = {}): Logger {
	const sink = options.sink ?? ((message: string) => console.log(message));
	const minInterval = options.minInterval ?? 20;
	const maxKeys = options.maxKeys ?? 200;
	const lastEmitted = new Map<string, number>();
	let currentTick = 0;

	function emit(key: string, message: string): boolean {
		const previous = lastEmitted.get(key);
		if (previous !== undefined && currentTick - previous < minInterval) {
			return false;
		}
		// 删了再插, 让 Map 的插入序 = 最近输出序, 淘汰时才是"最久没输出的 key"
		lastEmitted.delete(key);
		lastEmitted.set(key, currentTick);
		if (lastEmitted.size > maxKeys) {
			const oldest = lastEmitted.keys().next();
			if (!oldest.done) {
				lastEmitted.delete(oldest.value);
			}
		}
		sink(`[nexus][${key}] ${message}`);
		return true;
	}

	return {
		beginTick(tick: number): void {
			currentTick = tick;
		},
		info(message: string): void {
			sink(`[nexus] ${message}`);
		},
		warn(key: string, message: string): boolean {
			return emit(`warn.${key}`, message);
		},
		error(key: string, message: string): boolean {
			return emit(`error.${key}`, message);
		},
	};
}
