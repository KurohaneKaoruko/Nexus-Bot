/**
 * 变体装配参数。
 * 模块组合由各变体入口的 .use(...) 清单显式表达 (docs/22 单一事实源);
 * 部署目标与凭据在 .secret.json (不入库)。
 */
import type { RoomModeName } from "@/config/roomMode";

export interface VariantProfile {
	/** 变体名, 与 .secret.json branches 的键一致 */
	readonly variant: string;
	/**
	 * 变体级房间模式固定档 (可选): 设置后跳过 cpu 档位自动判档, 所有房间缺省取该档。
	 * 用途: 冲级服 (race) 无条件 rush; 缺省 undefined = 维持配置默认链 (显式 > auto 判档)。
	 */
	readonly roomMode?: RoomModeName;
}

/** 缺省变体: 官服部署口径 (纯 Nexus 模块清单) */
export const DEFAULT_PROFILE: VariantProfile = {
	variant: "main",
};
