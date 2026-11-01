import type { VariantProfile } from "@/config/profile";

/**
 * race 变体: 冲级服。
 * roomMode 固定 rush 档供主链模块消费; 本变体链上行为模块只有
 * RaceSpeedrun (固定布局引擎), 模块清单差异见 main.ts 头注。
 */
export const RACE_PROFILE: VariantProfile = {
	variant: "race",
	roomMode: "rush",
};
