/**
 * 角色代号表与中文体名表 (UnitData 的派生视图)。
 * 代号/体名均从 `UnitData` 单源派生, 新增角色无需在本表登记。
 * 名称格式 `中文体名 代号-HEX`, 如 采集体 H-3F2A。
 */
import { UnitData, type UnitId } from "@/constant/CreepConstant";

export type { UnitId };

/**
 * 角色代号 (`UnitData[].code`, 缺省回退角色名大写)。
 * 派生而非手抄: 两表并存时新增角色必漏, 回退形态会污染 creep 名与感知侧解析。
 */
export const UNIT_CODES: Readonly<Record<UnitId, string>> = Object.freeze(
	Object.fromEntries(
		Object.entries(UnitData).map(([id, def]) => [id, def.code ?? id.toUpperCase()]),
	) as Record<UnitId, string>,
);

/** 取角色代号 */
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
	"up-upgrade": "加速升级体",
	"up-repair": "加速维修体",

	/* 占领房间 */
	claimer: "占领体",
	"attack-claimer": "强攻占领体",

	/* 援建 */
	"aid-build": "援建体",
	"aid-carry": "援建搬运体",
	"aid-upgrade": "援建升级体",

	/* 一体机 */
	"one-ranged": "远程一体体",
	aio: "进攻一体体",
	saio: "支援一体体",

	/* 二人队 */
	"double-attack": "双人突击体",
	"double-dismantle": "双人拆除体",
	"double-heal": "双人治疗体",

	/* 四人队 */
	"team-attack": "四人队突击体",
	"team-dismantle": "四人队拆除体",
	"team-heal": "四人队治疗体",
	"team-ranged": "四人队远程体",

	/* 主动防御 */
	defender: "防御体",
	"defend-attack": "防御突击体",
	"defend-ranged": "防御远程体",
	"defend-2attack": "防御双人突击体",
	"defend-2heal": "防御双人治疗体",

	/* 外矿 */
	reserver: "预定体",
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

	/* 跨分支共用 */
	attacker: "通用近战体",
	blinky: "风筝远程体",
	healer: "通用治疗体",
	quad: "四人队成员",
	colonist: "殖民开拓体",
	porter: "补充搬运体",
	courier: "资源派送体",
	picker: "掉落拾取体",
	puller: "拉动协作体",
	digger: "破墙开路体",
	tester: "测试体",
	"rampart-repairer": "城墙维修体",
	"nuke-repairer": "核弹维修体",
	"core-attacker": "核心清除体",
	"mineral-hauler": "矿物搬运体",
	"keeper-killer": "猎杀体",
	"score-hunter": "分数猎取体",
};

/** 取角色中文体名; 未收录角色回退为角色代号 */
export function unitBodyName(unit: string): string {
	return UNIT_BODY_NAMES[unit as UnitId] ?? unitCode(unit);
}