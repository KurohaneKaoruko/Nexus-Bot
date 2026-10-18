/**
 * Phase 3 防御/恢复参数集中配置 (docs/nexus-design/09 / docs/nexus-design/14 Phase 3)。
 * 全部可调参数只在此处定义, 模块禁止散落魔法数;
 * 数值为 NPC Invader 量级基线, 按战损统计 (docs/nexus-design/09 §9.5) 校准。
 */

/** 威胁模型 (docs/nexus-design/09 §9.2) */
export const THREAT_CONFIG = {
	/** 每部件威胁能力估值 (attack/ranged/heal/tough/move) */
	partWeights: { attack: 30, ranged: 12, heal: 24, tough: 3, move: 0 } as Record<string, number>,
	/** Boost 部件的能力放大倍数 */
	boostMultiplier: 2,
	/** 接近关键资产的加成上限倍数 (score × (1..1+weight)) */
	proximityWeight: 1,
	/** 距关键资产该切比雪夫距离内开始加权 */
	proximityRange: 20,
	/** 类别乘数: 玩家敌人比 NPC Invader 更值得响应 */
	categoryMultiplier: { npc: 1, player: 2.5 } as Record<"npc" | "player", number>,
	/** 未观测每 tick 的分数衰减乘子 */
	decayFactor: 0.97,
	/** 未观测置信度半衰期 (tick) */
	confidenceHalfLife: 150,
	/** 未观测超过该 tick 清除威胁记录 */
	staleTicks: 600,
	/** 低于该分视为无害 (威胁窗口关闭线) */
	harmlessScore: 20,
	/** 威胁分级阈值: low 以上生成 defend/retreat, high 增编 */
	tierThresholds: { low: 60, high: 300 },
	/** war 姿态进出阈值 (阈值分离防抖, docs/nexus-design/19 §19.4) */
	postureWarEnterScore: 400,
	postureWarExitScore: 100,
} as const;

/** 塔控制 (docs/nexus-design/09 §9.3/§9.4) */
export const TOWER_CONFIG = {
	/** 低于该能源停止修缮等非关键用途, 只保留对敌/治疗 */
	energyFloor: 350,
	/** 低于该能源进入补给配额 (成为高优先级搬运目的地) */
	resupplyTrigger: 600,
	/** 补给目标线 (headroom = target - 库存 - 在途) */
	resupplyTarget: 900,
	/** 多塔分配时已分配伤害达到目标生命即换目标 (防过度集火) */
	overkillHeadroom: 0,
	/** 目标可行性折算: 敌方每点治疗/折算抵消量 (估算击杀可行性) */
	healDenialFactor: 20,
	/** 塔行动提案优先级 (结构 actor 无任务租约, 需自带优先级进 broker 仲裁) */
	actionPriority: 90,
} as const;

/** SafeMode 政策 (docs/nexus-design/09 §9.3) */
export const SAFEMODE_CONFIG = {
	/** 视为「关键结构濒毁」的耐久比例 (hits < hitsMax × ratio) */
	criticalHitsRatio: 0.4,
	/** 计入濒毁判定的结构类型 */
	criticalTypes: ["spawn", "tower", "storage"] as readonly string[],
	/** 威胁分超过该值视为常规防御不足 */
	threatDeficitScore: 500,
	/** 激活尝试后的冷却 (tick), 防每 Tick 重试 */
	retryCooldown: 500,
} as const;

/** 维修目标 (docs/nexus-design/09 §9.3 被动防御 / docs/api/08 §8.6) */
export const REPAIR_CONFIG = {
	/** 结构类型 → 战略价值 tier (排序用, 未收录按 1) */
	valueTier: {
		spawn: 5,
		tower: 5,
		storage: 4,
		extension: 3,
		rampart: 3,
		wall: 2,
		container: 2,
		road: 1,
	} as Record<string, number>,
	/** 普通结构维护线: 修至 hitsMax × 该比例即完成 */
	maintainRatio: 0.9,
	/** 墙体维护线 (绝对耐久, 不随 hitsMax) */
	wallMaintainHits: 30000,
	/** 城门维护线 (绝对耐久) */
	rampartMaintainHits: 50000,
	/** 感知只收录耐久低于该值的墙/城门 (高于视为完好, 快照有界) */
	wallScanCeiling: 200000,
	/** 距敌方该切比雪夫距离内视为威胁区域 (排序加成) */
	threatZoneRange: 8,
	/** 威胁区域排序加成 (repairRank 排序分, 大者优先, 维持正分语义) */
	threatZoneBonus: 25,
	/** 威胁活跃期防线 (墙/城门) 抢修提级幅度 (等级提前量) */
	defenseLineThreatBonus: 3,
	/** 同房间并发维修任务上限 (有界) */
	maxConcurrentTasks: 4,
} as const;

/** 战斗单位编制 (docs/nexus-design/09 §9.3 主动单位防御) */
export const STAFFING_CONFIG = {
	/** 威胁分级 → defender 编制目标 (和平不养常备军) */
	tierDefenders: { peace: 0, low: 1, high: 2 } as Record<"peace" | "low" | "high", number>,
} as const;

/** 撤退 (docs/nexus-design/09 §9.3 非战斗单位) */
export const RETREAT_CONFIG = {
	/** 撤退锚点选择: spawn 优先, 缺省 controller */
	anchor: "spawn" as "spawn" | "controller",
	/** 距锚点该范围内视为已撤离 (保持不动) */
	anchorRadius: 3,
	/** 撤退结束线: 威胁分低于该值 cancel 撤退任务 (与进入线分离防抖) */
	exitScore: 15,
} as const;

/** 战斗 Agent 行为 */
export const COMBAT_CONFIG = {
	/** 友方损血比例低于该值时持治疗部件的 defender 优先治疗 (hits < hitsMax × 该值) */
	healThreshold: 0.7,
} as const;

/** 战损统计 (docs/nexus-design/14 Phase 3: 战损有预算与统计) */
export const WAR_STATS_CONFIG = {
	/** 塔能耗窗口折叠长度 (tick), 每 window 折一次 EMA */
	foldWindowTicks: 100,
	/** EMA 折叠系数 (新窗口均值权重) */
	foldSmoothing: 0.3,
	/** 每次塔行动能耗 */
	towerEnergyPerAction: 10,
} as const;
