/**
 * Creep 命名约定: `代号-短十六进制串`, 如 H-3F2A / UNIV-00FF。
 * 代号来自 roleCodes.ts;
 * 纯函数, 随机源与占用查询可注入, 便于测试与确定性复现。
 */
import { roleCode } from "@/constant/RoleConstant";

export interface CreepNameSource {
	/** 用于生成十六进制串的随机数 [0,1), 游戏内传 Math.random */
	random: () => number;
	/** 名称占用查询, 游戏内传 (name) => name in Game.creeps */
	exists?: (name: string) => boolean;
}

const NAME_RETRY_LIMIT = 8;

export function generateCreepName(role: string, source: CreepNameSource): string {
	const code = roleCode(role);
	let name = "";
	for (let attempt = 0; attempt < NAME_RETRY_LIMIT; attempt += 1) {
		// 2 字节短十六进制串: 65536 空间对单角色足够, 碰撞时重试
		const hex = Math.floor(source.random() * 0x10000)
			.toString(16)
			.toUpperCase()
			.padStart(4, "0");
		name = `${code}-${hex}`;
		if (!source.exists?.(name)) {
			return name;
		}
	}
	return name;
}
