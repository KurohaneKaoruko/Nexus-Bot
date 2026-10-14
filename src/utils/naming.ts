/**
 * Creep 命名约定: `中文体名 代号-短十六进制串`, 如 采集体 H-3F2A / 全能体 UNIV-00FF。
 * 体名与代号来自 UnitConstant; 纯函数, 随机源与占用查询可注入, 便于测试与确定性复现。
 */
import { unitBodyName, unitCode } from "@/constant/UnitConstant";

export interface CreepNameSource {
	/** 用于生成十六进制串的随机数 [0,1), 游戏内传 Math.random */
	random: () => number;
	/** 名称占用查询, 游戏内传 (name) => name in Game.creeps */
	exists?: (name: string) => boolean;
}

const NAME_RETRY_LIMIT = 8;

export function generateCreepName(role: string, source: CreepNameSource): string {
	const bodyName = unitBodyName(role);
	const code = unitCode(role);
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

/** 单位代号 + 全局序号短名 (生成后全局唯一, 撞名递归重取) */
export function GenShortNumber(len = 4) {
    return (Game.time*1296 + Math.floor(Math.random()*1296))
            .toString(36)
            .slice(-len)
            .toUpperCase();
}

export function GenCreepName(code: string) {
    const number = GenShortNumber();
    const name = `${code}#${number}`;
    if (Game.creeps[name]) {
        return GenCreepName(code);
    } else {
        return name;
    }
}
