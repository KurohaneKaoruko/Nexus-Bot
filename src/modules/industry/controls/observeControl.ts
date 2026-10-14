
/**
 * Observer 控制模块: 观察队列 + 回调 (纯函数, Industry TickModule 驱动)。
 * observeRoom 入队 → runObserveWork 每 tick 执行一个 → 回调在下一 tick 链首执行。
 */

interface ObserveTask {
	roomName: string;           // 目标房间名
	observerId: string;         // 使用的 observer ID
	callbacks: (() => void)[];  // 回调函数列表
	addTime: number;            // 加入队列的时间
}

interface ObserveCallback {
	roomName: string;           // 被观察的房间名
	callbacks: (() => void)[];  // 回调函数列表
	tick: number;               // 执行的 tick
}

const observerQueueByRoom: Record<string, ObserveTask[]> = {};
const observerCallbacks: ObserveCallback[] = [];

/**
 * 使用 Observer 观察指定房间 (入队, 每 tick 消费一个)。
 * @returns 是否成功加入队列
 */
export function observeRoom(room: Room, targetRoomName: string, callback?: () => void): boolean {
	// 没有 observer 时返回 false
	if (!room.observer) return false;

	// 检查是否已经在本 tick 观察过该房间
	const queue = (observerQueueByRoom[room.name] ??= []);
	const existingIndex = queue.findIndex((t) => t.roomName === targetRoomName);

	if (existingIndex !== -1) {
		// 如果已存在，更新回调（合并多个回调）
		if (callback) {
			queue[existingIndex]!.callbacks.push(callback);
		}
		return true;
	}

	// 加入队列
	queue.push({
		roomName: targetRoomName,
		observerId: room.observer.id,
		callbacks: callback ? [callback] : [],
		addTime: Game.time,
	});

	return true;
}

/**
 * 执行 Observer 任务 (每 tick 一个, Industry 结构链驱动)。
 */
export function runObserveWork(room: Room): void {
	const queue = observerQueueByRoom[room.name];
	if (!queue || queue.length === 0) return;

	// 获取房间的 observer
	const observer = room.observer;
	if (!observer) {
		queue.length = 0;
		return;
	}

	// 执行队列中的任务（每 tick 只执行一个）
	const task = queue.shift();
	if (!task) return;

	// 执行 observeRoom
	const code = observer.observeRoom(task.roomName);

	if (code === OK) {
		// 观察成功，注册下一 tick 的回调
		if (task.callbacks.length > 0) {
			observerCallbacks.push({
				roomName: task.roomName,
				callbacks: task.callbacks,
				tick: Game.time + 1,
			});
		}
	} else {
		// 观察失败，记录日志
		console.log(`[ObserveControl] ${room.name} observe ${task.roomName} failed: ${code}`);
	}
}

/**
 * 处理 Observer 回调 (上一 tick 观察成功的, Industry 结构链首驱动)。
 */
export function runObserveCallbackTick(): void {
	const currentTime = Game.time;

	// 找出需要执行的回调
	const toExecute: ObserveCallback[] = [];
	for (let i = observerCallbacks.length - 1; i >= 0; i--) {
		if ((observerCallbacks[i]?.tick ?? Infinity) <= currentTime) {
			toExecute.push(observerCallbacks.splice(i, 1)[0]!);
		}
	}

	// 执行回调
	for (const cb of toExecute) {
		for (const callback of cb.callbacks) {
			try {
				callback();
			} catch (e) {
				console.log(`[ObserveControl] Callback error: ${e}`);
			}
		}
	}
}

/**
 * 获取队列状态（调试用）。
 */
export function getObserveQueueStatus(): { queueLength: number; pendingCallbacks: number } {
	const queueLength = Object.values(observerQueueByRoom).reduce((s, q) => s + q.length, 0);
	return {
		queueLength,
		pendingCallbacks: observerCallbacks.filter((cb) => cb.tick > Game.time).length,
	};
}
