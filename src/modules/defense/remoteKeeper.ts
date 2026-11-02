/**
 * SK 房常驻覆盖编队 (docs/nexus-design/13 §24.2 四期, remote-keeper 2.1):
 * active 的 keeper/center 房按 lair 数提 kind="remote" 常驻编队需求
 * (压制 source keeper, 采集链的前置门)。与三期清理编队共用 squad id
 * (squad:remote:房名)——同房需战斗件时槽位取大合并, 语义一致。
 * 采集前置门 (2.2): emitActiveColonyTasks 侧查编队覆盖, 无覆盖不派采集。
 */
import type { TickContext } from "@/core";
import { requestSquad } from "@/core/store/runtime";
import { REMOTE_CONFIG } from "@/config/remote";
import { roomKind } from "@/utils/roomName";

/**
 * SK 房驻守规划主入口 (Defense 模块每节拍调用, 与 planRemoteClearSquads 同拍):
 * active 且 kind∈{keeper,center} 的外矿房 → 常驻编队请求 (续期即每 tick)。
 */
export function planKeeperHoldSquads(ctx: TickContext): void {
	for (const colony of Object.values(ctx.memory.remotes ?? {})) {
		for (const [roomName, rec] of Object.entries(colony.rooms)) {
			const kind = roomKind(roomName);
			if (kind !== "keeper" && kind !== "center") continue;
			if (rec.state !== "active") continue;
			// 配槽: 每 lair 一组; lair 未知 (intel 缺) 按 SK 房定式 3 lair
			const lairCount = Math.max(1, ctx.memory.rooms[roomName]?.lairs?.length ?? 3);
			requestSquad({
				kind: "remote",
				roomName,
				slots: lairCount * REMOTE_CONFIG.keeper.slotsPerLair,
				taskKind: "defend",
				capabilities: ["ranged", "move"],
				priority: 60,
				reason: `keeper-hold:lairs:${lairCount}`,
			});
		}
	}
}
