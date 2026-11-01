/**
 * 外矿控制台命令组 (docs/nexus-design/13 §24.7.1 manual, phase4 4.5)。
 *
 * Nexus.remote.pin / ban / clear / list + Nexus.remotes() 查询。
 * manual 字段是状态机输入 (pin 跳过净收益门槛不跳安全规则 / ban 永不准入),
 * 控制台只写 manual 与候选注册, 状态推进由 remote-planner 下一规划拍承接。
 */
import { log } from "@/utils/log";

/** 母房名推断: 唯一己方房, 或房名显式给定 */
function homeOf(roomName?: string): string | undefined {
	if (roomName) {
		const owned = Game.rooms[roomName]?.controller?.my;
		if (!owned) {
			log("", `房间 ${roomName} 不是己方房 (母房须为己方房)`);
			return undefined;
		}
		return roomName;
	}
	const owned = Object.values(Game.rooms).filter((r) => r.controller?.my);
	if (owned.length === 1) return owned[0]?.name;
	log("", `存在 ${owned.length} 个己方房, 请显式指定母房: Nexus.remote.pin(home, target)`);
	return undefined;
}

/** 殖民地子树定位 (懒建; 与 remote-planner 的 colonyOf 同构) */
function colonyRooms(home: string): Record<string, { manual?: "pin" | "ban" }> {
	const mem = Memory.Nexus as { remotes?: Record<string, { rooms: Record<string, { manual?: "pin" | "ban" }> }> };
	if (!mem.remotes) mem.remotes = {};
	if (!mem.remotes[home]) mem.remotes[home] = { rooms: {} };
	return mem.remotes[home]!.rooms;
}

function setManual(home: string, target: string, manual: "pin" | "ban"): void {
	const rooms = colonyRooms(home);
	const rec = (rooms[target] ?? {}) as { manual?: "pin" | "ban"; state?: string; since?: number; reason?: string; sources?: Record<string, unknown>; profile?: "energy" };
	rec.manual = manual;
	if (rec.state === undefined) {
		// 新注册: candidate 起点, 下一规划拍进状态机
		rec.state = "candidate";
		rec.since = Game.time;
		rec.reason = "console-manual";
		rec.sources = {};
		rec.profile = "energy";
	}
	rooms[target] = rec;
}

export const remoteConsole = {
	remote: {
		/** 钉选: 跳过净收益门槛与亏损剔除 (安全规则仍生效) */
		pin(target: string, home?: string) {
			const h = homeOf(home);
			if (!h || !target) return Error("用法: Nexus.remote.pin(targetRoom, homeRoom?)");
			setManual(h, target, "pin");
			log("", `已钉选 ${target} (母房 ${h}): 跳过净收益门槛, 安全规则仍生效`);
			return OK;
		},
		/** 封禁: 永不准入 */
		ban(target: string, home?: string) {
			const h = homeOf(home);
			if (!h || !target) return Error("用法: Nexus.remote.ban(targetRoom, homeRoom?)");
			setManual(h, target, "ban");
			log("", `已封禁 ${target} (母房 ${h}): 永不准入`);
			return OK;
		},
		/** 清除手动标记 (回到自动评估) */
		clear(target: string, home?: string) {
			const h = homeOf(home);
			if (!h || !target) return Error("用法: Nexus.remote.clear(targetRoom, homeRoom?)");
			const rec = colonyRooms(h)[target];
			if (rec) delete rec.manual;
			log("", `已清除 ${target} 的手动标记 (母房 ${h})`);
			return OK;
		},
		/** 列出殖民地全部外矿房状态 */
		list(home?: string) {
			const h = homeOf(home);
			if (!h) return Error("用法: Nexus.remote.list(homeRoom?)");
			const mem = Memory.Nexus as { remotes?: Record<string, { rooms: Record<string, { state: string; reason: string; manual?: string; estimate?: { net: number } }> }> };
			const rooms = mem.remotes?.[h]?.rooms ?? {};
			const rows = Object.entries(rooms).map(
				([name, r]) =>
					`${name}: ${r.state}${r.manual ? `(${r.manual})` : ""} net=${r.estimate?.net?.toFixed(2) ?? "?"} ← ${r.reason}`,
			);
			log("", rows.length ? rows.join("\n") : `母房 ${h} 无外矿记录`);
			return OK;
		},
	},
	/** 殖民地概览查询 (HUD 同源数据) */
	remotes() {
		const mem = Memory.Nexus as { remotes?: Record<string, { rooms: Record<string, { state: string; reason: string; estimate?: { net: number; s: number } }> }> };
		const out: Record<string, { rooms: Record<string, { state: string; reason: string }> }> = {};
		for (const [home, colony] of Object.entries(mem.remotes ?? {})) {
			const rooms: Record<string, { state: string; reason: string; net?: number; s?: number }> = {};
			for (const [name, r] of Object.entries(colony.rooms)) {
				const row: { state: string; reason: string; net?: number; s?: number } = {
					state: r.state,
					reason: r.reason,
				};
				if (r.estimate) {
					row.net = r.estimate.net;
					row.s = r.estimate.s;
				}
				rooms[name] = row;
			}
			out[home] = { rooms };
		}
		return out;
	},
};
