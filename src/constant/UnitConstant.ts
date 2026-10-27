/**
 * 类型代号表与中文体名表 (UnitData 的派生视图)。
 * 代号/体名均从 `UnitData` 单源派生, 新增类型无需在本表登记。
 * 名称格式 `中文体名 代号-HEX`, 如 采集体 H-3F2A。
 */
import { UnitData, type UnitId } from "@/constant/CreepConstant";

export type { UnitId };

/**
 * 类型代号 (`UnitData[].code`, 缺省回退类型名大写)。
 * 派生而非手抄: 两表并存时新增类型必漏, 回退形态会污染 creep 名与感知侧解析。
 */
export const UNIT_CODES: Readonly<Record<UnitId, string>> = Object.freeze(
	Object.fromEntries(
		Object.entries(UnitData).map(([id, def]) => [id, def.code ?? id.toUpperCase()]),
	) as Record<UnitId, string>,
);

/** 取类型代号 */
export function unitCode(unit: string): string {
	return UNIT_CODES[unit as UnitId] ?? unit.toUpperCase();
}

/**
 * 中文体名表 (展示前缀)。
 * 声明为全量 Record 而非 Partial: 漏登记即编译失败, 杜绝 creep 名回退成裸代号。
 */
export const UNIT_BODY_NAMES: Record<UnitId, string> = {
	/* 基本房间运营 */
	harvester: "采集体",
	carrier: "搬运体",
	transporter: "建筑搬运体",
	manager: "中央搬运体",
	upgrader: "升级体",
	worker: "工作体",
	miner: "元素矿工",
	universal: "全能体",
	"rush-courier": "快递体",

	/* 特殊用途 */
	scout: "侦察体",
	logistic: "长途运输体",
	cleaner: "清理体",
	dismantle: "拆除体",

	/* 冲级专属 (race speedrun 直通模块) */
	hauler: "冲级搬运体",
	tug: "拖拽体",
	paver: "铺路体",
	spawnFiller: "孵化补给体",
	hubFiller: "枢纽补给体",

	/* 占领房间 */
	claimer: "占领体",
	"attack-claimer": "强攻占领体",

	/* 一体机 */
	aio: "进攻一体体",

	/* 二人队 */

	/* 连结队 */
	"team-attack": "连结突击体",
	"team-dismantle": "连结拆除体",
	"team-heal": "连结治疗体",
	"team-ranged": "连结远程体",

	/* 主动防御 */
	defender: "防御体",
	"defend-2heal": "防御双人治疗体",

	/* 外矿 */
	reserver: "预定体",
	remoteMiner: "外矿矿工",
	"out-build": "外矿建造体",
	"out-defend": "外矿防御体",
	"out-2attack": "外矿双人突击体",
	"out-2heal": "外矿双人治疗体",
	"out-invader": "外矿入侵体",
	"out-attack": "外矿突击体",
	"out-ranged": "外矿远程体",
	"out-mineral": "外矿矿工",
	"out-repair": "外矿维修体",

	/* 沉积物 */
	"deposit-harvest": "沉积物采集体",
	"deposit-transfer": "沉积物转运体",
	"deposit-attack": "沉积物突击体",
	"deposit-heal": "沉积物治疗体",
	"deposit-ranged": "沉积物远程体",

	/* Power */
	"power-attack": "智械突击体",
	"power-heal": "智械治疗体",
	"pc-heal": "智械护工",
	"power-carry": "智械搬运体",
	"power-ranged": "智械远程体",
};

/** 取类型中文体名; 未收录类型回退为类型代号 */
export function unitBodyName(unit: string): string {
	return UNIT_BODY_NAMES[unit as UnitId] ?? unitCode(unit);
}