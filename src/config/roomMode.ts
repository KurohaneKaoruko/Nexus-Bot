/**
 * 房间运行模式档位 (specs/room-mode-profiles):
 * 每己方房一个模式, 消费方统一经 strategy/roomMode resolver 读参数表,
 * 禁止各自维护模式字符串比较与魔法数。
 * 模式集合: low 低功耗 / main 常规 / high 全开 / rush 冲级特化。
 */

export type RoomModeName = "low" | "main" | "high" | "rush";

export interface RoomModeProfile {
	name: RoomModeName;
	/**
	 * 升级定编口径倍率: 升级火力按实测收入 × 该倍率定编。
	 * 定编教训 (race 服实测): 冲级档取 >1 会让升级任务永久欠账、
	 * 持续抢占 spawn, 把搬运舰队饿垮再重建——各档一律对齐收入 (1), 超额倍率禁止上架。
	 */
	upgradeIncomeMultiplier: number;
	/** 拉能快递总闸 (specs/rush-courier): 仅冲级类档位开启 */
	courierEnabled: boolean;
	/**
	 * 升级任务提权 (冲级期建造/升级能量之争): rcl ≤ belowRcl 时 upgrade 任务优先级
	 * 加 amount, 压过普通与 cc 工地 (地基建成后让位于扩容); 达到 belowRcl 后回落。
	 */
	upgradeBias?: { amount: number; belowRcl: number };
	/** 外矿同名-role 采集闸: 开 = 侦查邻房并产出远程 harvest/scout 任务 (外矿设计定案) */
	remoteMining: boolean;
}

/** 档位参数表: 后续参数扩展 (外矿/工业/low 降档) 的新消费参数一律入表, 不散落分支 */
export const ROOM_MODE_PROFILES: Record<RoomModeName, RoomModeProfile> = {
	low: { name: "low", upgradeIncomeMultiplier: 1, courierEnabled: false, remoteMining: false },
	main: { name: "main", upgradeIncomeMultiplier: 1, courierEnabled: false, remoteMining: true },
	high: { name: "high", upgradeIncomeMultiplier: 1, courierEnabled: false, remoteMining: true },
	rush: {
		name: "rush",
		upgradeIncomeMultiplier: 1,
		courierEnabled: true,
		// 冲级档不开外矿: rush 自动扩图会在本矿 0 采集时
		// 把孵化队列队头让给卡死的外矿单位, 控制冻结 (外矿设计定案)
		remoteMining: false,
		// 冲级底线 (bugs/P1-14): RCL4 前升级压过建造, 到 RCL4 后回落让 ext/路网扩容
		upgradeBias: { amount: 55, belowRcl: 4 },
	},
};

export const ROOM_MODE_CONFIG = {
	/** 未显式设置模式时的默认档: "auto" = 按 CPU 档位取默认, 或固定某档 */
	defaultMode: "auto" as "auto" | RoomModeName,
	/** auto 档判据: cpu.limit ≥ 该值默认 rush (冲级/高速服), 否则 main */
	cpuLimitRushThreshold: 100,
} as const;
