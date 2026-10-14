import type { VariantProfile } from "@/config/profile";

/**
 * race 变体: 冲级服。
 * 模块清单与 main 一致 (主线即冲级架构); 变体差异 = roomMode 固定 rush 档,
 * 无条件走冲级参数 (快递/升级偏置/定编口径), 不依赖 cpu.limit 自动判档。
 */
export const RACE_PROFILE: VariantProfile = {
	variant: "race",
	roomMode: "rush",
};
