/**
 * Creep 命名约定: `中文体名 代号-短十六进制串`, 如 采集体 H-3F2A。
 * 体名与代号来自 UnitConstant; 纯函数, 随机源与占用查询可注入, 便于测试与确定性复现。
 * 唯一命名入口: 所有孵化路径 (spawnDirector / legacy 孵化池 / directSpawn) 共用本生成器,
 * 保证 `代号-HEX` 的第二段恒为代号——感知侧 `unitCodeFromName` 依赖该形态解析角色。
 */
import { unitBodyName, unitCode } from "@/constant/UnitConstant";

export interface CreepNameSource {
	/** 用于生成十六进制串的随机数 [0,1), 游戏内传 Math.random */
	random: () => number;
	/** 名称占用查询, 游戏内传 (name) => name in Game.creeps */
	exists?: (name: string) => boolean;
	/** 体名覆盖 (首段), 如标注归属对象; 缺省取 UnitConstant 体名词表 */
	bodyName?: string;
}

const NAME_RETRY_LIMIT = 8;

export function generateCreepName(unit: string, source: CreepNameSource): string {
	const bodyName = source.bodyName ?? unitBodyName(unit);
	const code = unitCode(unit);
	let name = "";
	for (let attempt = 0; attempt < NAME_RETRY_LIMIT; attempt += 1) {
		// 2 字节短十六进制串: 65536 空间对单角色足够, 碰撞时重试
		const hex = Math.floor(source.random() * 0x10000)
			.toString(16)
			.toUpperCase()
			.padStart(4, "0");
		name = `${bodyName} ${code}-${hex}`;
		if (!source.exists?.(name)) {
			return name;
		}
	}
	return name;
}