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
 * 闪电战打法参数 (盾队站桩 + 蓝球散爬输出)。
 *
 * @remarks
 * beatstronghold 口径: 盾队顶到敌建筑群外沿站桩, 把塔火与守军仇恨吸在身上,
 * 当奶站+肉盾; 输出靠蓝球在建筑外沿安全点齐射。
 * 盾队旗 secondaryColor=PURPLE (rush) 恒 attack 不 flee, 死战不退。
 */
export const STRONGHOLD_BLITZ = {
    /** 盾队配置键 (quad 2x2: 首员纯肉盾, 其余全奶) */
    guardConfig: "SRG/4",
    /** 蓝球配置键 (散爬, 每爬一旗一安全点) */
    rangedConfig: "SRD/1",
    /** 盾队数量上限 */
    guardTeamCap: 2,
    /** 蓝球数量上限 */
    rangedCap: 28,
    /** 盾队满员后开始出蓝球的延迟 (tick) */
    rangedDelayTicks: 500,
    /** 调度/落位扫描间隔 (tick) */
    spotScanInterval: 10,
    /** 蓝球集结期落点: 目标房靠孵化房一侧边缘内偏移格数 (塔射程外 22+ 格的远围) */
    guardPostOffset: 2,
    /** 盾队耗能位: 距最近敌塔的切比雪夫距离 (塔在 20 格内就能开火, 20 格外降到最低档 150/发) */
    guardDrainRange: 17,
    /** 盾队站桩点: 敌建筑群包围盒外沿再让出的格数 (0 = 紧贴 rampart 环) */
    guardTankGap: 1,
    /** 蓝球总攻阈值: 存活数达到此数即开总攻。
     * 核心会给塔补能 (实测 1750→4810 一次回满), 抽干不现实, 只能靠数量抢时间 */
    rangedPushCount: 21,
    /** 总攻收束阈值: 蓝球掉到此数以下关总攻锁, 回集结位 (避免单只裸冲送死) */
    rangedRetreatCount: 4,
    /** 蓝球总攻站位: 敌建筑群外沿的包围环层数 (1 = 紧贴 rampart 环) */
    rangedRingLayers: 1,
} as const;
