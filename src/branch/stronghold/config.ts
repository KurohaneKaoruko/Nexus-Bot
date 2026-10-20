import type { ServerCaps } from "@/config/capabilities";

/**
 * 要塞挑战服配置: RCL8 锁定 + spawn 能量视为无限 + 无源房。
 *
 * @remarks
 * 只保留孵化与战斗所需的运行时能力; 经济/扩张/工业等模块不在入口挂载,
 * 因此这里只关闭与编队孵化直接相关的闸门。
 */
export const STRONGHOLD_SERVER_CAPS: Partial<ServerCaps> = {
    racePanel: false,
    boostResCheck: false,
    energyCheck: false,
    defaultRoomMode: "main",
};

/** 一体机小队模板: 键为配置短名, 值为 member() 可解析的体型字符串 */
export const STRONGHOLD_TEAM_BODIES = {
    AIO: "T10R15H15M10N",
    AIOH: "T10R10H20M10N",
    AIOD: "T10R25H5M10N",
} as const;

export const STRONGHOLD_TEAM = {
    /** ATK 旗缺省编队 (九人三方阵) */
    defaultConfig: "AIO/9",
    /** ATK 旗缺省派兵间隔 (0 = 队列空闲即派) */
    defaultInterval: 0,
    /** 场上同时存在的队伍上限 (含蓝球散爬队) */
    teamCap: 30,
    /** 短名自动补全的编队规模 (如 AIO → AIO/4) */
    shortNameFormations: [4, 2],
    /** 注册到 TeamConfig 的编队规模 */
    formations: [9, 4],
    /** ATK 旗前缀 */
    flagPrefix: "ATK",
    /** 旗名分段分隔符 (两种写法等价) */
    segmentSeparator: /[/_]/,
    /** N 次数段 / T 间隔段 */
    countSegment: /^N(\d+)$/,
    intervalSegment: /^T(\d+)$/,
    /** 旗名内显式孵化房的房间名格式 */
    roomNameSegment: /^[EW]\d+[NS]\d+$/,
} as const;

/** 指挥旗自动落位参数 */
export const STRONGHOLD_ANCHOR = {
    /** 落位扫描间隔 (tick) */
    interval: 10,
    /** 多队锚点之间的最小切比雪夫间距 */
    minSpacing: 3,
    /** 房间边长 (Screeps 固定 50) */
    roomSize: 50,
    /** 安全点与房间边界的最小距离 */
    edgeMargin: 1,
} as const;

/**
 * 闪电战打法参数 (盾队抗伤 + 蓝球散爬输出)。
 *
 * @remarks
 * 盾队 = 2x2 方阵纯抗伤 (肉盾队长 + 全奶), 顶住塔伤开路;
 * 蓝球 = 散装远程爬, 各占一个安全输出位 (建筑群外沿 BFS 第一圈),
 * 齐射 rampart 露头目标, 够得着核心时直击核心。
 */
export const STRONGHOLD_BLITZ = {
    /** 盾队配置键 (quad 2x2: 首员纯肉盾, 其余全奶) */
    guardConfig: "SRG/4",
    /** 蓝球配置键 (散爬, 每爬一旗一安全点) */
    rangedConfig: "SRD/1",
    /** 盾队数量上限 */
    guardTeamCap: 2,
    /** 蓝球数量上限 */
    rangedCap: 24,
    /** 盾队满员后开始出蓝球的延迟 (tick) */
    rangedDelayTicks: 500,
    /** 调度/落位扫描间隔 (tick) */
    spotScanInterval: 10,
} as const;
