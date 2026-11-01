import type { VariantProfile } from "@/config/profile";

/**
 * stronghold 变体: 要塞挑战服 (RCL8 锁定 / 无限能量 spawn / 无源房)。
 * 房间模式固定 main 档; 模块清单由入口精简为孵化 + 战斗。
 */
export const STRONGHOLD_PROFILE: VariantProfile = {
	variant: "stronghold",
	roomMode: "main",
};
