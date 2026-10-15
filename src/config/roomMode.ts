/**
 * 房间运行模式档位 (specs/room-mode-profiles):
 * 每己方房一个模式, 消费方统一经 strategy/roomMode resolver 读参数表,
 * 禁止各自维护模式字符串比较与魔法数。
 * 模式集合: low 低功耗 / main 常规 / high 全开 / rush 冲级特化 (火力全开, 功能给冲级让路) /
 * mini 迷你房 (常驻冲级 farm, 对应 mini 布局)。
 */

export type RoomModeName = "low" | "main" | "high" | "rush" | "mini";

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
	 * 升级体断粮直采 (bugs/P1-14 cc 断粮, (十) 正解方向2): 开 = cc 空且工位旁
	 * 无 pile 时升级体退化为长腿自取 (fetchEnergy 去最近货源), cc 有货自动回归
	 * 直供。仅无 courier 投喂经济的档位启用——rush 档的墓碑投喂闭环依赖钉工位
	 * ((九) 断粮回退实验实锤 arena −16%), 分档启用绕开冲突。
	 */
	upgraderForageOnStarve: boolean;
	/**
	 * 升级任务提权 (冲级期建造/升级能量之争): rcl ≤ belowRcl 时 upgrade 任务优先级
	 * 加 amount, 压过普通与 cc 工地 (地基建成后让位于扩容); 达到 belowRcl 后回落。
	 */
	upgradeBias?: { amount: number; belowRcl: number };
	/**
	 * 外矿政策 (用户口径 2026-10-15): "auto" = 自动扫描发展邻房 (仅冲级档——
	 * 外矿收入直接喂升级进度); "manual" = 只挖显式登记的远程源 (main 系常态,
	 * 目标列表见 Memory.Nexus.economy.remoteTargets); "off" = 不挖。
	 */
	remoteMining: "auto" | "manual" | "off";
	/**
	 * auto 档同时在发展的外矿房上限 (缺省 = 无限制)。定编是任务数驱动的
	 * (每远程源 +1 harvester), 不设上限时 8 邻房全开会瞬间抬高定编、淹没孵化
	 * 队列, 把本矿采集饿死——历史「rush 控制冻结」事故的机理。
	 */
	remoteAutoMaxRooms?: number;
}

/** 档位参数表: 后续参数扩展 (外矿/工业/low 降档) 的新消费参数一律入表, 不散落分支 */
export const ROOM_MODE_PROFILES: Record<RoomModeName, RoomModeProfile> = {
	low: {
		name: "low",
		upgradeIncomeMultiplier: 1,
		courierEnabled: false,
		upgraderForageOnStarve: true,
		remoteMining: "manual",
	},
	main: {
		name: "main",
		upgradeIncomeMultiplier: 1,
		courierEnabled: false,
		upgraderForageOnStarve: true,
		remoteMining: "manual",
	},
	high: {
		name: "high",
		upgradeIncomeMultiplier: 1,
		courierEnabled: false,
		upgraderForageOnStarve: true,
		remoteMining: "manual",
	},
	rush: {
		name: "rush",
		upgradeIncomeMultiplier: 1,
		courierEnabled: true,
		// rush 有 courier 墓碑投喂闭环, 直采会破坏钉工位 ((九) arena 实测 −16%)
		upgraderForageOnStarve: false,
		// 冲级档自动发展外矿: 外矿收入直接喂升级进度 (用户口径 2026-10-15)
		remoteMining: "auto",
		// 同时在发展的外矿房上限: 定编任务数驱动, 不设限会淹没孵化队列 (控制冻结机理)
		remoteAutoMaxRooms: 2,
		// 冲级底线 (bugs/P1-14): RCL4 前升级压过建造, 到 RCL4 后回落让 ext/路网扩容
		upgradeBias: { amount: 55, belowRcl: 4 },
	},
	// mini 迷你房: 常驻冲级 farm (对应 mini 布局), 非必要设施全关、拉能快递常驻
	mini: {
		name: "mini",
		upgradeIncomeMultiplier: 1.5,
		courierEnabled: true,
		upgraderForageOnStarve: false,
		remoteMining: "manual",
		upgradeBias: { amount: 55, belowRcl: 4 },
	},
};

export const ROOM_MODE_CONFIG = {
	/** 未显式设置模式时的默认档: "auto" = 按 CPU 档位取默认, 或固定某档 */
	defaultMode: "auto" as "auto" | RoomModeName,
	/** auto 档判据: cpu.limit ≥ 该值默认 rush (冲级/高速服), 否则 main */
	cpuLimitRushThreshold: 100,
} as const;
